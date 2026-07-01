'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

interface Notification {
  id: string
  user_id?: string
  workspace_id?: string
  kind?: string
  title?: string
  body?: string
  is_read?: boolean
  created_at?: string
}

interface Workspace {
  id: string
  name: string
  owner_id?: string
}

interface Activity {
  id: string
  workspace_id?: string
  user_id?: string
  action?: string
  target?: string
  meta?: Record<string, unknown>
  created_at?: string
}

const timeAgo = (iso?: string) => {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

const kindTone = (kind?: string) => {
  switch ((kind || '').toLowerCase()) {
    case 'alert':
    case 'warning':
    case 'crossing':
      return 'amber' as const
    case 'error':
    case 'failed':
      return 'red' as const
    case 'success':
    case 'complete':
    case 'completed':
      return 'green' as const
    case 'info':
      return 'blue' as const
    default:
      return 'violet' as const
  }
}

const asArray = <T,>(v: any, key?: string): T[] => {
  if (Array.isArray(v)) return v
  if (key && Array.isArray(v?.[key])) return v[key]
  if (Array.isArray(v?.data)) return v.data
  return []
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(false)
  const [error, setError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [busyId, setBusyId] = useState<string>('')
  const [markingAll, setMarkingAll] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const loadActivity = useCallback((workspaceId: string) => {
    if (!workspaceId) {
      setActivity([])
      return
    }
    setActivityLoading(true)
    setActivityError('')
    api
      .getActivity(workspaceId)
      .then((res) => setActivity(asArray<Activity>(res, 'activity')))
      .catch((e) => setActivityError(e?.message || 'Failed to load activity.'))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.listNotifications(), api.listWorkspaces()])
      .then(([notifs, ws]) => {
        if (!active) return
        setNotifications(asArray<Notification>(notifs, 'notifications'))
        const wsList = asArray<Workspace>(ws, 'workspaces')
        setWorkspaces(wsList)
        if (wsList.length > 0) {
          setSelectedWorkspace(wsList[0].id)
          loadActivity(wsList[0].id)
        }
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Failed to load notifications.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadActivity])

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  )

  const visibleNotifications = useMemo(() => {
    const list = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications
    return [...list].sort((a, b) => {
      const at = new Date(a.created_at || 0).getTime()
      const bt = new Date(b.created_at || 0).getTime()
      return bt - at
    })
  }, [notifications, filter])

  const workspaceName = useCallback(
    (id?: string) => workspaces.find((w) => w.id === id)?.name || '',
    [workspaces],
  )

  async function markRead(id: string) {
    setBusyId(id)
    try {
      await api.markNotificationRead(id)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    } catch (e: any) {
      setError(e?.message || 'Failed to mark notification read.')
    } finally {
      setBusyId('')
    }
  }

  async function markAll() {
    setMarkingAll(true)
    try {
      await api.markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    } catch (e: any) {
      setError(e?.message || 'Failed to mark all read.')
    } finally {
      setMarkingAll(false)
    }
  }

  function onSelectWorkspace(id: string) {
    setSelectedWorkspace(id)
    loadActivity(id)
  }

  if (loading) return <Spinner label="Loading notifications..." />

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Alerts on nexus crossings, computations, and workspace activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <Badge tone="violet">{unreadCount} unread</Badge>
          ) : (
            <Badge tone="slate">All caught up</Badge>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={markAll}
            disabled={markingAll || unreadCount === 0}
          >
            {markingAll ? 'Marking...' : 'Mark all read'}
          </Button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Notifications */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-100">Your notifications</h2>
              <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-0.5">
                {(['all', 'unread'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      filter === f ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {visibleNotifications.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    icon="🔔"
                    title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                    description={
                      filter === 'unread'
                        ? 'You have read all of your notifications.'
                        : 'Notifications about crossings, exposure computations, and shared snapshots will appear here.'
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {visibleNotifications.map((n) => (
                    <li
                      key={n.id}
                      className={`flex items-start gap-3 px-5 py-4 ${n.is_read ? '' : 'bg-violet-500/5'}`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                          n.is_read ? 'bg-slate-700' : 'bg-violet-400'
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-100">{n.title || 'Notification'}</span>
                          {n.kind ? <Badge tone={kindTone(n.kind)}>{n.kind}</Badge> : null}
                          {n.workspace_id && workspaceName(n.workspace_id) ? (
                            <Badge tone="slate">{workspaceName(n.workspace_id)}</Badge>
                          ) : null}
                        </div>
                        {n.body ? <p className="mt-1 text-sm text-slate-400">{n.body}</p> : null}
                        <div className="mt-1 text-xs text-slate-600">{timeAgo(n.created_at)}</div>
                      </div>
                      {!n.is_read ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markRead(n.id)}
                          disabled={busyId === n.id}
                        >
                          {busyId === n.id ? '...' : 'Mark read'}
                        </Button>
                      ) : (
                        <span className="mt-1 text-xs text-slate-600">Read</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Workspace activity feed */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-100">Workspace activity</h2>
              {workspaces.length > 0 ? (
                <select
                  value={selectedWorkspace}
                  onChange={(e) => onSelectWorkspace(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </CardHeader>
            <CardBody className="p-0">
              {workspaces.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    icon="🏢"
                    title="No workspaces"
                    description="Create a workspace to start tracking team activity."
                  />
                </div>
              ) : activityLoading ? (
                <Spinner label="Loading activity..." />
              ) : activityError ? (
                <div className="m-4 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
                  {activityError}
                </div>
              ) : activity.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState icon="📜" title="No activity yet" description="Actions in this workspace will show up here." />
                </div>
              ) : (
                <ol className="relative space-y-4 px-5 py-4">
                  {activity
                    .slice()
                    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                    .map((a) => (
                      <li key={a.id} className="relative border-l border-slate-800 pl-4">
                        <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-violet-500" />
                        <div className="text-sm text-slate-200">
                          <span className="font-medium text-violet-300">{a.action || 'action'}</span>
                          {a.target ? <span className="text-slate-400"> · {a.target}</span> : null}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600">{timeAgo(a.created_at)}</div>
                      </li>
                    ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
