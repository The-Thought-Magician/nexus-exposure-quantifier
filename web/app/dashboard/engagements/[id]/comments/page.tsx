'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'

interface Comment {
  id: string
  engagement_id: string
  user_id: string
  state?: string | null
  parent_id?: string | null
  body: string
  created_at?: string | null
}

interface Snapshot {
  share_token?: string | null
  label?: string | null
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

function fmtTime(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function initials(userId: string): string {
  const base = (userId || '?').replace(/[^a-zA-Z0-9]/g, '')
  return base.slice(0, 2).toUpperCase() || '?'
}

export default function CommentsPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [meId, setMeId] = useState<string | null>(null)

  const [stateFilter, setStateFilter] = useState('')
  const [search, setSearch] = useState('')

  const [body, setBody] = useState('')
  const [commentState, setCommentState] = useState('')
  const [posting, setPosting] = useState(false)

  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [replyBody, setReplyBody] = useState('')

  // Snapshot modal
  const [snapModal, setSnapModal] = useState(false)
  const [snapLabel, setSnapLabel] = useState('')
  const [creatingSnap, setCreatingSnap] = useState(false)
  const [createdSnap, setCreatedSnap] = useState<Snapshot | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    authClient
      .getSession?.()
      ?.then((s: any) => {
        if (!active) return
        const uid = s?.data?.user?.id ?? s?.user?.id ?? s?.data?.session?.userId ?? null
        setMeId(uid)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.listComments(id)
      setComments(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comments')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const states = useMemo(() => {
    const set = new Set<string>()
    comments.forEach((c) => {
      if (c.state) set.add(c.state)
    })
    return Array.from(set).sort()
  }, [comments])

  // Build threaded structure: top-level (no parent) with children
  const threads = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byParent = new Map<string, Comment[]>()
    const roots: Comment[] = []
    for (const c of comments) {
      if (c.parent_id) {
        const arr = byParent.get(c.parent_id) ?? []
        arr.push(c)
        byParent.set(c.parent_id, arr)
      }
    }
    for (const c of comments) {
      if (c.parent_id) continue
      if (stateFilter && (c.state ?? '') !== stateFilter) continue
      const children = (byParent.get(c.id) ?? []).slice().sort((a, b) => tOf(a) - tOf(b))
      if (q) {
        const match =
          c.body.toLowerCase().includes(q) || children.some((ch) => ch.body.toLowerCase().includes(q))
        if (!match) continue
      }
      roots.push(c)
    }
    roots.sort((a, b) => tOf(b) - tOf(a))
    return roots.map((r) => ({ root: r, replies: byParent.get(r.id) ?? [] }))
  }, [comments, stateFilter, search])

  function tOf(c: Comment): number {
    const d = c.created_at ? new Date(c.created_at).getTime() : 0
    return Number.isFinite(d) ? d : 0
  }

