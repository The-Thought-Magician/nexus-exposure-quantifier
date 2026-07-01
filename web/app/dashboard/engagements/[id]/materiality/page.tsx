'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

interface RankingRow {
  state: string
  tax?: number | string | null
  penalty?: number | string | null
  interest?: number | string | null
  total?: number | string | null
  vda_total?: number | string | null
  vda_savings?: number | string | null
  materiality_band?: string | null
  has_crossed?: boolean | null
}

interface Rollup {
  total?: number | string | null
  total_tax?: number | string | null
  total_penalty?: number | string | null
  total_interest?: number | string | null
  total_vda_savings?: number | string | null
  top_n_total?: number | string | null
  top_n_share?: number | string | null
  state_count?: number | null
  above_threshold?: number | null
  [k: string]: unknown
}

interface MaterialityResponse {
  ranking?: RankingRow[]
  rollup?: Rollup
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

function bandTone(band: string | null | undefined): 'red' | 'amber' | 'green' | 'slate' | 'blue' {
  const b = (band || '').toLowerCase()
  if (b.includes('high') || b.includes('material')) return 'red'
  if (b.includes('medium') || b.includes('moderate')) return 'amber'
  if (b.includes('low')) return 'blue'
  if (b.includes('immaterial') || b.includes('nil') || b.includes('none')) return 'green'
  return 'slate'
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

const TOP_N_OPTIONS = [3, 5, 10]
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'total', label: 'Total exposure' },
  { value: 'tax', label: 'Tax' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'interest', label: 'Interest' },
  { value: 'vda_savings', label: 'VDA savings' },
]

