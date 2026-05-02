import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'

export const metadata: Metadata = {
  title: 'Trading Watchtower',
  description: 'NQ/MNQ ORB Risk Management System — TopStep 100K',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '24px 16px',
          position: 'relative',
          zIndex: 1,
        }}>
          {children}
        </main>
      </body>
    </html>
  )
}
