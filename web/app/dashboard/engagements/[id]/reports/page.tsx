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

interface WorkingPaperRow {
  state?: string | null
  period?: string | null
  taxable_sales?: number | string | null
  rate_applied?: number | string | null
  tax?: number | string | null
  penalty?: number | string | null
  interest?: number | string | null
  [k: string]: unknown
}

interface ScheduleRow {
  state?: string | null
  tax?: number | string | null
  penalty?: number | string | null
  interest?: number | string | null
  total?: number | string | null
  vda_total?: number | string | null
  vda_savings?: number | string | null
  materiality_band?: string | null
  [k: string]: unknown
}

interface SummaryReport {
  engagement?: {
    name?: string
    as_of_date?: string
    status?: string
    total_tax?: number | string | null
    total_penalty?: number | string | null
    total_interest?: number | string | null
    total_exposure?: number | string | null
    total_vda_savings?: number | string | null
  }
  totals?: Record<string, number | string | null>
  states?: ScheduleRow[]
  state_count?: number
  crossed_states?: number
  recommendation?: string | null
  assumptions?: Record<string, unknown> | null
  generated_at?: string | null
  [k: string]: unknown
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

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : 0
}

const money = (v: number | string | null | undefined) =>
  num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const pct = (v: number | string | null | undefined) => {
  const n = num(v)
  const asPct = n <= 1 ? n * 100 : n
  return `${asPct.toFixed(2)}%`
}

function bandTone(band?: string | null): 'red' | 'amber' | 'green' | 'slate' {
  const b = (band || '').toLowerCase()
  if (b.includes('high') || b.includes('material')) return 'red'
  if (b.includes('med')) return 'amber'
  if (b.includes('low')) return 'green'
  return 'slate'
}

type Tab = 'summary' | 'schedule' | 'working-papers'

