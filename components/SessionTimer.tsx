'use client'
import { useEffect, useState } from 'react'

interface SessionPhase {
  name: string
  label: string
  color: string
  bg: string
  border: string
  glow: string
  emoji: string
}

interface TimerState {
  phase: 'pre_session' | 'orb_window' | 'breakout_window' | 'session_closed' | 'weekend'
  phaseInfo: SessionPhase
  countdown: string       // "2h 14m 33s"
  countdownSeconds: number
  etTime: string          // "14:22:05"
  dubaiTime: string       // "18:22:05"
  sessionOpenET: string   // "09:30"
  orbCloseET: string      // "10:00"
  sessionCloseET: string  // "10:30"
  progressPct: number     // 0–100 within current window
  isWeekend: boolean
}

const PHASES: Record<string, SessionPhase> = {
  pre_session: {
    name: 'PRE-SESSION',
    label: 'Opens at 9:30 AM ET',
    color: 'var(--yellow)',
    bg: 'var(--yellow-bg)',
    border: 'var(--yellow-border)',
    glow: '0 0 20px rgba(255,179,0,0.2)',
    emoji: '⏳',
  },
  orb_window: {
    name: 'ORB WINDOW',
    label: '9:30 → 10:00 AM ET',
    color: 'var(--green)',
    bg: 'var(--green-bg)',
    border: 'var(--green-border)',
    glow: '0 0 20px rgba(0,230,118,0.25)',
    emoji: '📐',
  },
  breakout_window: {
    name: 'BREAKOUT WINDOW',
    label: '10:00 → 10:30 AM ET',
    color: '#00bcd4',
    bg: 'rgba(0,188,212,0.08)',
    border: 'rgba(0,188,212,0.3)',
    glow: '0 0 20px rgba(0,188,212,0.2)',
    emoji: '⚡',
  },
  session_closed: {
    name: 'SESSION CLOSED',
    label: 'Next session tomorrow',
    color: 'var(--text-dim)',
    bg: 'var(--surface)',
    border: 'var(--border)',
    glow: 'none',
    emoji: '🔒',
  },
  weekend: {
    name: 'WEEKEND',
    label: 'Markets closed',
    color: 'var(--text-dim)',
    bg: 'var(--surface)',
    border: 'var(--border)',
    glow: 'none',
    emoji: '📅',
  },
}

