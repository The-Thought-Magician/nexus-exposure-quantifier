import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'violet' | 'green' | 'amber' | 'red' | 'blue' | 'slate'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-stone-800 text-stone-300 border-stone-700',
  violet: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  slate: 'bg-stone-700/40 text-stone-300 border-stone-600/40',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
