'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { EngagementSubNav } from '../page'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface SalesLine {
  id: string
  engagement_id: string
  sale_date?: string | null
  state: string
  jurisdiction?: string | null
  amount: number | string
  is_taxable?: boolean
  is_marketplace?: boolean
  transaction_ref?: string | null
  product_category?: string | null
  exempt_reason?: string | null
  created_at?: string | null
}

interface StateSummary {
  state: string
  amount?: number | string
  total_amount?: number | string
  taxable_amount?: number | string
  count?: number | string
  transaction_count?: number | string
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}
const money = (v: unknown): string =>
  num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const fmtDate = (v?: string | null): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
]

const emptyForm = {
  sale_date: '',
  state: 'CA',
  jurisdiction: '',
  amount: '',
  is_taxable: true,
  is_marketplace: false,
  transaction_ref: '',
  product_category: '',
  exempt_reason: '',
}

export default function SalesPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [lines, setLines] = useState<SalesLine[]>([])
  const [summary, setSummary] = useState<StateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [stateFilter, setStateFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ls, sm] = await Promise.all([api.listSales(id), api.getSalesSummary(id)])
      setLines(Array.isArray(ls) ? ls : [])
      setSummary(Array.isArray(sm) ? sm : Array.isArray((sm as { summary?: StateSummary[] })?.summary) ? (sm as { summary: StateSummary[] }).summary : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sales')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const states = useMemo(() => {
    const set = new Set<string>()
    for (const l of lines) if (l.state) set.add(l.state)
    return Array.from(set).sort()
  }, [lines])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lines.filter((l) => {
      if (stateFilter !== 'all' && l.state !== stateFilter) return false
      if (q) {
        const hay = `${l.state} ${l.jurisdiction || ''} ${l.transaction_ref || ''} ${l.product_category || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [lines, stateFilter, search])

  const totals = useMemo(() => {
    let amount = 0
    let taxable = 0
    let marketplace = 0
    for (const l of filtered) {
      const a = num(l.amount)
      amount += a
      if (l.is_taxable) taxable += a
      if (l.is_marketplace) marketplace += a
    }
    return { amount, taxable, marketplace, count: filtered.length }
  }, [filtered])

  const maxSummary = useMemo(
    () => Math.max(1, ...summary.map((s) => num(s.total_amount ?? s.amount))),
    [summary],
  )

  function openAdd() {
    setForm(emptyForm)
    setFormError(null)
    setAddOpen(true)
  }

  async function submitAdd() {
    if (!form.state) {
      setFormError('State is required')
      return
    }
    const amt = parseFloat(form.amount)
    if (!Number.isFinite(amt)) {
      setFormError('Enter a valid amount')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        state: form.state,
        amount: amt,
        is_taxable: form.is_taxable,
        is_marketplace: form.is_marketplace,
      }
      if (form.sale_date) body.sale_date = form.sale_date
      if (form.jurisdiction.trim()) body.jurisdiction = form.jurisdiction.trim()
      if (form.transaction_ref.trim()) body.transaction_ref = form.transaction_ref.trim()
      if (form.product_category.trim()) body.product_category = form.product_category.trim()
      if (form.exempt_reason.trim()) body.exempt_reason = form.exempt_reason.trim()
      await api.addSalesLine(id, body)
      setAddOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to add sales line')
    } finally {
      setSaving(false)
    }
  }

  async function removeLine(l: SalesLine) {
    setBusyId(l.id)
    setError(null)
    try {
      await api.deleteSalesLine(id, l.id)
      setLines((prev) => prev.filter((x) => x.id !== l.id))
      // refresh summary so per-state totals stay accurate
      try {
        const sm = await api.getSalesSummary(id)
        setSummary(Array.isArray(sm) ? sm : [])
      } catch {
        /* keep stale summary rather than surface a secondary error */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete line')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteAll() {
    if (!window.confirm('Delete ALL sales lines for this engagement? This cannot be undone.')) return
    setBulkBusy(true)
    setError(null)
    try {
      await api.deleteAllSales(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete all sales')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/engagements/${id}`} className="text-sm text-stone-500 hover:text-stone-300">
          ← Engagement
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-stone-100">Sales lines</h1>
            <p className="mt-1 text-sm text-stone-500">
              Transaction detail feeding nexus crossings and exposure. Add lines manually or import them, then recompute.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/dashboard/engagements/${id}/imports`}>
              <Button variant="secondary">Bulk import</Button>
            </Link>
            <Button onClick={openAdd}>+ Add line</Button>
          </div>
        </div>
      </div>

      <EngagementSubNav id={id} active="/sales" />

      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading sales…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Gross sales" value={money(totals.amount)} tone="violet" hint={`${totals.count} line${totals.count === 1 ? '' : 's'}`} />
            <Stat label="Taxable sales" value={money(totals.taxable)} />
            <Stat label="Marketplace sales" value={money(totals.marketplace)} tone="amber" />
            <Stat label="States" value={states.length} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-wrap items-center gap-3">
                <h2 className="mr-auto text-sm font-semibold text-stone-200">Lines</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ref / jurisdiction…"
                  className="min-w-[10rem] rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
                />
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">All states</option>
                  {states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {lines.length > 0 ? (
                  <Button variant="danger" size="sm" onClick={deleteAll} disabled={bulkBusy}>
                    {bulkBusy ? 'Clearing…' : 'Delete all'}
                  </Button>
                ) : null}
              </CardHeader>
              <CardBody className="p-0">
                {filtered.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title={lines.length === 0 ? 'No sales lines yet' : 'No lines match your filters'}
                      description={
                        lines.length === 0
                          ? 'Add a line manually or import a CSV to begin building the exposure picture.'
                          : 'Adjust the state filter or search text.'
                      }
                      action={
                        lines.length === 0 ? (
                          <Button onClick={openAdd}>+ Add line</Button>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSearch('')
                              setStateFilter('all')
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
                        <TH>Date</TH>
                        <TH>State</TH>
                        <TH>Jurisdiction</TH>
                        <TH className="text-right">Amount</TH>
                        <TH>Flags</TH>
                        <TH>Ref</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {filtered.map((l) => (
                        <TR key={l.id}>
                          <TD className="whitespace-nowrap text-stone-400">{fmtDate(l.sale_date)}</TD>
                          <TD className="font-medium">{l.state}</TD>
                          <TD className="text-stone-400">{l.jurisdiction || '—'}</TD>
                          <TD className="text-right font-medium">{money(l.amount)}</TD>
                          <TD>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={l.is_taxable ? 'green' : 'slate'}>{l.is_taxable ? 'taxable' : 'exempt'}</Badge>
                              {l.is_marketplace ? <Badge tone="amber">mkt</Badge> : null}
                            </div>
                          </TD>
                          <TD className="text-xs text-stone-500">
                            {l.transaction_ref || '—'}
                            {l.product_category ? <div className="text-stone-600">{l.product_category}</div> : null}
                          </TD>
                          <TD>
                            <div className="flex justify-end">
                              <Button variant="ghost" size="sm" disabled={busyId === l.id} onClick={() => removeLine(l)}>
                                Delete
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

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-stone-200">Per-state summary</h2>
              </CardHeader>
              <CardBody>
                {summary.length === 0 ? (
                  <p className="text-sm text-stone-500">No summary data yet.</p>
                ) : (
                  <div className="space-y-3">
                    {summary
                      .slice()
                      .sort((a, b) => num(b.total_amount ?? b.amount) - num(a.total_amount ?? a.amount))
                      .map((s) => {
                        const amt = num(s.total_amount ?? s.amount)
                        const cnt = num(s.transaction_count ?? s.count)
                        return (
                          <button
                            key={s.state}
                            onClick={() => setStateFilter((cur) => (cur === s.state ? 'all' : s.state))}
                            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                              stateFilter === s.state
                                ? 'border-blue-500/50 bg-blue-500/10'
                                : 'border-stone-800 bg-stone-950/40 hover:border-stone-700'
                            }`}
                          >
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-stone-200">{s.state}</span>
                              <span className="text-stone-300">{money(amt)}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
                              <div className="h-full bg-blue-500" style={{ width: `${(amt / maxSummary) * 100}%` }} />
                            </div>
                            {cnt > 0 ? <div className="mt-1 text-xs text-stone-500">{cnt} transactions</div> : null}
                          </button>
                        )
                      })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add sales line"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={saving}>
              {saving ? 'Adding…' : 'Add line'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">State</label>
              <select
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Sale date</label>
              <input
                type="date"
                value={form.sale_date}
                onChange={(e) => setForm((f) => ({ ...f, sale_date: e.target.value }))}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Jurisdiction</label>
              <input
                value={form.jurisdiction}
                onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                placeholder="e.g. Los Angeles County"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Transaction ref</label>
              <input
                value={form.transaction_ref}
                onChange={(e) => setForm((f) => ({ ...f, transaction_ref: e.target.value }))}
                placeholder="INV-1001"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Product category</label>
              <input
                value={form.product_category}
                onChange={(e) => setForm((f) => ({ ...f, product_category: e.target.value }))}
                placeholder="saas / tangible / service"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={form.is_taxable}
                onChange={(e) => setForm((f) => ({ ...f, is_taxable: e.target.checked }))}
                className="h-4 w-4 rounded border-stone-600 bg-stone-950 text-blue-500 focus:ring-blue-500"
              />
              Taxable
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={form.is_marketplace}
                onChange={(e) => setForm((f) => ({ ...f, is_marketplace: e.target.checked }))}
                className="h-4 w-4 rounded border-stone-600 bg-stone-950 text-blue-500 focus:ring-blue-500"
              />
              Marketplace-facilitated
            </label>
          </div>
          {!form.is_taxable ? (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Exempt reason</label>
              <input
                value={form.exempt_reason}
                onChange={(e) => setForm((f) => ({ ...f, exempt_reason: e.target.value }))}
                placeholder="resale / nontaxable service / …"
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
