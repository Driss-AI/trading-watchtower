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

type OrderflowVerdict = 'confirm' | 'caution' | 'veto'

interface OrderflowAssessment {
  available: boolean
  cumDelta: number
  shortDelta: number
  deltaConfirms: boolean
  divergence: 'none' | 'mild' | 'strong'
  resistanceVol: number
  supportVol: number
  wallRisk: 'none' | 'moderate' | 'high'
  verdict: OrderflowVerdict
  reasons: string[]
}

interface OrderflowLive {
  refPrice: number
  long: OrderflowAssessment
  short: OrderflowAssessment
}

interface OrderflowSnapshot {
  available: boolean
  contractId: string
  cumDelta: number
  shortDelta: number
  bookLevels: number
  lastTradeAgoMs: number | null
  bestBid: number | null
  bestAsk: number | null
  live: OrderflowLive | null
}

type GateVerdict = 'confirm' | 'caution' | 'neutral' | 'veto'

interface PatternGate {
  verdict: GateVerdict
  patternName: string | null
  patternSignal: 'bullish' | 'bearish' | 'neutral' | 'caution' | null
  patternStrength: number | null
  orbContext: string | null
  reasons: string[]
}

interface VolumeGate {
  verdict: GateVerdict
  breakVolume: number
  avgVolume: number
  ratio: number
  reasons: string[]
}

interface EngineCandle {
  open: number; high: number; low: number; close: number
  time: number; ticks: number; volume: number
}

interface CandleSnapshot {
  available: boolean
  contractId: string
  closedBars: number
  lastTradeAgoMs: number | null
  latestClosed: EngineCandle | null
  live: EngineCandle | null
  avgVolume20: number
}

