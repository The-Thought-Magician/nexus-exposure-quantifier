interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-3 py-10 ${className}`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-violet-500" />
      {label ? <span className="text-sm text-slate-500">{label}</span> : null}
    </div>
  )
}

export default Spinner
