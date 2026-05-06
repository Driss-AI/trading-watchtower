'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

// ─── ORB BREAKOUT ALERTS ──────────────────────────────────────────────────────
// Monitors NQ price via SSE and alerts when price breaks the Opening Range.
// Designed for the 9:30–10:00 ET Opening Range Breakout strategy.

type BreakoutDirection = 'LONG' | 'SHORT' | null

interface SessionData {
  orHigh?: number
  orLow?: number
  orSize?: number
  decision?: string
  directionBias?: string
  tradeDirection?: string
}

interface MacroBias {
  label: string
  color: string
  preferLong: boolean
  preferShort: boolean
}

export default function ORBAlerts() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [breakout, setBreakout] = useState<BreakoutDirection>(null)
  const [breakoutPrice, setBreakoutPrice] = useState<number | null>(null)
  const [breakoutTime, setBreakoutTime] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [macroBias, setMacroBias] = useState<MacroBias | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const breakoutFiredRef = useRef(false)

  // Fetch today's session data (OR levels)
  const loadSession = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(`/api/sessions?date=${today}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.session) setSession(data.session)
    } catch {}
  }, [])

  // Fetch macro sentiment for bias context
  const loadMacro = useCallback(async () => {
    try {
      const res = await fetch('/api/market-data', { cache: 'no-store' })
      const { briefing } = await res.json()
      if (briefing) {
        const qqBullish = briefing.qqq?.direction === 'bullish'
        const vixLow = briefing.vix?.level < 20
        const preferLong = qqBullish && vixLow
        const preferShort = !qqBullish && briefing.vix?.level > 25
        setMacroBias({
          label: preferLong ? 'Bullish' : preferShort ? 'Bearish' : 'Neutral',
          color: preferLong ? 'var(--green)' : preferShort ? 'var(--red)' : 'var(--yellow)',
          preferLong,
          preferShort,
        })
      }
    } catch {}
  }, [])

  // Load session + macro on mount, refresh every 30s
  useEffect(() => {
    loadSession()
    loadMacro()
    const t = setInterval(() => { loadSession(); loadMacro() }, 30_000)
    return () => clearInterval(t)
  }, [loadSession, loadMacro])

  // SSE stream for live NQ price
  useEffect(() => {
    let cancelled = false
    const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
    esRef.current = es

    es.onopen = () => { if (!cancelled) setStreaming(true) }
    es.onerror = () => { if (!cancelled) setStreaming(false) }
    es.onmessage = (e) => {
      if (cancelled) return
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'quote' && event.data?.price > 0) {
          setLivePrice(event.data.price)
        }
      } catch {}
    }

    return () => {
      cancelled = true
      es.close()
      esRef.current = null
    }
  }, [])

  // Breakout detection logic
  useEffect(() => {
    if (!livePrice || !session?.orHigh || !session?.orLow) return
    if (breakoutFiredRef.current) return

    const now = new Date()
    const nyHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }))

    // Only alert after 10:00 AM ET (ORB window closed)
    if (nyHour < 10) return

    const orHigh = session.orHigh
    const orLow = session.orLow

    if (livePrice > orHigh) {
      breakoutFiredRef.current = true
      setBreakout('LONG')
      setBreakoutPrice(livePrice)
      setBreakoutTime(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
      setDismissed(false)
      playAlert()
    } else if (livePrice < orLow) {
      breakoutFiredRef.current = true
      setBreakout('SHORT')
      setBreakoutPrice(livePrice)
      setBreakoutTime(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
      setDismissed(false)
      playAlert()
    }
  }, [livePrice, session])

  function playAlert() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'square'
      gain.gain.value = 0.3
      osc.start()
      setTimeout(() => { gain.gain.value = 0 }, 150)
      setTimeout(() => { gain.gain.value = 0.3 }, 250)
      setTimeout(() => { gain.gain.value = 0 }, 400)
      setTimeout(() => { gain.gain.value = 0.3 }, 500)
      setTimeout(() => { gain.gain.value = 0; osc.stop() }, 650)
    } catch {}
  }

  // Determine current phase
  const now = new Date()
  const nyTimeStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
  const [nyH, nyM] = nyTimeStr.split(':').map(Number)
  const nyMinutes = nyH * 60 + nyM

  const isPreMarket = nyMinutes < 570
  const isORBWindow = nyMinutes >= 570 && nyMinutes < 600
  const isPostORB = nyMinutes >= 600
  const hasOR = session?.orHigh && session?.orLow && session.orHigh > 0 && session.orLow > 0

  const distToHigh = livePrice && session?.orHigh ? (session.orHigh - livePrice).toFixed(2) : null
  const distToLow = livePrice && session?.orLow ? (livePrice - session.orLow).toFixed(2) : null

  const breakoutAligned = breakout === 'LONG' ? macroBias?.preferLong
    : breakout === 'SHORT' ? macroBias?.preferShort
    : null

  // Active breakout alert
  if (breakout && !dismissed) {
    const isLong = breakout === 'LONG'
    return (
      <div style={{
        background: isLong ? 'var(--green-bg)' : 'var(--red-bg)',
        border: `2px solid ${isLong ? 'var(--green)' : 'var(--red)'}`,
        borderRadius: '12px', padding: '24px 28px', marginBottom: '20px',
        boxShadow: `0 0 40px ${isLong ? 'rgba(0,230,118,0.4)' : 'rgba(255,61,61,0.4)'}`,
        animation: 'orbPulse 2s ease-in-out infinite', position: 'relative',
      }}>
        <style>{`
          @keyframes orbPulse {
            0%, 100% { box-shadow: 0 0 20px ${isLong ? 'rgba(0,230,118,0.3)' : 'rgba(255,61,61,0.3)'}; }
            50% { box-shadow: 0 0 50px ${isLong ? 'rgba(0,230,118,0.6)' : 'rgba(255,61,61,0.6)'}; }
          }
        `}</style>
        <button onClick={() => setDismissed(true)} style={{ position: 'absolute', top: '12px', right: '16px', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '18px', padding: '4px' }}>✕</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{
            width: '70px', height: '70px', borderRadius: '50%',
            background: isLong ? 'var(--green)' : 'var(--red)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '32px', flexShrink: 0,
            boxShadow: `0 0 20px ${isLong ? 'rgba(0,230,118,0.6)' : 'rgba(255,61,61,0.6)'}`,
          }}>{isLong ? '↑' : '↓'}</div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', fontWeight: '700',
              color: isLong ? 'var(--green)' : 'var(--red)', letterSpacing: '-0.02em',
              textShadow: `0 0 12px ${isLong ? 'rgba(0,230,118,0.5)' : 'rgba(255,61,61,0.5)'}`,
            }}>{isLong ? '▲ LONG BREAKOUT' : '▼ SHORT BREAKOUT'}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              NQ broke {isLong ? 'above OR High' : 'below OR Low'} at {breakoutTime} ET · Price: {breakoutPrice?.toFixed(2)}
            </div>
            {macroBias && (
              <div style={{ marginTop: '8px', padding: '6px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>
                <span style={{ color: macroBias.color }}>● {macroBias.label} Macro</span>
                <span style={{ color: 'var(--text-dim)' }}>·</span>
                <span style={{ color: breakoutAligned ? 'var(--green)' : breakoutAligned === false ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                  {breakoutAligned ? '✓ Aligned' : breakoutAligned === false ? '⚠ Counter-trend' : '— Neutral'}
                </span>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
            <div style={{ color: 'var(--green)', marginBottom: '4px' }}>OR High: {session?.orHigh?.toFixed(2)}</div>
            <div style={{ color: 'var(--text-dim)', marginBottom: '4px' }}>Range: {session?.orSize?.toFixed(0) ?? ((session!.orHigh! - session!.orLow!).toFixed(0))} pts</div>
            <div style={{ color: 'var(--red)' }}>OR Low: {session?.orLow?.toFixed(2)}</div>
          </div>
        </div>
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${isLong ? 'var(--green-border)' : 'var(--red-border)'}`, display: 'flex', gap: '12px', alignItems: 'center' }}>
          <a href="/risk" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '600', color: isLong ? 'var(--green)' : 'var(--red)', textDecoration: 'none', padding: '8px 16px', border: `1px solid ${isLong ? 'var(--green-border)' : 'var(--red-border)'}`, borderRadius: '6px', transition: 'all 0.15s' }}>
            ⚡ Open Risk Calculator
          </a>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>Entry auto-populates from live price</span>
        </div>
      </div>
    )
  }

  // Pre-market
  if (isPreMarket) return null

  // ORB window forming
  if (isORBWindow) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--yellow-border)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--yellow)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
        <span style={{ color: 'var(--yellow)', fontWeight: '600' }}>OR FORMING</span>
        <span style={{ color: 'var(--text-dim)' }}>·</span>
        <span style={{ color: 'var(--text-secondary)' }}>Opening range window 9:30–10:00 ET · {livePrice ? `NQ ${livePrice.toFixed(2)}` : 'Connecting...'}</span>
      </div>
    )
  }

  // Post-ORB: no session data
  if (isPostORB && !hasOR) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
        <span style={{ color: 'var(--text-dim)' }}>◈</span>
        <span style={{ color: 'var(--text-secondary)' }}>ORB Alerts need Opening Range data —</span>
        <a href="/session" style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: '600' }}>Set up today&apos;s session →</a>
      </div>
    )
  }

  // Post-ORB: monitoring
  if (isPostORB && hasOR && !breakout) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: streaming ? 'var(--green)' : 'var(--text-dim)', animation: streaming ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
          <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
          <span style={{ color: 'var(--green)', fontWeight: '600' }}>ORB MONITOR</span>
          <span style={{ color: 'var(--text-dim)' }}>·</span>
          <span style={{ color: 'var(--text-secondary)' }}>{livePrice ? `NQ ${livePrice.toFixed(2)}` : 'Connecting...'}</span>
          {livePrice && (
            <>
              <span style={{ color: 'var(--text-dim)' }}>·</span>
              <span style={{ color: parseFloat(distToHigh!) < parseFloat(distToLow!) ? 'var(--green)' : 'var(--red)' }}>
                {parseFloat(distToHigh!) < parseFloat(distToLow!) ? `↑ ${distToHigh} pts to OR High` : `↓ ${distToLow} pts to OR Low`}
              </span>
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', fontSize: '11px' }}>
            <span style={{ color: 'var(--green)' }}>H: {session?.orHigh?.toFixed(2)}</span>
            <span style={{ color: 'var(--red)' }}>L: {session?.orLow?.toFixed(2)}</span>
          </div>
        </div>
        {livePrice && session?.orHigh && session?.orLow && (
          <div style={{ marginTop: '10px', position: 'relative' }}>
            <div style={{ height: '4px', background: 'var(--surface)', borderRadius: '2px', position: 'relative', overflow: 'visible' }}>
              <div style={{ position: 'absolute', left: '10%', right: '10%', height: '100%', background: 'var(--border-bright)', borderRadius: '2px' }} />
              {(() => {
                const range = session.orHigh - session.orLow
                const buffer = range * 0.5
                const min = session.orLow - buffer
                const max = session.orHigh + buffer
                const pct = Math.max(0, Math.min(100, ((livePrice - min) / (max - min)) * 100))
                return <div style={{ position: 'absolute', left: `${pct}%`, top: '-3px', width: '10px', height: '10px', borderRadius: '50%', background: livePrice > session.orHigh ? 'var(--green)' : livePrice < session.orLow ? 'var(--red)' : 'var(--blue)', transform: 'translateX(-5px)', boxShadow: '0 0 6px rgba(0,0,0,0.3)' }} />
              })()}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Breakout dismissed
  if (breakout && dismissed) {
    const isLong = breakout === 'LONG'
    return (
      <div style={{ background: 'var(--card)', border: `1px solid ${isLong ? 'var(--green-border)' : 'var(--red-border)'}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
        <span style={{ color: isLong ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>{isLong ? '▲' : '▼'} {breakout} BREAKOUT</span>
        <span style={{ color: 'var(--text-dim)' }}>at {breakoutTime} ET</span>
        <span style={{ color: 'var(--text-dim)' }}>·</span>
        <span style={{ color: 'var(--text-secondary)' }}>NQ {livePrice?.toFixed(2) ?? '—'}</span>
        <a href="/risk" style={{ marginLeft: 'auto', color: 'var(--blue)', textDecoration: 'none', fontWeight: '600' }}>⚡ Risk Calc →</a>
      </div>
    )
  }

  return null
}
