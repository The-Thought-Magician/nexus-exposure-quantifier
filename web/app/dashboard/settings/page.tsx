'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import Spinner from '@/components/ui/Spinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

const currency = (cents: unknown) => {
  const n = typeof cents === 'string' ? parseFloat(cents) : (cents as number)
  if (!Number.isFinite(n)) return '$0'
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const asArray = <T,>(v: any, key?: string): T[] => {
  if (Array.isArray(v)) return v
  if (key && Array.isArray(v?.[key])) return v[key]
  if (Array.isArray(v?.data)) return v.data
  return []
}

interface Workspace {
  id: string
  name: string
  owner_id?: string
  legal_name?: string
  fiscal_year_end?: string
  created_at?: string
}

interface Plan {
  id?: string
  name?: string
  price_cents?: number
}

interface Subscription {
  plan_id?: string
  status?: string
  current_period_end?: string
  stripe_customer_id?: string
}

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'

export default function SettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [billing, setBilling] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Workspace form state
  const [form, setForm] = useState({ name: '', legal_name: '', fiscal_year_end: '' })
  const [savingWorkspace, setSavingWorkspace] = useState(false)
  const [wsMessage, setWsMessage] = useState('')

  // Billing action state
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMessage, setBillingMessage] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.listWorkspaces(), api.getBillingPlan()])
      .then(([ws, plan]) => {
        if (!active) return
        const list = asArray<Workspace>(ws, 'workspaces')
        setWorkspaces(list)
        setBilling(plan)
        if (list.length > 0) {
          setSelectedId(list[0].id)
          setForm({
            name: list[0].name || '',
            legal_name: list[0].legal_name || '',
            fiscal_year_end: list[0].fiscal_year_end || '',
          })
        }
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Failed to load settings.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const selected = useMemo(
    () => workspaces.find((w) => w.id === selectedId),
    [workspaces, selectedId],
  )

  const plan: Plan = billing?.plan || {}
  const subscription: Subscription = billing?.subscription || {}
  const stripeEnabled: boolean = !!(billing?.stripeEnabled ?? billing?.stripe_enabled)
  const isPro = (subscription.plan_id || plan.id) === 'pro'

  function onSelectWorkspace(id: string) {
    setSelectedId(id)
    setWsMessage('')
    const w = workspaces.find((x) => x.id === id)
    setForm({
      name: w?.name || '',
      legal_name: w?.legal_name || '',
      fiscal_year_end: w?.fiscal_year_end || '',
    })
  }

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    setSavingWorkspace(true)
    setWsMessage('')
    setError('')
    try {
      const updated = await api.updateWorkspace(selectedId, {
        name: form.name.trim(),
        legal_name: form.legal_name.trim() || null,
        fiscal_year_end: form.fiscal_year_end.trim() || null,
      })
      const merged: Workspace = { ...(selected as Workspace), ...(updated || {}), ...form }
      setWorkspaces((prev) => prev.map((w) => (w.id === selectedId ? merged : w)))
      setWsMessage('Workspace profile saved.')
    } catch (err: any) {
      setError(err?.message || 'Failed to save workspace.')
    } finally {
      setSavingWorkspace(false)
    }
  }

  async function upgrade() {
    setBillingBusy(true)
    setBillingMessage('')
    setError('')
    try {
      const res = await api.startCheckout({ plan_id: 'pro' })
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMessage('Checkout is not available right now.')
      }
    } catch (err: any) {
      setBillingMessage(err?.message || 'Billing is not configured. Pro is coming soon.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function manageBilling() {
    setBillingBusy(true)
    setBillingMessage('')
    setError('')
    try {
      const res = await api.openPortal()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMessage('Billing portal is not available right now.')
      }
    } catch (err: any) {
      setBillingMessage(err?.message || 'Billing portal is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  if (loading) return <Spinner label="Loading settings..." />

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your workspace profile and subscription plan.</p>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workspace profile */}
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-100">Workspace profile</h2>
            {workspaces.length > 1 ? (
              <select
                value={selectedId}
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
          <CardBody>
            {workspaces.length === 0 ? (
              <EmptyState
                icon="🏢"
                title="No workspaces"
                description="Create a workspace from the Workspaces page to configure its profile here."
              />
            ) : (
              <form onSubmit={saveWorkspace} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Workspace name
                  </label>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Acme Inc. Nexus Study"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Legal entity name
                  </label>
                  <input
                    className={inputClass}
                    value={form.legal_name}
                    onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
                    placeholder="Acme Incorporated"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Fiscal year end
                  </label>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.fiscal_year_end ? form.fiscal_year_end.slice(0, 10) : ''}
                    onChange={(e) => setForm((f) => ({ ...f, fiscal_year_end: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={savingWorkspace || !form.name.trim()}>
                    {savingWorkspace ? 'Saving...' : 'Save profile'}
                  </Button>
                  {wsMessage ? <span className="text-sm text-emerald-300">{wsMessage}</span> : null}
                </div>
                {selected?.created_at ? (
                  <p className="text-xs text-slate-600">
                    Created {new Date(selected.created_at).toLocaleDateString()}
                  </p>
                ) : null}
              </form>
            )}
          </CardBody>
        </Card>

        {/* Billing / plan */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">Billing &amp; plan</h2>
            <Badge tone={isPro ? 'violet' : 'slate'}>{isPro ? 'Pro' : 'Free'}</Badge>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-slate-200">{plan.name || (isPro ? 'Pro' : 'Free')} plan</span>
                <span className="text-lg font-semibold text-slate-100">
                  {plan.price_cents ? `${currency(plan.price_cents)}/mo` : '$0/mo'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {subscription.status ? <Badge tone="green">{subscription.status}</Badge> : null}
                {subscription.current_period_end ? (
                  <span>Renews {new Date(subscription.current_period_end).toLocaleDateString()}</span>
                ) : null}
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-400">
                <li>• Unlimited engagements &amp; workspaces</li>
                <li>• Full nexus, exposure, and VDA computation</li>
                <li>• Working papers &amp; diligence-binder exports</li>
              </ul>
            </div>

            {!stripeEnabled ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
                Billing is not configured on this instance. All features are currently available on the Free plan. Pro
                is coming soon.
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {isPro ? (
                  <Button variant="secondary" onClick={manageBilling} disabled={billingBusy}>
                    {billingBusy ? 'Opening...' : 'Manage billing'}
                  </Button>
                ) : (
                  <Button onClick={upgrade} disabled={billingBusy}>
                    {billingBusy ? 'Redirecting...' : 'Upgrade to Pro'}
                  </Button>
                )}
                {subscription.stripe_customer_id ? (
                  <Button variant="ghost" onClick={manageBilling} disabled={billingBusy}>
                    Billing portal
                  </Button>
                ) : null}
              </div>
            )}
            {billingMessage ? <p className="text-sm text-amber-300">{billingMessage}</p> : null}
          </CardBody>
        </Card>
      </div>

      {/* Workspaces overview */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-100">Your workspaces</h2>
        </CardHeader>
        <CardBody className="p-0">
          {workspaces.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState icon="🏢" title="No workspaces" description="Workspaces you own or belong to appear here." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-medium text-slate-100">{w.name}</div>
                    {w.legal_name ? <div className="text-xs text-slate-500">{w.legal_name}</div> : null}
                  </div>
                  <button
                    onClick={() => onSelectWorkspace(w.id)}
                    className={`text-xs font-medium ${
                      w.id === selectedId ? 'text-violet-300' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {w.id === selectedId ? 'Editing' : 'Edit'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
