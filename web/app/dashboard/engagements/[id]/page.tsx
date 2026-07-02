'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

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

const SUB_TABS = [
  ['Summary', ''],
  ['Sales', '/sales'],
  ['Imports', '/imports'],
  ['Crossings', '/crossings'],
  ['Exposure', '/exposure'],
  ['Scenarios', '/scenarios'],
  ['Materiality', '/materiality'],
  ['Wait Cost', '/wait-cost'],
  ['Taxability', '/taxability'],
  ['Assumptions', '/assumptions'],
  ['Memo', '/memo'],
  ['Remediation', '/remediation'],
  ['Comments', '/comments'],
  ['Reports', '/reports'],
] as const

export function EngagementSubNav({ id, active }: { id: string; active?: string }) {
  const pathname = usePathname()
  const base = `/dashboard/engagements/${id}`
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-stone-800 pb-px">
      {SUB_TABS.map(([label, suffix]) => {
        const href = `${base}${suffix}`
        const isActive = active !== undefined ? active === suffix : pathname === href
        return (
          <Link
            key={label}
            href={href}
            className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-b-2 border-blue-500 text-blue-300'
                : 'border-b-2 border-transparent text-stone-400 hover:text-stone-200'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}

export default function EngagementSummaryPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [eng, setEng] = useState<Engagement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', as_of_date: '', status: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getEngagement(id)
      setEng(data as Engagement)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load engagement')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function recompute() {
    setAction('recompute')
    setNotice(null)
    setError(null)
    try {
      await api.recomputeEngagement(id)
      setNotice('Recompute complete. Crossings, exposure and scenarios refreshed.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setAction(null)
    }
  }

  async function toggleLock() {
    if (!eng) return
    setAction('lock')
    setError(null)
    try {
      const next = !eng.is_locked
      await api.lockEngagement(id, { is_locked: next })
      setNotice(next ? 'Engagement locked.' : 'Engagement unlocked.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lock toggle failed')
    } finally {
      setAction(null)
    }
  }

  function openEdit() {
    if (!eng) return
    setForm({
      name: eng.name || '',
      description: eng.description || '',
      as_of_date: eng.as_of_date ? eng.as_of_date.slice(0, 10) : '',
      status: eng.status || '',
    })
    setFormError(null)
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
      }
      if (form.as_of_date) body.as_of_date = form.as_of_date
      if (form.status.trim()) body.status = form.status.trim()
      await api.updateEngagement(id, body)
      setEditOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update engagement')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="Loading engagement…" />

  if (error && !eng) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
        <Link href="/dashboard/engagements" className="text-sm text-blue-300 hover:text-blue-200">
          ← Back to engagements
        </Link>
      </div>
    )
  }

  if (!eng) return null

  const exposure = num(eng.total_exposure)
  const tax = num(eng.total_tax)
  const penalty = num(eng.total_penalty)
  const interest = num(eng.total_interest)
  const vda = num(eng.total_vda_savings)
  // Simple stacked composition bar (tax / penalty / interest) as SVG-free divs.
  const compTotal = tax + penalty + interest || 1
  const segs = [
    { label: 'Tax', value: tax, cls: 'bg-blue-500' },
    { label: 'Penalty', value: penalty, cls: 'bg-amber-500' },
    { label: 'Interest', value: interest, cls: 'bg-sky-500' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/engagements" className="text-sm text-stone-500 hover:text-stone-300">
          ← Engagements
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-stone-100">{eng.name}</h1>
              <Badge tone={eng.is_locked ? 'slate' : 'blue'}>{eng.status || 'draft'}</Badge>
              {eng.is_locked ? <Badge tone="amber">🔒 locked</Badge> : null}
            </div>
            {eng.description ? <p className="mt-1 max-w-2xl text-sm text-stone-500">{eng.description}</p> : null}
            <p className="mt-1 text-xs text-stone-600">
              As of {fmtDate(eng.as_of_date)} · Updated {fmtDate(eng.updated_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={openEdit} disabled={!!action}>
              Edit
            </Button>
            <Button variant="secondary" onClick={toggleLock} disabled={!!action}>
              {action === 'lock' ? 'Working…' : eng.is_locked ? 'Unlock' : 'Lock'}
            </Button>
            <Button onClick={recompute} disabled={!!action || eng.is_locked}>
              {action === 'recompute' ? 'Recomputing…' : 'Recompute'}
            </Button>
          </div>
        </div>
      </div>

      <EngagementSubNav id={id} active="" />

      {notice ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      ) : null}
      {eng.is_locked ? (
        <div className="rounded-lg border border-stone-700 bg-stone-800/40 px-4 py-3 text-sm text-stone-400">
          This engagement is locked. Unlock it to recompute or edit inputs.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total exposure" value={money(exposure)} tone="violet" hint="tax + penalty + interest" />
        <Stat label="Tax" value={money(tax)} />
        <Stat label="Penalty" value={money(penalty)} tone="amber" />
        <Stat label="Interest" value={money(interest)} tone="amber" />
        <Stat label="VDA savings" value={money(vda)} tone="green" hint="vs. register-now" />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-stone-200">Exposure composition</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {tax + penalty + interest === 0 ? (
            <p className="text-sm text-stone-500">
              No exposure computed yet. Add sales lines then run <span className="text-blue-300">Recompute</span>.
            </p>
          ) : (
            <>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-stone-800">
                {segs.map((s) =>
                  s.value > 0 ? (
                    <div
                      key={s.label}
                      className={s.cls}
                      style={{ width: `${(s.value / compTotal) * 100}%` }}
                      title={`${s.label}: ${money(s.value)}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-stone-400">
                {segs.map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.cls}`} />
                    {s.label} · {money(s.value)} ({((s.value / compTotal) * 100).toFixed(1)}%)
                  </div>
                ))}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-stone-200">Work the engagement</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SUB_TABS.filter(([, suffix]) => suffix !== '').map(([label, suffix]) => (
              <Link
                key={label}
                href={`/dashboard/engagements/${id}${suffix}`}
                className="rounded-lg border border-stone-800 bg-stone-950/40 px-4 py-3 text-sm font-medium text-stone-300 transition-colors hover:border-blue-500/40 hover:text-blue-200"
              >
                {label}
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit engagement"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">As-of date</label>
              <input
                type="date"
                value={form.as_of_date}
                onChange={(e) => setForm((f) => ({ ...f, as_of_date: e.target.value }))}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
              >
                <option value="">draft</option>
                <option value="active">active</option>
                <option value="review">review</option>
                <option value="final">final</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
