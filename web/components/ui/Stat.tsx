import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'violet' | 'green' | 'amber' | 'red'
  className?: string
}

const accents: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-stone-100',
  violet: 'text-blue-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  red: 'text-red-300',
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-stone-800 bg-stone-900 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accents[tone]}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-500">{hint}</div> : null}
    </div>
  )
}

export default Stat
