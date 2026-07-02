'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface TimelinePoint {
  period?: string
  date?: string
  label?: string
  measure?: number
  running_measure?: number
  sales?: number
  transactions?: number
  threshold?: number
  crossed?: boolean
}

interface Crossing {
  id: string
  engagement_id: string
  state: string
  has_crossed: boolean
  crossing_date: string | null
  tripping_test: string | null
  measure_at_crossing: number | null
  threshold_used: number | null
  timeline?: TimelinePoint[] | null
  computed_at: string | null
}

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function money(v?: number | null) {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pointMeasure(p: TimelinePoint): number {
  return p.running_measure ?? p.measure ?? p.sales ?? 0
}
function pointLabel(p: TimelinePoint, i: number): string {
  return p.period || p.label || p.date || `P${i + 1}`
}

function Sparkline({ timeline, threshold }: { timeline: TimelinePoint[]; threshold?: number | null }) {
  const w = 640
  const h = 160
  const pad = 8
  const measures = timeline.map(pointMeasure)
  const maxVal = Math.max(threshold ?? 0, ...measures, 1)
  const n = timeline.length
  const x = (i: number) => (n <= 1 ? pad : pad + (i * (w - 2 * pad)) / (n - 1))
  const y = (v: number) => h - pad - (v / maxVal) * (h - 2 * pad)
  const line = timeline.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(pointMeasure(p)).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(n - 1).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z`
  const threshY = threshold ? y(threshold) : null

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full min-w-[520px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cx-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(139 92 246)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(139 92 246)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#cx-fill)" />
        <path d={line} fill="none" stroke="rgb(167 139 250)" strokeWidth={2} />
        {threshY !== null ? (
          <>
            <line x1={pad} y1={threshY} x2={w - pad} y2={threshY} stroke="rgb(248 113 113)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={w - pad} y={threshY - 4} textAnchor="end" fontSize="10" fill="rgb(248 113 113)">
              threshold {money(threshold)}
            </text>
          </>
        ) : null}
        {timeline.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(pointMeasure(p))}
            r={p.crossed ? 4 : 2.5}
            fill={p.crossed ? 'rgb(248 113 113)' : 'rgb(167 139 250)'}
          />
        ))}
      </svg>
    </div>
  )
}

export default function CrossingsPage() {
  const params = useParams<{ id: string }>()
  const engagementId = params.id

  const [rows, setRows] = useState<Crossing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyCrossed, setOnlyCrossed] = useState(false)

  const [detail, setDetail] = useState<Crossing | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listCrossings(engagementId)
      setRows(Array.isArray(data) ? data : data?.crossings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load crossings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (engagementId) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId])

  function flash(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice(null), 4000)
  }

  async function detect() {
    setDetecting(true)
    setError(null)
    try {
      const res = await api.detectCrossings(engagementId)
      const list = Array.isArray(res?.crossings) ? res.crossings : null
      if (list) setRows(list)
      else await load()
      flash('Crossing detection complete.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  async function openDetail(state: string) {
    setDetailErr(null)
    setDetailLoading(true)
    setDetail(null)
    try {
      const c = await api.getCrossing(engagementId, state)
      setDetail(c)
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : 'Failed to load state timeline')
    } finally {
      setDetailLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    return rows
      .filter((r) => (onlyCrossed ? r.has_crossed : true))
      .filter((r) => (q ? (r.state || '').toUpperCase().includes(q) : true))
      .sort((a, b) => {
        if (a.has_crossed !== b.has_crossed) return a.has_crossed ? -1 : 1
        return (a.state || '').localeCompare(b.state || '')
      })
  }, [rows, search, onlyCrossed])

  const stats = useMemo(() => {
    const crossed = rows.filter((r) => r.has_crossed).length
    const earliest = rows
      .filter((r) => r.has_crossed && r.crossing_date)
      .map((r) => r.crossing_date as string)
      .sort()[0]
    return { total: rows.length, crossed, notCrossed: rows.length - crossed, earliest }
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Link href={`/dashboard/engagements/${engagementId}`} className="hover:text-blue-300">
              Engagement
            </Link>
            <span>/</span>
            <span className="text-stone-400">Crossings</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-stone-100">Nexus Crossings</h1>
          <p className="mt-1 text-sm text-stone-500">
            Per-state economic-nexus threshold crossing dates and the running-measure timeline that tripped each one.
          </p>
        </div>
        <Button onClick={detect} disabled={detecting}>
          {detecting ? 'Detecting…' : 'Detect crossings'}
        </Button>
      </div>

      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="States analyzed" value={stats.total} tone="violet" />
        <Stat label="Nexus established" value={stats.crossed} tone={stats.crossed > 0 ? 'red' : 'default'} />
        <Stat label="Below threshold" value={stats.notCrossed} tone="green" />
        <Stat label="Earliest crossing" value={fmtDate(stats.earliest)} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-stone-200">Per-state crossings</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter state…"
              className="w-36 rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
            <label className="flex items-center gap-2 text-sm text-stone-400">
              <input
                type="checkbox"
                checked={onlyCrossed}
                onChange={(e) => setOnlyCrossed(e.target.checked)}
                className="h-4 w-4 rounded border-stone-700 bg-stone-950 text-blue-600 focus:ring-blue-500"
              />
              Crossed only
            </label>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <Spinner label="Loading crossings…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No crossings computed"
              description="Import sales data, then run detection to see which states have established economic nexus and when."
              action={
                <Button onClick={detect} disabled={detecting}>
                  {detecting ? 'Detecting…' : 'Detect crossings'}
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-stone-500">No states match your filters.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>State</TH>
                  <TH>Status</TH>
                  <TH>Crossing date</TH>
                  <TH>Tripping test</TH>
                  <TH className="text-right">Measure at crossing</TH>
                  <TH className="text-right">Threshold</TH>
                  <TH className="text-right">Timeline</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id || r.state} className="cursor-pointer" onClick={() => openDetail(r.state)}>
                    <TD className="font-semibold text-stone-100">{r.state}</TD>
                    <TD>
                      {r.has_crossed ? (
                        <Badge tone="red">Nexus established</Badge>
                      ) : (
                        <Badge tone="green">Below threshold</Badge>
                      )}
                    </TD>
                    <TD className="text-stone-300">{fmtDate(r.crossing_date)}</TD>
                    <TD>
                      {r.tripping_test ? (
                        <Badge tone="violet">{r.tripping_test}</Badge>
                      ) : (
                        <span className="text-stone-500">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{money(r.measure_at_crossing)}</TD>
                    <TD className="text-right tabular-nums text-stone-400">{money(r.threshold_used)}</TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(r.state)
                        }}
                      >
                        View
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!detail || detailLoading || !!detailErr}
        onClose={() => {
          setDetail(null)
          setDetailErr(null)
        }}
        title={detail ? `${detail.state} — nexus timeline` : 'State timeline'}
        className="max-w-3xl"
        footer={
          <Button
            variant="secondary"
            onClick={() => {
              setDetail(null)
              setDetailErr(null)
            }}
          >
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <Spinner label="Loading timeline…" />
        ) : detailErr ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {detailErr}
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Status"
                value={detail.has_crossed ? 'Crossed' : 'Below'}
                tone={detail.has_crossed ? 'red' : 'green'}
              />
              <Stat label="Crossing date" value={fmtDate(detail.crossing_date)} />
              <Stat label="Measure" value={money(detail.measure_at_crossing)} tone="violet" />
              <Stat label="Threshold" value={money(detail.threshold_used)} tone="amber" />
            </div>
            {detail.tripping_test ? (
              <p className="text-sm text-stone-400">
                Tripped by <Badge tone="violet">{detail.tripping_test}</Badge> test.
              </p>
            ) : null}
            {detail.timeline && detail.timeline.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Running measure over period
                </h3>
                <Sparkline timeline={detail.timeline} threshold={detail.threshold_used} />
                <div className="mt-3 max-h-64 overflow-y-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Period</TH>
                        <TH className="text-right">Running measure</TH>
                        <TH className="text-right">Txns</TH>
                        <TH>Crossed</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {detail.timeline.map((p, i) => (
                        <TR key={i} className={p.crossed ? 'bg-red-500/5' : ''}>
                          <TD className="text-stone-300">{pointLabel(p, i)}</TD>
                          <TD className="text-right tabular-nums">{money(pointMeasure(p))}</TD>
                          <TD className="text-right tabular-nums text-stone-400">
                            {p.transactions ?? '—'}
                          </TD>
                          <TD>{p.crossed ? <Badge tone="red">Crossed</Badge> : <span className="text-stone-600">—</span>}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-stone-500">No timeline points recorded for this state.</p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
