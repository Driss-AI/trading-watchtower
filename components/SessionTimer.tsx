'use client'
import { useEffect, useState } from 'react'

interface TimerState {
  phase: 'pre_session' | 'orb_window' | 'post_orb' | 'closed' | 'weekend'
  label: string
  sublabel: string
  countdownMs: number   // ms until next phase change
  hours: number
  minutes: number
  seconds: number
  color: string
  urgency: 'calm' | 'approaching' | 'live' | 'over'
  dubaiTime: string
  nyTime: string
  dayLabel: string
}

function computeTimerState(): TimerState {
  const now = new Date()

  // Current time in ET
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dubaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }))

  const nyTime = nyNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const dubaiTime = dubaiNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

  const day = nyNow.getDay()   // 0=Sun, 6=Sat
  const h = nyNow.getHours()
  const m = nyNow.getMinutes()
  const s = nyNow.getSeconds()
  const totalSecsNow = h * 3600 + m * 60 + s

  // Key session times in ET seconds
  const SESSION_OPEN   = 9 * 3600 + 30 * 60   // 9:30 AM
  const ORB_END        = 10 * 3600             // 10:00 AM (OR established)
  const SESSION_CLOSE  = 10 * 3600 + 30 * 60  // 10:30 AM (end of trading window)
  const PREP_START     = 9 * 3600              // 9:00 AM (30 min prep warning)

  const isWeekday = day >= 1 && day <= 5
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayLabel = dayNames[day]

  // Weekend
  if (!isWeekday) {
    // Next Monday 9:30 AM ET
    const daysUntilMon = day === 6 ? 2 : 1
    const nextOpen = new Date(nyNow)
    nextOpen.setDate(nyNow.getDate() + daysUntilMon)
    nextOpen.setHours(9, 30, 0, 0)
    const msUntil = nextOpen.getTime() - now.getTime()
    const totalSecs = Math.floor(msUntil / 1000)
    const hrs = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    const secs = totalSecs % 60
    return {
      phase: 'weekend',
      label: 'MARKET CLOSED — WEEKEND',
      sublabel: `Next session: Monday 9:30 AM ET · 6:30 PM Dubai`,
      countdownMs: msUntil,
      hours: hrs, minutes: mins, seconds: secs,
      color: 'var(--text-dim)',
      urgency: 'over',
      nyTime, dubaiTime, dayLabel,
    }
  }

  // After session close — show next day's countdown
  if (totalSecsNow >= SESSION_CLOSE) {
    const isFriday = day === 5
    const daysUntil = isFriday ? 3 : 1
    const nextOpen = new Date(nyNow)
    nextOpen.setDate(nyNow.getDate() + daysUntil)
    nextOpen.setHours(9, 30, 0, 0)
    const msUntil = nextOpen.getTime() - now.getTime()
    const totalSecs = Math.floor(msUntil / 1000)
    const hrs = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    const secs = totalSecs % 60
    const nextDayName = isFriday ? 'Monday' : dayNames[day + 1]
    return {
      phase: 'closed',
      label: `SESSION CLOSED`,
      sublabel: `Next: ${nextDayName} 9:30 AM ET · 6:30 PM Dubai`,
      countdownMs: msUntil,
      hours: hrs, minutes: mins, seconds: secs,
      color: 'var(--text-dim)',
      urgency: 'over',
      nyTime, dubaiTime, dayLabel,
    }
  }

  // ORB window live: 9:30–10:00 AM ET
  if (totalSecsNow >= SESSION_OPEN && totalSecsNow < ORB_END) {
    const secsLeft = ORB_END - totalSecsNow
    const mins = Math.floor(secsLeft / 60)
    const secs = secsLeft % 60
    return {
      phase: 'orb_window',
      label: '🔴 LIVE — OR BUILDING',
      sublabel: 'Opening Range window closes at 10:00 AM ET · 7:00 PM Dubai',
      countdownMs: secsLeft * 1000,
      hours: 0, minutes: mins, seconds: secs,
      color: 'var(--red)',
      urgency: 'live',
      nyTime, dubaiTime, dayLabel,
    }
  }

  // Post-ORB trading window: 10:00–10:30 AM ET
  if (totalSecsNow >= ORB_END && totalSecsNow < SESSION_CLOSE) {
    const secsLeft = SESSION_CLOSE - totalSecsNow
    const mins = Math.floor(secsLeft / 60)
    const secs = secsLeft % 60
    return {
      phase: 'post_orb',
      label: '🟢 LIVE — OR COMPLETE',
      sublabel: 'Trade window closes at 10:30 AM ET · 7:30 PM Dubai',
      countdownMs: secsLeft * 1000,
      hours: 0, minutes: mins, seconds: secs,
      color: 'var(--green)',
      urgency: 'live',
      nyTime, dubaiTime, dayLabel,
    }
  }

  // Pre-session: before 9:30 AM ET
  const secsUntilOpen = SESSION_OPEN - totalSecsNow
  const msUntilOpen = secsUntilOpen * 1000
  const hrs = Math.floor(secsUntilOpen / 3600)
  const mins = Math.floor((secsUntilOpen % 3600) / 60)
  const secs = secsUntilOpen % 60

  // < 30 min = approaching
  const urgency: TimerState['urgency'] = secsUntilOpen < 30 * 60 ? 'approaching' : 'calm'
  const color = urgency === 'approaching' ? 'var(--yellow)' : 'var(--blue)'

  return {
    phase: 'pre_session',
    label: urgency === 'approaching' ? '⚡ SESSION STARTING SOON' : 'NEXT SESSION',
    sublabel: `NY Open 9:30 AM ET · Dubai 6:30 PM`,
    countdownMs: msUntilOpen,
    hours: hrs, minutes: mins, seconds: secs,
    color,
    urgency,
    nyTime, dubaiTime, dayLabel,
  }
}

