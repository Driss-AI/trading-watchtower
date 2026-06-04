'use client'
import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  // Sync from whatever the no-flash script already applied
  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || 'dark'
    setTheme(current)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('wt-theme', next) } catch {}
  }

  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle theme"
      style={{
        flexShrink: 0,
        width: '30px',
        height: '30px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--lime-border)'
        e.currentTarget.style.color = 'var(--lime)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      {isDark ? '☀' : '☾'}
    </button>
  )
}
