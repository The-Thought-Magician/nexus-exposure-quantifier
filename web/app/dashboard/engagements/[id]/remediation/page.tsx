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
import { Modal } from '@/components/ui/Modal'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface ChecklistItem {
  label: string
  done: boolean
}

interface RemediationItem {
  id: string
  engagement_id: string
  user_id?: string | null
  state: string
  status: string
  owner?: string | null
  target_date?: string | null
  checklist?: ChecklistItem[] | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface Progress {
  total?: number
  done?: number
  in_progress?: number
  not_started?: number
  pct?: number
}

interface AuditFlag {
  id: string
  engagement_id: string
  state: string
  vda_window?: boolean | string | null
  has_prior_contact?: boolean | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
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
    <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-stone-800 bg-stone-900/60 p-1">
      {SUB_NAV.map((t) => {
        const href = t.slug ? `/dashboard/engagements/${id}/${t.slug}` : `/dashboard/engagements/${id}`
        const isActive = t.slug === active
        return (
          <Link
            key={t.slug || 'summary'}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive ? 'bg-blue-600 text-white' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

const STATUSES = ['not_started', 'in_progress', 'blocked', 'complete'] as const
type Status = (typeof STATUSES)[number]

function statusMeta(status: string): { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' } {
  const s = (status || '').toLowerCase()
  if (s === 'complete' || s === 'completed' || s === 'done') return { label: 'Complete', tone: 'green' }
  if (s === 'in_progress' || s === 'in-progress' || s === 'active') return { label: 'In progress', tone: 'blue' }
  if (s === 'blocked') return { label: 'Blocked', tone: 'red' }
  return { label: 'Not started', tone: 'slate' }
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { label: 'Confirm nexus crossing date', done: false },
  { label: 'Determine registration vs. VDA path', done: false },
  { label: 'Prepare back-tax schedule', done: false },
  { label: 'File registration / VDA application', done: false },
  { label: 'Remit liability and confirm closure', done: false },
]

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]

function bool(v: boolean | string | null | undefined): boolean {
  if (typeof v === 'string') return v === 'true' || v === 'open' || v === 'yes'
  return !!v
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function RemediationPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [items, setItems] = useState<RemediationItem[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [flags, setFlags] = useState<AuditFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [search, setSearch] = useState('')

  // Remediation item modal
  const [itemModal, setItemModal] = useState<{ open: boolean; editing: RemediationItem | null }>({
    open: false,
    editing: null,
  })
  const [form, setForm] = useState({
    state: '',
    status: 'not_started' as string,
    owner: '',
    target_date: '',
    notes: '',
    checklist: DEFAULT_CHECKLIST,
  })

  // Audit flag modal
  const [flagModal, setFlagModal] = useState<{ open: boolean; editing: AuditFlag | null }>({ open: false, editing: null })
  const [flagForm, setFlagForm] = useState({
    state: '',
    vda_window: true,
    has_prior_contact: false,
    notes: '',
  })

  const load = useCallback(async () => {
    setError('')
    try {
      const [rem, af] = await Promise.all([api.getRemediation(id), api.listAuditFlags(id)])
      const rawItems = Array.isArray(rem) ? rem : Array.isArray(rem?.items) ? rem.items : []
      setItems(rawItems)
      setProgress(rem && !Array.isArray(rem) ? rem.progress ?? null : null)
      setFlags(Array.isArray(af) ? af : Array.isArray(af?.flags) ? af.flags : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load remediation data')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const computedProgress = useMemo(() => {
    const total = items.length
    const done = items.filter((i) => statusMeta(i.status).tone === 'green').length
    const inProg = items.filter((i) => statusMeta(i.status).tone === 'blue').length
    const blocked = items.filter((i) => statusMeta(i.status).tone === 'red').length
    const pct = progress?.pct ?? (total > 0 ? Math.round((done / total) * 100) : 0)
    return { total, done, inProg, blocked, pct }
  }, [items, progress])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (statusFilter !== 'all') {
        const meta = statusMeta(i.status)
        const map: Record<Status, string> = {
          not_started: 'Not started',
          in_progress: 'In progress',
          blocked: 'Blocked',
          complete: 'Complete',
        }
        if (meta.label !== map[statusFilter]) return false
      }
      if (q) {
        const hay = `${i.state} ${i.owner ?? ''} ${i.notes ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, statusFilter, search])

  const openCreateItem = () => {
    setForm({ state: '', status: 'not_started', owner: '', target_date: '', notes: '', checklist: DEFAULT_CHECKLIST })
    setItemModal({ open: true, editing: null })
  }

  const openEditItem = (it: RemediationItem) => {
    setForm({
      state: it.state,
      status: it.status || 'not_started',
      owner: it.owner ?? '',
      target_date: it.target_date ? it.target_date.slice(0, 10) : '',
      notes: it.notes ?? '',
      checklist: Array.isArray(it.checklist) && it.checklist.length > 0 ? it.checklist : DEFAULT_CHECKLIST,
    })
    setItemModal({ open: true, editing: it })
  }

  const saveItem = async () => {
    if (!form.state) {
      setError('Select a state for the remediation item')
      return
    }
    setSaving(true)
    setError('')
    const body = {
      state: form.state,
      status: form.status,
      owner: form.owner || null,
      target_date: form.target_date || null,
      notes: form.notes || null,
      checklist: form.checklist,
    }
    try {
      if (itemModal.editing) {
        await api.updateRemediation(id, itemModal.editing.id, body)
      } else {
        await api.upsertRemediation(id, body)
      }
      setItemModal({ open: false, editing: null })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save remediation item')
    } finally {
      setSaving(false)
    }
  }

  const quickStatus = async (it: RemediationItem, status: string) => {
    setError('')
    try {
      await api.updateRemediation(id, it.id, { status })
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, status } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
      await load()
    }
  }

  const toggleChecklist = (idx: number) => {
    setForm((f) => ({
      ...f,
      checklist: f.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)),
    }))
  }

  const openCreateFlag = () => {
    setFlagForm({ state: '', vda_window: true, has_prior_contact: false, notes: '' })
    setFlagModal({ open: true, editing: null })
  }

  const openEditFlag = (f: AuditFlag) => {
    setFlagForm({
      state: f.state,
      vda_window: bool(f.vda_window),
      has_prior_contact: !!f.has_prior_contact,
      notes: f.notes ?? '',
    })
    setFlagModal({ open: true, editing: f })
  }

  const saveFlag = async () => {
    if (!flagForm.state) {
      setError('Select a state for the audit flag')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.upsertAuditFlag(id, {
        state: flagForm.state,
        vda_window: flagForm.vda_window,
        has_prior_contact: flagForm.has_prior_contact,
        notes: flagForm.notes || null,
      })
      setFlagModal({ open: false, editing: null })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save audit flag')
    } finally {
      setSaving(false)
    }
  }

  const usedStates = useMemo(() => new Set(items.map((i) => i.state)), [items])
  const flaggedStates = useMemo(() => new Set(flags.map((f) => f.state)), [flags])

  const atRiskCount = useMemo(
    () => flags.filter((f) => f.has_prior_contact || !bool(f.vda_window)).length,
    [flags]
  )

  return (
    <div>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href={`/dashboard/engagements/${id}`}
            className="text-xs text-stone-500 transition-colors hover:text-blue-300"
          >
            ← Engagement
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-stone-100">Remediation &amp; Audit Risk</h1>
          <p className="mt-1 text-sm text-stone-500">
            Track per-state cleanup work and flag states where VDA windows are closing or contact has already occurred.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openCreateFlag}>
            + Audit flag
          </Button>
          <Button onClick={openCreateItem}>+ Remediation item</Button>
        </div>
      </div>

      <SubNav id={id} active="remediation" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <Spinner label="Loading remediation…" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tracked states" value={computedProgress.total} tone="violet" />
            <Stat
              label="Complete"
              value={computedProgress.done}
              tone="green"
              hint={`${computedProgress.pct}% of tracked work`}
            />
            <Stat label="In progress" value={computedProgress.inProg} tone="amber" />
            <Stat
              label="Audit-risk states"
              value={atRiskCount}
              tone={atRiskCount > 0 ? 'red' : 'default'}
              hint={`${flags.length} flag${flags.length === 1 ? '' : 's'} recorded`}
            />
          </div>

          {/* Progress bar */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-stone-200">Overall remediation progress</h2>
                <span className="text-sm font-semibold tabular-nums text-emerald-300">{computedProgress.pct}%</span>
              </div>
            </CardHeader>
            <CardBody>
              <div className="h-3 w-full overflow-hidden rounded-full bg-stone-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.max(2, computedProgress.pct)}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500">
                <span>
                  <span className="text-emerald-300">{computedProgress.done}</span> complete
                </span>
                <span>
                  <span className="text-sky-300">{computedProgress.inProg}</span> in progress
                </span>
                <span>
                  <span className="text-red-300">{computedProgress.blocked}</span> blocked
                </span>
                <span>
                  <span className="text-stone-300">
                    {computedProgress.total - computedProgress.done - computedProgress.inProg - computedProgress.blocked}
                  </span>{' '}
                  not started
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1 rounded-lg border border-stone-800 bg-stone-900/60 p-1">
              {(['all', ...STATUSES] as const).map((s) => {
                const label =
                  s === 'all'
                    ? 'All'
                    : s === 'not_started'
                    ? 'Not started'
                    : s === 'in_progress'
                    ? 'In progress'
                    : s === 'blocked'
                    ? 'Blocked'
                    : 'Complete'
                const active = statusFilter === s
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active ? 'bg-blue-600 text-white' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search state, owner, notes…"
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none sm:w-72"
            />
          </div>

          {/* Remediation items table */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-stone-200">Remediation tracker</h2>
            </CardHeader>
            {items.length === 0 ? (
              <CardBody>
                <EmptyState
                  title="No remediation items yet"
                  description="Add a per-state remediation item to track registration or VDA cleanup work."
                  action={<Button onClick={openCreateItem}>+ Remediation item</Button>}
                  icon={<span>🛠️</span>}
                />
              </CardBody>
            ) : filtered.length === 0 ? (
              <CardBody>
                <p className="py-6 text-center text-sm text-stone-500">No items match the current filters.</p>
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>State</TH>
                    <TH>Status</TH>
                    <TH>Owner</TH>
                    <TH>Target date</TH>
                    <TH>Checklist</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((it) => {
                    const meta = statusMeta(it.status)
                    const checklist = Array.isArray(it.checklist) ? it.checklist : []
                    const doneCount = checklist.filter((c) => c.done).length
                    const flagged = flaggedStates.has(it.state)
                    return (
                      <TR key={it.id}>
                        <TD>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-stone-100">{it.state}</span>
                            {flagged && <Badge tone="red">Flagged</Badge>}
                          </div>
                        </TD>
                        <TD>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </TD>
                        <TD className="text-stone-300">{it.owner || <span className="text-stone-600">—</span>}</TD>
                        <TD className="text-stone-300">{fmtDate(it.target_date)}</TD>
                        <TD>
                          {checklist.length > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-800">
                                <div
                                  className="h-full bg-blue-500"
                                  style={{ width: `${(doneCount / checklist.length) * 100}%` }}
                                />
                              </div>
                              <span className="text-xs tabular-nums text-stone-500">
                                {doneCount}/{checklist.length}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-stone-600">—</span>
                          )}
                        </TD>
                        <TD className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              value={statusMeta(it.status).label}
                              onChange={(e) => {
                                const map: Record<string, string> = {
                                  'Not started': 'not_started',
                                  'In progress': 'in_progress',
                                  Blocked: 'blocked',
                                  Complete: 'complete',
                                }
                                quickStatus(it, map[e.target.value])
                              }}
                              className="rounded-md border border-stone-700 bg-stone-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                            >
                              <option>Not started</option>
                              <option>In progress</option>
                              <option>Blocked</option>
                              <option>Complete</option>
                            </select>
                            <Button variant="ghost" size="sm" onClick={() => openEditItem(it)}>
                              Edit
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          {/* Audit flags */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-stone-200">Audit-risk flags</h2>
                  <p className="mt-0.5 text-xs text-stone-500">
                    A closed VDA window or prior contact with the state raises audit exposure.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={openCreateFlag}>
                  + Flag
                </Button>
              </div>
            </CardHeader>
            {flags.length === 0 ? (
              <CardBody>
                <EmptyState
                  title="No audit flags recorded"
                  description="Flag any state where the VDA window has closed or where you have had prior contact with the taxing authority."
                  action={<Button onClick={openCreateFlag}>+ Audit flag</Button>}
                  icon={<span>🚩</span>}
                />
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>State</TH>
                    <TH>VDA window</TH>
                    <TH>Prior contact</TH>
                    <TH>Risk</TH>
                    <TH>Notes</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {flags.map((f) => {
                    const vdaOpen = bool(f.vda_window)
                    const risk = f.has_prior_contact || !vdaOpen
                    return (
                      <TR key={f.id}>
                        <TD className="font-semibold text-stone-100">{f.state}</TD>
                        <TD>
                          <Badge tone={vdaOpen ? 'green' : 'red'}>{vdaOpen ? 'Open' : 'Closed'}</Badge>
                        </TD>
                        <TD>
                          <Badge tone={f.has_prior_contact ? 'red' : 'slate'}>
                            {f.has_prior_contact ? 'Yes' : 'No'}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={risk ? 'red' : 'green'}>{risk ? 'Elevated' : 'Low'}</Badge>
                        </TD>
                        <TD className="max-w-xs truncate text-stone-400">
                          {f.notes || <span className="text-stone-600">—</span>}
                        </TD>
                        <TD className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEditFlag(f)}>
                            Edit
                          </Button>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* Remediation item modal */}
      <Modal
        open={itemModal.open}
        onClose={() => setItemModal({ open: false, editing: null })}
        title={itemModal.editing ? `Edit remediation — ${itemModal.editing.state}` : 'New remediation item'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemModal({ open: false, editing: null })}>
              Cancel
            </Button>
            <Button onClick={saveItem} disabled={saving}>
              {saving ? 'Saving…' : itemModal.editing ? 'Save changes' : 'Create item'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">State</label>
              <select
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                disabled={!!itemModal.editing}
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-60"
              >
                <option value="">Select…</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s} disabled={!itemModal.editing && usedStates.has(s)}>
                    {s}
                    {!itemModal.editing && usedStates.has(s) ? ' (tracked)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="complete">Complete</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">Owner</label>
              <input
                value={form.owner}
                onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
                placeholder="Assignee"
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">Target date</label>
              <input
                type="date"
                value={form.target_date}
                onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-400">Checklist</label>
            <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
              {form.checklist.map((c, idx) => (
                <label key={idx} className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={() => toggleChecklist(idx)}
                    className="h-4 w-4 rounded border-stone-600 bg-stone-800 accent-blue-600"
                  />
                  <span className={c.done ? 'text-stone-500 line-through' : ''}>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-400">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Context, blockers, next steps…"
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Audit flag modal */}
      <Modal
        open={flagModal.open}
        onClose={() => setFlagModal({ open: false, editing: null })}
        title={flagModal.editing ? `Edit flag — ${flagModal.editing.state}` : 'New audit-risk flag'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFlagModal({ open: false, editing: null })}>
              Cancel
            </Button>
            <Button onClick={saveFlag} disabled={saving}>
              {saving ? 'Saving…' : flagModal.editing ? 'Save changes' : 'Create flag'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-400">State</label>
            <select
              value={flagForm.state}
              onChange={(e) => setFlagForm((f) => ({ ...f, state: e.target.value }))}
              disabled={!!flagModal.editing}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-60"
            >
              <option value="">Select…</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2.5 text-sm text-stone-300">
            <span>VDA window still open</span>
            <input
              type="checkbox"
              checked={flagForm.vda_window}
              onChange={(e) => setFlagForm((f) => ({ ...f, vda_window: e.target.checked }))}
              className="h-4 w-4 rounded border-stone-600 bg-stone-800 accent-blue-600"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2.5 text-sm text-stone-300">
            <span>Prior contact with the state</span>
            <input
              type="checkbox"
              checked={flagForm.has_prior_contact}
              onChange={(e) => setFlagForm((f) => ({ ...f, has_prior_contact: e.target.checked }))}
              className="h-4 w-4 rounded border-stone-600 bg-stone-800 accent-blue-600"
            />
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-400">Notes</label>
            <textarea
              value={flagForm.notes}
              onChange={(e) => setFlagForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="Audit-risk context…"
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
