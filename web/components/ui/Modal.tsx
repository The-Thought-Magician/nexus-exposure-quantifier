'use client'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, footer, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-950/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative z-10 w-full max-w-lg rounded-2xl border border-stone-800 bg-stone-900 shadow-2xl ${className}`}
        role="dialog"
        aria-modal="true"
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-stone-800 px-5 py-4">
            <h2 className="text-base font-semibold text-stone-100">{title}</h2>
            <button
              onClick={onClose}
              className="text-stone-500 transition-colors hover:text-stone-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        ) : null}
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-stone-800 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  )
}

export default Modal
