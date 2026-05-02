'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '⬛' },
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
        <Link href="/" style={{
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
        </Link>

        {/* Nav links */}
        <div style={{ display: 'flex', flex: 1, overflow: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const active = path === item.href
            return (
              <Link
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
              </Link>
            )
          })}
        </div>

        {/* Time */}
        <TimeDisplay />
      </div>
    </nav>
  )
}

function TimeDisplay() {
  return (
    <div style={{
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: '11px',
      color: '#3a5280',
      padding: '0 8px',
      flexShrink: 0,
    }}>
      <LiveClock />
    </div>
  )
}

function LiveClock() {
  'use client'
  const { useState, useEffect } = require('react')
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const nyTime = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      setTime(`NY ${nyTime}`)
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [])

  return <span>{time}</span>
}
