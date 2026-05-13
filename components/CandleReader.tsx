'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candle {
  open: number
  high: number
  low: number
  close: number
  time: number
  ticks: number
}

interface PatternResult {
  name: string
  emoji: string
  signal: 'bullish' | 'bearish' | 'neutral' | 'caution'
  meaning: string
  orbContext: string
  strength: number
  action: string
}

// ─── Pattern Detection ────────────────────────────────────────────────────────

function detectPattern(candles: Candle[]): PatternResult | null {
  if (candles.length < 1) return null
  const c    = candles[candles.length - 1]
  const prev = candles.length >= 2 ? candles[candles.length - 2] : null
  const prev2 = candles.length >= 3 ? candles[candles.length - 3] : null

  const body        = Math.abs(c.close - c.open)
  const range       = c.high - c.low
  if (range === 0) return null

  const upperWick      = c.high - Math.max(c.open, c.close)
  const lowerWick      = Math.min(c.open, c.close) - c.low
  const bodyRatio      = body / range
  const upperWickRatio = upperWick / range
  const lowerWickRatio = lowerWick / range
  const isBullish      = c.close > c.open
  const isBearish      = c.close < c.open

  // ── Three consecutive momentum candles (strongest ORB confirmation) ──
  if (prev && prev2) {
    const allBull = c.close > c.open && prev.close > prev.open && prev2.close > prev2.open
    const allBear = c.close < c.open && prev.close < prev.open && prev2.close < prev2.open
    const avgBody = (Math.abs(c.close - c.open) + Math.abs(prev.close - prev.open) + Math.abs(prev2.close - prev2.open)) / 3
    const avgRange = ((c.high - c.low) + (prev.high - prev.low) + (prev2.high - prev2.low)) / 3
    if (allBull && avgBody / avgRange > 0.55) {
      return {
        name: '3-Candle Momentum Stack',
        emoji: '🚀',
        signal: 'bullish',
        meaning: 'Three consecutive bullish candles with solid bodies — pure institutional buying program driving price.',
        orbContext: 'THIS is the ORB confirmation pattern. Per the research, 3-4 stacked green candles driving through OR High = institutional commitment. High-probability long entry on next pullback to 50-61.8% Fib.',
        strength: 93,
        action: 'STRONG LONG — wait for Fib pullback entry',
      }
    }
    if (allBear && avgBody / avgRange > 0.55) {
      return {
        name: '3-Candle Sell Stack',
        emoji: '💣',
        signal: 'bearish',
        meaning: 'Three consecutive bearish candles with solid bodies — coordinated institutional selling pressure.',
        orbContext: 'Breakdown confirmed. Sustained below OR Low with 3 stacked red candles = sellers in control. Short on any bounce to 50-61.8% Fib of breakdown move.',
        strength: 93,
        action: 'STRONG SHORT — wait for bounce entry',
      }
    }
  }

  // ── Doji ──
  if (bodyRatio < 0.1) {
    return {
      name: 'Doji',
      emoji: '➕',
      signal: 'neutral',
      meaning: 'Bulls and bears in perfect equilibrium — indecision at this level. Neither side committed.',
      orbContext: 'At OR boundary: HIGH RISK — do NOT enter. Wait for the next candle to break in a clear direction. Doji at OR High/Low often precedes a false breakout.',
      strength: 20,
      action: 'WAIT — no trade until next candle commits',
    }
  }

  // ── Hammer (bullish reversal) ──
  if (lowerWickRatio > 0.55 && upperWickRatio < 0.2 && bodyRatio > 0.05) {
    return {
      name: 'Hammer',
      emoji: '🔨',
      signal: 'bullish',
      meaning: 'Sellers drove price down hard but buyers violently rejected the lows and closed near the top.',
      orbContext: 'Hammer at OR Low = stop-hunt complete. Buyers defended the support aggressively. Look for a long entry on next green confirmation candle.',
      strength: 74,
      action: 'LONG on next green candle confirmation',
    }
  }

  // ── Inverted Hammer / Shooting Star ──
  if (upperWickRatio > 0.55 && lowerWickRatio < 0.2 && bodyRatio > 0.05) {
    const isAfterDown = prev && prev.close < prev.open
    return {
      name: isAfterDown ? 'Inverted Hammer' : 'Shooting Star',
      emoji: isAfterDown ? '🌟' : '⭐',
      signal: 'bearish',
      meaning: isAfterDown
        ? 'After a downtrend, buyers tried to push up but sellers controlled the close — potential reversal signal.'
        : 'Buyers pushed price sharply higher but sellers crushed the move and closed near the open — rejection.',
      orbContext: isAfterDown
        ? 'Wait for confirmation. Needs a strong red candle next to confirm the reversal.'
        : 'Shooting Star at OR High = liquidity sweep trap. Sellers absorbed all buying. Breakout likely failed — exit longs, watch for short.',
      strength: isAfterDown ? 52 : 71,
      action: isAfterDown ? 'WAIT for bearish confirmation' : 'EXIT longs / SHORT on next red candle',
    }
  }

  // ── Bullish Marubozu (pure momentum) ──
  if (bodyRatio > 0.85 && isBullish) {
    return {
      name: 'Bullish Marubozu',
      emoji: '🟩',
      signal: 'bullish',
      meaning: 'Opened at the low, closed at the high — zero wick. Pure institutional buy program with no hesitation.',
      orbContext: 'This is momentum candle #1. Watch for 2-3 more like this above OR High to confirm the ORB. Volume should be 2x average. Do not chase — wait for the Fib pullback.',
      strength: 88,
      action: 'LONG — scale in on 50-61.8% retracement',
    }
  }

  // ── Bearish Marubozu ──
  if (bodyRatio > 0.85 && isBearish) {
    return {
      name: 'Bearish Marubozu',
      emoji: '🟥',
      signal: 'bearish',
      meaning: 'Opened at the high, closed at the low — zero wick. Pure institutional selling with zero buyer resistance.',
      orbContext: 'Breakdown has full institutional conviction. Below OR Low = sellers own this session. Short on any bounce, target 2:1 minimum.',
      strength: 88,
      action: 'SHORT — enter on 50-61.8% bounce',
    }
  }

  // ── Bullish Engulfing ──
  if (prev && isBullish && prev.close < prev.open) {
    const prevBody = Math.abs(prev.close - prev.open)
    if (body > prevBody * 1.0 && bodyRatio > 0.4) {
      return {
        name: 'Bullish Engulfing',
        emoji: '📈',
        signal: 'bullish',
        meaning: 'Current bullish candle fully swallows the prior bearish candle — buyers decisively took control.',
        orbContext: 'After OR pullback: high-probability long re-entry. This is the Fibonacci bounce confirmation you are waiting for. Aligns with 50-61.8% retracement re-entry technique.',
        strength: 82,
        action: 'LONG — confirmation candle printed',
      }
    }
  }

  // ── Bearish Engulfing ──
  if (prev && isBearish && prev.close > prev.open) {
    const prevBody = Math.abs(prev.close - prev.open)
    if (body > prevBody * 1.0 && bodyRatio > 0.4) {
      return {
        name: 'Bearish Engulfing',
        emoji: '📉',
        signal: 'bearish',
        meaning: 'Current bearish candle fully swallows the prior bullish candle — sellers aggressively took control.',
        orbContext: 'OR High rejection confirmed by engulfing. This is the false breakout trap materializing. Exit any longs immediately. Short entry on next candle.',
        strength: 82,
        action: 'EXIT longs / SHORT entry confirmed',
      }
    }
  }

  // ── Inside Bar (consolidation/compression) ──
  if (prev && c.high < prev.high && c.low > prev.low) {
    return {
      name: 'Inside Bar',
      emoji: '📦',
      signal: 'caution',
      meaning: 'Price compressing fully inside prior candle range — market in indecision, energy coiling for a move.',
      orbContext: 'High-probability explosive breakout imminent. The direction of the NEXT candle breaking the inside bar gives the trade signal. Do not anticipate — wait and react.',
      strength: 50,
      action: 'WAIT — trade the breakout of inside bar next candle',
    }
  }

  // ── Pin Bar Long ──
  if (lowerWickRatio > 0.45 && upperWickRatio < 0.25 && bodyRatio < 0.3) {
    return {
      name: 'Pin Bar (Bullish)',
      emoji: '📌',
      signal: 'bullish',
      meaning: 'Long lower wick — price swept lows aggressively but buyers absorbed the selling and closed mid-range.',
      orbContext: 'Lower wick below OR Low = algorithmic stop-hunt complete. Institutions swept retail stops, now buying. Long on next green candle above the pin bar high.',
      strength: 68,
      action: 'LONG above pin bar high on next candle',
    }
  }

  // ── Pin Bar Short ──
  if (upperWickRatio > 0.45 && lowerWickRatio < 0.25 && bodyRatio < 0.3) {
    return {
      name: 'Pin Bar (Bearish)',
      emoji: '📌',
      signal: 'bearish',
      meaning: 'Long upper wick — price swept highs aggressively but sellers rejected and closed mid-range.',
      orbContext: 'Upper wick above OR High = liquidity sweep trap. Breakout buyers got trapped. Short below the pin bar low on next candle confirmation.',
      strength: 68,
      action: 'SHORT below pin bar low on next candle',
    }
  }

  // ── Generic strong directional ──
  if (bodyRatio > 0.62) {
    if (isBullish) {
      return {
        name: 'Strong Bullish Candle',
        emoji: '💚',
        signal: 'bullish',
        meaning: 'Buyers controlling with solid momentum. Body dominates wicks — not a fake move.',
        orbContext: 'Supports long ORB thesis. Look for follow-through next candle. If above OR High, the breakout has legs.',
        strength: 63,
        action: 'HOLD longs / look for continuation',
      }
    } else {
      return {
        name: 'Strong Bearish Candle',
        emoji: '❤️',
        signal: 'bearish',
        meaning: 'Sellers controlling with solid momentum. Bearish body dominates — sellers committed.',
        orbContext: 'Supports short ORB thesis. If below OR Low, breakdown is real. Look for follow-through next candle.',
        strength: 63,
        action: 'HOLD shorts / look for continuation',
      }
    }
  }

  return {
    name: 'Mixed / Indecisive',
    emoji: '↔️',
    signal: 'neutral',
    meaning: 'No clear pattern — price action ambiguous with balanced wicks and body. Market not committed.',
    orbContext: 'Avoid trading until a cleaner pattern forms. Wait for a momentum candle with body > 60% of range to confirm direction.',
    strength: 18,
    action: 'WAIT — no clear edge this candle',
  }
}

