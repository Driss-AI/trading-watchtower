'use client'
import { useCallback, useEffect, useState } from 'react'

// ─── MANUAL EXECUTION LOG ───────────────────────────────────────────────────
// The cockpit surface for the "user executes, system audits" loop. Lists every
// signal the engine fired today (taken or skipped) and lets the user log what
// they actually did: TAKEN (with real fill + contracts), SKIPPED, or MISSED.
// A live countdown shows each signal's manual-execution validity window.

interface Opportunity {
  id: string
  barTime: string
  direction: 'LONG' | 'SHORT'
  market: string
  finalDecision: 'take' | 'skip'
  mechanicalVerdict: 'take' | 'caution' | 'skip'
  entry: number
  stop: number
  target: number
  finalContracts: number
  skipReason: string | null
  rationale: string | null
  signalExpiresAt: string | null
  validForSeconds: number | null
  maxChaseDistance: number | null
  cancelIfBeyond: number | null
  entryBandLow: number | null
  entryBandHigh: number | null
  manualExecutionStatus: string
  actualEntry: number | null
  actualContracts: number | null
  executionDelaySeconds: number | null
  isExpired: boolean
}

const STATUS_COLOR: Record<string, string> = {
  NOT_TAKEN: 'var(--text-dim)',
  TAKEN: 'var(--green)',
  SKIPPED: 'var(--text-secondary)',
  MISSED: 'var(--yellow)',
  CANCELLED: 'var(--text-secondary)',
  EXPIRED: 'var(--red)',
}

export default function ManualExecutionLog() {
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const today = new Date().toISOString().split('T')[0]

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/opportunities?date=${today}`)
      const { opportunities } = await res.json()
      setOpps(opportunities ?? [])
    } catch {
      /* leave prior state */
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => { load() }, [load])
  // Poll + tick so countdowns and new signals stay live.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(load, 20_000)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [load])

  async function record(o: Opportunity, status: string) {
    let actualEntry: number | null = null
    let actualContracts: number | null = null
    if (status === 'TAKEN') {
      const fill = prompt(`Your actual fill price for ${o.direction} ${o.market}?`, o.entry.toFixed(2))
      if (fill == null) return
      actualEntry = parseFloat(fill)
      const c = prompt('Contracts filled?', String(o.finalContracts || 1))
      if (c == null) return
      actualContracts = parseInt(c, 10)
    }
    setBusy(o.id)
    try {
      const post = (manualOverrideReason?: string) =>
        fetch(`/api/opportunities/${o.id}/execution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, actualEntry, actualContracts, priceAtExecution: actualEntry, manualOverrideReason }),
        })

      let res = await post()
      // 400 = backend discipline check (over-chase / over-size). Let the user
      // justify it with an override reason and retry, rather than failing silent.
      if (res.status === 400) {
        const { error } = await res.json().catch(() => ({ error: 'Rejected' }))
        const reason = prompt(`${error}\n\nLog anyway? Enter an override reason (cancel to abort):`)
        if (reason == null || !reason.trim()) return
        res = await post(reason.trim())
      }
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        alert(`Could not log: ${error}`)
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: '20px' }}>
        <Heading />
        <div style={{ color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', padding: '8px 0' }}>Loading signals…</div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <Heading count={opps.length} />
      {opps.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', padding: '8px 0' }}>
          No signals fired yet today. The engine logs every OR breakout it evaluates here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {opps.map((o) => <Row key={o.id} o={o} now={now} busy={busy === o.id} onRecord={record} />)}
        </div>
      )}
    </div>
  )
}

function Heading({ count }: { count?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>
        MANUAL EXECUTION LOG{count != null ? ` (${count})` : ''}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>system decides · you execute · system audits</div>
    </div>
  )
}

function Row({ o, now, busy, onRecord }: { o: Opportunity; now: number; busy: boolean; onRecord: (o: Opportunity, s: string) => void }) {
  const dirColor = o.direction === 'LONG' ? 'var(--green)' : 'var(--red)'
  const expiresMs = o.signalExpiresAt ? new Date(o.signalExpiresAt).getTime() : null
  const secsLeft = expiresMs ? Math.round((expiresMs - now) / 1000) : null
  const live = o.manualExecutionStatus === 'NOT_TAKEN' && !o.isExpired && secsLeft != null && secsLeft > 0
  const isTake = o.finalDecision === 'take'
  const caution = o.mechanicalVerdict === 'caution'
  const status = o.isExpired && o.manualExecutionStatus === 'NOT_TAKEN' ? 'EXPIRED' : o.manualExecutionStatus

  const time = new Date(o.barTime).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px',
      background: 'var(--card-hover)', display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: dirColor, fontSize: '13px' }}>
          {isTake ? (caution ? 'CAUTION' : 'TAKE') : 'SKIP'} · {o.direction}
        </span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-dim)' }}>{o.market} · {time} ET</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', fontWeight: 700, color: STATUS_COLOR[status] ?? 'var(--text-dim)' }}>
          {status}
          {o.executionDelaySeconds != null && status === 'TAKEN' ? ` · +${o.executionDelaySeconds}s` : ''}
        </span>
      </div>

      {isTake && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
          E {o.entry.toFixed(2)} · S {o.stop.toFixed(2)} · T {o.target.toFixed(2)} · {o.finalContracts}c
          {caution && o.entryBandLow != null && o.entryBandHigh != null
            ? ` · band ${o.entryBandLow.toFixed(2)}–${o.entryBandHigh.toFixed(2)} (pullback only)`
            : o.cancelIfBeyond != null ? ` · cancel >${o.cancelIfBeyond.toFixed(2)}` : ''}
        </div>
      )}

      <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
        {isTake ? (o.rationale ?? '') : (o.skipReason ?? '')}
      </div>

      {/* Validity + actions only while NOT_TAKEN */}
      {o.manualExecutionStatus === 'NOT_TAKEN' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
          {isTake && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: 700, color: live ? 'var(--green)' : 'var(--red)' }}>
              {live ? `⏱ ${secsLeft}s left` : 'EXPIRED'}
            </span>
          )}
          {isTake && live && <Btn label="Taken" color="var(--green)" disabled={busy} onClick={() => onRecord(o, 'TAKEN')} />}
          {isTake && <Btn label="Missed" color="var(--yellow)" disabled={busy} onClick={() => onRecord(o, 'MISSED')} />}
          <Btn label="Skipped" color="var(--text-secondary)" disabled={busy} onClick={() => onRecord(o, 'SKIPPED')} />
        </div>
      )}

      {status === 'TAKEN' && o.actualEntry != null && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--green)' }}>
          Filled {o.actualEntry.toFixed(2)} × {o.actualContracts ?? '?'}
          {' · slippage '}{(o.direction === 'LONG' ? o.actualEntry - o.entry : o.entry - o.actualEntry).toFixed(2)} pts
        </div>
      )}
    </div>
  )
}

function Btn({ label, color, disabled, onClick }: { label: string; color: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: 600,
        color, background: 'transparent', border: `1px solid ${color}`,
        borderRadius: '4px', padding: '3px 10px', cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}
