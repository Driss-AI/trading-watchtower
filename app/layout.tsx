import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'
import AuthProvider from '@/components/AuthProvider'
import QueryProvider from '@/components/QueryProvider'
import MarketAlerts from '@/components/MarketAlerts'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Trading Watchtower',
  description: 'NQ/MNQ ORB Risk Management System — TopStep 50K',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <QueryProvider>
            {session ? (
              <>
                <Navbar />
                <MarketAlerts />
                <main style={{
                  maxWidth: '1200px',
                  margin: '0 auto',
                  padding: '24px 16px',
                  position: 'relative',
                  zIndex: 1,
                }}>
                  {children}
                </main>
              </>
            ) : children}
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
