'use client'
import { useEffect, useState } from 'react'
import { SessionTimerNavbar } from './SessionTimer'
import ThemeToggle from './ThemeToggle'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

const NAV_ITEMS = [
  { href: '/', label: 'Cockpit' },
  { href: '/opportunities', label: 'Signals' },
  { href: '/paper', label: 'Paper' },
  { href: '/risk', label: 'Risk' },
  { href: '/performance', label: 'Stats' },
  { href: '/settings', label: 'Settings' },
]

const MONO = 'JetBrains Mono, monospace'

function UTCClock() {
  const [t, setT] = useState('')
  useEffect(() => {
    const tick = () =>
      setT(
        new Date().toLocaleTimeString('en-GB', {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  if (!t) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      fontFamily: MONO, fontSize: '12px', fontWeight: 700,
      color: 'var(--text-primary)', letterSpacing: '0.06em',
    }}>
      <span style={{ color: 'var(--text-dim)', fontSize: '9px', letterSpacing: '0.14em' }}>UTC</span>
      <span>{t}</span>
      <span className="blink" style={{ color: 'var(--lime)' }}>▋</span>
    </div>
  )
}

export default function Navbar() {
  const path = usePathname()

  return (
    <nav style={{
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(6px)',
    }}>
      {/* ── Row 1 — brand bar ── */}
      <div style={{
        maxWidth: '1320px',
        margin: '0 auto',
        padding: '0 16px',
        height: '46px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Logo */}
        <a href="/" style={{
          display: 'flex', alignItems: 'center', gap: '9px',
          textDecoration: 'none', flexShrink: 0,
        }}>
          <span className="syspulse" style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: 'var(--green)', boxShadow: '0 0 8px var(--green)',
            flexShrink: 0,
          }} />
          <span style={{
            fontFamily: MONO, fontSize: '16px', fontWeight: 700,
            color: 'var(--lime)', letterSpacing: '0.04em',
            textShadow: '0 0 14px rgba(200,255,0,0.35)',
          }}>
            WATCHTOWER
          </span>
          <span style={{
            fontFamily: MONO, fontSize: '9px', fontWeight: 700,
            color: 'var(--text-dim)', letterSpacing: '0.16em',
            padding: '2px 6px', border: '1px solid var(--border)',
            borderRadius: '4px',
          }}>
            NQ ORB
          </span>
        </a>

        <div style={{ flex: 1 }} />

        {/* Right cluster */}
        <UTCClock />
        <div style={{ flexShrink: 0 }}>
          <SessionTimerNavbar />
        </div>
        <ThemeToggle />
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            flexShrink: 0,
            height: '30px',
            padding: '0 12px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text-dim)',
            fontFamily: MONO,
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--red-border)'
            e.currentTarget.style.color = 'var(--red)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = 'var(--text-dim)'
          }}
        >
          LOGOUT
        </button>
      </div>

      {/* ── Row 2 — tabs ── */}
      <div style={{
        maxWidth: '1320px',
        margin: '0 auto',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'stretch',
        gap: '0',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href)
          return (
            <a
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                textDecoration: 'none',
                fontFamily: MONO,
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: active ? 'var(--lime)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--lime)' : '2px solid transparent',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {item.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
