'use client'
// ─── LIVE TRAILING DRAWDOWN METER ─────────────────────────────────────────────
// Streams GatewayUserAccount events via SSE → tracks peak balance → computes
// trailing drawdown floor in real time. Goes red when within $500 of the limit.
//
// Topstep $50K rules:
//   Trailing drawdown limit : $2,000
//   Daily loss limit        : $1,000  (shown separately)
//   Profit target           : $3,000

import { useEffect, useRef, useState } from 'react'

const TRAILING_LIMIT   = 2_000   // Topstep $50K trailing drawdown
const DAILY_LIMIT      = 1_000   // daily loss limit
const PROFIT_TARGET    = 3_000   // profit target
const START_BALANCE    = 50_000  // initial account balance
const DANGER_THRESHOLD = 400     // go red when this close to floor

interface AccountState {
  balance:      number
  peak:         number
  floor:        number
  remaining:    number          // peak - balance (drawdown used so far)
  available:    number          // floor headroom (balance - floor)
  dailyPnL:     number
  pctUsed:      number          // 0-100 how much of the $3K is consumed
  status:       'safe' | 'warning' | 'danger'
  streaming:    boolean
  lastUpdate:   string | null
  canTrade:     boolean
}

function calcState(balance: number, peak: number, dailyPnL: number, streaming: boolean, lastUpdate: string | null, canTrade: boolean): AccountState {
  const floor     = peak - TRAILING_LIMIT
  const remaining = peak - balance           // drawdown consumed
  const available = balance - floor          // room left before account out
  const pctUsed   = Math.min(100, (remaining / TRAILING_LIMIT) * 100)
  const status    = available <= DANGER_THRESHOLD ? 'danger'
                  : available <= DANGER_THRESHOLD * 2 ? 'warning'
                  : 'safe'
  return { balance, peak, floor, remaining, available, dailyPnL, pctUsed, status, streaming, lastUpdate, canTrade }
}