export default function MaterialityPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [ranking, setRanking] = useState<RankingRow[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [threshold, setThreshold] = useState<number>(0)
  const [thresholdInput, setThresholdInput] = useState('')
  const [sort, setSort] = useState('total')
  const [search, setSearch] = useState('')
  const [topN, setTopN] = useState(5)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data: MaterialityResponse = await api.getMateriality(id, {
        threshold: threshold > 0 ? threshold : undefined,
        sort,
      })
      setRanking(Array.isArray(data?.ranking) ? data.ranking : [])
      setRollup(data?.rollup ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load materiality')
    } finally {
      setLoading(false)
    }
  }, [id, threshold, sort])

  useEffect(() => {
    load()
  }, [load])

  const applyThreshold = () => {
    const v = parseFloat(thresholdInput.replace(/[^0-9.]/g, ''))
    setThreshold(Number.isFinite(v) ? v : 0)
  }

  const clearThreshold = () => {
    setThresholdInput('')
    setThreshold(0)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    if (!q) return ranking
    return ranking.filter((r) => r.state?.toUpperCase().includes(q))
  }, [ranking, search])

  const maxTotal = useMemo(() => Math.max(1, ...ranking.map((r) => num(r.total))), [ranking])

  const grandTotal = useMemo(
    () => (rollup?.total !== undefined ? num(rollup.total) : ranking.reduce((s, r) => s + num(r.total), 0)),
    [rollup, ranking],
  )

  const topRollup = useMemo(() => {
    const sorted = [...ranking].sort((a, b) => num(b.total) - num(a.total))
    const top = sorted.slice(0, topN)
    const topTotal = top.reduce((s, r) => s + num(r.total), 0)
    const share = grandTotal > 0 ? (topTotal / grandTotal) * 100 : 0
    return { top, topTotal, share }
  }, [ranking, topN, grandTotal])

  const bandGroups = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const r of ranking) {
      const key = r.materiality_band || 'Unbanded'
      const g = map.get(key) || { count: 0, total: 0 }
      g.count += 1
      g.total += num(r.total)
      map.set(key, g)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total)
  }, [ranking])

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/dashboard/engagements/${id}`}
          className="text-xs text-slate-500 transition-colors hover:text-violet-300"
        >
          ← Engagement
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-100">Materiality Ranking</h1>
        <p className="mt-1 text-sm text-slate-500">
          States ranked by exposure, materiality bands, and a top-N concentration rollup.
        </p>
      </div>

      <SubNav id={id} active="materiality" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <Spinner label="Loading materiality…" />
      ) : ranking.length === 0 ? (
        <EmptyState
          title="No exposure to rank"
          description="Compute exposure for this engagement first, then materiality ranking will populate here."
          action={
            <Link href={`/dashboard/engagements/${id}/exposure`}>
              <Button>Go to Exposure</Button>
            </Link>
          }
          icon={<span>📊</span>}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total exposure" value={money(grandTotal)} tone="violet" hint={`${ranking.length} states`} />
            <Stat
              label={`Top ${topN} exposure`}
              value={money(topRollup.topTotal)}
              tone="red"
              hint={`${topRollup.share.toFixed(0)}% of total`}
            />
            <Stat
              label="VDA savings"
              value={money(rollup?.total_vda_savings ?? ranking.reduce((s, r) => s + num(r.vda_savings), 0))}
              tone="green"
            />
            <Stat
              label="Above threshold"
              value={threshold > 0 ? filtered.filter((r) => num(r.total) >= threshold).length : ranking.length}
              hint={threshold > 0 ? `≥ ${money(threshold)}` : 'no threshold'}
            />
          </div>

          {/* Band distribution */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Materiality bands</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {bandGroups.map(([band, g]) => {
                const pct = grandTotal > 0 ? (g.total / grandTotal) * 100 : 0
                const tone = bandTone(band)
                const bar =
                  tone === 'red'
                    ? 'bg-red-500'
                    : tone === 'amber'
                    ? 'bg-amber-500'
                    : tone === 'green'
                    ? 'bg-emerald-500'
                    : tone === 'blue'
                    ? 'bg-sky-500'
                    : 'bg-slate-500'
                return (
                  <div key={band}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Badge tone={tone}>{band}</Badge>
                        <span className="text-xs text-slate-500">{g.count} states</span>
                      </span>
                      <span className="tabular-nums text-slate-300">{money(g.total)}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  </div>
                )
              })}
            </CardBody>
          </Card>

          {/* Filters */}
          <Card>
            <CardBody className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Search state</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. CA"
                  className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Sort by</label>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Min exposure threshold</label>
                <div className="flex gap-2">
                  <input
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyThreshold()}
                    placeholder="e.g. 10000"
                    className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                  />
                  <Button variant="secondary" size="sm" onClick={applyThreshold}>
                    Apply
                  </Button>
                  {threshold > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearThreshold}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Top-N rollup</label>
                <div className="flex gap-1">
                  {TOP_N_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setTopN(n)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        topN === n ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Ranking table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Ranked states</h2>
                <span className="text-xs text-slate-500">{filtered.length} shown</span>
              </div>
            </CardHeader>
            {filtered.length === 0 ? (
              <CardBody>
                <p className="text-sm text-slate-500">No states match your filters.</p>
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>State</TH>
                    <TH>Band</TH>
                    <TH className="text-right">Tax</TH>
                    <TH className="text-right">Penalty</TH>
                    <TH className="text-right">Interest</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">VDA savings</TH>
                    <TH className="w-40">Share</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((r, i) => {
                    const pct = (num(r.total) / maxTotal) * 100
                    const inTop = topRollup.top.some((t) => t.state === r.state)
                    return (
                      <TR key={r.state} className={inTop ? 'bg-violet-500/5' : ''}>
                        <TD className="text-slate-500">{i + 1}</TD>
                        <TD className="font-semibold text-slate-100">{r.state}</TD>
                        <TD>
                          {r.materiality_band ? (
                            <Badge tone={bandTone(r.materiality_band)}>{r.materiality_band}</Badge>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </TD>
                        <TD className="text-right tabular-nums text-slate-300">{money(r.tax)}</TD>
                        <TD className="text-right tabular-nums text-slate-300">{money(r.penalty)}</TD>
                        <TD className="text-right tabular-nums text-slate-300">{money(r.interest)}</TD>
                        <TD className="text-right font-semibold tabular-nums text-slate-100">{money(r.total)}</TD>
                        <TD className="text-right tabular-nums text-emerald-300">{money(r.vda_savings)}</TD>
                        <TD>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-violet-500"
                              style={{ width: `${Math.max(2, pct)}%` }}
                            />
                          </div>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
