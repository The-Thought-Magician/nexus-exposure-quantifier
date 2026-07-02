'use client'

import { use, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface TaxabilityRow {
  id: string
  engagement_id: string
  state: string
  product_category: string
  is_taxable: boolean
  rate_override: number | string | null
}

interface TaxRate {
  id: string
  state: string
  base_rate: number | string | null
  avg_combined_rate: number | string | null
  effective_date?: string
  filing_frequency?: string
}

const CATEGORY_SUGGESTIONS = [
  'SaaS',
  'Software (downloaded)',
  'Digital goods',
  'Tangible goods',
  'Professional services',
  'Shipping',
  'Support & maintenance',
  'Data processing',
]

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function pct(v: number | string | null | undefined): string {
  const n = num(v)
  if (n === null) return '—'
  // rates may be stored as fraction (0.0725) or as percent (7.25)
  const asPct = n <= 1 ? n * 100 : n
  return `${asPct.toFixed(2)}%`
}

export default function TaxabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [rows, setRows] = useState<TaxabilityRow[]>([])
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [stateFilter, setStateFilter] = useState('')
  const [taxableFilter, setTaxableFilter] = useState<'all' | 'taxable' | 'exempt'>('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<TaxabilityRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [form, setForm] = useState({
    state: '',
    product_category: '',
    is_taxable: true,
    rate_override: '',
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [tax, rates] = await Promise.all([api.listTaxability(id), api.listTaxRates()])
      setRows(Array.isArray(tax) ? tax : [])
      setTaxRates(Array.isArray(rates) ? rates : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load taxability matrix')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const rateByState = useMemo(() => {
    const m = new Map<string, TaxRate>()
    for (const r of taxRates) {
      if (!m.has(r.state)) m.set(r.state, r)
    }
    return m
  }, [taxRates])

  const states = useMemo(() => {
    const s = new Set<string>()
    rows.forEach((r) => s.add(r.state))
    return Array.from(s).sort()
  }, [rows])

  const categories = useMemo(() => {
    const s = new Set<string>()
    rows.forEach((r) => s.add(r.product_category))
    return Array.from(s).sort()
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (stateFilter && r.state !== stateFilter) return false
      if (taxableFilter === 'taxable' && !r.is_taxable) return false
      if (taxableFilter === 'exempt' && r.is_taxable) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.state.toLowerCase().includes(q) && !r.product_category.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, stateFilter, taxableFilter, search])

  // Matrix pivot: states (rows) x categories (columns)
  const matrix = useMemo(() => {
    const key = (st: string, cat: string) => `${st}|||${cat}`
    const m = new Map<string, TaxabilityRow>()
    filtered.forEach((r) => m.set(key(r.state, r.product_category), r))
    const filteredStates = Array.from(new Set(filtered.map((r) => r.state))).sort()
    const filteredCats = Array.from(new Set(filtered.map((r) => r.product_category))).sort()
    return { m, key, filteredStates, filteredCats }
  }, [filtered])

  const stats = useMemo(() => {
    const taxable = rows.filter((r) => r.is_taxable).length
    const overrides = rows.filter((r) => num(r.rate_override) !== null).length
    return { total: rows.length, taxable, exempt: rows.length - taxable, states: states.length, overrides }
  }, [rows, states])

  function openCreate() {
    setEditing(null)
    setForm({ state: '', product_category: '', is_taxable: true, rate_override: '' })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(r: TaxabilityRow) {
    setEditing(r)
    setForm({
      state: r.state,
      product_category: r.product_category,
      is_taxable: r.is_taxable,
      rate_override: num(r.rate_override) === null ? '' : String(num(r.rate_override)),
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    if (!form.state.trim() || !form.product_category.trim()) {
      setFormError('State and product category are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        state: form.state.trim().toUpperCase(),
        product_category: form.product_category.trim(),
        is_taxable: form.is_taxable,
        rate_override: form.rate_override.trim() === '' ? null : Number(form.rate_override),
      }
      await api.upsertTaxability(id, body)
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save row')
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: TaxabilityRow) {
    if (!confirm(`Delete taxability rule for ${r.product_category} in ${r.state}?`)) return
    try {
      await api.deleteTaxability(id, r.id)
      setRows((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete row')
    }
  }

  async function bulkToggle(makeTaxable: boolean) {
    if (filtered.length === 0) return
    if (
      !confirm(
        `Mark ${filtered.length} filtered rule(s) as ${makeTaxable ? 'taxable' : 'exempt'}? This upserts each row.`,
      )
    )
      return
    try {
      for (const r of filtered) {
        if (r.is_taxable === makeTaxable) continue
        await api.upsertTaxability(id, {
          state: r.state,
          product_category: r.product_category,
          is_taxable: makeTaxable,
          rate_override: num(r.rate_override),
        })
      }
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Bulk update failed')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-100">Product Taxability Matrix</h1>
          <p className="mt-1 text-sm text-stone-500">
            Map each product category to a taxable/exempt treatment per state. Overrides feed exposure computations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => load()}>
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            + Add rule
          </Button>
        </div>
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
        <Spinner label="Loading taxability matrix…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Rules" value={stats.total} />
            <Stat label="States" value={stats.states} tone="violet" />
            <Stat label="Taxable" value={stats.taxable} tone="amber" />
            <Stat label="Exempt" value={stats.exempt} tone="green" />
            <Stat label="Rate overrides" value={stats.overrides} />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search state or category…"
                className="w-56 rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
              />
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <div className="inline-flex overflow-hidden rounded-lg border border-stone-700">
                {(['all', 'taxable', 'exempt'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTaxableFilter(t)}
                    className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                      taxableFilter === t ? 'bg-blue-600 text-white' : 'bg-stone-950 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => bulkToggle(true)}>
                  Mark filtered taxable
                </Button>
                <Button variant="secondary" size="sm" onClick={() => bulkToggle(false)}>
                  Mark filtered exempt
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {rows.length === 0 ? (
                <EmptyState
                  title="No taxability rules yet"
                  description="Add product-category treatments per state. Rules with no override inherit the state's combined rate."
                  action={<Button size="sm" onClick={openCreate}>+ Add first rule</Button>}
                />
              ) : filtered.length === 0 ? (
                <EmptyState title="No rules match the current filters" description="Adjust the search or filters above." />
              ) : (
                <div className="space-y-8">
                  {/* Matrix pivot */}
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Matrix — state × category
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-stone-800">
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-stone-900/80">
                          <tr>
                            <th className="sticky left-0 z-10 bg-stone-900/80 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                              State
                            </th>
                            {matrix.filteredCats.map((c) => (
                              <th
                                key={c}
                                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500"
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-800">
                          {matrix.filteredStates.map((st) => {
                            const rate = rateByState.get(st)
                            return (
                              <tr key={st} className="hover:bg-stone-800/40">
                                <td className="sticky left-0 z-10 bg-stone-900 px-4 py-3">
                                  <div className="font-medium text-stone-100">{st}</div>
                                  <div className="text-xs text-stone-500">{rate ? pct(rate.avg_combined_rate ?? rate.base_rate) : 'no rate'}</div>
                                </td>
                                {matrix.filteredCats.map((c) => {
                                  const cell = matrix.m.get(matrix.key(st, c))
                                  if (!cell)
                                    return (
                                      <td key={c} className="px-4 py-3 text-stone-700">
                                        —
                                      </td>
                                    )
                                  return (
                                    <td key={c} className="px-4 py-3">
                                      <button
                                        onClick={() => openEdit(cell)}
                                        className="inline-flex flex-col items-start gap-1 text-left"
                                        title="Edit rule"
                                      >
                                        <Badge tone={cell.is_taxable ? 'amber' : 'green'}>
                                          {cell.is_taxable ? 'Taxable' : 'Exempt'}
                                        </Badge>
                                        {num(cell.rate_override) !== null ? (
                                          <span className="text-xs text-blue-300">
                                            override {pct(cell.rate_override)}
                                          </span>
                                        ) : null}
                                      </button>
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Detail rows */}
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      All rules ({filtered.length})
                    </div>
                    <Table>
                      <THead>
                        <TR>
                          <TH>State</TH>
                          <TH>Product category</TH>
                          <TH>Treatment</TH>
                          <TH>Rate override</TH>
                          <TH>State combined rate</TH>
                          <TH className="text-right">Actions</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {filtered.map((r) => {
                          const rate = rateByState.get(r.state)
                          return (
                            <TR key={r.id}>
                              <TD className="font-medium text-stone-100">{r.state}</TD>
                              <TD>{r.product_category}</TD>
                              <TD>
                                <Badge tone={r.is_taxable ? 'amber' : 'green'}>
                                  {r.is_taxable ? 'Taxable' : 'Exempt'}
                                </Badge>
                              </TD>
                              <TD>{num(r.rate_override) !== null ? pct(r.rate_override) : <span className="text-stone-600">inherit</span>}</TD>
                              <TD className="text-stone-400">{rate ? pct(rate.avg_combined_rate ?? rate.base_rate) : '—'}</TD>
                              <TD className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                                    Edit
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                                    Delete
                                  </Button>
                                </div>
                              </TD>
                            </TR>
                          )
                        })}
                      </TBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit taxability rule' : 'Add taxability rule'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <p className="text-sm text-red-300">{formError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">State</label>
            <input
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder="e.g. CA"
              maxLength={2}
              disabled={!!editing}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm uppercase text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Product category
            </label>
            <input
              value={form.product_category}
              onChange={(e) => setForm((f) => ({ ...f, product_category: e.target.value }))}
              placeholder="e.g. SaaS"
              list="taxability-categories"
              disabled={!!editing}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none disabled:opacity-60"
            />
            <datalist id="taxability-categories">
              {[...new Set([...CATEGORY_SUGGESTIONS, ...categories])].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={form.is_taxable}
                onChange={(e) => setForm((f) => ({ ...f, is_taxable: e.target.checked }))}
                className="h-4 w-4 rounded border-stone-600 bg-stone-950 text-blue-600 focus:ring-blue-500"
              />
              Taxable in this state
            </label>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Rate override (optional)
            </label>
            <input
              value={form.rate_override}
              onChange={(e) => setForm((f) => ({ ...f, rate_override: e.target.value }))}
              placeholder="e.g. 0.0725 or 7.25 — leave blank to inherit"
              inputMode="decimal"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-stone-600">
              Leave blank to use the state&apos;s combined rate from the tax-rate library.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