export default function DrawdownMeter() {
  const [state, setState] = useState<AccountState>(
    calcState(START_BALANCE, START_BALANCE, 0, false, null, true)
  )
  const peakRef    = useRef(START_BALANCE)
  const balanceRef = useRef(START_BALANCE)
  const esRef      = useRef<EventSource | null>(null)

  useEffect(() => {
    // Also fetch current balance via REST on mount for immediate accurate state
    fetch('/api/topstepx/account')
      .then(r => r.json())
      .then(data => {
        if (data.balance) {
          balanceRef.current = data.balance
          peakRef.current    = Math.max(peakRef.current, data.balance)
          setState(s => calcState(data.balance, peakRef.current, s.dailyPnL, s.streaming, s.lastUpdate, data.canTrade ?? true))
        }
      }).catch(() => {})

    // Open SSE stream for live account updates
    const es = new EventSource('/api/topstepx/stream?hub=user')
    esRef.current = es

    es.onopen = () => {
      setState(s => ({ ...s, streaming: true }))
    }

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)

        if (event.type === 'account' && event.data) {
          const { balance, canTrade } = event.data as { balance: number; canTrade: boolean }
          // Update peak (trailing — it only moves UP, never down)
          peakRef.current = Math.max(peakRef.current, balance)
          balanceRef.current = balance
          const dailyPnL = balance - START_BALANCE  // simplified; real = today's fills
          setState(calcState(balance, peakRef.current, dailyPnL, true, new Date().toLocaleTimeString(), canTrade))
        }

        if (event.type === 'connected') {
          setState(s => ({ ...s, streaming: true }))
        }
        if (event.type === 'disconnected') {
          setState(s => ({ ...s, streaming: false }))
        }
      } catch {}
    }

    es.onerror = () => {
      setState(s => ({ ...s, streaming: false }))
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  const { balance, peak, floor, remaining, available, dailyPnL, pctUsed, status, streaming, lastUpdate, canTrade } = state

  const barColor = status === 'danger'  ? 'var(--red)'
                 : status === 'warning' ? 'var(--yellow)'
                 : 'var(--green)'

  const progressToTarget = Math.min(100, ((balance - START_BALANCE) / PROFIT_TARGET) * 100)
  const profitPnL        = balance - START_BALANCE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.1em' }}>
          TRAILING DRAWDOWN — $50K EVAL
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>
          <span style={{ color: streaming ? 'var(--green)' : 'var(--text-dim)' }}>
            {streaming ? '● LIVE' : '○ POLLING'}
          </span>
          {lastUpdate && <span style={{ color: 'var(--text-dim)' }}>{lastUpdate}</span>}
        </div>
      </div>

      {/* Balance row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
        {[
          { label: 'BALANCE',      value: `$${balance.toLocaleString()}`,   color: balance >= START_BALANCE ? 'var(--green)' : 'var(--red)', big: true },
          { label: 'PEAK',         value: `$${peak.toLocaleString()}`,       color: 'var(--text-primary)', big: false },
          { label: 'FLOOR',        value: `$${Math.round(floor).toLocaleString()}`, color: 'var(--yellow)', big: false },
          { label: 'ROOM LEFT',    value: `$${Math.round(available).toLocaleString()}`, color: barColor, big: true },
        ].map(item => (
          <div key={item.label} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>
              {item.label}
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: item.big ? '18px' : '14px', color: item.color }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* Trailing drawdown bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: 'var(--text-dim)' }}>
            DRAWDOWN USED — ${Math.round(remaining).toLocaleString()} of $2,000
          </span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: barColor, fontWeight: 600 }}>
            {pctUsed.toFixed(1)}%
          </span>
        </div>
        <div style={{ height: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pctUsed}%`,
            background: barColor,
            borderRadius: '6px',
            transition: 'width 0.4s ease, background 0.3s ease',
            boxShadow: status === 'danger' ? `0 0 12px var(--red)` : undefined,
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)' }}>
          <span>$0 used</span>
          <span style={{ color: 'var(--yellow)' }}>⚠ $1,600</span>
          <span style={{ color: 'var(--red)' }}>✕ $2,000 MAX</span>
        </div>
      </div>

      {/* Profit target bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: 'var(--text-dim)' }}>
            PROFIT TARGET — ${Math.max(0, profitPnL).toLocaleString()} of $3,000
          </span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: 'var(--green)', fontWeight: 600 }}>
            {Math.max(0, progressToTarget).toFixed(1)}%
          </span>
        </div>
        <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.max(0, progressToTarget)}%`,
            background: 'var(--green)',
            borderRadius: '6px',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Status / Daily P&L row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>ACCOUNT STATUS</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '13px', color: canTrade ? 'var(--green)' : 'var(--red)' }}>
            {canTrade ? '✓ CAN TRADE' : '✕ BLOCKED'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>DAILY LOSS LIMIT</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '13px', color: 'var(--yellow)' }}>
            ${DAILY_LIMIT.toLocaleString()} max
          </div>
        </div>
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '4px' }}>TO PASS</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '13px', color: 'var(--green)' }}>
            ${Math.max(0, START_BALANCE + PROFIT_TARGET - balance).toLocaleString()} needed
          </div>
        </div>
      </div>

      {/* Danger alert */}
      {status === 'danger' && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(210, 40, 40, 0.15)',
          border: '1px solid var(--red)',
          borderRadius: '8px',
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '12px',
          color: 'var(--red)',
          fontWeight: 600,
          animation: 'pulse 1s infinite',
        }}>
          ⚠ DANGER — Only ${Math.round(available).toLocaleString()} left before account is pulled. Stop trading.
        </div>
      )}
      {status === 'warning' && (
        <div style={{
          padding: '10px 16px',
          background: 'rgba(239, 159, 39, 0.1)',
          border: '1px solid var(--yellow)',
          borderRadius: '8px',
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '12px',
          color: 'var(--yellow)',
        }}>
          ⚡ WARNING — Approaching drawdown limit. ${Math.round(available).toLocaleString()} remaining.
        </div>
      )}
    </div>
  )
}
