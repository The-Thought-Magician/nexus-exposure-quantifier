'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const currency = (v: unknown) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  if (n === null || n === undefined || Number.isNaN(n)) return '$0'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const bandTone = (band?: string) => {
  switch ((band || '').toLowerCase()) {
    case 'high':
    case 'critical':
      return 'red' as const
    case 'medium':
    case 'moderate':
      return 'amber' as const
    case 'low':
      return 'green' as const
    default:
      return 'slate' as const
  }
}

interface StateExposure {
  state: string
  tax?: number | string
  penalty?: number | string
  interest?: number | string
  total?: number | string
  vda_total?: number | string
  vda_savings?: number | string
  materiality_band?: string
}

export default function SharedSnapshotPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [snapshot, setSnapshot] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    api
      .getSharedSnapshot(token)
      .then((data) => {
        if (active) setSnapshot(data)
      })
      .catch((e) => {
        if (active) setError(e?.message || 'This snapshot could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950">
        <Spinner label="Loading shared snapshot..." />
      </main>
    )
  }

  if (error || !snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg">
          <EmptyState
            icon="🔒"
            title="Snapshot unavailable"
            description={
              error ||
              'This share link is invalid or has been revoked. Ask the engagement owner for a fresh link.'
            }
            action={
              <Link href="/" className="text-sm text-violet-400 hover:text-violet-300">
                Go to NexusExposureQuantifier
              </Link>
            }
          />
        </div>
      </main>
    )
  }

  // Snapshot shape: { id, share_token, label, created_at, data: {...} }
  const data = snapshot.data || snapshot
  const engagement = data.engagement || data
  const totals = data.totals || engagement || {}
  const stateExposures: StateExposure[] = data.state_exposures || data.exposures || data.stateExposures || []
  const crossings: any[] = data.crossings || []
  const scenarios: any[] = data.scenarios || []
  const asOf = engagement.as_of_date || data.as_of_date

  const crossedCount = crossings.filter((c) => c.has_crossed).length
  const recommended = scenarios.find((s) => s.is_recommended)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      {/* Read-only banner */}
      <div className="border-b border-violet-500/20 bg-violet-500/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-violet-200">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-violet-600 text-xs font-black text-white">
              N
            </span>
            <span className="font-semibold">NexusExposureQuantifier</span>
            <Badge tone="violet">Read-only diligence snapshot</Badge>
          </div>
          <div className="text-xs text-slate-400">
            Shared {snapshot.created_at ? new Date(snapshot.created_at).toLocaleDateString() : ''}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-100">
              {engagement.name || snapshot.label || 'Exposure Snapshot'}
            </h1>
            {engagement.status ? <Badge tone="slate">{engagement.status}</Badge> : null}
            {engagement.is_locked ? <Badge tone="amber">Locked</Badge> : null}
          </div>
          {engagement.description ? (
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{engagement.description}</p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            {asOf ? `As of ${new Date(asOf).toLocaleDateString()}` : null}
            {snapshot.label ? `  ·  ${snapshot.label}` : null}
          </p>
        </header>

        {/* KPI tiles */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Total Exposure" value={currency(totals.total_exposure)} tone="violet" />
          <Stat label="Tax" value={currency(totals.total_tax)} />
          <Stat label="Penalty" value={currency(totals.total_penalty)} tone="amber" />
          <Stat label="Interest" value={currency(totals.total_interest)} tone="amber" />
        </section>
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="VDA Savings" value={currency(totals.total_vda_savings)} tone="green" />
          <Stat label="States with Nexus" value={crossedCount || stateExposures.length} />
          <Stat label="States Analyzed" value={crossings.length || stateExposures.length} />
          <Stat
            label="Recommended Path"
            value={recommended ? recommended.kind : '—'}
            tone={recommended ? 'green' : 'default'}
          />
        </section>

        {/* Per-state exposure */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-100">Per-state exposure</h2>
          </CardHeader>
          <CardBody className="p-0">
            {stateExposures.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState title="No exposure detected" description="No state exceeded economic-nexus thresholds in this snapshot." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>State</TH>
                    <TH className="text-right">Tax</TH>
                    <TH className="text-right">Penalty</TH>
                    <TH className="text-right">Interest</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">VDA Total</TH>
                    <TH className="text-right">VDA Savings</TH>
                    <TH>Band</TH>
                  </TR>
                </THead>
                <TBody>
                  {stateExposures.map((s) => (
                    <TR key={s.state}>
                      <TD className="font-medium text-slate-100">{s.state}</TD>
                      <TD className="text-right">{currency(s.tax)}</TD>
                      <TD className="text-right text-amber-300">{currency(s.penalty)}</TD>
                      <TD className="text-right text-amber-300">{currency(s.interest)}</TD>
                      <TD className="text-right font-semibold text-slate-100">{currency(s.total)}</TD>
                      <TD className="text-right text-slate-400">{currency(s.vda_total)}</TD>
                      <TD className="text-right text-emerald-300">{currency(s.vda_savings)}</TD>
                      <TD>
                        <Badge tone={bandTone(s.materiality_band)}>{s.materiality_band || 'n/a'}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Crossings */}
        {crossings.length > 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-100">Nexus crossings</h2>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>State</TH>
                    <TH>Crossed</TH>
                    <TH>Crossing date</TH>
                    <TH>Tripping test</TH>
                    <TH className="text-right">Measure at crossing</TH>
                    <TH className="text-right">Threshold</TH>
                  </TR>
                </THead>
                <TBody>
                  {crossings.map((c) => (
                    <TR key={c.state}>
                      <TD className="font-medium text-slate-100">{c.state}</TD>
                      <TD>
                        {c.has_crossed ? (
                          <Badge tone="red">Crossed</Badge>
                        ) : (
                          <Badge tone="green">Below threshold</Badge>
                        )}
                      </TD>
                      <TD className="text-slate-400">
                        {c.crossing_date ? new Date(c.crossing_date).toLocaleDateString() : '—'}
                      </TD>
                      <TD className="text-slate-400">{c.tripping_test || '—'}</TD>
                      <TD className="text-right">{currency(c.measure_at_crossing)}</TD>
                      <TD className="text-right text-slate-400">{currency(c.threshold_used)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        ) : null}

        {/* Scenarios */}
        {scenarios.length > 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-100">Remediation scenarios</h2>
            </CardHeader>
            <CardBody>
              <div className="grid gap-4 md:grid-cols-3">
                {scenarios.map((sc, i) => {
                  const max = Math.max(
                    1,
                    ...scenarios.map((x) => Number(x.total) || 0),
                  )
                  const pct = Math.min(100, ((Number(sc.total) || 0) / max) * 100)
                  return (
                    <div
                      key={sc.id || i}
                      className={`rounded-xl border p-4 ${
                        sc.is_recommended
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : 'border-slate-800 bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold capitalize text-slate-200">
                          {sc.kind}
                          {sc.wait_months ? ` (${sc.wait_months}mo)` : ''}
                        </span>
                        {sc.is_recommended ? <Badge tone="green">Recommended</Badge> : null}
                      </div>
                      <div className="mt-3 text-2xl font-semibold text-slate-100">{currency(sc.total)}</div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full ${sc.is_recommended ? 'bg-emerald-500' : 'bg-violet-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-3 space-y-0.5 text-xs text-slate-500">
                        <div>Tax {currency(sc.total_tax)}</div>
                        <div>Penalty {currency(sc.total_penalty)}</div>
                        <div>Interest {currency(sc.total_interest)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        ) : null}

        <footer className="border-t border-slate-800 pt-6 text-xs text-slate-600">
          This is a point-in-time, read-only snapshot generated by NexusExposureQuantifier. Figures reflect the
          engagement state at the time the snapshot was created and are provided for diligence review only.
        </footer>
      </div>
    </main>
  )
}
