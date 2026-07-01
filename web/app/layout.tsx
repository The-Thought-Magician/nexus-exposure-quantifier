import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NexusExposureQuantifier',
  description: 'Backward-looking sales-tax nexus exposure quantification: back-tax, penalties, interest, and VDA savings per state.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