function getTimerState(): TimerState {
  const now = new Date()

  // Get ET time
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const etHour = etNow.getHours()
  const etMin  = etNow.getMinutes()
  const etSec  = etNow.getSeconds()
  const etDay  = etNow.getDay()  // 0=Sun, 6=Sat
  const etDecimal = etHour + etMin / 60 + etSec / 3600

  const isWeekend = etDay === 0 || etDay === 6

  // Dubai time (GMT+4)
  const dubaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }))

  const pad = (n: number) => String(n).padStart(2, '0')
  const etTime    = `${pad(etHour)}:${pad(etMin)}:${pad(etSec)}`
  const dubaiTime = `${pad(dubaiNow.getHours())}:${pad(dubaiNow.getMinutes())}:${pad(dubaiNow.getSeconds())}`

  // Session times in decimal hours ET
  const SESSION_OPEN  = 9.5    // 9:30 AM
  const ORB_CLOSE     = 10.0   // 10:00 AM
  const SESSION_CLOSE = 10.5   // 10:30 AM

  function secondsUntil(targetDecimalHour: number): number {
    const targetSec = targetDecimalHour * 3600
    const nowSec    = etDecimal * 3600
    let diff = targetSec - nowSec
    if (diff < 0) diff += 86400 // next day
    return Math.floor(diff)
  }

  function formatCountdown(secs: number): string {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`
    if (m > 0) return `${m}m ${pad(s)}s`
    return `${s}s`
  }

  let phase: TimerState['phase']
  let countdownSeconds: number
  let progressPct = 0

  if (isWeekend) {
    phase = 'weekend'
    // Seconds until Monday 9:30 AM ET
    const daysUntilMon = etDay === 6 ? 2 : 1
    countdownSeconds = daysUntilMon * 86400 - secondsUntil(SESSION_OPEN) + (etDay === 0 ? 0 : 0)
    // Simpler: just calc from now to next weekday 9:30
    const nextMon = new Date(etNow)
    nextMon.setDate(etNow.getDate() + (etDay === 6 ? 2 : 1))
    nextMon.setHours(9, 30, 0, 0)
    countdownSeconds = Math.max(0, Math.floor((nextMon.getTime() - now.getTime()) / 1000))
  } else if (etDecimal < SESSION_OPEN) {
    phase = 'pre_session'
    countdownSeconds = secondsUntil(SESSION_OPEN)
    // Progress 0–100 from midnight to 9:30
    progressPct = Math.min(100, (etDecimal / SESSION_OPEN) * 100)
  } else if (etDecimal < ORB_CLOSE) {
    phase = 'orb_window'
    countdownSeconds = secondsUntil(ORB_CLOSE)
    // Progress within ORB window
    progressPct = ((etDecimal - SESSION_OPEN) / (ORB_CLOSE - SESSION_OPEN)) * 100
  } else if (etDecimal < SESSION_CLOSE) {
    phase = 'breakout_window'
    countdownSeconds = secondsUntil(SESSION_CLOSE)
    progressPct = ((etDecimal - ORB_CLOSE) / (SESSION_CLOSE - ORB_CLOSE)) * 100
  } else {
    phase = 'session_closed'
    // Time until tomorrow's open
    countdownSeconds = secondsUntil(SESSION_OPEN + 24)
    progressPct = 100
  }

  return {
    phase,
    phaseInfo: PHASES[phase],
    countdown: formatCountdown(countdownSeconds),
    countdownSeconds,
    etTime,
    dubaiTime,
    sessionOpenET: '09:30',
    orbCloseET: '10:00',
    sessionCloseET: '10:30',
    progressPct: Math.min(100, Math.max(0, progressPct)),
    isWeekend,
  }
}

// ─── COMPACT VERSION (for navbar) ────────────────────────────────────────────
export function SessionTimerCompact() {
  const [state, setState] = useState<TimerState | null>(null)

  useEffect(() => {
    setState(getTimerState())
    const t = setInterval(() => setState(getTimerState()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!state) return null

  const { phaseInfo, countdown, phase } = state
  const showCountdown = phase !== 'session_closed' && phase !== 'weekend'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '6px', background: phaseInfo.bg, border: `1px solid ${phaseInfo.border}` }}>
      <span style={{ fontSize: '12px' }}>{phaseInfo.emoji}</span>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px' }}>
        <span style={{ color: phaseInfo.color, fontWeight: '700' }}>{phaseInfo.name}</span>
        {showCountdown && (
          <span style={{ color: 'var(--text-dim)', marginLeft: '6px' }}>
            {phase === 'pre_session' ? '→ ' : ''}{countdown}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── FULL VERSION (for dashboard) ────────────────────────────────────────────
export default function SessionTimer() {
  const [state, setState] = useState<TimerState | null>(null)

  useEffect(() => {
    setState(getTimerState())
    const t = setInterval(() => setState(getTimerState()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!state) return null

  const { phase, phaseInfo, countdown, countdownSeconds, etTime, dubaiTime, progressPct, isWeekend } = state

  const isActive = phase === 'orb_window' || phase === 'breakout_window'

  return (
    <div style={{
      background: phaseInfo.bg,
      border: `1px solid ${phaseInfo.border}`,
      borderRadius: '10px',
      padding: '16px 20px',
      marginBottom: '16px',
      boxShadow: phaseInfo.glow,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>

        {/* Left: Phase + countdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '22px' }}>{phaseInfo.emoji}</span>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: phaseInfo.color, fontWeight: '700', letterSpacing: '0.12em', marginBottom: '2px' }}>
              {phaseInfo.name}
            </div>
            {/* Big countdown */}
            {phase !== 'session_closed' && phase !== 'weekend' && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: phaseInfo.color, lineHeight: 1, letterSpacing: '-0.02em' }}>
                {countdown}
              </div>
            )}
            {(phase === 'session_closed' || phase === 'weekend') && (
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: '700', color: phaseInfo.color }}>
                {phase === 'weekend' ? `Next session in ${countdown}` : `Next session in ${countdown}`}
              </div>
            )}
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {phase === 'pre_session' ? 'until session opens' :
               phase === 'orb_window' ? 'until ORB closes → 10:00 AM ET' :
               phase === 'breakout_window' ? 'until session closes → 10:30 AM ET' :
               phaseInfo.label}
            </div>
          </div>
        </div>

        {/* Middle: Progress bar showing session timeline */}
        <div style={{ flex: 1, minWidth: '200px' }}>
          {/* Timeline */}
          <div style={{ marginBottom: '6px', position: 'relative' }}>
            <div style={{ background: 'var(--surface)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
              <div style={{
                width: `${progressPct}%`,
                height: '100%',
                background: isActive
                  ? `linear-gradient(to right, var(--green), ${phase === 'breakout_window' ? '#00bcd4' : 'var(--green)'})`
                  : phaseInfo.color,
                borderRadius: '4px',
                transition: 'width 1s linear',
                boxShadow: isActive ? `0 0 8px ${phaseInfo.color}60` : 'none',
              }} />
            </div>
            {/* Markers */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)' }}>
              <span style={{ color: phase === 'orb_window' || phase === 'breakout_window' ? 'var(--green)' : 'var(--text-dim)' }}>9:30</span>
              <span style={{ color: phase === 'breakout_window' ? '#00bcd4' : 'var(--text-dim)' }}>10:00</span>
              <span>10:30</span>
            </div>
          </div>

          {/* Session window labels */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <WindowBadge label="ORB" active={phase === 'orb_window'} done={phase === 'breakout_window' || phase === 'session_closed'} color="var(--green)" />
            <WindowBadge label="Breakout" active={phase === 'breakout_window'} done={phase === 'session_closed'} color="#00bcd4" />
          </div>
        </div>

        {/* Right: Clocks */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: '1px' }}>ET (NEW YORK)</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>{etTime}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: '1px' }}>DUBAI (YOUR TIME)</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: '700', color: phaseInfo.color }}>{dubaiTime}</div>
          </div>
        </div>
      </div>

      {/* Live pulsing dot when active */}
      {isActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${phaseInfo.border}` }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: phaseInfo.color, animation: 'pulse 1s infinite', boxShadow: `0 0 6px ${phaseInfo.color}` }} />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: phaseInfo.color, fontWeight: '600' }}>
            {phase === 'orb_window' ? 'OPENING RANGE FORMING — Watch price action' : 'BREAKOUT WINDOW — ORB levels set, watch for breakout'}
          </span>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  )
}

function WindowBadge({ label, active, done, color }: { label: string; active: boolean; done: boolean; color: string }) {
  return (
    <span style={{
      fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', fontWeight: '700',
      padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.06em',
      background: active ? `${color}20` : 'var(--surface)',
      color: active ? color : done ? 'var(--text-dim)' : 'var(--text-dim)',
      border: `1px solid ${active ? color : 'var(--border)'}`,
      textDecoration: done ? 'line-through' : 'none',
    }}>
      {label}
    </span>
  )
}
