import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import './globals.css'

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
