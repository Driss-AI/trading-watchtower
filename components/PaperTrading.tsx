'use client'
import { useEffect, useState, useCallback, useRef } from 'react'

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

interface AIState {
  preSession: {
    shouldTrade: boolean
    bias: 'long' | 'short' | 'neutral'
    confidence: number
    reasoning: string
    riskLevel: 'low' | 'medium' | 'high' | 'extreme'
    keyFactors: string[]
  } | null
  orAssessment: {
    quality: 'excellent' | 'good' | 'fair' | 'poor'
    shouldTrade: boolean
    preferredDirection: 'long' | 'short' | 'either' | 'none'
    reasoning: string
  } | null
  lastBreakout: {
    enter: boolean
    reasoning: string
    confidence: number
    contracts: number
  } | null
  analysisInProgress: boolean
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
  ai: AIState
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
  const [livePrice, setLivePrice] = useState<number>(0)
  const evtSourceRef = useRef<EventSource | null>(null)

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

  useEffect(() => {
    if (!state?.enabled) {
      if (evtSourceRef.current) {
        evtSourceRef.current.close()
        evtSourceRef.current = null
      }
      return
    }
    const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
    evtSourceRef.current = es
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (payload?.type === 'quote' && payload?.data) {
          const price = Number(payload.data.price || 0)
          if (price > 0) setLivePrice(price)
        }
      } catch {}
    }
    return () => { es.close(); evtSourceRef.current = null }
  }, [state?.enabled])

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
          {/* AI Brain Panel */}
          <AIPanel ai={state.ai} />

          {/* Opening Range + Price Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <MiniStat label="OR HIGH" value={state.orHigh?.toFixed(2) ?? '—'} color={state.orLocked ? 'var(--text-primary)' : 'var(--yellow)'} />
            <MiniStat label="OR LOW" value={state.orLow?.toFixed(2) ?? '—'} color={state.orLocked ? 'var(--text-primary)' : 'var(--yellow)'} />
            <MiniStat label="OR SIZE" value={state.orSize?.toFixed(2) ?? '—'} />
            <MiniStat label="LAST PRICE" value={(livePrice || state.lastPrice) > 0 ? (livePrice || state.lastPrice).toFixed(2) : '—'} color="var(--blue)" />
          </div>

          {/* Open Position */}
          {state.openTrade && (() => {
            const currentPrice = livePrice || state.lastPrice
            const ptsRaw = state.openTrade!.direction === 'LONG'
              ? currentPrice - state.openTrade!.entryPrice
              : state.openTrade!.entryPrice - currentPrice
            const livePts = livePrice > 0 ? ptsRaw : state.openTrade!.livePnlPts
            const liveDollars = livePrice > 0 ? ptsRaw * state.openTrade!.contracts * 2 : state.openTrade!.livePnlDollars
            return (
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '12px', fontWeight: 700,
                    color: state.openTrade!.direction === 'LONG' ? 'var(--green)' : 'var(--red)',
                  }}>
                    {state.openTrade!.direction === 'LONG' ? 'LONG' : 'SHORT'} {state.openTrade!.contracts} MNQ
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>@ {state.openTrade!.entryPrice.toFixed(2)}</span>
                </div>
                <div style={{
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', fontWeight: 700,
                  color: liveDollars >= 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {liveDollars >= 0 ? '+' : ''}{liveDollars.toFixed(2)}
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                    ({livePts >= 0 ? '+' : ''}{livePts.toFixed(2)}pts)
                  </span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <MiniStat label="STOP" value={state.openTrade!.stopPrice.toFixed(2)} color="var(--red)" />
                <MiniStat label="TARGET" value={state.openTrade!.targetPrice.toFixed(2)} color="var(--green)" />
                <MiniStat label="ENTRY" value={state.openTrade!.entryTime} />
              </div>
            </div>
            )
          })()}

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

const BIAS_STYLES: Record<string, { color: string; label: string }> = {
  long: { color: 'var(--green)', label: 'LONG BIAS' },
  short: { color: 'var(--red)', label: 'SHORT BIAS' },
  neutral: { color: 'var(--text-secondary)', label: 'NEUTRAL' },
}

