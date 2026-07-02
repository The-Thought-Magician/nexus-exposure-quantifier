'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

const asArray = <T,>(v: any, key?: string): T[] => {
  if (Array.isArray(v)) return v
  if (key && Array.isArray(v?.[key])) return v[key]
  if (Array.isArray(v?.data)) return v.data
  return []
}

interface Engagement {
  id: string
  name: string
  status?: string
  total_exposure?: number | string
}

interface StateHeat {
  state: string
  tax?: number | string
  penalty?: number | string
  interest?: number | string
  total?: number | string
  vda_savings?: number | string
  materiality_band?: string
  has_crossed?: boolean
}

interface TrendPoint {
  label?: string
  date?: string
  as_of?: string
  period?: string
  total_exposure?: number | string
  total?: number | string
  exposure?: number | string
  tax?: number | string
  penalty?: number | string
  interest?: number | string
}

const bandTone = (band?: string) => {
  switch ((band || '').toLowerCase()) {
    case 'high':
    case 'material':
      return 'red' as const
    case 'medium':
    case 'moderate':
      return 'amber' as const
    case 'low':
    case 'immaterial':
      return 'green' as const
    default:
      return 'slate' as const
  }
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<any>(null)
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [heat, setHeat] = useState<StateHeat[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [selectedEngagement, setSelectedEngagement] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')

  const loadDetail = useCallback((engagementId: string) => {
    setDetailLoading(true)
    setDetailError('')
    Promise.all([
      api.getAnalyticsByState(engagementId || undefined),
      engagementId ? api.getAnalyticsTrend(engagementId) : Promise.resolve([]),
    ])
      .then(([byState, tr]) => {
        setHeat(asArray<StateHeat>(byState, 'ranking'))
        setTrend(asArray<TrendPoint>(tr, 'trend'))
      })
      .catch((e) => setDetailError(e?.message || 'Failed to load analytics detail.'))
      .finally(() => setDetailLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.getAnalyticsOverview(), api.listEngagements()])
      .then(([ov, eng]) => {
        if (!active) return
        setOverview(ov)
        const list = asArray<Engagement>(eng, 'engagements')
        setEngagements(list)
        const first = list[0]?.id || ''
        setSelectedEngagement(first)
        loadDetail(first)
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Failed to load analytics.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadDetail])

  const tiles = overview?.tiles || overview || {}

  const rankedHeat = useMemo(
    () => [...heat].sort((a, b) => num(b.total) - num(a.total)),
    [heat],
  )
  const maxHeat = useMemo(
    () => rankedHeat.reduce((m, h) => Math.max(m, num(h.total)), 0),
    [rankedHeat],
  )

  const trendMax = useMemo(
    () =>
      trend.reduce(
        (m, p) => Math.max(m, num(p.total_exposure ?? p.total ?? p.exposure)),
        0,
      ),
    [trend],
  )

  const trendLabel = (p: TrendPoint, i: number) =>
    p.label || p.period || (p.date || p.as_of ? new Date((p.date || p.as_of) as string).toLocaleDateString() : `#${i + 1}`)

  function onSelect(id: string) {
    setSelectedEngagement(id)
    loadDetail(id)
  }

  if (loading) return <Spinner label="Loading analytics..." />

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Analytics</h1>
          <p className="mt-1 text-sm text-stone-500">
            Exposure heat ranking, trends, and portfolio KPIs across engagements.
          </p>
        </div>
        <select
          value={selectedEngagement}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All engagements (heat)</option>
          {engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      ) : null}

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Total Exposure"
          value={currency(tiles.total_exposure ?? tiles.totalExposure)}
          tone="violet"
          hint={`${tiles.engagement_count ?? engagements.length} engagements`}
        />
        <Stat label="Total Tax" value={currency(tiles.total_tax ?? tiles.totalTax)} />
        <Stat label="Total Penalty" value={currency(tiles.total_penalty ?? tiles.totalPenalty)} tone="amber" />
        <Stat label="Total Interest" value={currency(tiles.total_interest ?? tiles.totalInterest)} tone="amber" />
      </section>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="VDA Savings" value={currency(tiles.total_vda_savings ?? tiles.totalVdaSavings)} tone="green" />
        <Stat label="States with Nexus" value={tiles.states_with_nexus ?? tiles.statesWithNexus ?? '—'} />
        <Stat label="Open Engagements" value={tiles.open_engagements ?? tiles.openEngagements ?? engagements.length} />
        <Stat label="Locked" value={tiles.locked_engagements ?? tiles.lockedEngagements ?? '—'} />
      </section>

      {detailError ? (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{detailError}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Heat ranking */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-100">Exposure by state (heat ranking)</h2>
            {selectedEngagement ? <Badge tone="violet">Scoped</Badge> : <Badge tone="slate">All</Badge>}
          </CardHeader>
          <CardBody className="p-0">
            {detailLoading ? (
              <Spinner label="Loading heat ranking..." />
            ) : rankedHeat.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  icon="🗺️"
                  title="No exposure data"
                  description="Import sales and compute exposure for an engagement to populate the state heat ranking."
                />
              </div>
            ) : (
              <div className="space-y-3 px-5 py-4">
                {rankedHeat.slice(0, 15).map((h) => {
                  const total = num(h.total)
                  const pct = maxHeat > 0 ? Math.max(2, (total / maxHeat) * 100) : 0
                  return (
                    <div key={h.state}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-stone-200">{h.state}</span>
                          {h.materiality_band ? (
                            <Badge tone={bandTone(h.materiality_band)}>{h.materiality_band}</Badge>
                          ) : null}
                          {h.has_crossed ? <Badge tone="amber">crossed</Badge> : null}
                        </div>
                        <span className="font-semibold text-blue-300">{currency(total)}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Trend */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-stone-100">Exposure trend</h2>
          </CardHeader>
          <CardBody>
            {!selectedEngagement ? (
              <EmptyState
                icon="📈"
                title="Select an engagement"
                description="Choose an engagement above to see how its exposure grows as sales data is added."
              />
            ) : detailLoading ? (
              <Spinner label="Loading trend..." />
            ) : trend.length === 0 ? (
              <EmptyState
                icon="📈"
                title="No trend data"
                description="Trend appears once sales data and exposure are computed for this engagement."
              />
            ) : (
              <div>
                <div className="flex h-48 items-end gap-1.5">
                  {trend.map((p, i) => {
                    const v = num(p.total_exposure ?? p.total ?? p.exposure)
                    const pct = trendMax > 0 ? Math.max(2, (v / trendMax) * 100) : 0
                    return (
                      <div key={i} className="group flex flex-1 flex-col items-center justify-end">
                        <div className="mb-1 hidden text-[10px] text-stone-400 group-hover:block">{currency(v)}</div>
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-blue-700 to-blue-400 transition-all group-hover:from-blue-600 group-hover:to-blue-300"
                          style={{ height: `${pct}%` }}
                          title={`${trendLabel(p, i)}: ${currency(v)}`}
                        />
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-stone-600">
                  <span>{trendLabel(trend[0], 0)}</span>
                  {trend.length > 1 ? <span>{trendLabel(trend[trend.length - 1], trend.length - 1)}</span> : null}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Ranked table */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-100">State exposure breakdown</h2>
          <span className="text-xs text-stone-500">{rankedHeat.length} states</span>
        </CardHeader>
        <CardBody className="p-0">
          {detailLoading ? (
            <Spinner label="Loading breakdown..." />
          ) : rankedHeat.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState title="No data" description="No per-state exposure to display." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>State</TH>
                  <TH>Band</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Penalty</TH>
                  <TH className="text-right">Interest</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">VDA Savings</TH>
                </TR>
              </THead>
              <TBody>
                {rankedHeat.map((h) => (
                  <TR key={h.state}>
                    <TD className="font-mono font-semibold text-stone-100">{h.state}</TD>
                    <TD>
                      {h.materiality_band ? (
                        <Badge tone={bandTone(h.materiality_band)}>{h.materiality_band}</Badge>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="text-right">{currency(h.tax)}</TD>
                    <TD className="text-right text-amber-300">{currency(h.penalty)}</TD>
                    <TD className="text-right text-amber-300">{currency(h.interest)}</TD>
                    <TD className="text-right font-semibold text-blue-300">{currency(h.total)}</TD>
                    <TD className="text-right text-emerald-300">{currency(h.vda_savings)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-stone-600">
        Need per-engagement detail?{' '}
        <Link href="/dashboard/engagements" className="text-blue-400 hover:text-blue-300">
          Browse engagements
        </Link>
        .
      </p>
    </div>
  )
}
