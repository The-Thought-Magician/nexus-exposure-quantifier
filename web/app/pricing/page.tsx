'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Unlimited workspaces and engagements',
  'CSV, connector, and one-click sample-data import',
  'Retroactive crossing-date detection per state',
  'Uncollected-tax, penalty, and statutory-interest accrual',
  'VDA lookback modeling and savings quantification',
  'Register vs VDA vs wait scenario comparison',
  'Materiality ranking and wait-cost timelines',
  'Board-ready exposure memos and working-paper exports',
  'Remediation tracker, audit-risk flags, and collaboration',
  'Shareable read-only diligence snapshots',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getBillingPlan()
      .then((res: any) => {
        if (!cancelled) setStripeEnabled(Boolean(res?.stripeEnabled))
      })
      .catch(() => {
        if (!cancelled) setStripeEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <nav className="flex items-center justify-between border-b border-stone-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white">
            N
          </span>
          <span className="text-base font-semibold tracking-tight">NexusExposureQuantifier</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/auth/sign-in" className="text-stone-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Simple pricing: everything is free.</h1>
        <p className="mx-auto mt-4 max-w-xl text-stone-400">
          Every feature of NexusExposureQuantifier is available at no cost to signed-in users. No seat limits, no
          engagement caps, no gated exports.
        </p>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-blue-500/30 bg-stone-900 p-8 text-left shadow-xl shadow-blue-950/20">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-stone-100">Free</h2>
            <div>
              <span className="text-4xl font-bold text-blue-300">$0</span>
              <span className="text-sm text-stone-500"> / forever</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-stone-400">All features, for every engagement.</p>
          <ul className="mt-6 space-y-3">
            {freeFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-stone-300">
                <span className="mt-0.5 text-blue-400">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/auth/sign-up"
            className="mt-8 block rounded-lg bg-blue-600 py-3 text-center font-semibold text-white hover:bg-blue-500"
          >
            Create free account
          </Link>
        </div>

        <div className="mx-auto mt-8 max-w-md rounded-xl border border-stone-800 bg-stone-900/40 p-5 text-sm text-stone-400">
          <p className="font-medium text-stone-300">Pro plan coming soon</p>
          <p className="mt-1">
            A paid tier for high-volume firms is planned.{' '}
            {stripeEnabled === null
              ? 'Checking billing availability...'
              : stripeEnabled
                ? 'Billing is configured and available in Settings.'
                : 'Billing is not yet enabled; checkout returns a 503 until configured.'}
          </p>
        </div>
      </section>

      <footer className="border-t border-stone-800 py-8 text-center text-sm text-stone-600">
        <p>NexusExposureQuantifier</p>
      </footer>
    </main>
  )
}
