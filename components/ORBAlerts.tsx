'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

// ─── ORB BREAKOUT ALERTS v4 ───────────────────────────────────────────────────
// v4 adds: candle quality analysis via /api/topstepx/bars
//   - Body strength (how clean the breakout bar is)
//   - OR sweep detection (price faked one side before real move)
//   - Follow-through bar read
//   - Single-sentence verdict: Take it / Wait / High conviction

type BreakoutDirection = 'LONG' | 'SHORT' | null

interface MacroBias {
  label: string
  color: string
  preferLong: boolean
  preferShort: boolean
}

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

interface CandleSignal {
  loading:        boolean
  bodyStrength:   number
  bodyRating:     'strong' | 'moderate' | 'weak'
  orSwept:        boolean
  sweepSide:      'high' | 'low' | null
  followThrough:  boolean | null
  verdict:        'go' | 'caution' | 'wait'
  verdictText:    string
  verdictSub:     string
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getNYTime() {
  const now = new Date()
  const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
  const parts = nyStr.split(', ')[1]?.split(':') ?? []
  const h = parseInt(parts[0]) || 0
  const m = parseInt(parts[1]) || 0
  return { h, m, totalMin: h * 60 + m }
}

function todayKey() {
  return `orb_${new Date().toISOString().split('T')[0]}`
}

function saveToLocal(high: number, low: number) {
  try { localStorage.setItem(todayKey(), JSON.stringify({ high, low, ts: Date.now() })) } catch {}
}

function loadFromLocal(): { high: number; low: number } | null {
  try {
    const raw = localStorage.getItem(todayKey())
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data.high > 0 && data.low > 0) return data
  } catch {}
  return null
}

// ─── CANDLE ANALYSIS ──────────────────────────────────────────────────────────
function getBarETHour(isoStr: string): { h: number; m: number } {
  try {
    const d = new Date(isoStr)
    const etStr = d.toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const [hh, mm] = etStr.split(':').map(Number)
    return { h: hh, m: mm }
  } catch { return { h: 0, m: 0 } }
}