// ─── Mini Candle Chart ────────────────────────────────────────────────────────

function MiniCandleChart({
  candles,
  liveCandle,
  orHigh,
  orLow,
}: {
  candles: Candle[]
  liveCandle: Candle | null
  orHigh: number | null
  orLow: number | null
}) {
  const all = [...candles.slice(-6), ...(liveCandle ? [liveCandle] : [])]
  if (all.length === 0) return null

  const prices = all.flatMap(c => [c.high, c.low])
  if (orHigh && orHigh > 0) prices.push(orHigh)
  if (orLow  && orLow  > 0) prices.push(orLow)

  const maxP = Math.max(...prices)
  const minP = Math.min(...prices)
  const priceRange = maxP - minP || 1

  const W = 300; const H = 120
  const padL = 4; const padR = 4; const padT = 12; const padB = 4
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const toY = (p: number) => padT + chartH - ((p - minP) / priceRange) * chartH

  const slotW = chartW / (all.length || 1)
  const bodyW = Math.max(slotW * 0.55, 5)

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {orHigh && orHigh > 0 && (
        <>
          <line x1={padL} y1={toY(orHigh)} x2={W - padR} y2={toY(orHigh)}
            stroke="#22c55e" strokeWidth="1" strokeDasharray="4,3" opacity={0.7} />
          <text x={W - padR - 2} y={toY(orHigh) - 2} fill="#22c55e" fontSize="7"
            textAnchor="end" fontFamily="monospace" opacity={0.85}>OR HIGH</text>
        </>
      )}
      {orLow && orLow > 0 && (
        <>
          <line x1={padL} y1={toY(orLow)} x2={W - padR} y2={toY(orLow)}
            stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" opacity={0.7} />
          <text x={W - padR - 2} y={toY(orLow) + 9} fill="#ef4444" fontSize="7"
            textAnchor="end" fontFamily="monospace" opacity={0.85}>OR LOW</text>
        </>
      )}

      {all.map((c, i) => {
        const isLive = liveCandle && i === all.length - 1
        const cx    = padL + i * slotW + slotW / 2
        const bull  = c.close >= c.open
        const color = bull ? '#22c55e' : '#ef4444'
        const bodyTop = toY(Math.max(c.open, c.close))
        const bodyBot = toY(Math.min(c.open, c.close))
        const bodyH   = Math.max(bodyBot - bodyTop, 1)

        return (
          <g key={i} opacity={isLive ? 0.75 : 1}>
            <line x1={cx} y1={toY(c.high)} x2={cx} y2={toY(c.low)}
              stroke={color} strokeWidth="1.2" />
            <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH}
              fill={color} rx="1"
              fillOpacity={isLive ? 0.5 : 0.85}
              stroke={color} strokeWidth="0.5"
            />
            {isLive && (
              <rect x={cx - bodyW / 2 - 2} y={bodyTop - 2}
                width={bodyW + 4} height={bodyH + 4}
                fill="none" stroke="#facc15" strokeWidth="1" rx="2" opacity={0.7} />
            )}
          </g>
        )
      })}

      {liveCandle && (
        <text x={padL + (all.length - 0.5) * slotW} y={padT - 2}
          fill="#facc15" fontSize="7" textAnchor="middle" fontFamily="monospace">LIVE</text>
      )}
    </svg>
  )
}