export default function SessionTimer() {
  const [state, setState] = useState<TimerState | null>(null)

  useEffect(() => {
    // Initial
    setState(computeTimerState())
    // Tick every second
    const interval = setInterval(() => {
      setState(computeTimerState())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  if (!state) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  const isLive = state.urgency === 'live'
  const isApproaching = state.urgency === 'approaching'
  const isOver = state.urgency === 'over'

  const bgColor = isLive
    ? state.phase === 'orb_window' ? 'var(--red-bg)' : 'var(--green-bg)'
    : isApproaching ? 'var(--yellow-bg)'
    : 'var(--surface)'

  const borderColor = isLive
    ? state.phase === 'orb_window' ? 'var(--red-border)' : 'var(--green-border)'
    : isApproaching ? 'var(--yellow-border)'
    : 'var(--border)'

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: '10px',
      padding: '16px 24px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '20px',
      boxShadow: isLive ? `0 0 20px ${state.color}25` : 'none',
    }}>

      {/* Left: Label + sublabel */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '10px',
          fontWeight: '700',
          letterSpacing: '0.12em',
          color: state.color,
          marginBottom: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          {isLive && (
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: state.color,
              display: 'inline-block',
              animation: 'pulse 1.2s ease-in-out infinite',
            }} />
          )}
          {state.label}
        </div>
        <div style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {state.sublabel}
        </div>
      </div>

      {/* Center: Countdown clock */}
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        {!isOver && (
          <>
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: isLive ? '36px' : '32px',
              fontWeight: '700',
              color: state.color,
              lineHeight: 1,
              letterSpacing: '0.05em',
              textShadow: isLive ? `0 0 20px ${state.color}80` : 'none',
            }}>
              {state.hours > 0
                ? `${pad(state.hours)}:${pad(state.minutes)}:${pad(state.seconds)}`
                : `${pad(state.minutes)}:${pad(state.seconds)}`
              }
            </div>
            <div style={{
              fontSize: '10px',
              color: 'var(--text-dim)',
              marginTop: '3px',
              fontFamily: 'IBM Plex Mono, monospace',
              letterSpacing: '0.06em',
            }}>
              {isLive
                ? state.phase === 'orb_window' ? 'OR WINDOW CLOSES IN' : 'TRADE WINDOW CLOSES IN'
                : 'UNTIL NY OPEN'
              }
            </div>
          </>
        )}
      </div>

      {/* Right: Dual clock (Dubai + NY) */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <ClockDisplay label="DUBAI" time={state.dubaiTime} primary />
        <ClockDisplay label="NY" time={state.nyTime} />
        <div style={{
          fontSize: '10px',
          color: 'var(--text-dim)',
          marginTop: '4px',
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {state.dayLabel}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  )
}

function ClockDisplay({ label, time, primary }: { label: string; time: string; primary?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', justifyContent: 'flex-end', marginBottom: '2px' }}>
      <span style={{
        fontSize: '9px',
        color: 'var(--text-dim)',
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: '600',
        letterSpacing: '0.08em',
        width: '38px',
        textAlign: 'right',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: primary ? '16px' : '13px',
        fontWeight: primary ? '700' : '400',
        color: primary ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
        {time}
      </span>
    </div>
  )
}
