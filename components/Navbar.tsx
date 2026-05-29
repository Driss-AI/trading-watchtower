'use client'
import { SessionTimerNavbar } from './SessionTimer'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

const NAV_ITEMS = [
  { href: '/', label: 'Cockpit', icon: '⬛' },
  { href: '/paper', label: 'Paper', icon: '◇' },
  { href: '/session', label: 'Session', icon: '◈' },
  { href: '/risk', label: 'Risk Calc', icon: '⚡' },
  { href: '/journal', label: 'Journal', icon: '◎' },
  { href: '/performance', label: 'Stats', icon: '◆' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Navbar() {
  const path = usePathname()

  return (
    <nav style={{
      background: '#080f22',
      borderBottom: '1px solid #162040',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '0',
      }}>
        {/* Logo */}
        <a href="/" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '16px 20px 16px 0',
          textDecoration: 'none',
          borderRight: '1px solid #162040',
          marginRight: '8px',
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '18px',
            fontWeight: '700',
            color: '#00e676',
            letterSpacing: '-0.02em',
            textShadow: '0 0 12px rgba(0, 230, 118, 0.5)',
          }}>
            WATCHTOWER
          </span>
          <span style={{
            fontSize: '10px',
            fontFamily: 'IBM Plex Mono, monospace',
            color: '#3a5280',
            fontWeight: '500',
          }}>
            NQ ORB
          </span>
        </a>

        {/* Nav links */}
        <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'auto', scrollbarWidth: 'none' }}>
          {NAV_ITEMS.map((item) => {
            const active = path === item.href
            return (
              <a
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '18px 14px',
                  textDecoration: 'none',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: '12px',
                  fontWeight: active ? '600' : '500',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: active ? '#dce8ff' : '#6b85b8',
                  borderBottom: active ? '2px solid #2979ff' : '2px solid transparent',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: '14px' }}>{item.icon}</span>
                {item.label}
              </a>
            )
          })}
        </div>

        {/* Session Timer */}
        <div style={{ flexShrink: 0 }}>
          <SessionTimerNavbar />
        </div>

        {/* Logout button */}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            flexShrink: 0,
            marginLeft: '12px',
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid #162040',
            borderRadius: '6px',
            color: '#3a5280',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '11px',
            fontWeight: '500',
            letterSpacing: '0.05em',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            (e.target as HTMLButtonElement).style.borderColor = '#ef4444'
            ;(e.target as HTMLButtonElement).style.color = '#ef4444'
          }}
          onMouseLeave={e => {
            (e.target as HTMLButtonElement).style.borderColor = '#162040'
            ;(e.target as HTMLButtonElement).style.color = '#3a5280'
          }}
        >
          LOGOUT
        </button>
      </div>
    </nav>
  )
}
