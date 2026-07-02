'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const currency = (v: unknown) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  if (n === null || n === undefined || Number.isNaN(n)) return '$0'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const statusTone = (status?: string) => {
  switch ((status || '').toLowerCase()) {
    case 'final':
    case 'complete':
    case 'completed':
      return 'green' as const
    case 'in_review':
    case 'review':
      return 'blue' as const
    case 'draft':
      return 'slate' as const
    default:
      return 'default' as const
  }
}

interface Engagement {
  id: string
  name: string
  description?: string
  status?: string
  as_of_date?: string
  is_locked?: boolean
  total_exposure?: number | string
  total_tax?: number | string
  total_vda_savings?: number | string
  updated_at?: string
  created_at?: string
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<any>(null)
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.getAnalyticsOverview(), api.listEngagements()])
      .then(([ov, eng]) => {
        if (!active) return
        setOverview(ov)
        setEngagements(Array.isArray(eng) ? eng : eng?.engagements || [])
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Failed to load dashboard data.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // tiles can arrive as { tiles: {...} } or flat object
  const tiles = overview?.tiles || overview || {}

  const statuses = useMemo(() => {
    const set = new Set<string>()
    engagements.forEach((e) => e.status && set.add(e.status))
    return Array.from(set)
  }, [engagements])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return engagements.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false
      if (!q) return true
      return (
        e.name?.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q)
      )
    })
  }, [engagements, search, statusFilter])

  const recent = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const at = new Date(a.updated_at || a.created_at || 0).getTime()
        const bt = new Date(b.updated_at || b.created_at || 0).getTime()
        return bt - at
      }),
    [filtered],
  )

  if (loading) return <Spinner label="Loading dashboard..." />

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-500">
            Aggregate sales-tax nexus exposure across all your engagements.
          </p>
        </div>
        <Link href="/dashboard/engagements">
          <Button>New engagement</Button>
        </Link>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      ) : null}

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Total Exposure"
          value={currency(tiles.total_exposure ?? tiles.totalExposure)}
          tone="violet"
          hint={`${tiles.engagement_count ?? engagements.length} engagements`}
        />
        <Stat label="Total Tax" value={currency(tiles.total_tax ?? tiles.totalTax)} />
        <Stat label="Total Penalty" value={currency(tiles.total_penalty ?? tiles.totalPenalty)} tone="amber" />
        <Stat label="Total Interest" value={currency(tiles.total_interest ?? tiles.totalInterest)} tone="amber" />
      </section>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="VDA Savings"
          value={currency(tiles.total_vda_savings ?? tiles.totalVdaSavings)}
          tone="green"
        />
        <Stat label="States with Nexus" value={tiles.states_with_nexus ?? tiles.statesWithNexus ?? '—'} />
        <Stat label="Open Engagements" value={tiles.open_engagements ?? tiles.openEngagements ?? engagements.length} />
        <Stat label="Locked" value={tiles.locked_engagements ?? engagements.filter((e) => e.is_locked).length} />
      </section>

      {/* Recent engagements */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-stone-100">Recent engagements</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search engagements..."
              className="rounded-lg border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-stone-700 bg-stone-800 px-3 py-1.5 text-sm text-stone-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {engagements.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                icon="📊"
                title="No engagements yet"
                description="Create your first engagement to import sales data and quantify nexus exposure."
                action={
                  <Link href="/dashboard/engagements">
                    <Button>Create engagement</Button>
                  </Link>
                }
              />
            </div>
          ) : recent.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState title="No matches" description="No engagements match your search or filter." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Engagement</TH>
                  <TH>Status</TH>
                  <TH>As of</TH>
                  <TH className="text-right">Exposure</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">VDA Savings</TH>
                  <TH>Updated</TH>
                </TR>
              </THead>
              <TBody>
                {recent.slice(0, 12).map((e) => (
                  <TR key={e.id} className="cursor-pointer">
                    <TD>
                      <Link href={`/dashboard/engagements/${e.id}`} className="block">
                        <span className="font-medium text-stone-100 hover:text-blue-300">{e.name}</span>
                        {e.description ? (
                          <span className="mt-0.5 block max-w-md truncate text-xs text-stone-500">
                            {e.description}
                          </span>
                        ) : null}
                      </Link>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(e.status)}>{e.status || 'draft'}</Badge>
                        {e.is_locked ? <Badge tone="amber">Locked</Badge> : null}
                      </div>
                    </TD>
                    <TD className="text-stone-400">
                      {e.as_of_date ? new Date(e.as_of_date).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right font-semibold text-blue-300">{currency(e.total_exposure)}</TD>
                    <TD className="text-right">{currency(e.total_tax)}</TD>
                    <TD className="text-right text-emerald-300">{currency(e.total_vda_savings)}</TD>
                    <TD className="text-stone-500">
                      {e.updated_at ? new Date(e.updated_at).toLocaleDateString() : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
