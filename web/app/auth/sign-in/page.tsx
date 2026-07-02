'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

export default function SignIn() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signIn.email({
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Failed to sign in')
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-base font-black text-white">
              N
            </span>
            <span className="text-lg font-semibold tracking-tight text-stone-100">NexusExposureQuantifier</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-stone-100">Sign in to your account</h1>
          <p className="mt-1 text-sm text-stone-500">Access your exposure engagements.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900 p-8">
          {error && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Password</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-center text-sm text-stone-400">
            No account?{' '}
            <Link href="/auth/sign-up" className="text-blue-400 hover:text-blue-300">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