// ─── Strength Bar ─────────────────────────────────────────────────────────────

function StrengthBar({ value, signal }: { value: number; signal: PatternResult['signal'] }) {
  const colors = { bullish: '#22c55e', bearish: '#ef4444', neutral: '#6b7280', caution: '#f59e0b' }
  const color = colors[signal]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '4px', background: '#2d2d2d', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          width: `${value}%`, height: '100%', background: color,
          borderRadius: '2px', transition: 'width 0.4s ease',
          boxShadow: `0 0 6px ${color}60`,
        }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color, minWidth: '28px', textAlign: 'right' }}>
        {value}%
      </span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CandleReader({
  orHigh,
  orLow,
}: {
  orHigh?: number | null
  orLow?: number | null
}) {
  const [candles,    setCandles]    = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [pattern,    setPattern]    = useState<PatternResult | null>(null)
  const [connected,  setConnected]  = useState(false)
  const [timeframe,  setTimeframe]  = useState(5)
  const [lastPrice,  setLastPrice]  = useState<number | null>(null)
  const [priceDir,   setPriceDir]   = useState<'up' | 'down' | null>(null)

  const currentCandle = useRef<Candle | null>(null)
  const prevPrice     = useRef<number | null>(null)

  const getIntervalStart = useCallback((ts: number) => {
    const ms = timeframe * 60 * 1000
    return Math.floor(ts / ms) * ms
  }, [timeframe])

  const processTick = useCallback((price: number) => {
    if (price <= 0) return

    if (prevPrice.current !== null) {
      setPriceDir(price > prevPrice.current ? 'up' : price < prevPrice.current ? 'down' : null)
    }
    prevPrice.current = price
    setLastPrice(price)

    const now           = Date.now()
    const intervalStart = getIntervalStart(now)

    if (!currentCandle.current || currentCandle.current.time !== intervalStart) {
      if (currentCandle.current) {
        const completed = { ...currentCandle.current }
        setCandles(prev => {
          const next = [...prev, completed].slice(-12)
          setPattern(detectPattern(next))
          return next
        })
      }
      currentCandle.current = {
        open: price, high: price, low: price, close: price,
        time: intervalStart, ticks: 1,
      }
    } else {
      currentCandle.current = {
        ...currentCandle.current,
        high:  Math.max(currentCandle.current.high, price),
        low:   Math.min(currentCandle.current.low,  price),
        close: price,
        ticks: currentCandle.current.ticks + 1,
      }
    }
    setLiveCandle({ ...currentCandle.current })
  }, [getIntervalStart])

  useEffect(() => {
    setCandles([])
    setLiveCandle(null)
    setPattern(null)
    currentCandle.current = null
    prevPrice.current = null
  }, [timeframe])

  useEffect(() => {
    const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
    es.onopen    = () => setConnected(true)
    es.onerror   = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data)
        if (evt.type === 'connected')    setConnected(true)
        if (evt.type === 'disconnected') setConnected(false)
        if (evt.type === 'quote' && evt.data) {
          // WSQuote shape uses `price` — same field MorningBriefing reads
          const price = Number(evt.data.price || evt.data.lastPrice || 0)
          if (price > 0) processTick(price)
        }
      } catch {}
    }
    return () => es.close()
  }, [processTick])

  const signalConfig = {
    bullish: { color: '#22c55e', bgColor: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',   label: 'BULLISH' },
    bearish: { color: '#ef4444', bgColor: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',   label: 'BEARISH' },
    neutral: { color: '#9ca3af', bgColor: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.25)', label: 'NEUTRAL' },
    caution: { color: '#f59e0b', bgColor: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',  label: 'CAUTION' },
  }
  const sig = pattern ? signalConfig[pattern.signal] : signalConfig.neutral

  const orPos = lastPrice && orHigh && orLow
    ? lastPrice > orHigh ? 'ABOVE OR HIGH' : lastPrice < orLow ? 'BELOW OR LOW' : 'INSIDE OR'
    : null
  const orPosColor = orPos === 'ABOVE OR HIGH' ? '#22c55e' : orPos === 'BELOW OR LOW' ? '#ef4444' : '#9ca3af'

  const priceChangeInCandle = liveCandle ? liveCandle.close - liveCandle.open : 0
  const priceChangeColor = priceChangeInCandle > 0 ? '#22c55e' : priceChangeInCandle < 0 ? '#ef4444' : '#6b7280'

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '0.1em' }}>CANDLE READER</span>
          <span style={{
            fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'IBM Plex Mono, monospace',
            background: connected ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
            color: connected ? '#22c55e' : '#6b7280',
          }}>
            {connected ? '● LIVE' : '○ OFF'}
          </span>
          {orPos && (
            <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'IBM Plex Mono, monospace', background: `${orPosColor}15`, color: orPosColor }}>
              {orPos}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[1, 3, 5].map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer',
              border: '1px solid', borderColor: timeframe === tf ? 'var(--border-bright)' : 'transparent',
              background: timeframe === tf ? 'var(--surface)' : 'transparent',
              color: timeframe === tf ? 'var(--text-primary)' : 'var(--text-dim)', transition: 'all 0.15s',
            }}>{tf}M</button>
          ))}
        </div>
      </div>

      {/* Price ticker */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '26px', fontWeight: '700', letterSpacing: '-0.02em', transition: 'color 0.3s',
          color: priceDir === 'up' ? '#22c55e' : priceDir === 'down' ? '#ef4444' : 'var(--text-primary)',
        }}>
          {lastPrice ? lastPrice.toFixed(2) : '—'}
        </span>
        {priceDir && <span style={{ fontSize: '16px', color: priceDir === 'up' ? '#22c55e' : '#ef4444' }}>{priceDir === 'up' ? '▲' : '▼'}</span>}
        {liveCandle && (
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: priceChangeColor, marginLeft: '4px' }}>
            {priceChangeInCandle >= 0 ? '+' : ''}{priceChangeInCandle.toFixed(1)} pts this candle
          </span>
        )}
      </div>

      {/* Mini chart */}
      <div style={{ background: 'var(--surface)', borderRadius: '8px', padding: '10px 8px 6px', marginBottom: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {(candles.length > 0 || liveCandle) ? (
          <MiniCandleChart candles={candles} liveCandle={liveCandle} orHigh={orHigh ?? null} orLow={orLow ?? null} />
        ) : (
          <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px' }}>
            Waiting for first tick...
          </div>
        )}
        {liveCandle && (
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            {(['open', 'high', 'low', 'close'] as const).map(k => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
                <div style={{
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: k === 'close' ? '700' : '400',
                  color: k === 'close' ? (liveCandle.close >= liveCandle.open ? '#22c55e' : '#ef4444') : k === 'high' ? '#22c55e' : k === 'low' ? '#ef4444' : 'var(--text-secondary)',
                }}>{liveCandle[k].toFixed(0)}</div>
              </div>
            ))}
            <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', paddingLeft: '12px' }}>
              <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.06em' }}>TICKS</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>{liveCandle.ticks}</div>
            </div>
          </div>
        )}
      </div>

      {/* Pattern card */}
      {pattern ? (
        <div style={{ background: sig.bgColor, border: `1px solid ${sig.border}`, borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>{pattern.emoji}</span>
              <div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: '700', color: sig.color }}>{pattern.name}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', marginTop: '1px' }}>Last {candles.length} completed candles analyzed</div>
              </div>
            </div>
            <div style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '4px', background: `${sig.color}20`, color: sig.color, fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', fontWeight: '700', letterSpacing: '0.08em' }}>
              {sig.label}
            </div>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '4px', letterSpacing: '0.06em' }}>SIGNAL STRENGTH</div>
            <StrengthBar value={pattern.strength} signal={pattern.signal} />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.55', margin: '0 0 10px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {pattern.meaning}
          </p>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.08em', marginBottom: '5px' }}>ORB CONTEXT</div>
            <p style={{ fontSize: '12px', color: sig.color, lineHeight: '1.55', margin: 0 }}>{pattern.orbContext}</p>
          </div>
          <div style={{ background: `${sig.color}12`, border: `1px solid ${sig.color}30`, borderRadius: '6px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>⚡</span>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: sig.color, fontWeight: '700' }}>{pattern.action}</span>
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', margin: 0 }}>
            {candles.length === 0 ? 'Accumulating candle data...' : 'Pattern forming — result on candle close...'}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>{candles.length} completed · {timeframe}M candles · MNQ</span>
        <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>Patterns: last 3 candles analyzed</span>
      </div>
    </div>
  )
}
