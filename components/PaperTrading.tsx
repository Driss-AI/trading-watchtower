'use client'
import { useEffect, useState, useCallback } from 'react'

interface OpenTrade {
  dbId: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  stopPrice: number
  targetPrice: number
  contracts: number
  entryTime: string
  livePnlPts: number
  livePnlDollars: number
}

interface ClosedTrade {
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  contracts: number
  resultPts: number
  resultDollars: number
  status: 'WIN' | 'LOSS' | 'BE'
  entryTime: string
  exitTime: string
}

interface EngineState {
  enabled: boolean
  phase: 'idle' | 'forming' | 'monitoring' | 'closed'
  contractId: string | null
  orHigh: number | null
  orLow: number | null
  orSize: number | null
  orLocked: boolean
  openTrade: OpenTrade | null
  dailyPnl: number
  tradesCount: number
  winsCount: number
  lossesCount: number
  lastPrice: number
  todayTrades: ClosedTrade[]
  config: {
    bufferPoints: number
    targetMultiple: number
    maxContracts: number
    sessionEndMinute: number
    enableBreakevenStop: boolean
  }
}

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  idle:       { label: 'IDLE',       color: 'var(--text-dim)' },
  forming:    { label: 'FORMING OR', color: 'var(--yellow)' },
  monitoring: { label: 'MONITORING', color: 'var(--blue)' },
  closed:     { label: 'CLOSED',     color: 'var(--text-secondary)' },
}

export default function PaperTrading() {
  const [state, setState] = useState<EngineState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-engine')
      if (res.ok) {
        setState(await res.json())
        setError(null)
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 2000)
    return () => clearInterval(interval)
  }, [fetchState])

  async function sendAction(action: string) {
    setLoading(true)
    try {
      const res = await fetch('/api/paper-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (data.state) setState(data.state)
      if (data.error) setError(data.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  if (!state) {
    return (
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>
          PAPER TRADING ENGINE
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '8px' }}>Loading...</div>
      </div>
    )
  }

  const phaseInfo = PHASE_LABELS[state.phase] ?? PHASE_LABELS.idle
  const pnlColor = state.dailyPnl > 0 ? 'var(--green)' : state.dailyPnl < 0 ? 'var(--red)' : 'var(--text-primary)'

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>
            PAPER TRADING ENGINE
          </div>
          <span style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
            padding: '2px 8px', borderRadius: '4px',
            background: state.enabled ? 'rgba(0,230,118,0.15)' : 'rgba(255,255,255,0.06)',
            color: state.enabled ? 'var(--green)' : 'var(--text-dim)',
            border: `1px solid ${state.enabled ? 'rgba(0,230,118,0.3)' : 'var(--border)'}`,
          }}>
            {state.enabled ? 'RUNNING' : 'OFF'}
          </span>
          <span style={{
            fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em',
            color: phaseInfo.color,
          }}>
            {phaseInfo.label}
          </span>
        </div>
        <button
          onClick={() => sendAction(state.enabled ? 'stop' : 'start')}
          disabled={loading}
          style={{
            background: state.enabled ? 'rgba(255,61,61,0.15)' : 'rgba(0,230,118,0.15)',
            color: state.enabled ? 'var(--red)' : 'var(--green)',
            border: `1px solid ${state.enabled ? 'rgba(255,61,61,0.3)' : 'rgba(0,230,118,0.3)'}`,
            borderRadius: '6px', padding: '6px 16px', cursor: 'pointer',
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
            fontFamily: 'IBM Plex Mono, monospace',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '...' : state.enabled ? 'STOP' : 'START'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
      )}

      {/* Only show details when engine is running */}
      {state.enabled && (
        <>
          {/* Opening Range + Price Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <MiniStat label="OR HIGH" value={state.orHigh?.toFixed(2) ?? '—'} color={state.orLocked ? 'var(--text-primary)' : 'var(--yellow)'} />
            <MiniStat label="OR LOW" value={state.orLow?.toFixed(2) ?? '—'} color={state.orLocked ? 'var(--text-primary)' : 'var(--yellow)'} />
            <MiniStat label="OR SIZE" value={state.orSize?.toFixed(2) ?? '—'} />
            <MiniStat label="LAST PRICE" value={state.lastPrice > 0 ? state.lastPrice.toFixed(2) : '—'} color="var(--blue)" />
          </div>

          {/* Open Position */}
          {state.openTrade && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '12px', fontWeight: 700,
                    color: state.openTrade.direction === 'LONG' ? 'var(--green)' : 'var(--red)',
                  }}>
                    {state.openTrade.direction === 'LONG' ? 'LONG' : 'SHORT'} {state.openTrade.contracts} MNQ
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>@ {state.openTrade.entryPrice.toFixed(2)}</span>
                </div>
                <div style={{
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', fontWeight: 700,
                  color: state.openTrade.livePnlDollars >= 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {state.openTrade.livePnlDollars >= 0 ? '+' : ''}{state.openTrade.livePnlDollars.toFixed(2)}
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                    ({state.openTrade.livePnlPts >= 0 ? '+' : ''}{state.openTrade.livePnlPts.toFixed(2)}pts)
                  </span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <MiniStat label="STOP" value={state.openTrade.stopPrice.toFixed(2)} color="var(--red)" />
                <MiniStat label="TARGET" value={state.openTrade.targetPrice.toFixed(2)} color="var(--green)" />
                <MiniStat label="ENTRY" value={state.openTrade.entryTime} />
              </div>
            </div>
          )}

          {/* Daily Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
            <MiniStat label="DAILY P&L" value={`${state.dailyPnl >= 0 ? '+' : ''}$${state.dailyPnl.toFixed(0)}`} color={pnlColor} />
            <MiniStat label="TRADES" value={String(state.tradesCount)} />
            <MiniStat label="WINS" value={String(state.winsCount)} color={state.winsCount > 0 ? 'var(--green)' : undefined} />
            <MiniStat label="LOSSES" value={String(state.lossesCount)} color={state.lossesCount > 0 ? 'var(--red)' : undefined} />
          </div>

          {/* Trade Log */}
          {state.todayTrades.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '8px' }}>
                TODAY'S PAPER TRADES
              </div>
              {state.todayTrades.map((t, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: i < state.todayTrades.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 700,
                      color: t.direction === 'LONG' ? 'var(--green)' : 'var(--red)',
                    }}>
                      {t.direction}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {t.contracts}x {t.entryPrice.toFixed(2)} → {t.exitPrice.toFixed(2)}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                      {t.entryTime}–{t.exitTime}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: 600,
                    color: t.status === 'WIN' ? 'var(--green)' : t.status === 'LOSS' ? 'var(--red)' : 'var(--text-secondary)',
                  }}>
                    {t.resultDollars >= 0 ? '+' : ''}${t.resultDollars.toFixed(0)} ({t.resultPts >= 0 ? '+' : ''}{t.resultPts.toFixed(1)}pts)
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Idle hint */}
      {!state.enabled && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>
          Start the engine to paper trade the ORB strategy on MNQ. Trades are simulated — no real orders placed.
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '3px' }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: 600,
        color: color ?? 'var(--text-primary)',
      }}>
        {value}
      </div>
    </div>
  )
}