  const post = async () => {
    if (!body.trim()) return
    setPosting(true)
    setError('')
    try {
      await api.addComment(id, { body: body.trim(), state: commentState || null })
      setBody('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  const postReply = async () => {
    if (!replyTo || !replyBody.trim()) return
    setPosting(true)
    setError('')
    try {
      await api.addComment(id, {
        body: replyBody.trim(),
        parent_id: replyTo.id,
        state: replyTo.state || null,
      })
      setReplyBody('')
      setReplyTo(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post reply')
    } finally {
      setPosting(false)
    }
  }

  const remove = async (c: Comment) => {
    if (!confirm('Delete this comment?')) return
    setError('')
    try {
      await api.deleteComment(id, c.id)
      setComments((prev) => prev.filter((x) => x.id !== c.id && x.parent_id !== c.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete comment')
      await load()
    }
  }

  const createSnapshot = async () => {
    setCreatingSnap(true)
    setError('')
    try {
      const snap = await api.createSnapshot(id, { label: snapLabel || undefined })
      setCreatedSnap(snap ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create snapshot')
    } finally {
      setCreatingSnap(false)
    }
  }

  const shareUrl = createdSnap?.share_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${createdSnap.share_token}`
    : ''

  const copyShare = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const closeSnapModal = () => {
    setSnapModal(false)
    setSnapLabel('')
    setCreatedSnap(null)
    setCopied(false)
  }

  const canDelete = (c: Comment) => meId === null || c.user_id === meId

  const CommentBubble = ({ c, isReply }: { c: Comment; isReply?: boolean }) => (
    <div className={`flex gap-3 ${isReply ? 'ml-6 border-l border-stone-800 pl-4' : ''}`}>
      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-500/20 text-xs font-semibold text-blue-300">
        {initials(c.user_id)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-stone-200">
            {c.user_id === meId ? 'You' : c.user_id.slice(0, 12)}
          </span>
          {c.state && <Badge tone="blue">{c.state}</Badge>}
          <span className="text-xs text-stone-500">{fmtTime(c.created_at)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-300">{c.body}</p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          {!isReply && (
            <button
              onClick={() => {
                setReplyTo(c)
                setReplyBody('')
              }}
              className="text-stone-500 transition-colors hover:text-blue-300"
            >
              Reply
            </button>
          )}
          {canDelete(c) && (
            <button
              onClick={() => remove(c)}
              className="text-stone-500 transition-colors hover:text-red-300"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )

  const replyCount = comments.filter((c) => c.parent_id).length

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
          <h1 className="mt-1 text-2xl font-bold text-stone-100">Comments &amp; Collaboration</h1>
          <p className="mt-1 text-sm text-stone-500">
            Threaded discussion on findings, and a locked shareable snapshot for the diligence team.
          </p>
        </div>
        <Button onClick={() => setSnapModal(true)}>Create shareable snapshot</Button>
      </div>

      <SubNav id={id} active="comments" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <Spinner label="Loading comments…" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Threads" value={threads.length || comments.filter((c) => !c.parent_id).length} tone="violet" />
            <Stat label="Total comments" value={comments.length} />
            <Stat label="Replies" value={replyCount} tone="green" />
          </div>

          {/* New comment composer */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-stone-200">Add a comment</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Note a finding, ask a question, flag a risk…"
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-stone-400">Tag state</label>
                  <input
                    value={commentState}
                    onChange={(e) => setCommentState(e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="e.g. CA"
                    className="w-24 rounded-lg border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <Button onClick={post} disabled={posting || !body.trim()}>
                  {posting ? 'Posting…' : 'Post comment'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Filters */}
          {comments.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1 rounded-lg border border-stone-800 bg-stone-900/60 p-1">
                <button
                  onClick={() => setStateFilter('')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    stateFilter === '' ? 'bg-blue-600 text-white' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                >
                  All states
                </button>
                {states.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStateFilter(s)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      stateFilter === s ? 'bg-blue-600 text-white' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search comments…"
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none sm:w-72"
              />
            </div>
          )}

          {/* Threads */}
          {comments.length === 0 ? (
            <EmptyState
              title="No comments yet"
              description="Start the discussion by adding the first comment above."
              icon={<span>💬</span>}
            />
          ) : threads.length === 0 ? (
            <Card>
              <CardBody>
                <p className="py-6 text-center text-sm text-stone-500">No comments match the current filters.</p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-4">
              {threads.map(({ root, replies }) => (
                <Card key={root.id}>
                  <CardBody className="space-y-4">
                    <CommentBubble c={root} />
                    {replies
                      .slice()
                      .sort((a, b) => tOf(a) - tOf(b))
                      .map((r) => (
                        <CommentBubble key={r.id} c={r} isReply />
                      ))}
                    {replyTo?.id === root.id && (
                      <div className="ml-6 space-y-2 border-l border-blue-500/40 pl-4">
                        <textarea
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          rows={2}
                          autoFocus
                          placeholder={`Reply to ${root.user_id === meId ? 'yourself' : root.user_id.slice(0, 12)}…`}
                          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={postReply} disabled={posting || !replyBody.trim()}>
                            {posting ? 'Posting…' : 'Reply'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Snapshot modal */}
      <Modal
        open={snapModal}
        onClose={closeSnapModal}
        title="Create shareable snapshot"
        footer={
          createdSnap ? (
            <Button onClick={closeSnapModal}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeSnapModal}>
                Cancel
              </Button>
              <Button onClick={createSnapshot} disabled={creatingSnap}>
                {creatingSnap ? 'Creating…' : 'Create snapshot'}
              </Button>
            </>
          )
        }
      >
        {createdSnap ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              Snapshot created. Share the read-only link below with your diligence team.
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">Read-only link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-300 focus:outline-none"
                />
                <Button variant="secondary" onClick={copyShare} disabled={!shareUrl}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {createdSnap.label && <p className="mt-2 text-xs text-stone-500">Label: {createdSnap.label}</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-stone-400">
              A snapshot freezes the current exposure results into a locked, read-only page you can share externally.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-400">Label (optional)</label>
              <input
                value={snapLabel}
                onChange={(e) => setSnapLabel(e.target.value)}
                placeholder="e.g. Q2 diligence packet"
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
