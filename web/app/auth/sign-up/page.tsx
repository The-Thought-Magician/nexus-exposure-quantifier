'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

export default function SignUp() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signUp.email({
      name: fd.get('name') as string,
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Failed to create account')
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
          <h1 className="mt-6 text-2xl font-bold text-stone-100">Create your account</h1>
          <p className="mt-1 text-sm text-stone-500">Size your sales-tax exposure in minutes. All features free.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900 p-8">
          {error && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-300">Name</label>
            <input
              name="name"
              type="text"
              required
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
              placeholder="Your name"
            />
          </div>
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
              minLength={8}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
          <p className="text-center text-sm text-stone-400">
            Already have an account?{' '}
            <Link href="/auth/sign-in" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
