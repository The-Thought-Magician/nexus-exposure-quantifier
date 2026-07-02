import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'NexusExposureQuantifier',
  description: 'Backward-looking sales-tax nexus exposure quantification: back-tax, penalties, interest, and VDA savings per state.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-stone-950 text-stone-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
