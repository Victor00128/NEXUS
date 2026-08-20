import type { Metadata } from 'next'
import { Inter, Fira_Code } from 'next/font/google'
import { Providers } from '@/components/Providers'
import './globals.css'

// Self-hosted at build time by next/font: no runtime request to Google, which
// also keeps the "privacy-respecting" claim honest.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-fira-code',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'NEXUS AI | Advanced Multi-Model Orchestration',
  description: 'Open-source, privacy-respecting, multi-model chat interface for researchers and developers',
  keywords: ['AI', 'chat', 'open-source', 'privacy', 'multi-model', 'orchestration', 'NVIDIA', 'OpenRouter'],
  authors: [{ name: 'NEXUS AI' }],
  openGraph: {
    title: 'NEXUS AI',
    description: 'Multi-Model AI Orchestration',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${firaCode.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
