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

interface StateExposure {
  id: string
  engagement_id: string
  state: string
  tax: number
  penalty: number
  interest: number
  total: number
  vda_tax?: number | null
  vda_total?: number | null
  vda_savings?: number | null
  materiality_band?: string | null
  computed_at?: string | null
}

interface ExposureLine {
  id: string
  engagement_id: string
  state: string
  period: string
  taxable_sales: number
  rate_applied: number
  tax: number
  penalty: number
  interest: number
}

function money(v?: number | null) {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
function money0(v?: number | null) {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function pct(v?: number | null) {
  if (v === null || v === undefined) return '—'
  const r = v > 1 ? v : v * 100
  return `${r.toFixed(2)}%`
}

function bandTone(band?: string | null): 'red' | 'amber' | 'green' | 'slate' {
  const b = (band || '').toLowerCase()
  if (b === 'high' || b === 'material') return 'red'
  if (b === 'medium' || b === 'moderate') return 'amber'
  if (b === 'low' || b === 'immaterial') return 'green'
  return 'slate'
}

type SortKey = 'state' | 'tax' | 'penalty' | 'interest' | 'total'

export default function ExposurePage() {
  const params = useParams<{ id: string }>()
  const engagementId = params.id

  const [rows, setRows] = useState<StateExposure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [computing, setComputing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total')

  const [detailState, setDetailState] = useState<string | null>(null)
  const [detailExposure, setDetailExposure] = useState<StateExposure | null>(null)
  const [detailLines, setDetailLines] = useState<ExposureLine[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listExposure(engagementId)
      setRows(Array.isArray(data) ? data : data?.exposure ?? data?.states ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load exposure')
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

  async function compute() {
    setComputing(true)
    setError(null)
    try {
      await api.computeExposure(engagementId)
      flash('Exposure recomputed across all states.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compute failed')
    } finally {
      setComputing(false)
    }
  }

  async function openDetail(state: string) {
    setDetailState(state)
    setDetailErr(null)
    setDetailLoading(true)
    setDetailExposure(null)
    setDetailLines([])
    try {
      const res = await api.getStateExposure(engagementId, state)
      setDetailExposure(res?.exposure ?? (res && res.state ? res : null))
      setDetailLines(Array.isArray(res?.lines) ? res.lines : Array.isArray(res) ? res : [])
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : 'Failed to load state detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        tax: a.tax + (r.tax || 0),
        penalty: a.penalty + (r.penalty || 0),
        interest: a.interest + (r.interest || 0),
        total: a.total + (r.total || 0),
        vdaSavings: a.vdaSavings + (r.vda_savings || 0),
      }),
      { tax: 0, penalty: 0, interest: 0, total: 0, vdaSavings: 0 },
    )
  }, [rows])

  const maxTotal = useMemo(() => Math.max(1, ...rows.map((r) => r.total || 0)), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    const list = rows.filter((r) => (q ? (r.state || '').toUpperCase().includes(q) : true))
    return [...list].sort((a, b) => {
      if (sortKey === 'state') return (a.state || '').localeCompare(b.state || '')
      return (b[sortKey] || 0) - (a[sortKey] || 0)
    })
  }, [rows, search, sortKey])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Link href={`/dashboard/engagements/${engagementId}`} className="hover:text-blue-300">
              Engagement
            </Link>
            <span>/</span>
            <span className="text-stone-400">Exposure</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-stone-100">Exposure Quantification</h1>
          <p className="mt-1 text-sm text-stone-500">
            Estimated back tax, penalty, and interest per state, with period-level line items and VDA savings.
          </p>
        </div>
        <Button onClick={compute} disabled={computing}>
          {computing ? 'Computing…' : 'Compute exposure'}
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total tax" value={money0(totals.tax)} tone="violet" />
        <Stat label="Total penalty" value={money0(totals.penalty)} tone="amber" />
        <Stat label="Total interest" value={money0(totals.interest)} tone="amber" />
        <Stat label="Total exposure" value={money0(totals.total)} tone="red" />
        <Stat label="VDA savings" value={money0(totals.vdaSavings)} tone="green" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-stone-200">Per-state exposure</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter state…"
              className="w-36 rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="total">Sort: total</option>
              <option value="tax">Sort: tax</option>
              <option value="penalty">Sort: penalty</option>
              <option value="interest">Sort: interest</option>
              <option value="state">Sort: state</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <Spinner label="Loading exposure…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No exposure computed"
              description="Detect crossings first, then compute exposure to quantify back tax, penalty, and interest for each state with nexus."
              action={
                <Button onClick={compute} disabled={computing}>
                  {computing ? 'Computing…' : 'Compute exposure'}
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-stone-500">No states match your filter.</div>
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
                  <TH className="w-32">Share</TH>
                  <TH className="text-right">VDA savings</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id || r.state} className="cursor-pointer" onClick={() => openDetail(r.state)}>
                    <TD className="font-semibold text-stone-100">{r.state}</TD>
                    <TD>
                      {r.materiality_band ? (
                        <Badge tone={bandTone(r.materiality_band)}>{r.materiality_band}</Badge>
                      ) : (
                        <span className="text-stone-500">—</span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{money0(r.tax)}</TD>
                    <TD className="text-right tabular-nums text-amber-300">{money0(r.penalty)}</TD>
                    <TD className="text-right tabular-nums text-amber-300">{money0(r.interest)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-stone-100">{money0(r.total)}</TD>
                    <TD>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-800">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.max(2, ((r.total || 0) / maxTotal) * 100)}%` }}
                        />
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums text-emerald-300">{money0(r.vda_savings)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!detailState}
        onClose={() => setDetailState(null)}
        title={detailState ? `${detailState} — period line items` : 'State exposure'}
        className="max-w-3xl"
        footer={
          <Button variant="secondary" onClick={() => setDetailState(null)}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <Spinner label="Loading line items…" />
        ) : detailErr ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {detailErr}
          </div>
        ) : (
          <div className="space-y-5">
            {detailExposure ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Tax" value={money0(detailExposure.tax)} tone="violet" />
                <Stat label="Penalty" value={money0(detailExposure.penalty)} tone="amber" />
                <Stat label="Interest" value={money0(detailExposure.interest)} tone="amber" />
                <Stat label="Total" value={money0(detailExposure.total)} tone="red" />
              </div>
            ) : null}
            {detailExposure && (detailExposure.vda_total != null || detailExposure.vda_savings != null) ? (
              <div className="flex flex-wrap gap-2 text-sm text-stone-400">
                <Badge tone="green">VDA total {money0(detailExposure.vda_total)}</Badge>
                <Badge tone="green">VDA savings {money0(detailExposure.vda_savings)}</Badge>
                {detailExposure.materiality_band ? (
                  <Badge tone={bandTone(detailExposure.materiality_band)}>
                    {detailExposure.materiality_band} materiality
                  </Badge>
                ) : null}
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Period line items</h3>
              {detailLines.length === 0 ? (
                <p className="py-4 text-center text-sm text-stone-500">No period line items for this state.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Period</TH>
                        <TH className="text-right">Taxable sales</TH>
                        <TH className="text-right">Rate</TH>
                        <TH className="text-right">Tax</TH>
                        <TH className="text-right">Penalty</TH>
                        <TH className="text-right">Interest</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {detailLines.map((l) => (
                        <TR key={l.id || l.period}>
                          <TD className="text-stone-300">{l.period}</TD>
                          <TD className="text-right tabular-nums">{money(l.taxable_sales)}</TD>
                          <TD className="text-right tabular-nums text-stone-400">{pct(l.rate_applied)}</TD>
                          <TD className="text-right tabular-nums">{money(l.tax)}</TD>
                          <TD className="text-right tabular-nums text-amber-300">{money(l.penalty)}</TD>
                          <TD className="text-right tabular-nums text-amber-300">{money(l.interest)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
