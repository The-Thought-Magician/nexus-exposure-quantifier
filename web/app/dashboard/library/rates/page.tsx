'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface TaxRate {
  id: string
  state: string
  base_rate?: number | string | null
  avg_combined_rate?: number | string | null
  effective_date?: string | null
  filing_frequency?: string | null
  notes?: string | null
}

interface PenaltyRule {
  id: string
  state: string
  failure_to_file_rate?: number | string | null
  failure_to_pay_rate?: number | string | null
  penalty_cap_rate?: number | string | null
  min_penalty?: number | string | null
  accrual?: string | null
  effective_date?: string | null
  notes?: string | null
}

interface InterestRate {
  id: string
  state: string
  year?: number | string | null
  annual_rate?: number | string | null
  compounding?: string | null
  notes?: string | null
}

interface VdaTerm {
  id: string
  state: string
  lookback_years?: number | string | null
  waives_penalties?: boolean | null
  interest_treatment?: string | null
  requires_no_prior_contact?: boolean | null
  notes?: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

const money = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  return num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// Rates are stored as fractions (0.0725) or percents (7.25). Normalize to a percent string.
const pct = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  let n = num(v)
  if (n > 0 && n <= 1) n = n * 100
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

const pctNum = (v: unknown): number => {
  let n = num(v)
  if (n > 0 && n <= 1) n = n * 100
  return n
}

const fmtDate = (v?: string | null): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

type Tab = 'tax' | 'penalty' | 'interest' | 'vda'

const TABS: { id: Tab; label: string }[] = [
  { id: 'tax', label: 'Tax rates' },
  { id: 'penalty', label: 'Penalty rules' },
  { id: 'interest', label: 'Interest rates' },
  { id: 'vda', label: 'VDA terms' },
]

export default function RatesLibraryPage() {
  const [tab, setTab] = useState<Tab>('tax')
  const [search, setSearch] = useState('')

  const [taxRates, setTaxRates] = useState<TaxRate[]>([])
  const [penaltyRules, setPenaltyRules] = useState<PenaltyRule[]>([])
  const [interestRates, setInterestRates] = useState<InterestRate[]>([])
  const [vdaTerms, setVdaTerms] = useState<VdaTerm[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [tr, pr, ir, vt] = await Promise.all([
        api.listTaxRates(),
        api.listPenaltyRules(),
        api.listInterestRates(),
        api.listVdaTerms(),
      ])
      setTaxRates(Array.isArray(tr) ? tr : [])
      setPenaltyRules(Array.isArray(pr) ? pr : [])
      setInterestRates(Array.isArray(ir) ? ir : [])
      setVdaTerms(Array.isArray(vt) ? vt : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rate libraries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const q = search.trim().toLowerCase()
  const matchState = (s: string, ...extra: (string | null | undefined)[]) => {
    if (!q) return true
    return `${s} ${extra.filter(Boolean).join(' ')}`.toLowerCase().includes(q)
  }

  const fTax = useMemo(
    () => taxRates.filter((r) => matchState(r.state, r.filing_frequency, r.notes)).sort((a, b) => a.state.localeCompare(b.state)),
    [taxRates, q],
  )
  const fPenalty = useMemo(
    () => penaltyRules.filter((r) => matchState(r.state, r.accrual, r.notes)).sort((a, b) => a.state.localeCompare(b.state)),
    [penaltyRules, q],
  )
  const fInterest = useMemo(
    () =>
      interestRates
        .filter((r) => matchState(r.state, r.compounding, r.notes))
        .sort((a, b) => a.state.localeCompare(b.state) || num(b.year) - num(a.year)),
    [interestRates, q],
  )
  const fVda = useMemo(
    () => vdaTerms.filter((r) => matchState(r.state, r.interest_treatment, r.notes)).sort((a, b) => a.state.localeCompare(b.state)),
    [vdaTerms, q],
  )

  const stats = useMemo(() => {
    const combined = taxRates.map((r) => pctNum(r.avg_combined_rate)).filter((n) => n > 0)
    const avgCombined = combined.length ? combined.reduce((a, b) => a + b, 0) / combined.length : 0
    const waives = vdaTerms.filter((v) => v.waives_penalties).length
    return {
      taxStates: taxRates.length,
      avgCombined,
      penaltyStates: penaltyRules.length,
      interestRows: interestRates.length,
      vdaStates: vdaTerms.length,
      waives,
    }
  }, [taxRates, penaltyRules, interestRates, vdaTerms])

  // Highest combined tax rates chart (top 8).
  const topRates = useMemo(() => {
    const rows = taxRates
      .map((r) => ({ state: r.state, rate: pctNum(r.avg_combined_rate) }))
      .filter((r) => r.rate > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 8)
    const max = Math.max(1, ...rows.map((r) => r.rate))
    return { rows, max }
  }, [taxRates])

  const activeCount =
    tab === 'tax' ? fTax.length : tab === 'penalty' ? fPenalty.length : tab === 'interest' ? fInterest.length : fVda.length
  const totalForTab =
    tab === 'tax'
      ? taxRates.length
      : tab === 'penalty'
        ? penaltyRules.length
        : tab === 'interest'
          ? interestRates.length
          : vdaTerms.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Rates &amp; VDA reference</h1>
          <p className="mt-1 text-sm text-slate-500">
            The tax, penalty, interest and voluntary-disclosure-agreement data used to quantify exposure. Read-only
            reference shared across every engagement.
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
        <Spinner label="Loading rate libraries…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Avg combined tax rate" value={pct(stats.avgCombined)} tone="violet" hint={`${stats.taxStates} states with rates`} />
            <Stat label="Penalty regimes" value={stats.penaltyStates} tone="amber" />
            <Stat label="Interest rate rows" value={stats.interestRows} hint="State × year" />
            <Stat label="VDA programs" value={stats.vdaStates} tone="green" hint={`${stats.waives} waive penalties`} />
          </div>

          {topRates.rows.length > 0 ? (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-200">Highest combined tax rates</h2>
              </CardHeader>
              <CardBody>
                <div className="space-y-2.5">
                  {topRates.rows.map((r) => (
                    <div key={r.state} className="flex items-center gap-3">
                      <div className="w-10 shrink-0 text-xs font-semibold text-slate-300">{r.state}</div>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-slate-800">
                        <div
                          className="h-full rounded bg-gradient-to-r from-violet-600 to-fuchsia-400"
                          style={{ width: `${(r.rate / topRates.max) * 100}%` }}
                        />
                      </div>
                      <div className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-300">{pct(r.rate)}</div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-1.5">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      tab === t.id
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search state or notes…"
                className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
              />
              <Badge tone="slate">
                {activeCount} of {totalForTab}
              </Badge>
            </CardHeader>
            <CardBody className="p-0">
              {activeCount === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={totalForTab === 0 ? 'No data in this library' : 'No matches'}
                    description={
                      totalForTab === 0
                        ? 'This reference library has not been seeded yet.'
                        : 'Adjust the search to see more rows.'
                    }
                    action={
                      totalForTab === 0 ? (
                        <Button variant="secondary" onClick={load}>
                          Reload
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => setSearch('')}>
                          Clear search
                        </Button>
                      )
                    }
                  />
                </div>
              ) : tab === 'tax' ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH className="text-right">Base rate</TH>
                      <TH className="text-right">Avg combined</TH>
                      <TH>Filing frequency</TH>
                      <TH>Effective</TH>
                      <TH>Notes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fTax.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-semibold text-slate-100">{r.state}</TD>
                        <TD className="text-right text-slate-300">{pct(r.base_rate)}</TD>
                        <TD className="text-right font-medium text-violet-300">{pct(r.avg_combined_rate)}</TD>
                        <TD className="text-slate-400">{r.filing_frequency || '—'}</TD>
                        <TD className="text-slate-400">{fmtDate(r.effective_date)}</TD>
                        <TD className="max-w-[16rem] truncate text-slate-500" title={r.notes || ''}>
                          {r.notes || '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : tab === 'penalty' ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH className="text-right">Failure to file</TH>
                      <TH className="text-right">Failure to pay</TH>
                      <TH className="text-right">Cap</TH>
                      <TH className="text-right">Min penalty</TH>
                      <TH>Accrual</TH>
                      <TH>Effective</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fPenalty.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-semibold text-slate-100">{r.state}</TD>
                        <TD className="text-right text-amber-300">{pct(r.failure_to_file_rate)}</TD>
                        <TD className="text-right text-amber-300">{pct(r.failure_to_pay_rate)}</TD>
                        <TD className="text-right text-slate-300">{pct(r.penalty_cap_rate)}</TD>
                        <TD className="text-right text-slate-300">{money(r.min_penalty)}</TD>
                        <TD className="text-slate-400">{r.accrual || '—'}</TD>
                        <TD className="text-slate-400">{fmtDate(r.effective_date)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : tab === 'interest' ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH className="text-right">Year</TH>
                      <TH className="text-right">Annual rate</TH>
                      <TH>Compounding</TH>
                      <TH>Notes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fInterest.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-semibold text-slate-100">{r.state}</TD>
                        <TD className="text-right tabular-nums text-slate-300">{r.year ?? '—'}</TD>
                        <TD className="text-right font-medium text-violet-300">{pct(r.annual_rate)}</TD>
                        <TD>
                          <Badge tone={String(r.compounding || '').toLowerCase().includes('daily') ? 'amber' : 'slate'}>
                            {r.compounding || '—'}
                          </Badge>
                        </TD>
                        <TD className="max-w-[16rem] truncate text-slate-500" title={r.notes || ''}>
                          {r.notes || '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>State</TH>
                      <TH className="text-right">Lookback</TH>
                      <TH>Waives penalties</TH>
                      <TH>Interest treatment</TH>
                      <TH>No prior contact</TH>
                      <TH>Notes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fVda.map((r) => (
                      <TR key={r.id}>
                        <TD className="font-semibold text-slate-100">{r.state}</TD>
                        <TD className="text-right tabular-nums text-slate-300">
                          {r.lookback_years !== null && r.lookback_years !== undefined
                            ? `${num(r.lookback_years)} yr`
                            : '—'}
                        </TD>
                        <TD>
                          <Badge tone={r.waives_penalties ? 'green' : 'slate'}>
                            {r.waives_penalties ? 'Waived' : 'Not waived'}
                          </Badge>
                        </TD>
                        <TD className="text-slate-400">{r.interest_treatment || '—'}</TD>
                        <TD>
                          <Badge tone={r.requires_no_prior_contact ? 'amber' : 'slate'}>
                            {r.requires_no_prior_contact ? 'Required' : 'Not required'}
                          </Badge>
                        </TD>
                        <TD className="max-w-[16rem] truncate text-slate-500" title={r.notes || ''}>
                          {r.notes || '—'}
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
    </div>
  )
}