function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n')
  return `${header}\n${body}`
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [tab, setTab] = useState<Tab>('summary')
  const [workingPapers, setWorkingPapers] = useState<WorkingPaperRow[]>([])
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [summary, setSummary] = useState<SummaryReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const [wp, sch, sum] = await Promise.all([
        api.getWorkingPapers(id),
        api.getSchedule(id),
        api.getSummaryReport(id),
      ])
      setWorkingPapers(Array.isArray(wp) ? wp : Array.isArray(wp?.rows) ? wp.rows : [])
      setSchedule(Array.isArray(sch) ? sch : Array.isArray(sch?.schedule) ? sch.schedule : [])
      setSummary(sum && !Array.isArray(sum) ? sum : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const scheduleTotals = useMemo(() => {
    return schedule.reduce<{ tax: number; penalty: number; interest: number; total: number; vdaSavings: number }>(
      (acc, r) => {
        acc.tax += num(r.tax)
        acc.penalty += num(r.penalty)
        acc.interest += num(r.interest)
        acc.total += num(r.total)
        acc.vdaSavings += num(r.vda_savings)
        return acc
      },
      { tax: 0, penalty: 0, interest: 0, total: 0, vdaSavings: 0 }
    )
  }, [schedule])

  const orderedSchedule = useMemo(
    () => [...schedule].sort((a, b) => num(b.total) - num(a.total)),
    [schedule]
  )

  const maxStateTotal = useMemo(() => Math.max(1, ...schedule.map((r) => num(r.total))), [schedule])

  const filteredWp = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return workingPapers
    return workingPapers.filter((r) =>
      `${r.state ?? ''} ${r.period ?? ''}`.toLowerCase().includes(q)
    )
  }, [workingPapers, search])

  const exportSchedule = () => {
    download(
      `schedule-${id}.csv`,
      toCsv(orderedSchedule as Record<string, unknown>[], [
        { key: 'state', label: 'State' },
        { key: 'tax', label: 'Tax' },
        { key: 'penalty', label: 'Penalty' },
        { key: 'interest', label: 'Interest' },
        { key: 'total', label: 'Total' },
        { key: 'vda_total', label: 'VDA Total' },
        { key: 'vda_savings', label: 'VDA Savings' },
        { key: 'materiality_band', label: 'Materiality' },
      ])
    )
  }

  const exportWorkingPapers = () => {
    download(
      `working-papers-${id}.csv`,
      toCsv(filteredWp as Record<string, unknown>[], [
        { key: 'state', label: 'State' },
        { key: 'period', label: 'Period' },
        { key: 'taxable_sales', label: 'Taxable Sales' },
        { key: 'rate_applied', label: 'Rate' },
        { key: 'tax', label: 'Tax' },
        { key: 'penalty', label: 'Penalty' },
        { key: 'interest', label: 'Interest' },
      ])
    )
  }

  const eng = summary?.engagement
  const totalExposure =
    num(eng?.total_exposure) || scheduleTotals.total || num(summary?.totals?.total_exposure)
  const vdaSavings = num(eng?.total_vda_savings) || scheduleTotals.vdaSavings || num(summary?.totals?.total_vda_savings)

  const empty = !loading && workingPapers.length === 0 && schedule.length === 0 && !summary

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
          <h1 className="mt-1 text-2xl font-bold text-slate-100">Reports &amp; Working Papers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Binder-ready exports: diligence summary, consolidated state schedule, and period-by-period working papers.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      <SubNav id={id} active="reports" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <Spinner label="Building reports…" />
      ) : empty ? (
        <EmptyState
          title="No report data available"
          description="Import sales and run the exposure computation on this engagement to generate working papers and schedules."
          action={
            <Link href={`/dashboard/engagements/${id}/exposure`}>
              <Button>Go to exposure</Button>
            </Link>
          }
          icon={<span>📑</span>}
        />
      ) : (
        <div className="space-y-6">
          {/* Tab strip */}
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
            {(
              [
                { k: 'summary', label: 'Binder summary' },
                { k: 'schedule', label: 'Consolidated schedule' },
                { k: 'working-papers', label: 'Working papers' },
              ] as { k: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.k ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Binder summary */}
          {tab === 'summary' && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Total exposure" value={money(totalExposure)} tone="red" />
                <Stat label="Back tax" value={money(eng?.total_tax ?? scheduleTotals.tax)} tone="violet" />
                <Stat label="Penalty + interest" value={money(num(eng?.total_penalty ?? scheduleTotals.penalty) + num(eng?.total_interest ?? scheduleTotals.interest))} tone="amber" />
                <Stat label="Potential VDA savings" value={money(vdaSavings)} tone="green" />
              </div>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-200">Diligence binder summary</h2>
                    {summary?.generated_at && (
                      <span className="text-xs text-slate-500">
                        Generated {new Date(summary.generated_at).toLocaleString('en-US')}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardBody className="space-y-4">
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Engagement</dt>
                      <dd className="mt-1 text-sm text-slate-200">{eng?.name || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">As-of date</dt>
                      <dd className="mt-1 text-sm text-slate-200">
                        {eng?.as_of_date ? new Date(eng.as_of_date).toLocaleDateString('en-US') : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
                      <dd className="mt-1">
                        <Badge tone={eng?.status === 'final' || eng?.status === 'locked' ? 'green' : 'slate'}>
                          {eng?.status || 'draft'}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">States with exposure</dt>
                      <dd className="mt-1 text-sm text-slate-200">
                        {summary?.state_count ?? schedule.length}
                        {summary?.crossed_states != null && (
                          <span className="text-slate-500"> ({summary.crossed_states} crossed nexus)</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {summary?.recommendation && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                        Recommendation
                      </div>
                      <p className="mt-1 text-sm text-slate-200">{summary.recommendation}</p>
                    </div>
                  )}

                  {summary?.assumptions && Object.keys(summary.assumptions).length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Key assumptions
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(summary.assumptions).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm"
                          >
                            <span className="text-slate-400">{k.replace(/_/g, ' ')}</span>
                            <span className="font-medium text-slate-200">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top-state mini distribution */}
                  {schedule.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Exposure by state
                      </div>
                      <div className="space-y-2">
                        {orderedSchedule.slice(0, 8).map((r) => (
                          <div key={r.state}>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-300">{r.state}</span>
                              <span className="tabular-nums text-slate-400">{money(r.total)}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-violet-500"
                                style={{ width: `${Math.max(2, (num(r.total) / maxStateTotal) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          )}

          {/* Consolidated schedule */}
          {tab === 'schedule' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">Consolidated per-state schedule</h2>
                  <Button variant="secondary" size="sm" onClick={exportSchedule} disabled={schedule.length === 0}>
                    Export CSV
                  </Button>
                </div>
              </CardHeader>
              {schedule.length === 0 ? (
                <CardBody>
                  <p className="py-6 text-center text-sm text-slate-500">
                    No schedule rows. Run the exposure computation to populate this schedule.
                  </p>
                </CardBody>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH className="text-right">Tax</TH>
                      <TH className="text-right">Penalty</TH>
                      <TH className="text-right">Interest</TH>
                      <TH className="text-right">Total</TH>
                      <TH className="text-right">VDA total</TH>
                      <TH className="text-right">VDA savings</TH>
                      <TH>Band</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {orderedSchedule.map((r, i) => (
                      <TR key={r.state ?? i}>
                        <TD className="font-semibold text-slate-100">{r.state}</TD>
                        <TD className="text-right tabular-nums">{money(r.tax)}</TD>
                        <TD className="text-right tabular-nums">{money(r.penalty)}</TD>
                        <TD className="text-right tabular-nums">{money(r.interest)}</TD>
                        <TD className="text-right font-semibold tabular-nums text-slate-100">{money(r.total)}</TD>
                        <TD className="text-right tabular-nums text-slate-400">{money(r.vda_total)}</TD>
                        <TD className="text-right tabular-nums text-emerald-300">{money(r.vda_savings)}</TD>
                        <TD>
                          {r.materiality_band ? (
                            <Badge tone={bandTone(r.materiality_band)}>{r.materiality_band}</Badge>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                  <tfoot className="border-t-2 border-slate-700 bg-slate-900/80">
                    <tr>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-200">Total ({schedule.length} states)</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-200">{money(scheduleTotals.tax)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-200">{money(scheduleTotals.penalty)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-200">{money(scheduleTotals.interest)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-100">{money(scheduleTotals.total)}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-emerald-300">{money(scheduleTotals.vdaSavings)}</td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                </Table>
              )}
            </Card>
          )}

          {/* Working papers */}
          {tab === 'working-papers' && (
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-200">Working papers</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Period-by-period taxable sales, applied rates, and computed tax / penalty / interest.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filter state / period…"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none sm:w-56"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={exportWorkingPapers}
                      disabled={filteredWp.length === 0}
                    >
                      Export CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {workingPapers.length === 0 ? (
                <CardBody>
                  <p className="py-6 text-center text-sm text-slate-500">
                    No working-paper rows. Run the exposure computation to generate period detail.
                  </p>
                </CardBody>
              ) : filteredWp.length === 0 ? (
                <CardBody>
                  <p className="py-6 text-center text-sm text-slate-500">No rows match “{search}”.</p>
                </CardBody>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH>Period</TH>
                      <TH className="text-right">Taxable sales</TH>
                      <TH className="text-right">Rate</TH>
                      <TH className="text-right">Tax</TH>
                      <TH className="text-right">Penalty</TH>
                      <TH className="text-right">Interest</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredWp.map((r, i) => (
                      <TR key={i}>
                        <TD className="font-medium text-slate-100">{r.state || '—'}</TD>
                        <TD className="text-slate-300">{r.period || '—'}</TD>
                        <TD className="text-right tabular-nums">{money(r.taxable_sales)}</TD>
                        <TD className="text-right tabular-nums text-slate-400">{pct(r.rate_applied)}</TD>
                        <TD className="text-right tabular-nums">{money(r.tax)}</TD>
                        <TD className="text-right tabular-nums">{money(r.penalty)}</TD>
                        <TD className="text-right tabular-nums">{money(r.interest)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {filteredWp.length > 0 && (
                <CardBody className="border-t border-slate-800 text-xs text-slate-500">
                  {filteredWp.length} row{filteredWp.length === 1 ? '' : 's'}
                  {search ? ` matching “${search}”` : ''} of {workingPapers.length} total
                </CardBody>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
