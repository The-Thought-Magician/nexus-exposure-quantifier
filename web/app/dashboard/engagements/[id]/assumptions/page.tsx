'use client'

import { use, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Assumptions {
  id?: string
  engagement_id?: string
  effective_rate_basis?: string
  include_marketplace_sales?: boolean
  include_exempt_in_measure?: boolean
  compounding?: string
  saas_taxable_stance?: string
  notes?: string | null
  updated_at?: string
  created_at?: string
}

interface LogEntry {
  at?: string
  timestamp?: string
  user_id?: string
  field?: string
  from?: unknown
  to?: unknown
  note?: string
  [k: string]: unknown
}

const RATE_BASIS = [
  { value: 'combined', label: 'Combined (state + local avg)' },
  { value: 'base', label: 'State base rate only' },
]
const COMPOUNDING = [
  { value: 'annual', label: 'Annual' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'daily', label: 'Daily' },
  { value: 'simple', label: 'Simple (no compounding)' },
]
const SAAS_STANCE = [
  { value: 'taxable', label: 'Treat SaaS as taxable' },
  { value: 'exempt', label: 'Treat SaaS as exempt' },
  { value: 'per_state', label: 'Per-state taxability rules' },
]

const FIELD_LABELS: Record<string, string> = {
  effective_rate_basis: 'Effective rate basis',
  include_marketplace_sales: 'Include marketplace sales',
  include_exempt_in_measure: 'Include exempt in measure',
  compounding: 'Interest compounding',
  saas_taxable_stance: 'SaaS taxability stance',
  notes: 'Notes',
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

function fmtDate(v?: string): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

export default function AssumptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [current, setCurrent] = useState<Assumptions | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<Assumptions>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [a, l] = await Promise.all([api.getAssumptions(id), api.getAssumptionLog(id)])
      const asm: Assumptions = a && typeof a === 'object' ? a : {}
      setCurrent(asm)
      setForm({
        effective_rate_basis: asm.effective_rate_basis ?? 'combined',
        include_marketplace_sales: asm.include_marketplace_sales ?? false,
        include_exempt_in_measure: asm.include_exempt_in_measure ?? false,
        compounding: asm.compounding ?? 'annual',
        saas_taxable_stance: asm.saas_taxable_stance ?? 'per_state',
        notes: asm.notes ?? '',
      })
      setLog(Array.isArray(l) ? l : Array.isArray((l as { change_log?: LogEntry[] })?.change_log) ? (l as { change_log: LogEntry[] }).change_log : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assumptions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const dirty = useMemo(() => {
    if (!current) return false
    return (
      (current.effective_rate_basis ?? 'combined') !== form.effective_rate_basis ||
      (current.include_marketplace_sales ?? false) !== form.include_marketplace_sales ||
      (current.include_exempt_in_measure ?? false) !== form.include_exempt_in_measure ||
      (current.compounding ?? 'annual') !== form.compounding ||
      (current.saas_taxable_stance ?? 'per_state') !== form.saas_taxable_stance ||
      (current.notes ?? '') !== (form.notes ?? '')
    )
  }, [current, form])

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    setSaveErr(null)
    try {
      const body = {
        effective_rate_basis: form.effective_rate_basis,
        include_marketplace_sales: form.include_marketplace_sales,
        include_exempt_in_measure: form.include_exempt_in_measure,
        compounding: form.compounding,
        saas_taxable_stance: form.saas_taxable_stance,
        notes: form.notes ?? '',
      }
      await api.updateAssumptions(id, body)
      setSaveMsg('Assumptions saved. Recompute exposure to apply changes.')
      await load()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save assumptions')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    if (!current) return
    setForm({
      effective_rate_basis: current.effective_rate_basis ?? 'combined',
      include_marketplace_sales: current.include_marketplace_sales ?? false,
      include_exempt_in_measure: current.include_exempt_in_measure ?? false,
      compounding: current.compounding ?? 'annual',
      saas_taxable_stance: current.saas_taxable_stance ?? 'per_state',
      notes: current.notes ?? '',
    })
    setSaveMsg(null)
    setSaveErr(null)
  }

  const sortedLog = useMemo(() => {
    return [...log].sort((a, b) => {
      const ta = new Date(a.at ?? a.timestamp ?? 0).getTime()
      const tb = new Date(b.at ?? b.timestamp ?? 0).getTime()
      return tb - ta
    })
  }, [log])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-100">Assumptions Register</h1>
          <p className="mt-1 text-sm text-stone-500">
            Modeling assumptions that drive crossing detection, rate application, and interest accrual. Every change is
            logged for the diligence trail.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load()}>
          Refresh
        </Button>
      </div>

      {error ? (
        <Card>
          <CardBody className="flex items-center justify-between gap-4">
            <p className="text-sm text-red-300">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => load()}>
              Retry
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {loading ? (
        <Spinner label="Loading assumptions…" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-200">Register</h2>
              {current?.updated_at ? (
                <span className="text-xs text-stone-500">Updated {fmtDate(current.updated_at)}</span>
              ) : null}
            </CardHeader>
            <CardBody className="space-y-5">
              {saveMsg ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                  {saveMsg}
                </div>
              ) : null}
              {saveErr ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {saveErr}
                </div>
              ) : null}

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                    Effective rate basis
                  </label>
                  <select
                    value={form.effective_rate_basis}
                    onChange={(e) => setForm((f) => ({ ...f, effective_rate_basis: e.target.value }))}
                    className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
                  >
                    {RATE_BASIS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                    Interest compounding
                  </label>
                  <select
                    value={form.compounding}
                    onChange={(e) => setForm((f) => ({ ...f, compounding: e.target.value }))}
                    className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
                  >
                    {COMPOUNDING.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                    SaaS taxability stance
                  </label>
                  <select
                    value={form.saas_taxable_stance}
                    onChange={(e) => setForm((f) => ({ ...f, saas_taxable_stance: e.target.value }))}
                    className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
                  >
                    {SAAS_STANCE.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/50 px-3 py-3 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={!!form.include_marketplace_sales}
                    onChange={(e) => setForm((f) => ({ ...f, include_marketplace_sales: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-stone-600 bg-stone-950 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    Include marketplace sales
                    <span className="mt-0.5 block text-xs text-stone-500">
                      Count marketplace-facilitated sales toward the economic-nexus measure.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/50 px-3 py-3 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={!!form.include_exempt_in_measure}
                    onChange={(e) => setForm((f) => ({ ...f, include_exempt_in_measure: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-stone-600 bg-stone-950 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    Include exempt sales in measure
                    <span className="mt-0.5 block text-xs text-stone-500">
                      Include exempt / non-taxable sales when testing the threshold.
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Notes</label>
                <textarea
                  value={form.notes ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Rationale, client-specific caveats, source docs…"
                  className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={save} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save assumptions'}
                </Button>
                <Button variant="secondary" size="sm" onClick={reset} disabled={saving || !dirty}>
                  Reset
                </Button>
                {dirty ? <Badge tone="amber">Unsaved changes</Badge> : <Badge tone="green">Saved</Badge>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-200">Change log</h2>
              <Badge tone="slate">{sortedLog.length}</Badge>
            </CardHeader>
            <CardBody>
              {sortedLog.length === 0 ? (
                <EmptyState
                  title="No changes recorded"
                  description="Edits to the register above will appear here with a timestamped audit entry."
                />
              ) : (
                <ol className="relative space-y-4 border-l border-stone-800 pl-4">
                  {sortedLog.map((entry, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border border-blue-400 bg-blue-500" />
                      <div className="text-xs text-stone-500">{fmtDate(entry.at ?? entry.timestamp)}</div>
                      {entry.field ? (
                        <div className="mt-0.5 text-sm text-stone-200">
                          <span className="font-medium">{FIELD_LABELS[entry.field] ?? entry.field}</span>{' '}
                          <span className="text-stone-500">changed</span>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-stone-400">
                              {fmtVal(entry.from)}
                            </span>
                            <span className="text-stone-600">→</span>
                            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-300">
                              {fmtVal(entry.to)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-0.5 text-sm text-stone-300">{entry.note ?? 'Assumptions updated'}</div>
                      )}
                      {entry.user_id ? <div className="mt-1 text-xs text-stone-600">by {String(entry.user_id)}</div> : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