const QUALITY_STYLES: Record<string, { color: string }> = {
  excellent: { color: 'var(--green)' },
  good: { color: 'var(--blue)' },
  fair: { color: 'var(--yellow)' },
  poor: { color: 'var(--red)' },
}

const RISK_STYLES: Record<string, { color: string }> = {
  low: { color: 'var(--green)' },
  medium: { color: 'var(--yellow)' },
  high: { color: 'var(--red)' },
  extreme: { color: 'var(--red)' },
}

function AIPanel({ ai }: { ai: AIState }) {
  if (!ai.preSession && !ai.analysisInProgress) return null

  return (
    <div style={{
      background: 'rgba(99,102,241,0.06)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ fontSize: '10px', color: 'rgba(129,140,248,0.9)', letterSpacing: '0.08em', fontWeight: 700 }}>
          AI BRAIN
        </div>
        {ai.analysisInProgress && (
          <span style={{ fontSize: '10px', color: 'var(--yellow)', fontStyle: 'italic' }}>analyzing...</span>
        )}
      </div>

      {/* Pre-Session Decision */}
      {ai.preSession && (
        <div style={{ marginBottom: ai.orAssessment ? '10px' : '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
              padding: '2px 8px', borderRadius: '4px',
              background: ai.preSession.shouldTrade ? 'rgba(0,230,118,0.15)' : 'rgba(255,61,61,0.15)',
              color: ai.preSession.shouldTrade ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${ai.preSession.shouldTrade ? 'rgba(0,230,118,0.3)' : 'rgba(255,61,61,0.3)'}`,
            }}>
              {ai.preSession.shouldTrade ? 'TRADE TODAY' : 'NO TRADE'}
            </span>
            <span style={{
              fontSize: '10px', fontWeight: 600,
              color: BIAS_STYLES[ai.preSession.bias]?.color ?? 'var(--text-secondary)',
            }}>
              {BIAS_STYLES[ai.preSession.bias]?.label ?? ai.preSession.bias}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
              {ai.preSession.confidence}% confidence
            </span>
            <span style={{
              fontSize: '10px', fontWeight: 600,
              color: RISK_STYLES[ai.preSession.riskLevel]?.color ?? 'var(--text-dim)',
            }}>
              {ai.preSession.riskLevel.toUpperCase()} RISK
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {ai.preSession.reasoning}
          </div>
          {ai.preSession.keyFactors.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
              {ai.preSession.keyFactors.map((f, i) => (
                <span key={i} style={{
                  fontSize: '9px', color: 'var(--text-dim)', padding: '2px 6px',
                  background: 'rgba(255,255,255,0.04)', borderRadius: '3px', border: '1px solid var(--border)',
                }}>
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* OR Assessment */}
      {ai.orAssessment && (
        <div style={{ marginBottom: ai.lastBreakout ? '10px' : '0', paddingTop: '8px', borderTop: '1px solid rgba(99,102,241,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600 }}>OR QUALITY</span>
            <span style={{
              fontSize: '11px', fontWeight: 700,
              color: QUALITY_STYLES[ai.orAssessment.quality]?.color ?? 'var(--text-primary)',
            }}>
              {ai.orAssessment.quality.toUpperCase()}
            </span>
            {ai.orAssessment.preferredDirection !== 'none' && ai.orAssessment.preferredDirection !== 'either' && (
              <span style={{
                fontSize: '10px', fontWeight: 600,
                color: ai.orAssessment.preferredDirection === 'long' ? 'var(--green)' : 'var(--red)',
              }}>
                PREFER {ai.orAssessment.preferredDirection.toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {ai.orAssessment.reasoning}
          </div>
        </div>
      )}

      {/* Last Breakout Decision */}
      {ai.lastBreakout && (
        <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(99,102,241,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600 }}>BREAKOUT</span>
            <span style={{
              fontSize: '10px', fontWeight: 700,
              color: ai.lastBreakout.enter ? 'var(--green)' : 'var(--red)',
            }}>
              {ai.lastBreakout.enter ? 'ENTERED' : 'SKIPPED'}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
              {ai.lastBreakout.confidence}% · {ai.lastBreakout.contracts} contract{ai.lastBreakout.contracts !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {ai.lastBreakout.reasoning}
          </div>
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
