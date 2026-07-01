'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface Scenario {
  id: string
  engagement_id: string
  kind: string
  wait_months: number | null
  total_tax: number | string | null
  total_penalty: number | string | null
  total_interest: number | string | null
  total: number | string | null
  per_state?: PerStateRow[] | null
  is_recommended: boolean | null
  computed_at?: string | null
  created_at?: string | null
}

interface PerStateRow {
  state: string
  tax?: number | string | null
  penalty?: number | string | null
  interest?: number | string | null
  total?: number | string | null
  vda_total?: number | string | null
  vda_savings?: number | string | null
}

const SUB_NAV: { label: string; slug: string }[] = [
  { label: 'Summary', slug: '' },
  { label: 'Sales', slug: 'sales' },
  { label: 'Imports', slug: 'imports' },
  { label: 'Crossings', slug: 'crossings' },
  { label: 'Exposure', slug: 'exposure' },
  { label: 'Scenarios', slug: 'scenarios' },
  { label: 'Materiality', slug: 'materiality' },
  { label: 'Wait Cost', slug: 'wait-cost' },
  { label: 'Taxability', slug: 'taxability' },
  { label: 'Assumptions', slug: 'assumptions' },
  { label: 'Memo', slug: 'memo' },
  { label: 'Remediation', slug: 'remediation' },
  { label: 'Comments', slug: 'comments' },
  { label: 'Reports', slug: 'reports' },
]

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : 0
}

const money = (v: number | string | null | undefined) =>
  num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function kindMeta(kind: string): { label: string; tone: 'violet' | 'green' | 'amber' | 'blue' | 'slate'; blurb: string } {
  const k = (kind || '').toLowerCase()
  if (k.includes('register') || k === 'register_now' || k === 'register-now')
    return {
      label: 'Register Now',
      tone: 'blue',
      blurb: 'Register prospectively and remit full historical liability with penalties and interest accrued to date.',
    }
  if (k.includes('vda'))
    return {
      label: 'Voluntary Disclosure (VDA)',
      tone: 'green',
      blurb: 'Enter a VDA program: limited lookback, penalties typically waived, reduced total exposure.',
    }
  if (k.includes('wait'))
    return {
      label: 'Wait',
      tone: 'amber',
      blurb: 'Defer action. Penalties and interest continue to accrue and the VDA window keeps eroding.',
    }
  return { label: kind || 'Scenario', tone: 'slate', blurb: 'Computed exposure scenario.' }
}

