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

interface Engagement {
  id: string
  name: string
  status?: string | null
  as_of_date?: string | null
}

interface Snapshot {
  id: string
  engagement_id: string
  user_id?: string | null
  share_token: string
  label?: string | null
  data?: Record<string, unknown> | null
  created_at?: string | null
}

const fmtDateTime = (v?: string | null): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

const money = (v: unknown): string =>
  num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// Try to pull a headline exposure figure out of the snapshot data blob.
function snapshotExposure(data?: Record<string, unknown> | null): number | null {
  if (!data || typeof data !== 'object') return null
  const candidates = ['total_exposure', 'totalExposure', 'exposure']
  for (const key of candidates) {
    if (key in data) return num((data as Record<string, unknown>)[key])
  }
  const totals = (data as Record<string, unknown>).totals
  if (totals && typeof totals === 'object') {
    const t = totals as Record<string, unknown>
    if ('total_exposure' in t) return num(t.total_exposure)
    if ('exposure' in t) return num(t.exposure)
  }
  const eng = (data as Record<string, unknown>).engagement
  if (eng && typeof eng === 'object' && 'total_exposure' in (eng as Record<string, unknown>)) {
    return num((eng as Record<string, unknown>).total_exposure)
  }
  return null
}

export default function SnapshotsPage() {
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [engFilter, setEngFilter] = useState('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ engagement_id: '', label: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const eng = await api.listEngagements()
      const engList: Engagement[] = Array.isArray(eng) ? eng : []
      setEngagements(engList)
      const results = await Promise.all(
        engList.map(async (e) => {
          try {
            const snaps = await api.listSnapshots(e.id)
            return Array.isArray(snaps) ? (snaps as Snapshot[]) : []
          } catch {
            return [] as Snapshot[]
          }
        }),
      )
      setSnapshots(results.flat())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshots')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const engName = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of engagements) m.set(e.id, e.name)
    return m
  }, [engagements])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return snapshots
      .filter((s) => {
        if (engFilter !== 'all' && s.engagement_id !== engFilter) return false
        if (q) {
          const hay = `${s.label || ''} ${engName.get(s.engagement_id) || ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  }, [snapshots, search, engFilter, engName])

  const stats = useMemo(() => {
    const engsWithSnaps = new Set(snapshots.map((s) => s.engagement_id)).size
    let latest: string | null = null
    for (const s of snapshots) {
      if (!s.created_at) continue
      if (!latest || new Date(s.created_at).getTime() > new Date(latest).getTime()) latest = s.created_at
    }
    return { total: snapshots.length, engsWithSnaps, latest }
  }, [snapshots])

  function openCreate() {
    setForm({ engagement_id: engagements[0]?.id || '', label: '' })
    setFormError(null)
    setCreateOpen(true)
  }

  async function submitCreate() {
    if (!form.engagement_id) {
      setFormError('Select an engagement')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {}
      if (form.label.trim()) body.label = form.label.trim()
      await api.createSnapshot(form.engagement_id, body)
      setCreateOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create snapshot')
    } finally {
      setSaving(false)
    }
  }

  async function remove(s: Snapshot) {
    if (!window.confirm(`Delete this snapshot${s.label ? ` "${s.label}"` : ''}? The share link will stop working.`)) return
    setBusyId(s.id)
    try {
      await api.deleteSnapshot(s.engagement_id, s.id)
      setSnapshots((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete snapshot')
    } finally {
      setBusyId(null)
    }
  }

  async function copyLink(token: string) {
    const url = `${origin}/shared/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(token)
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000)
    } catch {
      // Clipboard may be unavailable; fall back to prompt so the link is still copyable.
      window.prompt('Copy the share link:', url)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Snapshots</h1>
          <p className="mt-1 text-sm text-slate-500">
            Locked, point-in-time exposure snapshots you can share with diligence teams and clients via a read-only
            link. Snapshots freeze the numbers even as the engagement keeps changing.
          </p>
        </div>
        <Button onClick={openCreate} disabled={engagements.length === 0}>
          + New snapshot
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
        <Spinner label="Loading snapshots…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Total snapshots" value={stats.total} tone="violet" />
            <Stat label="Engagements snapshotted" value={`${stats.engsWithSnaps} / ${engagements.length}`} />
            <Stat label="Most recent" value={stats.latest ? fmtDateTime(stats.latest) : '—'} tone="green" />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by label or engagement…"
                className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
              />
              <select
                value={engFilter}
                onChange={(e) => setEngFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="all">All engagements</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={snapshots.length === 0 ? 'No snapshots yet' : 'No snapshots match your filters'}
                    description={
                      snapshots.length === 0
                        ? engagements.length === 0
                          ? 'Create an engagement first, then capture a snapshot to share its exposure numbers.'
                          : 'Capture a snapshot to freeze an engagement’s exposure and share it via a read-only link.'
                        : 'Adjust the search or engagement filter to see more.'
                    }
                    action={
                      snapshots.length === 0 ? (
                        engagements.length === 0 ? (
                          <Link href="/dashboard/engagements">
                            <Button variant="secondary">Go to engagements</Button>
                          </Link>
                        ) : (
                          <Button onClick={openCreate}>+ New snapshot</Button>
                        )
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSearch('')
                            setEngFilter('all')
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
                      <TH>Snapshot</TH>
                      <TH>Engagement</TH>
                      <TH className="text-right">Exposure at capture</TH>
                      <TH>Captured</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((s) => {
                      const exp = snapshotExposure(s.data)
                      return (
                        <TR key={s.id}>
                          <TD>
                            <div className="font-medium text-slate-100">{s.label || 'Untitled snapshot'}</div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <Badge tone="slate">🔒 locked</Badge>
                              <code className="text-[11px] text-slate-500">{s.share_token.slice(0, 10)}…</code>
                            </div>
                          </TD>
                          <TD className="text-slate-400">
                            <Link
                              href={`/dashboard/engagements/${s.engagement_id}`}
                              className="hover:text-violet-300"
                            >
                              {engName.get(s.engagement_id) || 'Unknown engagement'}
                            </Link>
                          </TD>
                          <TD className="text-right font-medium text-violet-300">
                            {exp !== null ? money(exp) : '—'}
                          </TD>
                          <TD className="text-slate-400">{fmtDateTime(s.created_at)}</TD>
                          <TD>
                            <div className="flex justify-end gap-2">
                              <a href={`/shared/${s.share_token}`} target="_blank" rel="noopener noreferrer">
                                <Button variant="secondary" size="sm">
                                  Open
                                </Button>
                              </a>
                              <Button variant="ghost" size="sm" onClick={() => copyLink(s.share_token)}>
                                {copied === s.share_token ? 'Copied!' : 'Copy link'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyId === s.id}
                                onClick={() => remove(s)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      )
                    })}
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
        title="Capture snapshot"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={saving || engagements.length === 0}>
              {saving ? 'Capturing…' : 'Capture snapshot'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          ) : null}
          <p className="text-sm text-slate-400">
            A snapshot freezes the engagement’s current exposure numbers into a shareable, read-only link. It does not
            change or lock the engagement itself.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Engagement</label>
            {engagements.length === 0 ? (
              <p className="text-sm text-amber-300">Create an engagement first.</p>
            ) : (
              <select
                value={form.engagement_id}
                onChange={(e) => setForm((f) => ({ ...f, engagement_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              >
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Label (optional)
            </label>
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Q2 diligence pack"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