interface PendingBreak {
  direction: 'LONG' | 'SHORT'
  armedAtPrice: number
  armedAtTs: number
  armedAtBarTime: number
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
    enableOrderflowVeto: boolean
    enableWaitForClose: boolean
    enablePatternGate: boolean
    enableVolumeGate: boolean
  }
  ai: AIState
  pendingBreak: PendingBreak | null
  candles: CandleSnapshot | null
  lastPatternGate: PatternGate | null
  lastVolumeGate: VolumeGate | null
  orderflow: OrderflowSnapshot | null
  lastOrderflow: OrderflowAssessment | null
  orderflowVetoes: { count: number; reasons: string[] }
  debrief: string | null
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
    const interval = setInterval(fetchState, 5000)
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

  async function sendConfigure(config: Record<string, unknown>) {
    setLoading(true)
    try {
      const res = await fetch('/api/paper-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'configure', config }),
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
  const vetoOn = state.config.enableOrderflowVeto ?? true

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => sendConfigure({ enableOrderflowVeto: !vetoOn })}
            disabled={loading}
            title={vetoOn
              ? 'Order-flow veto is hard-skipping breakouts on strong divergence / heavy walls. Click to disable.'
              : 'Order-flow veto disabled — breakouts taken even on strong divergence. Click to enable.'}
            style={{
              background: vetoOn ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
              color: vetoOn ? 'rgba(129,140,248,0.95)' : 'var(--text-dim)',
              border: `1px solid ${vetoOn ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
              borderRadius: '6px', padding: '6px 12px', cursor: 'pointer',
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
              fontFamily: 'JetBrains Mono, monospace',
              opacity: loading ? 0.5 : 1,
            }}
          >
            VETO {vetoOn ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => sendAction(state.enabled ? 'stop' : 'start')}
            disabled={loading}
            style={{
              background: state.enabled ? 'rgba(255,61,61,0.15)' : 'rgba(0,230,118,0.15)',
              color: state.enabled ? 'var(--red)' : 'var(--green)',
              border: `1px solid ${state.enabled ? 'rgba(255,61,61,0.3)' : 'rgba(0,230,118,0.3)'}`,
              borderRadius: '6px', padding: '6px 16px', cursor: 'pointer',
              fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
              fontFamily: 'JetBrains Mono, monospace',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? '...' : state.enabled ? 'STOP' : 'START'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
      )}

      {/* Only show details when engine is running */}
      {state.enabled && (
        <>
          {/* AI Brain Panel */}
          <AIPanel ai={state.ai} />

          {/* Order Flow Panel */}
          <OrderFlowPanel snapshot={state.orderflow} lastAssessment={state.lastOrderflow} vetoOn={vetoOn} />

          {/* Candle Read Panel */}
          <CandleReadPanel
            snapshot={state.candles}
            patternGate={state.lastPatternGate}
            volumeGate={state.lastVolumeGate}
            pendingBreak={state.pendingBreak}
            patternGateOn={state.config.enablePatternGate ?? true}
            volumeGateOn={state.config.enableVolumeGate ?? true}
            waitForCloseOn={state.config.enableWaitForClose ?? true}
          />

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
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '18px', fontWeight: 700,
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
                    fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 600,
                    color: t.status === 'WIN' ? 'var(--green)' : t.status === 'LOSS' ? 'var(--red)' : 'var(--text-secondary)',
                  }}>
                    {t.resultDollars >= 0 ? '+' : ''}${t.resultDollars.toFixed(0)} ({t.resultPts >= 0 ? '+' : ''}{t.resultPts.toFixed(1)}pts)
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Order-flow Veto Feed */}
          <VetoFeed vetoes={state.orderflowVetoes} />
        </>
      )}

      {/* Today's Debrief — visible after session close even when engine has stopped */}
      <DebriefCard debrief={state.debrief} />

      {/* Idle hint */}
      {!state.enabled && !state.debrief && (
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
        fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: 600,
        color: color ?? 'var(--text-primary)',
      }}>
        {value}
      </div>
    </div>
  )
}

// ─── ORDER FLOW PANEL ────────────────────────────────────────────────────────

const VERDICT_STYLES: Record<OrderflowVerdict, { color: string; label: string }> = {
  confirm: { color: 'var(--green)', label: 'CONFIRM' },
  caution: { color: 'var(--yellow)', label: 'CAUTION' },
  veto:    { color: 'var(--red)',   label: 'VETO' },
}

// Window delta is rendered against this scale (matches DELTA_STRONG=250 in lib/orderflow.ts).
const DELTA_BAR_SCALE = 250

function OrderFlowPanel({
  snapshot,
  lastAssessment,
  vetoOn,
}: {
  snapshot: OrderflowSnapshot | null
  lastAssessment: OrderflowAssessment | null
  vetoOn: boolean
}) {
  if (!snapshot) {
    return (
      <div style={{
        background: 'rgba(56,189,248,0.04)',
        border: '1px solid rgba(56,189,248,0.18)',
        borderRadius: '8px', padding: '12px 14px', marginBottom: '16px',
      }}>
        <div style={{ fontSize: '10px', color: 'rgba(125,211,252,0.9)', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '4px' }}>
          ORDER FLOW
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Waiting for trade tape and DOM…</div>
      </div>
    )
  }

  const live = snapshot.live
  const available = snapshot.available
  const window = snapshot.shortDelta
  const cum = snapshot.cumDelta
  const pct = Math.max(-1, Math.min(1, window / DELTA_BAR_SCALE))
  const barColor = pct >= 0 ? 'var(--green)' : 'var(--red)'

  // Use the LONG-side view for DOM display: resistance = asks above, support = bids below.
  const dom = live?.long ?? lastAssessment
  const resistance = dom?.resistanceVol ?? 0
  const support = dom?.supportVol ?? 0
  const total = resistance + support
  const askPct = total > 0 ? (resistance / total) * 100 : 50
  const lastTradeAgo = snapshot.lastTradeAgoMs
  const ago = lastTradeAgo == null ? '—' : lastTradeAgo < 1000 ? '<1s' : `${Math.round(lastTradeAgo / 1000)}s`

  return (
    <div style={{
      background: 'rgba(56,189,248,0.04)',
      border: '1px solid rgba(56,189,248,0.18)',
      borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '10px', color: 'rgba(125,211,252,0.9)', letterSpacing: '0.08em', fontWeight: 700 }}>
            ORDER FLOW
          </div>
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
            padding: '1px 6px', borderRadius: '3px',
            background: available ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)',
            color: available ? 'var(--green)' : 'var(--text-dim)',
            border: `1px solid ${available ? 'rgba(0,230,118,0.25)' : 'var(--border)'}`,
          }}>
            {available ? 'LIVE' : 'STALE — FAIL-OPEN'}
          </span>
          {!vetoOn && (
            <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)' }}>
              VETO DISABLED
            </span>
          )}
        </div>
        <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
          last print {ago} · {snapshot.bookLevels} book lvls
        </span>
      </div>

      {/* Delta row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
        <MiniStat
          label="CUM DELTA (today)"
          value={`${cum >= 0 ? '+' : ''}${cum}`}
          color={cum > 0 ? 'var(--green)' : cum < 0 ? 'var(--red)' : undefined}
        />
        <MiniStat
          label="WINDOW Δ (90s)"
          value={`${window >= 0 ? '+' : ''}${window}`}
          color={window > 0 ? 'var(--green)' : window < 0 ? 'var(--red)' : undefined}
        />
      </div>

      {/* Pressure bar (sell ← center → buy) */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '4px' }}>
          <span>SELL PRESSURE</span>
          <span>BUY PRESSURE</span>
        </div>
        <div style={{
          position: 'relative', height: '8px', background: 'rgba(255,255,255,0.05)',
          borderRadius: '4px', border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px', background: 'var(--border)' }} />
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: pct >= 0 ? '50%' : `${50 + pct * 50}%`,
            width: `${Math.abs(pct) * 50}%`,
            background: barColor,
            opacity: 0.85,
          }} />
        </div>
      </div>

      {/* DOM imbalance */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '4px' }}>
          <span>BIDS BELOW {support}</span>
          <span>{resistance} ASKS ABOVE</span>
        </div>
        <div style={{
          position: 'relative', height: '8px', background: 'rgba(255,255,255,0.05)',
          borderRadius: '4px', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex',
        }}>
          <div style={{ width: `${100 - askPct}%`, background: 'var(--green)', opacity: 0.65 }} />
          <div style={{ width: `${askPct}%`, background: 'var(--red)', opacity: 0.65 }} />
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '4px' }}>
          {snapshot.bestBid != null && snapshot.bestAsk != null
            ? `bid ${snapshot.bestBid.toFixed(2)} / ask ${snapshot.bestAsk.toFixed(2)}`
            : 'no quote'}
        </div>
      </div>

      {/* Live two-sided read */}
      {live ? (
        <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(56,189,248,0.15)' }}>
          <div style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '6px' }}>
            IF PRICE BROKE NOW @ {live.refPrice.toFixed(2)}
          </div>
          <VerdictRow side="LONG" assessment={live.long} />
          <div style={{ height: '6px' }} />
          <VerdictRow side="SHORT" assessment={live.short} />
        </div>
      ) : lastAssessment ? (
        <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(56,189,248,0.15)' }}>
          <div style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '6px' }}>
            LAST BREAKOUT ASSESSMENT
          </div>
          <VerdictRow side="LAST" assessment={lastAssessment} />
        </div>
      ) : null}
    </div>
  )
}

function VerdictRow({ side, assessment }: { side: string; assessment: OrderflowAssessment }) {
  const v = VERDICT_STYLES[assessment.verdict]
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 700, width: '46px' }}>{side}</span>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
          padding: '1px 6px', borderRadius: '3px',
          background: `${v.color === 'var(--green)' ? 'rgba(0,230,118,0.15)' : v.color === 'var(--yellow)' ? 'rgba(255,193,7,0.15)' : 'rgba(255,61,61,0.15)'}`,
          color: v.color,
          border: `1px solid ${v.color === 'var(--green)' ? 'rgba(0,230,118,0.3)' : v.color === 'var(--yellow)' ? 'rgba(255,193,7,0.3)' : 'rgba(255,61,61,0.3)'}`,
        }}>
          {v.label}
        </span>
        {!assessment.available && (
          <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontStyle: 'italic' }}>fail-open</span>
        )}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '54px', lineHeight: 1.4 }}>
        {assessment.reasons.join(' · ')}
      </div>
    </div>
  )
}

// ─── VETO FEED ──────────────────────────────────────────────────────────────

function VetoFeed({ vetoes }: { vetoes: { count: number; reasons: string[] } }) {
  if (!vetoes || vetoes.count === 0) return null
  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '8px' }}>
        VETOES TODAY ({vetoes.count})
      </div>
      {vetoes.reasons.map((r, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px',
          padding: '6px 0',
          borderBottom: i < vetoes.reasons.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--red)', letterSpacing: '0.06em' }}>VETO</span>
          <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{r}</span>
        </div>
      ))}
    </div>
  )
}

// ─── CANDLE READ PANEL ──────────────────────────────────────────────────────

const SIGNAL_COLOR: Record<string, string> = {
  bullish: 'var(--green)',
  bearish: 'var(--red)',
  caution: 'var(--yellow)',
  neutral: 'var(--text-secondary)',
}

const VERDICT_COLOR: Record<GateVerdict, string> = {
  confirm: 'var(--green)',
  caution: 'var(--yellow)',
  neutral: 'var(--text-secondary)',
  veto:    'var(--red)',
}

function CandleReadPanel({
  snapshot, patternGate, volumeGate, pendingBreak,
  patternGateOn, volumeGateOn, waitForCloseOn,
}: {
  snapshot: CandleSnapshot | null
  patternGate: PatternGate | null
  volumeGate: VolumeGate | null
  pendingBreak: PendingBreak | null
  patternGateOn: boolean
  volumeGateOn: boolean
  waitForCloseOn: boolean
}) {
  if (!snapshot) {
    return (
      <div style={{
        background: 'rgba(250,204,21,0.04)',
        border: '1px solid rgba(250,204,21,0.18)',
        borderRadius: '8px', padding: '12px 14px', marginBottom: '16px',
      }}>
        <div style={{ fontSize: '10px', color: 'rgba(253,224,71,0.9)', letterSpacing: '0.08em', fontWeight: 700 }}>
          CANDLE READ
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Waiting for trade tape…</div>
      </div>
    )
  }

  const bar = snapshot.latestClosed
  const live = snapshot.live
  const ago = snapshot.lastTradeAgoMs == null ? '—' : snapshot.lastTradeAgoMs < 1000 ? '<1s' : `${Math.round(snapshot.lastTradeAgoMs / 1000)}s`

  return (
    <div style={{
      background: 'rgba(250,204,21,0.04)',
      border: '1px solid rgba(250,204,21,0.18)',
      borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '10px', color: 'rgba(253,224,71,0.95)', letterSpacing: '0.08em', fontWeight: 700 }}>
            CANDLE READ
          </div>
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
            padding: '1px 6px', borderRadius: '3px',
            background: snapshot.available ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)',
            color: snapshot.available ? 'var(--green)' : 'var(--text-dim)',
            border: `1px solid ${snapshot.available ? 'rgba(0,230,118,0.25)' : 'var(--border)'}`,
          }}>
            {snapshot.available ? 'LIVE' : 'STALE — FAIL-OPEN'}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>1-min bars · {snapshot.closedBars} closed</span>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>last print {ago}</span>
      </div>

      {pendingBreak && (
        <div style={{
          background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.3)',
          borderRadius: '6px', padding: '8px 10px', marginBottom: '10px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(125,211,252,0.95)' }}>⏳ ARMED</span>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {pendingBreak.direction} @ {pendingBreak.armedAtPrice.toFixed(2)} — waiting for next 1-min close
          </span>
        </div>
      )}

      {bar && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', marginBottom: '10px' }}>
          <MiniStat label="O" value={bar.open.toFixed(2)} />
          <MiniStat label="H" value={bar.high.toFixed(2)} color="var(--green)" />
          <MiniStat label="L" value={bar.low.toFixed(2)} color="var(--red)" />
          <MiniStat label="C" value={bar.close.toFixed(2)} color={bar.close >= bar.open ? 'var(--green)' : 'var(--red)'} />
          <MiniStat label="VOL" value={String(bar.volume)} />
          <MiniStat label="AVG20" value={snapshot.avgVolume20 > 0 ? snapshot.avgVolume20.toFixed(0) : '—'} />
        </div>
      )}

      {patternGate && (
        <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(250,204,21,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600 }}>PATTERN</span>
            <span style={{
              fontSize: '11px', fontWeight: 700,
              color: patternGate.patternSignal ? SIGNAL_COLOR[patternGate.patternSignal] : 'var(--text-secondary)',
            }}>
              {patternGate.patternName ?? 'none'}
            </span>
            {patternGate.patternStrength != null && (
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{patternGate.patternStrength}%</span>
            )}
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
              padding: '1px 6px', borderRadius: '3px',
              color: VERDICT_COLOR[patternGate.verdict],
              border: `1px solid ${VERDICT_COLOR[patternGate.verdict]}55`,
            }}>
              {patternGate.verdict.toUpperCase()}
            </span>
            {!patternGateOn && (
              <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontStyle: 'italic' }}>gate off</span>
            )}
          </div>
          {patternGate.orbContext && (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {patternGate.orbContext}
            </div>
          )}
        </div>
      )}

      {volumeGate && volumeGate.avgVolume > 0 && (
        <div style={{ paddingTop: '6px', marginTop: '6px', borderTop: '1px solid rgba(250,204,21,0.10)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.06em', fontWeight: 600 }}>VOLUME</span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {volumeGate.breakVolume} vs {volumeGate.avgVolume.toFixed(0)} avg → {volumeGate.ratio.toFixed(2)}×
            </span>
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
              padding: '1px 6px', borderRadius: '3px',
              color: VERDICT_COLOR[volumeGate.verdict],
              border: `1px solid ${VERDICT_COLOR[volumeGate.verdict]}55`,
            }}>
              {volumeGate.verdict.toUpperCase()}
            </span>
            {!volumeGateOn && (
              <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontStyle: 'italic' }}>gate off</span>
            )}
          </div>
        </div>
      )}

      {live && (
        <div style={{ paddingTop: '6px', marginTop: '6px', borderTop: '1px solid rgba(250,204,21,0.10)', fontSize: '10px', color: 'var(--text-dim)' }}>
          live bar: O {live.open.toFixed(2)} · C {live.close.toFixed(2)} · vol {live.volume} · {live.ticks} ticks
          {!waitForCloseOn && <span style={{ marginLeft: '8px', color: 'var(--yellow)', fontStyle: 'italic' }}>wait-for-close OFF</span>}
        </div>
      )}
    </div>
  )
}

// ─── DEBRIEF CARD ───────────────────────────────────────────────────────────

function DebriefCard({ debrief }: { debrief: string | null }) {
  const [open, setOpen] = useState(true)
  if (!debrief) return null
  return (
    <div style={{
      background: 'rgba(99,102,241,0.04)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: '8px', padding: '12px 14px', marginTop: '16px',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'rgba(129,140,248,0.95)', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '10px', letterSpacing: '0.08em', fontWeight: 700 }}>
          {open ? '▾' : '▸'} TODAY'S DEBRIEF
        </span>
      </button>
      {open && (
        <div style={{
          fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55,
          marginTop: '8px', whiteSpace: 'pre-wrap',
        }}>
          {debrief}
        </div>
      )}
    </div>
  )
}
