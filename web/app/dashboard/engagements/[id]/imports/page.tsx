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

interface ImportJob {
  id: string
  engagement_id: string
  user_id?: string
  source: string
  status: string
  row_count: number
  error_count: number
  column_mapping?: Record<string, string> | null
  created_at: string
}

interface ImportError {
  id: string
  import_job_id: string
  row_number: number
  message: string
  raw_row?: Record<string, unknown> | null
  created_at: string
}

const CONNECTORS = ['stripe', 'shopify', 'quickbooks', 'netsuite', 'square', 'amazon'] as const

function fmtDate(v?: string) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusTone(status: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  const s = (status || '').toLowerCase()
  if (s === 'completed' || s === 'complete' || s === 'success' || s === 'done') return 'green'
  if (s === 'processing' || s === 'pending' || s === 'running') return 'blue'
  if (s === 'partial' || s === 'warning') return 'amber'
  if (s === 'failed' || s === 'error') return 'red'
  return 'slate'
}

function sourceTone(source: string): 'violet' | 'blue' | 'slate' {
  const s = (source || '').toLowerCase()
  if (s === 'csv') return 'violet'
  if (s === 'sample') return 'slate'
  return 'blue'
}

export default function ImportsPage() {
  const params = useParams<{ id: string }>()
  const engagementId = params.id

  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  // CSV upload modal
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvErr, setCsvErr] = useState<string | null>(null)

  // Connector modal
  const [connOpen, setConnOpen] = useState(false)
  const [connSource, setConnSource] = useState<string>(CONNECTORS[0])
  const [connApiKey, setConnApiKey] = useState('')
  const [connFrom, setConnFrom] = useState('')
  const [connTo, setConnTo] = useState('')
  const [connBusy, setConnBusy] = useState(false)
  const [connErr, setConnErr] = useState<string | null>(null)

  // Sample seeder
  const [seedBusy, setSeedBusy] = useState(false)

  // Errors drawer
  const [errJob, setErrJob] = useState<ImportJob | null>(null)
  const [errRows, setErrRows] = useState<ImportError[]>([])
  const [errLoading, setErrLoading] = useState(false)
  const [errLoadErr, setErrLoadErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listImports(engagementId)
      setJobs(Array.isArray(data) ? data : data?.jobs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load import jobs')
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter((j) => {
      if (sourceFilter !== 'all' && (j.source || '').toLowerCase() !== sourceFilter) return false
      if (!q) return true
      return (
        (j.source || '').toLowerCase().includes(q) ||
        (j.status || '').toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q)
      )
    })
  }, [jobs, sourceFilter, search])

  const totals = useMemo(() => {
    const rows = jobs.reduce((a, j) => a + (j.row_count || 0), 0)
    const errs = jobs.reduce((a, j) => a + (j.error_count || 0), 0)
    return { jobs: jobs.length, rows, errs }
  }, [jobs])

  const sources = useMemo(() => {
    const set = new Set<string>()
    jobs.forEach((j) => j.source && set.add(j.source.toLowerCase()))
    return Array.from(set).sort()
  }, [jobs])

  async function onFile(file: File) {
    setCsvFileName(file.name)
    const text = await file.text()
    setCsvText(text)
  }

  async function submitCsv() {
    if (!csvText.trim()) {
      setCsvErr('Paste CSV content or choose a file first.')
      return
    }
    setCsvBusy(true)
    setCsvErr(null)
    try {
      const job = await api.importCsv(engagementId, { csv: csvText, filename: csvFileName || 'upload.csv' })
      setCsvOpen(false)
      setCsvText('')
      setCsvFileName('')
      flash(`CSV import queued: ${job?.row_count ?? 0} rows, ${job?.error_count ?? 0} errors.`)
      await load()
    } catch (e) {
      setCsvErr(e instanceof Error ? e.message : 'CSV import failed')
    } finally {
      setCsvBusy(false)
    }
  }

  async function submitConnector() {
    setConnBusy(true)
    setConnErr(null)
    try {
      const body: Record<string, unknown> = { source: connSource }
      if (connApiKey.trim()) body.api_key = connApiKey.trim()
      if (connFrom) body.from = connFrom
      if (connTo) body.to = connTo
      const job = await api.importConnector(engagementId, body)
      setConnOpen(false)
      setConnApiKey('')
      setConnFrom('')
      setConnTo('')
      flash(`Connector import queued from ${connSource}: ${job?.row_count ?? 0} rows.`)
      await load()
    } catch (e) {
      setConnErr(e instanceof Error ? e.message : 'Connector import failed')
    } finally {
      setConnBusy(false)
    }
  }

  async function seed() {
    setSeedBusy(true)
    setError(null)
    try {
      const res = await api.seedSample(engagementId)
      flash(`Seeded sample data: ${res?.inserted ?? res?.job?.row_count ?? 0} rows across multiple states.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample seed failed')
    } finally {
      setSeedBusy(false)
    }
  }

  async function openErrors(job: ImportJob) {
    setErrJob(job)
    setErrRows([])
    setErrLoadErr(null)
    setErrLoading(true)
    try {
      const data = await api.getImportErrors(engagementId, job.id)
      setErrRows(Array.isArray(data) ? data : data?.errors ?? [])
    } catch (e) {
      setErrLoadErr(e instanceof Error ? e.message : 'Failed to load errors')
    } finally {
      setErrLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Link href={`/dashboard/engagements/${engagementId}`} className="hover:text-blue-300">
              Engagement
            </Link>
            <span>/</span>
            <span className="text-stone-400">Imports</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-stone-100">Data Imports</h1>
          <p className="mt-1 text-sm text-stone-500">
            Load transaction data via CSV, connectors, or seed a realistic multi-state sample to test nexus exposure.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConnOpen(true)}>
            Connector
          </Button>
          <Button variant="secondary" onClick={seed} disabled={seedBusy}>
            {seedBusy ? 'Seeding…' : 'Seed sample'}
          </Button>
          <Button onClick={() => setCsvOpen(true)}>Upload CSV</Button>
        </div>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Import jobs" value={totals.jobs} tone="violet" />
        <Stat label="Rows imported" value={totals.rows.toLocaleString()} tone="green" />
        <Stat label="Row errors" value={totals.errs.toLocaleString()} tone={totals.errs > 0 ? 'red' : 'default'} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-stone-200">Import jobs</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs…"
              className="w-44 rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <Spinner label="Loading import jobs…" />
          ) : jobs.length === 0 ? (
            <EmptyState
              title="No imports yet"
              description="Upload a CSV of sales transactions, connect a source system, or seed a realistic sample to get started."
              action={
                <div className="flex gap-2">
                  <Button onClick={() => setCsvOpen(true)}>Upload CSV</Button>
                  <Button variant="secondary" onClick={seed} disabled={seedBusy}>
                    Seed sample
                  </Button>
                </div>
              }
            />
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-stone-500">No jobs match your filters.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Errors</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((j) => (
                  <TR key={j.id}>
                    <TD>
                      <Badge tone={sourceTone(j.source)}>{j.source || 'unknown'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(j.status)}>{j.status || '—'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{(j.row_count || 0).toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">
                      {j.error_count > 0 ? (
                        <span className="text-red-300">{j.error_count.toLocaleString()}</span>
                      ) : (
                        <span className="text-stone-500">0</span>
                      )}
                    </TD>
                    <TD className="text-stone-400">{fmtDate(j.created_at)}</TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openErrors(j)}
                        disabled={!j.error_count}
                        title={j.error_count ? 'View row errors' : 'No errors'}
                      >
                        View errors
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* CSV modal */}
      <Modal
        open={csvOpen}
        onClose={() => (csvBusy ? null : setCsvOpen(false))}
        title="Upload CSV"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCsvOpen(false)} disabled={csvBusy}>
              Cancel
            </Button>
            <Button onClick={submitCsv} disabled={csvBusy}>
              {csvBusy ? 'Importing…' : 'Import'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-stone-400">
            Expected columns: <code className="text-blue-300">sale_date, state, amount</code> and optional{' '}
            <code className="text-blue-300">jurisdiction, is_taxable, is_marketplace, transaction_ref, product_category</code>.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Choose file
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              className="block w-full text-sm text-stone-400 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-blue-500"
            />
            {csvFileName ? <p className="mt-1 text-xs text-stone-500">Loaded: {csvFileName}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Or paste CSV
            </label>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={8}
              placeholder="sale_date,state,amount,is_taxable&#10;2024-01-15,CA,1200.00,true"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-xs text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          {csvErr ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {csvErr}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Connector modal */}
      <Modal
        open={connOpen}
        onClose={() => (connBusy ? null : setConnOpen(false))}
        title="Connector import"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConnOpen(false)} disabled={connBusy}>
              Cancel
            </Button>
            <Button onClick={submitConnector} disabled={connBusy}>
              {connBusy ? 'Connecting…' : 'Import'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Source</label>
            <select
              value={connSource}
              onChange={(e) => setConnSource(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            >
              {CONNECTORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              API key (optional)
            </label>
            <input
              value={connApiKey}
              onChange={(e) => setConnApiKey(e.target.value)}
              placeholder="sk_live_…"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">From</label>
              <input
                type="date"
                value={connFrom}
                onChange={(e) => setConnFrom(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">To</label>
              <input
                type="date"
                value={connTo}
                onChange={(e) => setConnTo(e.target.value)}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          {connErr ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {connErr}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Errors modal */}
      <Modal
        open={!!errJob}
        onClose={() => setErrJob(null)}
        title={errJob ? `Import errors — ${errJob.source} (${errJob.error_count})` : 'Import errors'}
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setErrJob(null)}>
            Close
          </Button>
        }
      >
        {errLoading ? (
          <Spinner label="Loading errors…" />
        ) : errLoadErr ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {errLoadErr}
          </div>
        ) : errRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">No error rows recorded for this job.</p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {errRows.map((er) => (
              <div key={er.id} className="rounded-lg border border-stone-800 bg-stone-950/60 p-3">
                <div className="flex items-center justify-between">
                  <Badge tone="red">Row {er.row_number}</Badge>
                  <span className="text-xs text-stone-500">{fmtDate(er.created_at)}</span>
                </div>
                <p className="mt-2 text-sm text-stone-300">{er.message}</p>
                {er.raw_row ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-stone-900 p-2 text-xs text-stone-500">
                    {JSON.stringify(er.raw_row, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
