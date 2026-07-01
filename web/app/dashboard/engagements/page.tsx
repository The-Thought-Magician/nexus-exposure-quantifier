'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface Engagement {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  as_of_date?: string | null
  status?: string | null
  is_locked?: boolean
  total_tax?: number | string | null
  total_penalty?: number | string | null
  total_interest?: number | string | null
  total_exposure?: number | string | null
  total_vda_savings?: number | string | null
  created_at?: string | null
  updated_at?: string | null
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

function statusTone(status?: string | null): 'slate' | 'blue' | 'green' | 'amber' {
  switch ((status || '').toLowerCase()) {
    case 'final':
    case 'complete':
    case 'completed':
      return 'green'
    case 'review':
    case 'in_review':
      return 'amber'
    case 'active':
    case 'in_progress':
      return 'blue'
    default:
      return 'slate'
  }
}

export default function EngagementsPage() {
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [wsFilter, setWsFilter] = useState('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', workspace_id: '', as_of_date: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [eng, ws] = await Promise.all([api.listEngagements(), api.listWorkspaces()])
      const engList: Engagement[] = Array.isArray(eng) ? eng : []
      const wsList: Workspace[] = Array.isArray(ws) ? ws : []
      setEngagements(engList)
      setWorkspaces(wsList)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load engagements')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const wsName = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of workspaces) m.set(w.id, w.name)
    return m
  }, [workspaces])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    for (const e of engagements) if (e.status) set.add(e.status)
    return Array.from(set).sort()
  }, [engagements])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return engagements.filter((e) => {
      if (wsFilter !== 'all' && e.workspace_id !== wsFilter) return false
      if (statusFilter !== 'all' && (e.status || '') !== statusFilter) return false
      if (q) {
        const hay = `${e.name} ${e.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [engagements, search, statusFilter, wsFilter])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, e) => {
        acc.tax += num(e.total_tax)
        acc.penalty += num(e.total_penalty)
        acc.interest += num(e.total_interest)
        acc.exposure += num(e.total_exposure)
        acc.vda += num(e.total_vda_savings)
        return acc
      },
      { tax: 0, penalty: 0, interest: 0, exposure: 0, vda: 0 },
    )
  }, [filtered])

  function openCreate() {
    setForm({ name: '', description: '', workspace_id: workspaces[0]?.id || '', as_of_date: '' })
    setFormError(null)
    setCreateOpen(true)
  }

  async function submitCreate() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    if (!form.workspace_id) {
      setFormError('Select a workspace')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        workspace_id: form.workspace_id,
      }
      if (form.description.trim()) body.description = form.description.trim()
      if (form.as_of_date) body.as_of_date = form.as_of_date
      await api.createEngagement(body)
      setCreateOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create engagement')
    } finally {
      setSaving(false)
    }
  }

  async function clone(e: Engagement) {
    setBusyId(e.id)
    try {
      await api.cloneEngagement(e.id, { name: `${e.name} (copy)` })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone engagement')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(e: Engagement) {
    if (!window.confirm(`Delete engagement "${e.name}"? This removes all sales, exposure and reports.`)) return
    setBusyId(e.id)
    try {
      await api.deleteEngagement(e.id)
      setEngagements((prev) => prev.filter((x) => x.id !== e.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete engagement')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Engagements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nexus exposure studies across your client base. Create, clone and drill into each engagement.
          </p>
        </div>
        <Button onClick={openCreate}>+ New engagement</Button>
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
        <Spinner label="Loading engagements…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total exposure" value={money(totals.exposure)} tone="violet" hint={`${filtered.length} engagement${filtered.length === 1 ? '' : 's'}`} />
            <Stat label="Tax" value={money(totals.tax)} />
            <Stat label="Penalty" value={money(totals.penalty)} tone="amber" />
            <Stat label="Interest" value={money(totals.interest)} tone="amber" />
            <Stat label="VDA savings" value={money(totals.vda)} tone="green" />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search engagements…"
                className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
              />
              <select
                value={wsFilter}
                onChange={(e) => setWsFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="all">All workspaces</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="all">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={engagements.length === 0 ? 'No engagements yet' : 'No engagements match your filters'}
                    description={
                      engagements.length === 0
                        ? 'Create your first engagement to start quantifying sales-tax nexus exposure.'
                        : 'Adjust search or filters to see more results.'
                    }
                    action={
                      engagements.length === 0 ? (
                        <Button onClick={openCreate}>+ New engagement</Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSearch('')
                            setStatusFilter('all')
                            setWsFilter('all')
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
                      <TH>Engagement</TH>
                      <TH>Workspace</TH>
                      <TH>Status</TH>
                      <TH>As of</TH>
                      <TH className="text-right">Exposure</TH>
                      <TH className="text-right">VDA savings</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((e) => (
                      <TR key={e.id}>
                        <TD>
                          <Link href={`/dashboard/engagements/${e.id}`} className="font-medium text-slate-100 hover:text-violet-300">
                            {e.name}
                          </Link>
                          {e.description ? <div className="mt-0.5 text-xs text-slate-500">{e.description}</div> : null}
                        </TD>
                        <TD className="text-slate-400">{wsName.get(e.workspace_id) || '—'}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <Badge tone={statusTone(e.status)}>{e.status || 'draft'}</Badge>
                            {e.is_locked ? <Badge tone="slate">🔒 locked</Badge> : null}
                          </div>
                        </TD>
                        <TD className="text-slate-400">{fmtDate(e.as_of_date)}</TD>
                        <TD className="text-right font-medium text-violet-300">{money(e.total_exposure)}</TD>
                        <TD className="text-right text-emerald-300">{money(e.total_vda_savings)}</TD>
                        <TD>
                          <div className="flex justify-end gap-2">
                            <Link href={`/dashboard/engagements/${e.id}`}>
                              <Button variant="secondary" size="sm">
                                Open
                              </Button>
                            </Link>
                            <Button variant="ghost" size="sm" disabled={busyId === e.id} onClick={() => clone(e)}>
                              Clone
                            </Button>
                            <Button variant="ghost" size="sm" disabled={busyId === e.id} onClick={() => remove(e)}>
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
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New engagement"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? 'Creating…' : 'Create engagement'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Acme Corp — 2024 nexus study"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</label>
            {workspaces.length === 0 ? (
              <p className="text-sm text-amber-300">Create a workspace first from the Workspaces page.</p>
            ) : (
              <select
                value={form.workspace_id}
                onChange={(e) => setForm((f) => ({ ...f, workspace_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">As-of date</label>
            <input
              type="date"
              value={form.as_of_date}
              onChange={(e) => setForm((f) => ({ ...f, as_of_date: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Scope, entities, notes…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
