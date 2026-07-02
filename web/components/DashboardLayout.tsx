'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Analytics', href: '/dashboard/analytics' },
    ],
  },
  {
    title: 'Engagements',
    items: [
      { label: 'All Engagements', href: '/dashboard/engagements' },
      { label: 'Workspaces', href: '/dashboard/workspaces' },
      { label: 'Snapshots', href: '/dashboard/snapshots' },
    ],
  },
  {
    title: 'Reference Library',
    items: [
      { label: 'Nexus Rules', href: '/dashboard/library/nexus-rules' },
      { label: 'Rates & VDA', href: '/dashboard/library/rates' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [workspaceName, setWorkspaceName] = useState('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      const user = (s as any)?.data?.user ?? (s as any)?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      setWorkspaceName(user.name || user.email || 'Workspace')
      setChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950">
        <div className="flex items-center gap-3 text-stone-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-700 border-t-blue-500" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const nav = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-600">
            {section.title}
          </div>
          <div className="space-y-1">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block rounded-lg border-l-2 px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-500/10 font-medium text-blue-300'
                      : 'border-transparent text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-stone-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-stone-800 bg-stone-900/60 lg:flex">
        <div className="flex h-16 items-center border-b border-stone-800 px-5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white">
              N
            </span>
            <span className="text-sm font-semibold tracking-tight text-stone-100">NexusExposureQuantifier</span>
          </Link>
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-stone-950/70" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 flex h-full w-64 flex-col border-r border-stone-800 bg-stone-900">
            <div className="flex h-16 items-center justify-between border-b border-stone-800 px-5">
              <span className="text-sm font-semibold text-stone-100">NexusExposureQuantifier</span>
              <button onClick={() => setMobileOpen(false)} className="text-stone-500 hover:text-stone-200">
                ✕
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-stone-800 bg-stone-900/40 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-stone-400 hover:bg-stone-800 hover:text-stone-100 lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <div className="text-sm text-stone-400">
              <span className="text-stone-500">Workspace</span>{' '}
              <span className="font-medium text-stone-200">{workspaceName}</span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-300 transition-colors hover:bg-stone-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