function SubNav({ id, active }: { id: string; active: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
      {SUB_NAV.map((t) => {
        const href = t.slug ? `/dashboard/engagements/${id}/${t.slug}` : `/dashboard/engagements/${id}`
        const isActive = t.slug === active
        return (
          <Link
            key={t.slug || 'summary'}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

export default function ScenariosPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [computing, setComputing] = useState(false)
  const [waitMonths, setWaitMonths] = useState(12)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.listScenarios(id)
      setScenarios(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const recompute = async () => {
    setComputing(true)
    setError('')
    try {
      const data = await api.computeScenarios(id, waitMonths)
      if (Array.isArray(data)) setScenarios(data)
      else await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute scenarios')
    } finally {
      setComputing(false)
    }
  }

  const ordered = useMemo(() => {
    const rank = (k: string) => {
      const m = kindMeta(k).label
      if (m === 'Register Now') return 0
      if (m.startsWith('Voluntary')) return 1
      if (m === 'Wait') return 2
      return 3
    }
    return [...scenarios].sort((a, b) => rank(a.kind) - rank(b.kind))
  }, [scenarios])

  const recommended = useMemo(() => scenarios.find((s) => s.is_recommended) ?? null, [scenarios])

  const best = useMemo(() => {
    if (scenarios.length === 0) return null
    return [...scenarios].sort((a, b) => num(a.total) - num(b.total))[0]
  }, [scenarios])

  const worst = useMemo(() => {
    if (scenarios.length === 0) return null
    return [...scenarios].sort((a, b) => num(b.total) - num(a.total))[0]
  }, [scenarios])

  const maxTotal = useMemo(() => Math.max(1, ...scenarios.map((s) => num(s.total))), [scenarios])

  const spread = best && worst ? num(worst.total) - num(best.total) : 0

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={`/dashboard/engagements/${id}`}
            className="text-xs text-slate-500 transition-colors hover:text-violet-300"
          >
            ← Engagement
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">Scenario Comparison</h1>
          <p className="mt-1 text-sm text-slate-500">
            Register now vs. voluntary disclosure vs. wait — modeled total exposure and recommendation.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Wait horizon (months)</label>
            <input
              type="number"
              min={1}
              max={120}
              value={waitMonths}
              onChange={(e) => setWaitMonths(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            />
          </div>
          <Button onClick={recompute} disabled={computing}>
            {computing ? 'Computing…' : 'Recompute scenarios'}
          </Button>
        </div>
      </div>

      <SubNav id={id} active="scenarios" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <Spinner label="Loading scenarios…" />
      ) : scenarios.length === 0 ? (
        <EmptyState
          title="No scenarios computed yet"
          description="Run the scenario engine to model register-now, VDA, and wait outcomes for this engagement."
          action={
            <Button onClick={recompute} disabled={computing}>
              {computing ? 'Computing…' : 'Compute scenarios'}
            </Button>
          }
          icon={<span>⚖️</span>}
        />
      ) : (
        <div className="space-y-6">
          {recommended && (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardBody>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="green">Recommended path</Badge>
                      <span className="text-sm font-semibold text-slate-100">{kindMeta(recommended.kind).label}</span>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm text-slate-400">{kindMeta(recommended.kind).blurb}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Modeled total</div>
                    <div className="text-3xl font-bold text-emerald-300">{money(recommended.total)}</div>
                    {best && worst && recommended.id === best.id && spread > 0 && (
                      <div className="mt-1 text-xs text-emerald-400">
                        Saves {money(spread)} vs. worst-case path
                      </div>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Lowest exposure" value={best ? money(best.total) : '—'} tone="green" hint={best ? kindMeta(best.kind).label : undefined} />
            <Stat label="Highest exposure" value={worst ? money(worst.total) : '—'} tone="red" hint={worst ? kindMeta(worst.kind).label : undefined} />
            <Stat label="Decision spread" value={money(spread)} tone="violet" hint="Best vs. worst path delta" />
          </div>

          {/* Comparison bars */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Total exposure by path</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              {ordered.map((s) => {
                const meta = kindMeta(s.kind)
                const pct = (num(s.total) / maxTotal) * 100
                const barColor =
                  meta.tone === 'green'
                    ? 'bg-emerald-500'
                    : meta.tone === 'amber'
                    ? 'bg-amber-500'
                    : meta.tone === 'blue'
                    ? 'bg-sky-500'
                    : 'bg-violet-500'
                return (
                  <div key={s.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-medium text-slate-200">
                        {meta.label}
                        {s.kind.toLowerCase().includes('wait') && s.wait_months ? (
                          <Badge tone="slate">{s.wait_months} mo</Badge>
                        ) : null}
                        {s.is_recommended ? <Badge tone="green">Recommended</Badge> : null}
                      </span>
                      <span className="tabular-nums text-slate-300">{money(s.total)}</span>
                    </div>
                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  </div>
                )
              })}
            </CardBody>
          </Card>

          {/* Detail comparison table */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Component breakdown</h2>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Path</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Penalty</TH>
                  <TH className="text-right">Interest</TH>
                  <TH className="text-right">Total</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {ordered.map((s) => {
                  const meta = kindMeta(s.kind)
                  const open = expanded === s.id
                  const perState = Array.isArray(s.per_state) ? s.per_state : []
                  return (
                    <Fragment key={s.id}>
                      <TR className={s.is_recommended ? 'bg-emerald-500/5' : ''}>
                        <TD>
                          <div className="flex items-center gap-2">
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {s.kind.toLowerCase().includes('wait') && s.wait_months ? (
                              <span className="text-xs text-slate-500">{s.wait_months} mo</span>
                            ) : null}
                          </div>
                        </TD>
                        <TD className="text-right tabular-nums">{money(s.total_tax)}</TD>
                        <TD className="text-right tabular-nums">{money(s.total_penalty)}</TD>
                        <TD className="text-right tabular-nums">{money(s.total_interest)}</TD>
                        <TD className="text-right font-semibold tabular-nums text-slate-100">{money(s.total)}</TD>
                        <TD className="text-right">
                          {perState.length > 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpanded(open ? null : s.id)}
                            >
                              {open ? 'Hide states' : `${perState.length} states`}
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </TD>
                      </TR>
                      {open && perState.length > 0 && (
                        <tr className="bg-slate-950/40">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="overflow-x-auto rounded-lg border border-slate-800">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-900/80">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">State</th>
                                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">Tax</th>
                                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">Penalty</th>
                                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">Interest</th>
                                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                  {perState
                                    .slice()
                                    .sort((a, b) => num(b.total) - num(a.total))
                                    .map((ps) => (
                                      <tr key={ps.state}>
                                        <td className="px-3 py-2 font-medium text-slate-200">{ps.state}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-300">{money(ps.tax)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-300">{money(ps.penalty)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-300">{money(ps.interest)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">{money(ps.total)}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  )
}
