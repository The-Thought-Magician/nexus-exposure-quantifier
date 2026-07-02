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

interface Memo {
  id: string
  engagement_id: string
  user_id?: string
  title: string
  scope: string
  state?: string | null
  content?: unknown
  as_of_date?: string | null
  created_at?: string
}

function fmtDate(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// Render memo content JSON into a readable document. The content shape is flexible,
// so we render known keys nicely and fall back to sections/paragraphs.
function MemoContent({ content }: { content: unknown }) {
  if (content == null) {
    return <p className="text-sm text-stone-500">This memo has no rendered body.</p>
  }
  if (typeof content === 'string') {
    return (
      <div className="space-y-3">
        {content.split(/\n{2,}/).map((p, i) => (
          <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">
            {p}
          </p>
        ))}
      </div>
    )
  }
  if (Array.isArray(content)) {
    return (
      <div className="space-y-4">
        {content.map((sec, i) => (
          <MemoSection key={i} section={sec} />
        ))}
      </div>
    )
  }
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>
    // Common shape: { summary, totals, sections, states, ... }
    const totals = (obj.totals ?? obj.rollup) as Record<string, unknown> | undefined
    const sections = obj.sections as unknown[] | undefined
    const perState = (obj.states ?? obj.per_state) as unknown[] | undefined
    return (
      <div className="space-y-5">
        {typeof obj.summary === 'string' ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Summary</h4>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">{obj.summary}</p>
          </div>
        ) : null}

        {totals && typeof totals === 'object' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {'total_tax' in totals ? <Stat label="Tax" value={fmtMoney(totals.total_tax)} /> : null}
            {'total_penalty' in totals ? <Stat label="Penalty" value={fmtMoney(totals.total_penalty)} tone="amber" /> : null}
            {'total_interest' in totals ? <Stat label="Interest" value={fmtMoney(totals.total_interest)} tone="amber" /> : null}
            {'total_exposure' in totals ? <Stat label="Exposure" value={fmtMoney(totals.total_exposure)} tone="red" /> : null}
            {'total_vda_savings' in totals ? (
              <Stat label="VDA savings" value={fmtMoney(totals.total_vda_savings)} tone="green" />
            ) : null}
          </div>
        ) : null}

        {Array.isArray(sections)
          ? sections.map((sec, i) => <MemoSection key={i} section={sec} />)
          : null}

        {Array.isArray(perState) && perState.length ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Per-state</h4>
            <div className="overflow-x-auto rounded-lg border border-stone-800">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-800">
                  {perState.map((row, i) => {
                    const r = row as Record<string, unknown>
                    return (
                      <tr key={i} className="hover:bg-stone-800/40">
                        <td className="px-3 py-2 font-medium text-stone-100">{String(r.state ?? '')}</td>
                        <td className="px-3 py-2 text-right text-stone-300">{fmtMoney(r.total ?? r.total_exposure)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Remaining scalar keys we didn't explicitly render */}
        {Object.entries(obj)
          .filter(([k, v]) => !['summary', 'totals', 'rollup', 'sections', 'states', 'per_state'].includes(k) && (typeof v === 'string' || typeof v === 'number'))
          .map(([k, v]) => (
            <div key={k}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{k.replace(/_/g, ' ')}</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">{String(v)}</p>
            </div>
          ))}
      </div>
    )
  }
  return <pre className="overflow-x-auto rounded-lg bg-stone-950 p-3 text-xs text-stone-400">{JSON.stringify(content, null, 2)}</pre>
}

function MemoSection({ section }: { section: unknown }) {
  if (typeof section === 'string') {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">{section}</p>
  }
  if (section && typeof section === 'object') {
    const s = section as Record<string, unknown>
    const heading = (s.heading ?? s.title ?? s.name) as string | undefined
    const bodyRaw = s.body ?? s.text ?? s.content
    const items = s.items as unknown[] | undefined
    return (
      <div>
        {heading ? <h4 className="mb-1 text-sm font-semibold text-stone-200">{heading}</h4> : null}
        {typeof bodyRaw === 'string' ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">{bodyRaw}</p>
        ) : null}
        {Array.isArray(items) ? (
          <ul className="ml-4 list-disc space-y-1 text-sm text-stone-300">
            {items.map((it, i) => (
              <li key={i}>{typeof it === 'string' ? it : JSON.stringify(it)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }
  return null
}

export default function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Memo | null>(null)
  const [selectedLoading, setSelectedLoading] = useState(false)

  const [genOpen, setGenOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  const [genForm, setGenForm] = useState({ scope: 'consolidated', state: '', title: '' })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const m = await api.listMemos(id)
      const list: Memo[] = Array.isArray(m) ? m : []
      setMemos(list)
      if (list.length && !selected) void openMemo(list[0])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load memos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function openMemo(m: Memo) {
    setSelectedLoading(true)
    try {
      const full = await api.getMemo(id, m.id)
      setSelected(full && typeof full === 'object' ? (full as Memo) : m)
    } catch {
      setSelected(m)
    } finally {
      setSelectedLoading(false)
    }
  }

  async function generate() {
    if (genForm.scope === 'state' && !genForm.state.trim()) {
      setGenErr('A state is required for a single-state memo.')
      return
    }
    setGenerating(true)
    setGenErr(null)
    try {
      const body: Record<string, unknown> = { scope: genForm.scope }
      if (genForm.title.trim()) body.title = genForm.title.trim()
      if (genForm.scope === 'state') body.state = genForm.state.trim().toUpperCase()
      const created = await api.generateMemo(id, body)
      setGenOpen(false)
      setGenForm({ scope: 'consolidated', state: '', title: '' })
      await load()
      if (created && typeof created === 'object' && (created as Memo).id) {
        await openMemo(created as Memo)
      }
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Failed to generate memo')
    } finally {
      setGenerating(false)
    }
  }

  async function remove(m: Memo) {
    if (!confirm(`Delete memo "${m.title}"?`)) return
    try {
      await api.deleteMemo(id, m.id)
      setMemos((prev) => prev.filter((x) => x.id !== m.id))
      if (selected?.id === m.id) setSelected(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete memo')
    }
  }

  const scopeStats = useMemo(() => {
    const consolidated = memos.filter((m) => m.scope !== 'state').length
    return { total: memos.length, consolidated, state: memos.length - consolidated }
  }, [memos])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-100">Exposure Memos</h1>
          <p className="mt-1 text-sm text-stone-500">
            Generate a diligence-ready exposure memo from the current computed results. Consolidated or single-state
            scope.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => load()}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setGenErr(null); setGenOpen(true) }}>
            + Generate memo
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
        <Spinner label="Loading memos…" />
      ) : memos.length === 0 ? (
        <EmptyState
          title="No memos generated yet"
          description="Generate a consolidated or single-state exposure memo from the latest computed results."
          action={<Button size="sm" onClick={() => { setGenErr(null); setGenOpen(true) }}>+ Generate first memo</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Memos" value={scopeStats.total} />
            <Stat label="Consolidated" value={scopeStats.consolidated} tone="violet" />
            <Stat label="State-specific" value={scopeStats.state} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <h2 className="text-sm font-semibold text-stone-200">Memo library</h2>
              </CardHeader>
              <CardBody className="space-y-2">
                {memos.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      selected?.id === m.id
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : 'border-stone-800 bg-stone-950/40 hover:border-stone-700'
                    }`}
                  >
                    <button className="min-w-0 flex-1 text-left" onClick={() => openMemo(m)}>
                      <div className="truncate text-sm font-medium text-stone-100">{m.title}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge tone={m.scope === 'state' ? 'blue' : 'violet'}>
                          {m.scope === 'state' ? m.state ?? 'State' : 'Consolidated'}
                        </Badge>
                        <span className="text-xs text-stone-500">{fmtDate(m.created_at)}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => remove(m)}
                      className="shrink-0 text-stone-600 transition-colors hover:text-red-300"
                      title="Delete memo"
                      aria-label="Delete memo"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-stone-200">
                  {selected ? selected.title : 'Select a memo'}
                </h2>
                {selected ? (
                  <div className="flex items-center gap-2">
                    <Badge tone={selected.scope === 'state' ? 'blue' : 'violet'}>
                      {selected.scope === 'state' ? selected.state ?? 'State' : 'Consolidated'}
                    </Badge>
                    {selected.as_of_date ? (
                      <span className="text-xs text-stone-500">as of {fmtDate(selected.as_of_date)}</span>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => remove(selected)}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </CardHeader>
              <CardBody>
                {selectedLoading ? (
                  <Spinner label="Loading memo…" />
                ) : selected ? (
                  <article className="prose-invert max-w-none">
                    <MemoContent content={selected.content} />
                  </article>
                ) : (
                  <EmptyState title="No memo selected" description="Pick a memo from the library to view it here." />
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate exposure memo"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setGenOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button size="sm" onClick={generate} disabled={generating}>
              {generating ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {genErr ? <p className="text-sm text-red-300">{genErr}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Scope</label>
            <div className="inline-flex overflow-hidden rounded-lg border border-stone-700">
              {(['consolidated', 'state'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setGenForm((f) => ({ ...f, scope: s }))}
                  className={`px-4 py-1.5 text-sm capitalize transition-colors ${
                    genForm.scope === s ? 'bg-blue-600 text-white' : 'bg-stone-950 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {genForm.scope === 'state' ? (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">State</label>
              <input
                value={genForm.state}
                onChange={(e) => setGenForm((f) => ({ ...f, state: e.target.value }))}
                placeholder="e.g. CA"
                maxLength={2}
                className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm uppercase text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Title (optional)
            </label>
            <input
              value={genForm.title}
              onChange={(e) => setGenForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Auto-generated if left blank"
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-stone-600">
            The memo captures a point-in-time snapshot of the current computed exposure. Recompute the engagement first
            if data changed.
          </p>
        </div>
      </Modal>
    </div>
  )
}