function analyseBars(
  bars: Bar[],
  direction: 'LONG' | 'SHORT',
  orHigh: number,
  orLow: number
): Omit<CandleSignal, 'loading'> {
  const sorted = [...bars].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
  )

  // Separate OR bars (9:30-9:55 ET) from trade-window bars (10:00+ ET)
  const orBars    = sorted.filter(b => { const { h, m } = getBarETHour(b.t); return h === 9 && m >= 30 })
  const tradeBars = sorted.filter(b => getBarETHour(b.t).h >= 10)

  const breakoutBar   = tradeBars[0] ?? sorted[sorted.length - 1]
  const followBar     = tradeBars[1] ?? null

  // Body strength: how much of the bar range is solid body (vs wicks)
  const barRange   = breakoutBar ? (breakoutBar.h - breakoutBar.l) : 0
  const barBody    = breakoutBar ? Math.abs(breakoutBar.c - breakoutBar.o) : 0
  const bodyStrength = barRange > 0 ? (barBody / barRange) * 100 : 0
  const bodyRating: 'strong' | 'moderate' | 'weak' =
    bodyStrength >= 70 ? 'strong' : bodyStrength >= 40 ? 'moderate' : 'weak'

  // OR sweep: did any OR candle spike beyond the OR boundary then close back inside?
  // SHORT breakout: sweep = OR bar spiked above orHigh (flushed longs) then reversed down
  // LONG breakout:  sweep = OR bar dipped below orLow (flushed shorts) then reversed up
  const SWEEP_PTS = 1.5
  let orSwept   = false
  let sweepSide: 'high' | 'low' | null = null

  for (const bar of orBars) {
    if (direction === 'SHORT' && bar.h > orHigh + SWEEP_PTS && bar.c < orHigh) {
      orSwept = true; sweepSide = 'high'
    }
    if (direction === 'LONG'  && bar.l < orLow  - SWEEP_PTS && bar.c > orLow) {
      orSwept = true; sweepSide = 'low'
    }
  }

  // Follow-through: next 5-min bar after breakout — did it keep going?
  const followThrough: boolean | null = followBar
    ? (direction === 'LONG' ? followBar.c > followBar.o : followBar.c < followBar.o)
    : null

  // Verdict
  let verdict: 'go' | 'caution' | 'wait'
  let verdictText: string
  let verdictSub: string

  if (orSwept && bodyRating !== 'weak') {
    verdict     = 'go'
    verdictText = 'High conviction — take the trade'
    verdictSub  = 'OR sweep + clean reversal = institutional move.'
  } else if (bodyRating === 'strong' && !orSwept) {
    verdict     = 'go'
    verdictText = 'Take the trade'
    verdictSub  = 'Clean institutional break. Low trap risk.'
  } else if (bodyRating === 'weak' && !orSwept) {
    verdict     = 'wait'
    verdictText = 'Wait for next bar'
    verdictSub  = 'Wick rejection — possible liquidity trap.'
  } else if (bodyRating === 'moderate') {
    verdict     = 'caution'
    verdictText = 'Proceed with caution'
    verdictSub  = 'Moderate body. Watch for confirmation next bar.'
  } else {
    verdict     = 'caution'
    verdictText = 'Mixed signals — size down'
    verdictSub  = 'Sweep present but body is weak. High risk.'
  }

  return { bodyStrength, bodyRating, orSwept, sweepSide, followThrough, verdict, verdictText, verdictSub }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function ORBAlerts() {
  const [orHigh,        setOrHigh]        = useState<number | null>(null)
  const [orLow,         setOrLow]         = useState<number | null>(null)
  const [orLocked,      setOrLocked]      = useState(false)
  const [livePrice,     setLivePrice]     = useState<number | null>(null)
  const [streaming,     setStreaming]     = useState(false)
  const [breakout,      setBreakout]      = useState<BreakoutDirection>(null)
  const [breakoutPrice, setBreakoutPrice] = useState<number | null>(null)
  const [breakoutTime,  setBreakoutTime]  = useState<string | null>(null)
  const [dismissed,     setDismissed]     = useState(false)
  const [macroBias,     setMacroBias]     = useState<MacroBias | null>(null)
  const [phase,         setPhase]         = useState<'pre' | 'forming' | 'monitoring' | 'closed'>('pre')
  const [candleSignal,  setCandleSignal]  = useState<CandleSignal | null>(null)

  const breakoutFiredRef = useRef(false)
  const orHighRef        = useRef<number | null>(null)
  const orLowRef         = useRef<number | null>(null)
  const signalFetchedRef = useRef(false)

  // ─── LOAD OR: DB first, then localStorage ─────────────────────────────────
  useEffect(() => {
    async function loadOR() {
      try {
        const today = new Date().toISOString().split('T')[0]
        const res  = await fetch(`/api/sessions?date=${today}`, { cache: 'no-store' })
        const data = await res.json()
        if (data.session?.orHigh && data.session?.orLow && data.session.orHigh > 0) {
          setOrHigh(data.session.orHigh)
          setOrLow(data.session.orLow)
          orHighRef.current = data.session.orHigh
          orLowRef.current  = data.session.orLow
          setOrLocked(true)
          return
        }
      } catch {}
      const local = loadFromLocal()
      if (local) {
        setOrHigh(local.high)
        setOrLow(local.low)
        orHighRef.current = local.high
        orLowRef.current  = local.low
        const ny = getNYTime()
        if (ny.totalMin >= 600) {
          setOrLocked(true)
          saveORtoDB(local.high, local.low)
        }
      }
    }
    loadOR()
  }, [])

  // ─── MACRO BIAS ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadMacro() {
      try {
        const res = await fetch('/api/market-data', { cache: 'no-store' })
        const { briefing } = await res.json()
        if (briefing) {
          const qqBullish = briefing.qqq?.direction === 'bullish'
          const vixLow    = briefing.vix?.level < 20
          setMacroBias({
            label:      qqBullish && vixLow ? 'Bullish' : !qqBullish && briefing.vix?.level > 25 ? 'Bearish' : 'Neutral',
            color:      qqBullish && vixLow ? 'var(--green)' : !qqBullish && briefing.vix?.level > 25 ? 'var(--red)' : 'var(--yellow)',
            preferLong: qqBullish && vixLow,
            preferShort: !qqBullish && briefing.vix?.level > 25,
          })
        }
      } catch {}
    }
    loadMacro()
    const t = setInterval(loadMacro, 60_000)
    return () => clearInterval(t)
  }, [])

  // ─── PHASE TRACKER ───────────────────────────────────────────────────────
  useEffect(() => {
    function updatePhase() {
      const ny = getNYTime()
      if      (ny.totalMin < 570) setPhase('pre')
      else if (ny.totalMin < 600) setPhase('forming')
      else if (ny.totalMin < 660) setPhase('monitoring')
      else                         setPhase('closed')
    }
    updatePhase()
    const t = setInterval(updatePhase, 1000)
    return () => clearInterval(t)
  }, [])

  // ─── LOCK OR at 10:00 ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'monitoring' && !orLocked && orHighRef.current && orLowRef.current) {
      setOrHigh(orHighRef.current)
      setOrLow(orLowRef.current)
      setOrLocked(true)
      saveToLocal(orHighRef.current, orLowRef.current)
      saveORtoDB(orHighRef.current, orLowRef.current)
    }
  }, [phase, orLocked])

  // ─── SSE STREAM ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
    es.onopen    = () => { if (!cancelled) setStreaming(true) }
    es.onerror   = () => { if (!cancelled) setStreaming(false) }
    es.onmessage = (e) => {
      if (cancelled) return
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'quote' && event.data?.price > 0) {
          const price = event.data.price
          setLivePrice(price)
          const ny = getNYTime()
          if (ny.totalMin >= 570 && ny.totalMin < 600) {
            let changed = false
            if (orHighRef.current === null || price > orHighRef.current) {
              orHighRef.current = price; setOrHigh(price); changed = true
            }
            if (orLowRef.current === null || price < orLowRef.current) {
              orLowRef.current = price; setOrLow(price); changed = true
            }
            if (changed && orHighRef.current && orLowRef.current) {
              saveToLocal(orHighRef.current, orLowRef.current)
            }
          }
        }
      } catch {}
    }
    return () => { cancelled = true; es.close() }
  }, [])

  // ─── CANDLE SIGNAL FETCH ─────────────────────────────────────────────────
  const fetchCandleSignal = useCallback(async (dir: 'LONG' | 'SHORT', high: number, low: number) => {
    if (signalFetchedRef.current) return
    signalFetchedRef.current = true
    setCandleSignal({ loading: true, bodyStrength: 0, bodyRating: 'weak', orSwept: false, sweepSide: null, followThrough: null, verdict: 'caution', verdictText: '', verdictSub: '' })
    try {
      const res = await fetch('/api/topstepx/bars?symbol=MNQ&period=orwindow', { cache: 'no-store' })
      const { bars } = await res.json()
      if (bars && bars.length > 0) {
        const analysis = analyseBars(bars as Bar[], dir, high, low)
        setCandleSignal({ loading: false, ...analysis })
        // Re-fetch in 5 min to pick up the follow-through bar
        setTimeout(async () => {
          try {
            const r2  = await fetch('/api/topstepx/bars?symbol=MNQ&period=orwindow', { cache: 'no-store' })
            const d2  = await r2.json()
            if (d2.bars?.length) {
              const a2 = analyseBars(d2.bars as Bar[], dir, high, low)
              setCandleSignal({ loading: false, ...a2 })
            }
          } catch {}
        }, 5 * 60 * 1000)
      } else {
        setCandleSignal(prev => prev ? { ...prev, loading: false } : null)
      }
    } catch {
      setCandleSignal(prev => prev ? { ...prev, loading: false } : null)
    }
  }, [])

  // ─── BREAKOUT DETECTION ──────────────────────────────────────────────────
  useEffect(() => {
    if (!livePrice || !orLocked || !orHigh || !orLow) return
    if (breakoutFiredRef.current) return
    if (phase !== 'monitoring') return
    const BUFFER = 2
    if (livePrice > orHigh + BUFFER) {
      breakoutFiredRef.current = true
      setBreakout('LONG')
      setBreakoutPrice(livePrice)
      setBreakoutTime(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
      setDismissed(false)
      playAlert()
      fetchCandleSignal('LONG', orHigh, orLow)
    } else if (livePrice < orLow - BUFFER) {
      breakoutFiredRef.current = true
      setBreakout('SHORT')
      setBreakoutPrice(livePrice)
      setBreakoutTime(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
      setDismissed(false)
      playAlert()
      fetchCandleSignal('SHORT', orHigh, orLow)
    }
  }, [livePrice, orLocked, orHigh, orLow, phase, fetchCandleSignal])

  // ─── SAVE OR TO DB ───────────────────────────────────────────────────────
  async function saveORtoDB(high: number, low: number) {
    try {
      const today    = new Date().toISOString().split('T')[0]
      const checkRes = await fetch(`/api/sessions?date=${today}`, { cache: 'no-store' })
      const { session } = await checkRes.json()
      const payload: Record<string, any> = {
        date:               today,
        market:             session?.market             || 'MNQ',
        orHigh:             high,
        orLow:              low,
        orSize:             parseFloat((high - low).toFixed(2)),
        directionBias:      session?.directionBias      || 'neutral',
        tradeDirection:     session?.tradeDirection     || 'LONG',
        hasHighImpactNews:  session?.hasHighImpactNews  ?? false,
        vixLevel:           session?.vixLevel           ?? 0,
        vixExtreme:         session?.vixExtreme         ?? false,
        qqpAligned:         session?.qqpAligned         ?? true,
        cleanRoomToTarget:  session?.cleanRoomToTarget  ?? true,
        us10yAgainst:       session?.us10yAgainst       ?? false,
        dxyAgainst:         session?.dxyAgainst         ?? false,
      }
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {}
  }

  function playAlert() {
    try {
      const ctx  = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880; osc.type = 'square'; gain.gain.value = 0.3
      osc.start()
      setTimeout(() => { gain.gain.value = 0 }, 150)
      setTimeout(() => { gain.gain.value = 0.3 }, 250)
      setTimeout(() => { gain.gain.value = 0 }, 400)
      setTimeout(() => { gain.gain.value = 0.3 }, 500)
      setTimeout(() => { gain.gain.value = 0; osc.stop() }, 650)
    } catch {}
  }

  // ─── COMPUTED ────────────────────────────────────────────────────────────
  const orSize        = orHigh && orLow ? orHigh - orLow : null
  const distToHigh    = livePrice && orHigh ? (orHigh - livePrice) : null
  const distToLow     = livePrice && orLow  ? (livePrice - orLow)  : null
  const breakoutAligned = breakout === 'LONG'
    ? macroBias?.preferLong
    : breakout === 'SHORT' ? macroBias?.preferShort : null

  // ─── CANDLE SIGNAL CARD ───────────────────────────────────────────────────
  function CandleCard({ dir }: { dir: 'LONG' | 'SHORT' }) {
    const color  = dir === 'LONG' ? 'var(--green)' : 'var(--red)'
    const border = dir === 'LONG' ? 'var(--green-border)' : 'var(--red-border)'

    if (!candleSignal) return null

    if (candleSignal.loading) {
      return (
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: `1px solid ${border}`, fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>↻</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          Analysing candle structure...
        </div>
      )
    }

    const { bodyStrength, bodyRating, orSwept, sweepSide, followThrough, verdict, verdictText, verdictSub } = candleSignal

    const bodyColor    = bodyRating === 'strong' ? 'var(--green)' : bodyRating === 'moderate' ? 'var(--yellow)' : 'var(--red)'
    const sweepColor   = orSwept ? 'var(--green)' : 'var(--text-secondary)'
    const followColor  = followThrough === true ? 'var(--green)' : followThrough === false ? 'var(--red)' : 'var(--text-dim)'
    const verdictColor = verdict === 'go' ? 'var(--green)' : verdict === 'caution' ? 'var(--yellow)' : 'var(--red)'
    const verdictBg    = verdict === 'go' ? 'rgba(0,230,118,0.12)' : verdict === 'caution' ? 'rgba(255,193,7,0.12)' : 'rgba(255,61,61,0.12)'
    const verdictBorder= verdict === 'go' ? 'var(--green-border)' : verdict === 'caution' ? 'var(--yellow-border)' : 'var(--red-border)'
    const verdictIcon  = verdict === 'go' ? '✓' : verdict === 'caution' ? '⚠' : '✕'

    return (
      <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${border}` }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '10px' }}>
          CANDLE SIGNAL
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px' }}>Body strength</div>
            <div style={{ fontSize: '13px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace', color: bodyColor }}>
              {bodyStrength.toFixed(0)}%
            </div>
            <div style={{ fontSize: '10px', color: bodyColor, opacity: 0.8, textTransform: 'capitalize' }}>{bodyRating}</div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px' }}>OR sweep</div>
            <div style={{ fontSize: '13px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace', color: sweepColor }}>
              {orSwept ? 'Yes' : 'No'}
            </div>
            <div style={{ fontSize: '10px', color: sweepColor, opacity: 0.8 }}>
              {orSwept ? (sweepSide === 'high' ? 'High swept' : 'Low swept') : 'Clean OR'}
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px' }}>Follow-through</div>
            <div style={{ fontSize: '13px', fontWeight: '700', fontFamily: 'IBM Plex Mono, monospace', color: followColor }}>
              {followThrough === null ? '—' : followThrough ? 'Yes' : 'No'}
            </div>
            <div style={{ fontSize: '10px', color: followColor, opacity: 0.8 }}>
              {followThrough === null ? 'Next bar pending' : followThrough ? 'Confirming' : 'Fading'}
            </div>
          </div>
        </div>

        <div style={{ background: verdictBg, border: `1px solid ${verdictBorder}`, borderRadius: '6px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px', color: verdictColor, fontWeight: '700', flexShrink: 0 }}>{verdictIcon}</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '700', color: verdictColor, fontFamily: 'IBM Plex Mono, monospace' }}>
              {verdictText}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>{verdictSub}</div>
          </div>
        </div>
      </div>
    )
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  if (phase === 'pre') return null

  // ACTIVE BREAKOUT ALERT
  if (breakout && !dismissed) {
    const isLong = breakout === 'LONG'
    const color  = isLong ? 'var(--green)' : 'var(--red)'
    const border = isLong ? 'var(--green-border)' : 'var(--red-border)'
    return (
      <div style={{ background: isLong ? 'var(--green-bg)' : 'var(--red-bg)', border: `2px solid ${color}`, borderRadius: '12px', padding: '24px 28px', marginBottom: '20px', boxShadow: `0 0 40px ${isLong ? 'rgba(0,230,118,0.4)' : 'rgba(255,61,61,0.4)'}`, animation: 'orbPulse 2s ease-in-out infinite', position: 'relative' }}>
        <style>{`@keyframes orbPulse { 0%,100% { box-shadow: 0 0 20px ${isLong ? 'rgba(0,230,118,0.3)' : 'rgba(255,61,61,0.3)'}; } 50% { box-shadow: 0 0 50px ${isLong ? 'rgba(0,230,118,0.6)' : 'rgba(255,61,61,0.6)'}; } } @keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <button onClick={() => setDismissed(true)} style={{ position: 'absolute', top: '12px', right: '16px', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '18px' }}>✕</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ width: '70px', height: '70px', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', flexShrink: 0, boxShadow: `0 0 20px ${isLong ? 'rgba(0,230,118,0.6)' : 'rgba(255,61,61,0.6)'}` }}>{isLong ? '↑' : '↓'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', fontWeight: '700', color, letterSpacing: '-0.02em', textShadow: `0 0 12px ${isLong ? 'rgba(0,230,118,0.5)' : 'rgba(255,61,61,0.5)'}` }}>{isLong ? '▲ LONG BREAKOUT' : '▼ SHORT BREAKOUT'}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>NQ broke {isLong ? 'above OR High' : 'below OR Low'} at {breakoutTime} ET · Price: {breakoutPrice?.toFixed(2)}</div>
            {macroBias && (
              <div style={{ marginTop: '8px', padding: '6px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>
                <span style={{ color: macroBias.color }}>● {macroBias.label} Macro</span>
                <span style={{ color: 'var(--text-dim)' }}>·</span>
                <span style={{ color: breakoutAligned ? 'var(--green)' : breakoutAligned === false ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                  {breakoutAligned ? '✓ Aligned — GO' : breakoutAligned === false ? '⚠ Counter-trend — caution' : '— Neutral'}
                </span>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
            <div style={{ color: 'var(--green)', marginBottom: '4px' }}>OR High: {orHigh?.toFixed(2)}</div>
            <div style={{ color: 'var(--text-dim)', marginBottom: '4px' }}>Range: {orSize?.toFixed(0)} pts</div>
            <div style={{ color: 'var(--red)' }}>OR Low: {orLow?.toFixed(2)}</div>
          </div>
        </div>

        <CandleCard dir={breakout} />

        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${border}`, display: 'flex', gap: '12px', alignItems: 'center' }}>
          <a href="/risk" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '600', color, textDecoration: 'none', padding: '8px 16px', border: `1px solid ${border}`, borderRadius: '6px' }}>⚡ Open Risk Calculator</a>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>Entry = live price · Stop = {isLong ? 'OR Low' : 'OR High'} · Target = 2:1</span>
        </div>
      </div>
    )
  }

  // OR FORMING
  if (phase === 'forming') {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--yellow-border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', marginBottom: orHigh ? '10px' : 0 }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--yellow)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
          <span style={{ color: 'var(--yellow)', fontWeight: '600' }}>OR FORMING</span>
          <span style={{ color: 'var(--text-dim)' }}>·</span>
          <span style={{ color: 'var(--text-secondary)' }}>Building range from live ticks · {livePrice ? `NQ ${livePrice.toFixed(2)}` : 'Connecting...'}</span>
          {streaming && <span style={{ marginLeft: 'auto', color: 'var(--green)', fontSize: '10px' }}>● LIVE</span>}
        </div>
        {orHigh && orLow && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>
              <span><span style={{ color: 'var(--text-dim)' }}>High:</span> <span style={{ color: 'var(--green)', fontWeight: '700' }}>{orHigh.toFixed(2)}</span></span>
              <span><span style={{ color: 'var(--text-dim)' }}>Low:</span> <span style={{ color: 'var(--red)', fontWeight: '700' }}>{orLow.toFixed(2)}</span></span>
              <span><span style={{ color: 'var(--text-dim)' }}>Size:</span> <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{(orHigh - orLow).toFixed(0)} pts</span></span>
            </div>
            <div style={{ flex: 1, height: '4px', background: 'var(--surface)', borderRadius: '2px', position: 'relative', overflow: 'visible' }}>
              <div style={{ position: 'absolute', left: '10%', right: '10%', height: '100%', background: 'var(--yellow)', opacity: 0.3, borderRadius: '2px' }} />
              {livePrice && (() => {
                const range = orHigh - orLow || 1; const buffer = range * 0.3
                const min = orLow - buffer; const max = orHigh + buffer
                const pct = Math.max(0, Math.min(100, ((livePrice - min) / (max - min)) * 100))
                return <div style={{ position: 'absolute', left: `${pct}%`, top: '-3px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--yellow)', transform: 'translateX(-5px)', boxShadow: '0 0 6px rgba(0,0,0,0.3)' }} />
              })()}
            </div>
          </div>
        )}
      </div>
    )
  }

  // MONITORING — OR locked, no breakout yet
  if (phase === 'monitoring' && orLocked && orHigh && orLow && !breakout) {
    const closerToHigh = distToHigh !== null && distToLow !== null && Math.abs(distToHigh) < Math.abs(distToLow)
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: streaming ? 'var(--green)' : 'var(--text-dim)', animation: streaming ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
          <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
          <span style={{ color: 'var(--green)', fontWeight: '600' }}>ORB MONITOR</span>
          <span style={{ color: 'var(--text-dim)' }}>·</span>
          <span style={{ color: 'var(--text-secondary)' }}>{livePrice ? `NQ ${livePrice.toFixed(2)}` : 'Connecting...'}</span>
          {livePrice && distToHigh !== null && distToLow !== null && (
            <><span style={{ color: 'var(--text-dim)' }}>·</span><span style={{ color: closerToHigh ? 'var(--green)' : 'var(--red)', fontWeight: '600' }}>{closerToHigh ? `↑ ${distToHigh.toFixed(1)} to High` : `↓ ${distToLow.toFixed(1)} to Low`}</span></>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', fontSize: '11px' }}>
            <span style={{ color: 'var(--green)' }}>H: {orHigh.toFixed(2)}</span>
            <span style={{ color: 'var(--text-dim)' }}>{orSize?.toFixed(0)}pts</span>
            <span style={{ color: 'var(--red)' }}>L: {orLow.toFixed(2)}</span>
          </div>
        </div>
        {livePrice && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ height: '6px', background: 'var(--surface)', borderRadius: '3px', position: 'relative', overflow: 'visible' }}>
              <div style={{ position: 'absolute', left: '15%', right: '15%', height: '100%', background: 'var(--border-bright)', borderRadius: '3px' }} />
              {(() => {
                const range = orHigh - orLow; const buffer = range * 0.7
                const min = orLow - buffer; const max = orHigh + buffer
                const pct = Math.max(0, Math.min(100, ((livePrice - min) / (max - min)) * 100))
                const inRange = livePrice >= orLow && livePrice <= orHigh
                return <div style={{ position: 'absolute', left: `${pct}%`, top: '-4px', width: '14px', height: '14px', borderRadius: '50%', background: inRange ? 'var(--blue)' : livePrice > orHigh ? 'var(--green)' : 'var(--red)', transform: 'translateX(-7px)', boxShadow: `0 0 8px ${inRange ? 'rgba(41,121,255,0.5)' : livePrice > orHigh ? 'rgba(0,230,118,0.5)' : 'rgba(255,61,61,0.5)'}`, transition: 'left 0.3s ease' }} />
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '9px' }}>
              <span style={{ color: 'var(--red)' }}>SHORT ←</span>
              <span style={{ color: 'var(--text-dim)' }}>range</span>
              <span style={{ color: 'var(--green)' }}>→ LONG</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // NO OR DATA
  if ((phase === 'monitoring' || phase === 'closed') && !orLocked) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
        <span style={{ color: 'var(--text-dim)' }}>◈</span>
        <span style={{ color: 'var(--text-secondary)' }}>ORB: No OR captured today — </span>
        <a href="/session" style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: '600' }}>Enter OR manually →</a>
      </div>
    )
  }

  // DISMISSED — compact bar
  if (breakout && dismissed) {
    const isLong = breakout === 'LONG'
    return (
      <div style={{ background: 'var(--card)', border: `1px solid ${isLong ? 'var(--green-border)' : 'var(--red-border)'}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
        <span style={{ color: isLong ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>{isLong ? '▲' : '▼'} {breakout} BREAKOUT</span>
        <span style={{ color: 'var(--text-dim)' }}>at {breakoutTime} ET</span>
        {candleSignal && !candleSignal.loading && (
          <>
            <span style={{ color: 'var(--text-dim)' }}>·</span>
            <span style={{ color: candleSignal.verdict === 'go' ? 'var(--green)' : candleSignal.verdict === 'caution' ? 'var(--yellow)' : 'var(--red)', fontWeight: '600', fontSize: '11px' }}>
              {candleSignal.verdict === 'go' ? '✓' : candleSignal.verdict === 'caution' ? '⚠' : '✕'} {candleSignal.verdictText}
            </span>
          </>
        )}
        <span style={{ color: 'var(--text-secondary)', marginLeft: 'auto' }}>NQ {livePrice?.toFixed(2) ?? '—'}</span>
        <a href="/risk" style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: '600' }}>⚡ Risk Calc →</a>
      </div>
    )
  }

  return null
}
