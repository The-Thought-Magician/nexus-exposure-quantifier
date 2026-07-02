'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface NexusRule {
  id: string
  state: string
  sales_threshold?: number | string | null
  transaction_threshold?: number | string | null
  measurement_period?: string | null
  counts_marketplace?: boolean | null
  includes_exempt?: boolean | null
  effective_date?: string | null
  citation?: string | null
  notes?: string | null
  created_at?: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

const money = (v: unknown): string => {
  const n = num(v)
  if (n === 0 && (v === null || v === undefined || v === '')) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const count = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  return num(v).toLocaleString('en-US')
}

const fmtDate = (v?: string | null): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function NexusRulesLibraryPage() {
  const [rules, setRules] = useState<NexusRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [marketplaceFilter, setMarketplaceFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [periodFilter, setPeriodFilter] = useState('all')

  const [detailState, setDetailState] = useState<string | null>(null)
  const [detail, setDetail] = useState<NexusRule | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listNexusRules()
      setRules(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load nexus rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function openDetail(state: string) {
    setDetailState(state)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const data = await api.getNexusRule(state)
      setDetail(data && typeof data === 'object' ? data : null)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load rule detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const periods = useMemo(() => {
    const set = new Set<string>()
    for (const r of rules) if (r.measurement_period) set.add(r.measurement_period)
    return Array.from(set).sort()
  }, [rules])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules
      .filter((r) => {
        if (marketplaceFilter === 'yes' && !r.counts_marketplace) return false
        if (marketplaceFilter === 'no' && r.counts_marketplace) return false
        if (periodFilter !== 'all' && (r.measurement_period || '') !== periodFilter) return false
        if (q) {
          const hay = `${r.state} ${r.citation || ''} ${r.notes || ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => a.state.localeCompare(b.state))
  }, [rules, search, marketplaceFilter, periodFilter])

  const stats = useMemo(() => {
    const thresholds = rules.map((r) => num(r.sales_threshold)).filter((n) => n > 0)
    const mkt = rules.filter((r) => r.counts_marketplace).length
    const txn = rules.filter((r) => num(r.transaction_threshold) > 0).length
    const median = thresholds.length
      ? [...thresholds].sort((a, b) => a - b)[Math.floor(thresholds.length / 2)]
      : 0
    return { total: rules.length, median, mkt, txn }
  }, [rules])

  // Distribution of sales thresholds (simple SVG bar buckets).
  const buckets = useMemo(() => {
    const defs = [
      { label: '≤ $100k', min: 0, max: 100000 },
      { label: '$100k–$250k', min: 100000, max: 250000 },
      { label: '$250k–$500k', min: 250000, max: 500000 },
      { label: '> $500k', min: 500000, max: Infinity },
    ]
    const rows = defs.map((d) => ({ label: d.label, n: 0 }))
    for (const r of rules) {
      const t = num(r.sales_threshold)
      if (t <= 0) continue
      const idx = defs.findIndex((d) => t > d.min && t <= d.max)
      if (idx >= 0) rows[idx].n++
    }
    const max = Math.max(1, ...rows.map((r) => r.n))
    return { rows, max }
  }, [rules])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-100">State nexus rules</h1>
          <p className="mt-1 text-sm text-stone-500">
            Economic-nexus thresholds by state: sales and transaction triggers, measurement windows, marketplace and
            exempt-sales treatment. Sourced from the reference library used across all engagements.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading nexus rules…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="States covered" value={stats.total} tone="violet" />
            <Stat label="Median sales threshold" value={money(stats.median)} />
            <Stat label="Count marketplace sales" value={`${stats.mkt} / ${stats.total}`} tone="amber" hint="States that include marketplace facilitator sales in the measure" />
            <Stat label="Have transaction test" value={`${stats.txn} / ${stats.total}`} tone="green" hint="States with a separate transaction-count trigger" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-stone-200">Sales-threshold distribution</h2>
            </CardHeader>
            <CardBody>
              <div className="space-y-3">
                {buckets.rows.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-xs text-stone-400">{b.label}</div>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-stone-800">
                      <div
                        className="h-full rounded bg-gradient-to-r from-blue-600 to-blue-400"
                        style={{ width: `${(b.n / buckets.max) * 100}%` }}
                      />
                    </div>
                    <div className="w-8 shrink-0 text-right text-xs tabular-nums text-stone-300">{b.n}</div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search state, citation, notes…"
                className="min-w-[12rem] flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
              />
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All measurement periods</option>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                value={marketplaceFilter}
                onChange={(e) => setMarketplaceFilter(e.target.value as 'all' | 'yes' | 'no')}
                className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">Marketplace: any</option>
                <option value="yes">Counts marketplace</option>
                <option value="no">Excludes marketplace</option>
              </select>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={rules.length === 0 ? 'No nexus rules loaded' : 'No rules match your filters'}
                    description={
                      rules.length === 0
                        ? 'The reference library has not been seeded yet. Rules appear here once the backend nexus-rules library is populated.'
                        : 'Adjust the search or filters to see more states.'
                    }
                    action={
                      rules.length === 0 ? (
                        <Button variant="secondary" onClick={load}>
                          Reload
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSearch('')
                            setMarketplaceFilter('all')
                            setPeriodFilter('all')
                          }}
                        >
                          Clear filters
                        </Button>
                      )
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH className="text-right">Sales threshold</TH>
                      <TH className="text-right">Txn threshold</TH>
                      <TH>Measurement</TH>
                      <TH>Marketplace</TH>
                      <TH>Exempt in measure</TH>
                      <TH>Effective</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <button
                            onClick={() => openDetail(r.state)}
                            className="font-semibold text-stone-100 hover:text-blue-300"
                          >
                            {r.state}
                          </button>
                          {r.citation ? <div className="mt-0.5 text-xs text-stone-500">{r.citation}</div> : null}
                        </TD>
                        <TD className="text-right font-medium text-blue-300">{money(r.sales_threshold)}</TD>
                        <TD className="text-right text-stone-300">{count(r.transaction_threshold)}</TD>
                        <TD className="text-stone-400">{r.measurement_period || '—'}</TD>
                        <TD>
                          <Badge tone={r.counts_marketplace ? 'amber' : 'slate'}>
                            {r.counts_marketplace ? 'Included' : 'Excluded'}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={r.includes_exempt ? 'blue' : 'slate'}>
                            {r.includes_exempt ? 'Included' : 'Excluded'}
                          </Badge>
                        </TD>
                        <TD className="text-stone-400">{fmtDate(r.effective_date)}</TD>
                        <TD>
                          <div className="flex justify-end">
                            <Button variant="ghost" size="sm" onClick={() => openDetail(r.state)}>
                              Details
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={detailState !== null}
        onClose={() => setDetailState(null)}
        title={detailState ? `${detailState} — economic nexus rule` : 'Nexus rule'}
        footer={
          <Button variant="secondary" onClick={() => setDetailState(null)}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <Spinner label="Loading rule…" />
        ) : detailError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{detailError}</div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Sales threshold</div>
                <div className="mt-1 text-lg font-semibold text-blue-300">{money(detail.sales_threshold)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Transaction threshold</div>
                <div className="mt-1 text-lg font-semibold text-stone-100">{count(detail.transaction_threshold)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Measurement period</div>
                <div className="mt-1 text-sm text-stone-200">{detail.measurement_period || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Effective date</div>
                <div className="mt-1 text-sm text-stone-200">{fmtDate(detail.effective_date)}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={detail.counts_marketplace ? 'amber' : 'slate'}>
                Marketplace {detail.counts_marketplace ? 'counted' : 'excluded'}
              </Badge>
              <Badge tone={detail.includes_exempt ? 'blue' : 'slate'}>
                Exempt sales {detail.includes_exempt ? 'in measure' : 'excluded'}
              </Badge>
            </div>
            {detail.citation ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Citation</div>
                <div className="mt-1 text-sm text-stone-200">{detail.citation}</div>
              </div>
            ) : null}
            {detail.notes ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Notes</div>
                <p className="mt-1 text-sm text-stone-300">{detail.notes}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-stone-500">No rule found for this state.</p>
        )}
      </Modal>
    </div>
  )
}
