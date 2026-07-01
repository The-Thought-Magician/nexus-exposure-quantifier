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

interface TimelinePoint {
  month?: number | null
  label?: string | null
  date?: string | null
  total?: number | string | null
  tax?: number | string | null
  penalty?: number | string | null
  interest?: number | string | null
  vda_total?: number | string | null
  vda_savings?: number | string | null
  incremental?: number | string | null
  [k: string]: unknown
}

interface Deadline {
  date?: string | null
  months?: number | null
  reason?: string | null
  state?: string | null
  vda_savings_at_deadline?: number | string | null
  [k: string]: unknown
}

interface WaitCostResponse {
  timeline?: TimelinePoint[]
  deadline?: Deadline | null
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

function pointLabel(p: TimelinePoint, i: number): string {
  if (p.label) return p.label
  if (p.date) {
    const d = new Date(p.date)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  if (p.month !== null && p.month !== undefined) return `+${p.month}mo`
  return `+${i}mo`
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

// Simple dual-line SVG chart (exposure grows, VDA savings erodes).
function DualLineChart({ points }: { points: TimelinePoint[] }) {
  const W = 720
  const H = 260
  const padL = 56
  const padR = 16
  const padT = 16
  const padB = 32
  const n = points.length
  if (n === 0) return null

  const totals = points.map((p) => num(p.total))
  const savings = points.map((p) => num(p.vda_savings))
  const maxVal = Math.max(1, ...totals, ...savings)

  const x = (i: number) => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR))
  const y = (v: number) => padT + (1 - v / maxVal) * (H - padT - padB)

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')

  const areaPath = (vals: number[]) =>
    `${path(vals)} L ${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
  const labelEvery = Math.max(1, Math.ceil(n / 8))

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Wait cost timeline">
        {gridLines.map((g) => {
          const yy = padT + g * (H - padT - padB)
          const val = maxVal * (1 - g)
          return (
            <g key={g}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#1e293b" strokeWidth={1} />
              <text x={padL - 8} y={yy + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)}
              </text>
            </g>
          )
        })}
        {/* exposure area + line */}
        <path d={areaPath(totals)} fill="rgba(139,92,246,0.12)" />
        <path d={path(totals)} fill="none" stroke="#8b5cf6" strokeWidth={2.5} />
        {/* vda savings line */}
        <path d={path(savings)} fill="none" stroke="#10b981" strokeWidth={2.5} strokeDasharray="5 4" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(num(p.total))} r={2.5} fill="#8b5cf6" />
            <circle cx={x(i)} cy={y(num(p.vda_savings))} r={2.5} fill="#10b981" />
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - padB + 18} textAnchor="middle" fontSize={9} fill="#64748b">
                {pointLabel(p, i)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex gap-5 pl-14 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded bg-violet-500" /> Total exposure
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded bg-emerald-500" /> VDA savings remaining
        </span>
      </div>
    </div>
  )
}

const MONTH_OPTIONS = [6, 12, 18, 24, 36]

export default function WaitCostPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [deadline, setDeadline] = useState<Deadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [months, setMonths] = useState(24)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data: WaitCostResponse = await api.getWaitCost(id, months)
      setTimeline(Array.isArray(data?.timeline) ? data.timeline : [])
      setDeadline(data?.deadline ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wait-cost analysis')
    } finally {
      setLoading(false)
    }
  }, [id, months])

  useEffect(() => {
    load()
  }, [load])

  const first = timeline[0]
  const last = timeline[timeline.length - 1]

  const growth = useMemo(() => {
    if (!first || !last) return 0
    return num(last.total) - num(first.total)
  }, [first, last])

  const erosion = useMemo(() => {
    if (!first || !last) return 0
    return num(first.vda_savings) - num(last.vda_savings)
  }, [first, last])

  const monthlyBleed = useMemo(() => {
    if (timeline.length < 2) return 0
    return growth / (timeline.length - 1)
  }, [growth, timeline.length])

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href={`/dashboard/engagements/${id}`}
            className="text-xs text-slate-500 transition-colors hover:text-violet-300"
          >
            ← Engagement
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">Cost of Waiting</h1>
          <p className="mt-1 text-sm text-slate-500">
            How exposure grows and VDA savings erode over the deferral horizon, plus the decision deadline.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Horizon</label>
          <div className="flex gap-1">
            {MONTH_OPTIONS.map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  months === m ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {m}mo
              </button>
            ))}
          </div>
        </div>
      </div>

      <SubNav id={id} active="wait-cost" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <Spinner label="Loading wait-cost analysis…" />
      ) : timeline.length === 0 ? (
        <EmptyState
          title="No wait-cost timeline yet"
          description="Compute exposure and scenarios for this engagement, then the wait-cost projection will appear here."
          action={
            <Link href={`/dashboard/engagements/${id}/exposure`}>
              <Button>Go to Exposure</Button>
            </Link>
          }
          icon={<span>⏳</span>}
        />
      ) : (
        <div className="space-y-6">
          {deadline && (deadline.date || deadline.months !== null) && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardBody>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Badge tone="amber">Decision deadline</Badge>
                    <p className="mt-2 text-lg font-semibold text-slate-100">
                      {deadline.date
                        ? new Date(deadline.date).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : `${deadline.months} months out`}
                    </p>
                    {deadline.reason && <p className="mt-1 max-w-xl text-sm text-slate-400">{deadline.reason}</p>}
                    {deadline.state && (
                      <p className="mt-1 text-xs text-slate-500">Driven by {deadline.state}</p>
                    )}
                  </div>
                  {deadline.vda_savings_at_deadline !== undefined && deadline.vda_savings_at_deadline !== null && (
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-slate-500">VDA savings at deadline</div>
                      <div className="text-2xl font-bold text-emerald-300">
                        {money(deadline.vda_savings_at_deadline)}
                      </div>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Exposure today" value={money(first?.total)} tone="violet" />
            <Stat label={`Exposure at +${months}mo`} value={money(last?.total)} tone="red" hint={`+${money(growth)}`} />
            <Stat label="VDA savings eroded" value={money(erosion)} tone="amber" hint="over the horizon" />
            <Stat label="Avg monthly cost" value={money(monthlyBleed)} tone="default" hint="added exposure / month" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Exposure growth vs. VDA-savings erosion</h2>
            </CardHeader>
            <CardBody>
              <DualLineChart points={timeline} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Month-by-month projection</h2>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Penalty</TH>
                  <TH className="text-right">Interest</TH>
                  <TH className="text-right">Total exposure</TH>
                  <TH className="text-right">Incremental</TH>
                  <TH className="text-right">VDA savings left</TH>
                </TR>
              </THead>
              <TBody>
                {timeline.map((p, i) => {
                  const prev = i > 0 ? timeline[i - 1] : null
                  const incremental =
                    p.incremental !== undefined && p.incremental !== null
                      ? num(p.incremental)
                      : prev
                      ? num(p.total) - num(prev.total)
                      : 0
                  return (
                    <TR key={i}>
                      <TD className="font-medium text-slate-200">{pointLabel(p, i)}</TD>
                      <TD className="text-right tabular-nums text-slate-300">{money(p.tax)}</TD>
                      <TD className="text-right tabular-nums text-slate-300">{money(p.penalty)}</TD>
                      <TD className="text-right tabular-nums text-slate-300">{money(p.interest)}</TD>
                      <TD className="text-right font-semibold tabular-nums text-slate-100">{money(p.total)}</TD>
                      <TD className="text-right tabular-nums text-amber-300">
                        {incremental > 0 ? `+${money(incremental)}` : money(incremental)}
                      </TD>
                      <TD className="text-right tabular-nums text-emerald-300">{money(p.vda_savings)}</TD>
                    </TR>
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
