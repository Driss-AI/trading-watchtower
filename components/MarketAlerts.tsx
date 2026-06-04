'use client'
import { useEffect, useRef, useState } from 'react'

type AlertDef = {
  id: string
  hour: number
  minute: number
  message: string
  color: string
  sound: 'chime' | 'bell' | 'alarm'
}

type Toast = AlertDef & { key: number }

// All times in ET (America/New_York)
const ALERT_SCHEDULE: AlertDef[] = [
  { id: 'pre15', hour: 9,  minute: 15, message: '⏰ Market opens in 15 minutes', color: '#f59e0b', sound: 'chime' },
  { id: 'pre5',  hour: 9,  minute: 25, message: '⚠️ Market opens in 5 minutes',  color: '#f97316', sound: 'bell'  },
  { id: 'open',  hour: 9,  minute: 30, message: '🟢 Market OPEN — OR building',   color: '#22c55e', sound: 'alarm' },
  { id: 'trade', hour: 10, minute: 0,  message: '⚡ OR Complete — Trade window OPEN', color: '#3b82f6', sound: 'alarm' },
  { id: 'close', hour: 11, minute: 0,  message: '🔴 Session CLOSED',              color: '#ef4444', sound: 'chime' },
]

function getETNow() {
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const et = new Date(etStr)
  const day = et.getDay() // 0=Sun, 6=Sat
  return {
    hour: et.getHours(),
    minute: et.getMinutes(),
    dateStr: et.toDateString(),
    isWeekday: day >= 1 && day <= 5,
  }
}

function playSound(type: 'chime' | 'bell' | 'alarm') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (type === 'chime') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.6)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      osc.start(); osc.stop(ctx.currentTime + 0.6)
    } else if (type === 'bell') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1200, ctx.currentTime)
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2)
      osc.start(); osc.stop(ctx.currentTime + 1.2)
    } else {
      // alarm — three sharp beeps
      ;[0, 0.35, 0.7].forEach(offset => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g); g.connect(ctx.destination)
        o.frequency.value = 1000
        g.gain.setValueAtTime(0.5, ctx.currentTime + offset)
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.25)
        o.start(ctx.currentTime + offset)
        o.stop(ctx.currentTime + offset + 0.25)
      })
    }
  } catch {}
}

export default function MarketAlerts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const keyRef = useRef(0)
  const firedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Restore fired alerts for today from localStorage
    try {
      const stored = localStorage.getItem('mkt_alerts_fired')
      if (stored) {
        const parsed = JSON.parse(stored)
        const { dateStr } = getETNow()
        if (parsed.date === dateStr) {
          parsed.ids.forEach((id: string) => firedRef.current.add(id))
        }
      }
    } catch {}

    const check = () => {
      const { hour, minute, dateStr, isWeekday } = getETNow()
      if (!isWeekday) return

      ALERT_SCHEDULE.forEach(alert => {
        const key = `${dateStr}_${alert.id}`
        if (firedRef.current.has(key)) return
        if (hour !== alert.hour || minute !== alert.minute) return

        // Mark fired
        firedRef.current.add(key)
        try {
          const ids = Array.from(firedRef.current)
          localStorage.setItem('mkt_alerts_fired', JSON.stringify({ date: dateStr, ids }))
        } catch {}

        // Show toast
        const toastKey = ++keyRef.current
        setToasts(prev => [...prev, { ...alert, key: toastKey }])
        setTimeout(() => setToasts(prev => prev.filter(t => t.key !== toastKey)), 9000)

        // Play sound
        playSound(alert.sound)
      })
    }

    check()
    const interval = setInterval(check, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      top: 80,
      right: 20,
      zIndex: 9998,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <div
          key={toast.key}
          style={{
            background: 'var(--card)',
            border: `1px solid ${toast.color}`,
            borderLeft: `4px solid ${toast.color}`,
            borderRadius: 8,
            padding: '14px 18px',
            color: 'var(--text-primary)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: `0 0 24px ${toast.color}40, 0 4px 20px rgba(0,0,0,0.6)`,
            minWidth: 290,
            animation: 'mktSlideIn 0.3s ease',
          }}
        >
          {toast.message}
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5, fontWeight: 400 }}>
            {new Date().toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
            })} ET &nbsp;·&nbsp;
            {new Date().toLocaleTimeString('en-US', {
              timeZone: 'Asia/Dubai',
              hour: '2-digit',
              minute: '2-digit',
            })} Dubai
          </div>
        </div>
      ))}
      <style>{`
        @keyframes mktSlideIn {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
