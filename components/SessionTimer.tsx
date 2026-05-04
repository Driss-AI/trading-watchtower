'use client'
import { useEffect, useState } from 'react'

interface TimerState {
  phase: 'weekend' | 'pre_session' | 'approaching' | 'orb_window' | 'post_orb' | 'closed'
  label: string
  sublabel: string
  hours: number
  minutes: number
  seconds: number
  color: string
  bgColor: string
  borderColor: string
  nyTime: string
  dubaiTime: string
  dayLabel: string
  progressPct: number  // 0-100 progress through current phase
}

function computeState(): TimerState {
  const now = new Date()
  const nyNow  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dubNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }))

  const nyTime  = nyNow.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dubaiTime = dubNow.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const day = nyNow.getDay()
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const totalSecs = nyNow.getHours() * 3600 + nyNow.getMinutes() * 60 + nyNow.getSeconds()

  const OPEN   = 9 * 3600 + 30 * 60   // 9:30
  const MID    = 10 * 3600             // 10:00
  const CLOSE  = 10 * 3600 + 30 * 60  // 10:30
  const WARN   = 9 * 3600             // 9:00 (30-min warning)

  const isWeekday = day >= 1 && day <= 5

  const pad = (n: number) => ({ h: Math.floor(n / 3600), m: Math.floor((n % 3600) / 60), s: n % 60 })

  // ── WEEKEND ──────────────────────────────────────────────────────────────
  if (!isWeekday) {
    const daysUntilMon = day === 6 ? 2 : 1
    const nextMon = new Date(nyNow)
    nextMon.setDate(nyNow.getDate() + daysUntilMon)
    nextMon.setHours(9, 30, 0, 0)
    const secs = Math.max(0, Math.floor((nextMon.getTime() - now.getTime()) / 1000))
    const t = pad(secs)
    return {
      phase: 'weekend',
      label: 'WEEKEND', sublabel: 'Next session: Monday 9:30 AM ET · 6:30 PM Dubai',
      hours: t.h, minutes: t.m, seconds: t.s,
      color: 'var(--text-secondary)', bgColor: 'var(--surface)', borderColor: 'var(--border)',
      nyTime, dubaiTime, dayLabel: dayNames[day], progressPct: 0,
    }
  }

  // ── SESSION CLOSED (after 10:30 AM) ──────────────────────────────────────
  if (totalSecs >= CLOSE) {
    const isFri = day === 5
    const daysAhead = isFri ? 3 : 1
    const next = new Date(nyNow)
    next.setDate(nyNow.getDate() + daysAhead)
    next.setHours(9, 30, 0, 0)
    const secs = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000))
    const t = pad(secs)
    const nextDay = isFri ? 'Monday' : dayNames[day + 1]
    return {
      phase: 'closed',
      label: 'SESSION CLOSED', sublabel: `Next: ${nextDay} 9:30 AM ET · 6:30 PM Dubai`,
      hours: t.h, minutes: t.m, seconds: t.s,
      color: 'var(--text-dim)', bgColor: 'var(--surface)', borderColor: 'var(--border)',
      nyTime, dubaiTime, dayLabel: dayNames[day], progressPct: 100,
    }
  }

  // ── OR BUILDING (9:30–10:00) ──────────────────────────────────────────────
  if (totalSecs >= OPEN && totalSecs < MID) {
    const secs = MID - totalSecs
    const t = pad(secs)
    const elapsed = totalSecs - OPEN
    const pct = (elapsed / (MID - OPEN)) * 100
    return {
      phase: 'orb_window',
      label: '🔴 LIVE — OPENING RANGE BUILDING', sublabel: 'OR closes at 10:00 AM ET (7:00 PM Dubai) — wait for the range to form',
      hours: 0, minutes: t.m, seconds: t.s,
      color: 'var(--red)', bgColor: 'var(--red-bg)', borderColor: 'var(--red-border)',
      nyTime, dubaiTime, dayLabel: dayNames[day], progressPct: pct,
    }
  }

  // ── TRADE WINDOW (10:00–10:30) ────────────────────────────────────────────
  if (totalSecs >= MID && totalSecs < CLOSE) {
    const secs = CLOSE - totalSecs
    const t = pad(secs)
    const elapsed = totalSecs - MID
    const pct = (elapsed / (CLOSE - MID)) * 100
    return {
      phase: 'post_orb',
      label: '🟢 LIVE — OR COMPLETE · TRADE WINDOW OPEN', sublabel: 'Session closes at 10:30 AM ET (7:30 PM Dubai)',
      hours: 0, minutes: t.m, seconds: t.s,
      color: 'var(--green)', bgColor: 'var(--green-bg)', borderColor: 'var(--green-border)',
      nyTime, dubaiTime, dayLabel: dayNames[day], progressPct: pct,
    }
  }

  // ── APPROACHING (9:00–9:30) ───────────────────────────────────────────────
  if (totalSecs >= WARN && totalSecs < OPEN) {
    const secs = OPEN - totalSecs
    const t = pad(secs)
    const elapsed = totalSecs - WARN
    const pct = (elapsed / (OPEN - WARN)) * 100
    return {
      phase: 'approaching',
      label: '⚡ SESSION STARTING SOON', sublabel: 'NY Open 9:30 AM ET · Dubai 6:30 PM · Prepare your setup now',
      hours: 0, minutes: t.m, seconds: t.s,
      color: 'var(--yellow)', bgColor: 'var(--yellow-bg)', borderColor: 'var(--yellow-border)',
      nyTime, dubaiTime, dayLabel: dayNames[day], progressPct: pct,
    }
  }

  // ── PRE-SESSION (before 9:00 AM) ─────────────────────────────────────────
  const secs = OPEN - totalSecs
  const t = pad(secs)
  return {
    phase: 'pre_session',
    label: 'NEXT SESSION', sublabel: 'NY Open 9:30 AM ET · Dubai 6:30 PM · 7:30 PM close',
    hours: t.h, minutes: t.m, seconds: t.s,
    color: 'var(--blue)', bgColor: 'var(--surface)', borderColor: 'var(--border)',
    nyTime, dubaiTime, dayLabel: dayNames[day], progressPct: 0,
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export default function SessionTimer() {
  const [s, setS] = useState<TimerState | null>(null)

  useEffect(() => {
    setS(computeState())
    const id = setInterval(() => setS(computeState()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!s) return null

  const isLive = s.phase === 'orb_window' || s.phase === 'post_orb'
  const isWeekendOrClosed = s.phase === 'weekend' || s.phase === 'closed'
  const countdown = s.hours > 0
    ? `${pad2(s.hours)}:${pad2(s.minutes)}:${pad2(s.seconds)}`
    : `${pad2(s.minutes)}:${pad2(s.seconds)}`

  return (
    <div style={{
      background: s.bgColor,
      border: `1px solid ${s.borderColor}`,
      borderRadius: '10px',
      padding: '16px 20px',
      marginBottom: '16px',
      boxShadow: isLive ? `0 0 24px ${s.color}20` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>

        {/* Left: Status + sublabel */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            {isLive && (
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%', background: s.color, flexShrink: 0,
                animation: 'timerPulse 1.2s ease-in-out infinite',
              }} />
            )}
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '700',
              letterSpacing: '0.1em', color: s.color,
            }}>
              {s.label}
            </span>
            <span style={{
              fontSize: '10px', padding: '1px 7px', borderRadius: '4px',
              background: 'var(--surface)', border: `1px solid ${s.borderColor}`,
              color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace',
            }}>
              {s.dayLabel.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {s.sublabel}
          </div>
        </div>

        {/* Center: Countdown */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: isLive ? '38px' : '30px',
            fontWeight: '700',
            color: s.color,
            lineHeight: 1,
            letterSpacing: '0.04em',
            textShadow: isLive ? `0 0 20px ${s.color}70` : 'none',
          }}>
            {countdown}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '3px', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.08em' }}>
            {s.phase === 'orb_window' ? 'OR CLOSES IN'
              : s.phase === 'post_orb' ? 'SESSION CLOSES IN'
              : s.phase === 'approaching' ? 'UNTIL OPEN'
              : 'UNTIL NEXT SESSION'}
          </div>
        </div>

        {/* Right: Dual clock */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.08em', marginBottom: '1px' }}>
              DUBAI (YOUR TIME)
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
              {s.dubaiTime}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.08em', marginBottom: '1px' }}>
              ET (NEW YORK)
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: '400', color: 'var(--text-secondary)' }}>
              {s.nyTime}
            </div>
          </div>
        </div>
      </div>

      {/* Session Timeline Bar */}
      <div style={{ marginTop: '14px' }}>
        {/* Labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
          <span style={{ color: s.phase === 'approaching' || isLive ? s.color : 'var(--text-dim)' }}>9:30 AM ET · 6:30 PM DXB</span>
          <span style={{ color: s.phase === 'post_orb' ? s.color : 'var(--text-dim)' }}>10:00 AM · 7:00 PM</span>
          <span>10:30 AM · 7:30 PM</span>
        </div>

        {/* Track */}
        <div style={{ position: 'relative', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
          {/* OR zone (9:30-10:00) */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%',
            background: s.phase === 'orb_window' ? `var(--red)` : 'var(--border-bright)',
            opacity: s.phase === 'orb_window' ? 1 : 0.4,
            transition: 'background 0.3s',
          }} />
          {/* Trade zone (10:00-10:30) */}
          <div style={{
            position: 'absolute', left: '50%', top: 0, bottom: 0, width: '50%',
            background: s.phase === 'post_orb' ? 'var(--green)' : 'var(--border-bright)',
            opacity: s.phase === 'post_orb' ? 1 : 0.4,
            transition: 'background 0.3s',
          }} />
          {/* Progress indicator (for live phases) */}
          {isLive && (
            <div style={{
              position: 'absolute',
              left: s.phase === 'orb_window'
                ? `${(s.progressPct / 100) * 50}%`
                : `${50 + (s.progressPct / 100) * 50}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: '10px', height: '10px', borderRadius: '50%',
              background: s.color,
              boxShadow: `0 0 8px ${s.color}`,
              transition: 'left 1s linear',
            }} />
          )}
          {/* 10:00 divider */}
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', background: 'var(--card)', transform: 'translateX(-50%)' }} />
        </div>

        {/* Zone labels */}
        <div style={{ display: 'flex', marginTop: '4px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
          <div style={{ flex: 1, textAlign: 'center', color: s.phase === 'orb_window' ? 'var(--red)' : 'var(--text-dim)' }}>
            ← OR BUILDING (30 min) →
          </div>
          <div style={{ flex: 1, textAlign: 'center', color: s.phase === 'post_orb' ? 'var(--green)' : 'var(--text-dim)' }}>
            ← TRADE WINDOW (30 min) →
          </div>
        </div>
      </div>

      <style>{`@keyframes timerPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.75)}}`}</style>
    </div>
  )
}

// ─── COMPACT NAVBAR VERSION ───────────────────────────────────────────────────
export function SessionTimerNavbar() {
  const [s, setS] = useState<TimerState | null>(null)
  useEffect(() => {
    setS(computeState())
    const id = setInterval(() => setS(computeState()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!s) return null
  const isLive = s.phase === 'orb_window' || s.phase === 'post_orb'
  const countdown = s.hours > 0
    ? `${pad2(s.hours)}:${pad2(s.minutes)}:${pad2(s.seconds)}`
    : `${pad2(s.minutes)}:${pad2(s.seconds)}`
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '5px 12px',
      background: 'var(--card)',
      border: `1px solid ${s.borderColor}`,
      borderRadius: '20px',
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: '11px',
      whiteSpace: 'nowrap',
      boxShadow: isLive ? `0 0 10px ${s.color}30` : 'none',
    }}>
      {isLive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, animation: 'timerPulse 1.2s ease-in-out infinite', flexShrink: 0 }} />}
      <span style={{ color: s.color, fontWeight: 700, letterSpacing: '0.05em' }}>
        {isLive ? s.label : s.phase === 'pre_session' || s.phase === 'approaching' ? 'NEXT SESSION' : s.label}
      </span>
      <span style={{ color: 'var(--text-dim)' }}>·</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '0.05em' }}>{countdown}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>{s.dubaiTime} DXB</span>
    </div>
  )
}
