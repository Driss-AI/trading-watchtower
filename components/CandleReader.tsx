'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { detectPattern, type Candle, type PatternResult } from '@/lib/patterns'

export default function CandleReader({ orHigh, orLow }: { orHigh?: number | null; orLow?: number | null }) {
  const [candles,     setCandles]     = useState<Candle[]>([])
  const [liveCandle,  setLiveCandle]  = useState<Candle | null>(null)
  const [connected,   setConnected]   = useState(false)
  const [timeframe,   setTimeframe]   = useState(5)
  const [lastPrice,   setLastPrice]   = useState<number | null>(null)
  const [priceDir,    setPriceDir]    = useState<'up' | 'down' | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const currentCandle = useRef<Candle | null>(null)
  const prevPrice     = useRef<number | null>(null)
  const tickBuffer    = useRef<{ price: number; ts: number }[]>([])

  const getIntervalStart = useCallback((ts: number) =>
    Math.floor(ts / (timeframe * 60 * 1000)) * (timeframe * 60 * 1000)
  , [timeframe])

  const buildCandlesFromTicks = useCallback((ticks: { price: number; ts: number }[], tf: number) => {
    const intervalMs = tf * 60 * 1000
    const getStart = (ts: number) => Math.floor(ts / intervalMs) * intervalMs
    const candleMap = new Map<number, Candle>()
    for (const { price, ts } of ticks) {
      const start = getStart(ts)
      const existing = candleMap.get(start)
      if (!existing) {
        candleMap.set(start, { open: price, high: price, low: price, close: price, time: start, ticks: 1 })
      } else {
        existing.high = Math.max(existing.high, price)
        existing.low = Math.min(existing.low, price)
        existing.close = price
        existing.ticks++
      }
    }
    const sorted = Array.from(candleMap.values()).sort((a, b) => a.time - b.time)
    if (sorted.length === 0) return { completed: [], live: null }
    const live = sorted.pop()!
    return { completed: sorted.slice(-20), live }
  }, [])

  const processTick = useCallback((price: number) => {
    if (price <= 0) return
    if (prevPrice.current !== null) setPriceDir(price > prevPrice.current ? 'up' : price < prevPrice.current ? 'down' : null)
    prevPrice.current = price
    setLastPrice(price)
    tickBuffer.current.push({ price, ts: Date.now() })
    // Keep last 2 hours of ticks
    const cutoff = Date.now() - 2 * 60 * 60 * 1000
    if (tickBuffer.current.length > 0 && tickBuffer.current[0].ts < cutoff) {
      tickBuffer.current = tickBuffer.current.filter(t => t.ts >= cutoff)
    }
    const intervalStart = getIntervalStart(Date.now())
    if (!currentCandle.current || currentCandle.current.time !== intervalStart) {
      if (currentCandle.current) {
        const completed = { ...currentCandle.current }
        setCandles(prev => [...prev, completed].slice(-20))
      }
      currentCandle.current = { open: price, high: price, low: price, close: price, time: intervalStart, ticks: 1 }
    } else {
      currentCandle.current = { ...currentCandle.current, high: Math.max(currentCandle.current.high, price), low: Math.min(currentCandle.current.low, price), close: price, ticks: currentCandle.current.ticks + 1 }
    }
    setLiveCandle({ ...currentCandle.current })
  }, [getIntervalStart])

  useEffect(() => {
    setSelectedIdx(null)
    if (tickBuffer.current.length === 0) {
      setCandles([]); setLiveCandle(null)
      currentCandle.current = null
      return
    }
    const { completed, live } = buildCandlesFromTicks(tickBuffer.current, timeframe)
    setCandles(completed)
    setLiveCandle(live)
    currentCandle.current = live
  }, [timeframe, buildCandlesFromTicks])

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
          const price = Number(evt.data.price || evt.data.lastPrice || 0)
          if (price > 0) processTick(price)
        }
      } catch {}
    }
    return () => es.close()
  }, [processTick])

  const allCandles     = [...candles, ...(liveCandle ? [liveCandle] : [])]
  const visibleCandles = allCandles.slice(-12)

  // SVG uses a fixed internal coordinate space (viewBox) so it scales to any column width
  const VB_W = 600; const VB_H = 200
  const PAD_L = 6; const PAD_R = 40; const PAD_T = 18; const PAD_B = 22
  const innerW = VB_W - PAD_L - PAD_R
  const innerH = VB_H - PAD_T - PAD_B

  const prices: number[] = []
  visibleCandles.forEach(c => prices.push(c.high, c.low))
  if (orHigh && orHigh > 0) prices.push(orHigh)
  if (orLow  && orLow  > 0) prices.push(orLow)
  const rawMin = prices.length ? Math.min(...prices) : 0
  const rawMax = prices.length ? Math.max(...prices) : 1
  const margin = (rawMax - rawMin) * 0.12
  // Clamp a minimum visible range so a quiet/forming candle (tiny high-low
  // spread) doesn't auto-zoom to fill the whole chart height. Expand
  // symmetrically around the midpoint when the natural span is too small.
  const MIN_RANGE = 25 // points
  let priceMin = rawMin - margin
  let priceMax = rawMax + margin
  if (priceMax - priceMin < MIN_RANGE) {
    const mid = (priceMax + priceMin) / 2
    priceMin = mid - MIN_RANGE / 2
    priceMax = mid + MIN_RANGE / 2
  }
  const priceRange = priceMax - priceMin || 1

  const toY    = (p: number) => PAD_T + innerH - ((p - priceMin) / priceRange) * innerH
  const SLOTS  = 12
  const slotW  = innerW / SLOTS
  // Pin the newest candle to the right edge (history grows leftward), so a
  // single candle sits at "now" instead of floating alone on the far left.
  const slotOffset = Math.max(0, SLOTS - visibleCandles.length)
  const bodyW  = Math.max(slotW * 0.55, 5)

  const selectedIsLive = selectedIdx !== null && selectedIdx >= candles.length
  const selectedCandle = selectedIdx !== null ? allCandles[selectedIdx] : null
  const selectedPattern = selectedIdx !== null && !selectedIsLive ? detectPattern(candles, selectedIdx) : null

  const sigColors: Record<string, { color: string; bg: string; border: string; label: string }> = {
    bullish: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.3)',   label: 'BULLISH' },
    bearish: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)',   label: 'BEARISH' },
    neutral: { color: '#9ca3af', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.3)', label: 'NEUTRAL' },
    caution: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)',  label: 'CAUTION' },
  }

  const priceChangeInCandle = liveCandle ? liveCandle.close - liveCandle.open : 0
  const orPos = lastPrice && orHigh && orLow
    ? lastPrice > orHigh ? 'ABOVE OR HIGH' : lastPrice < orLow ? 'BELOW OR LOW' : 'INSIDE OR' : null
  const orPosColor = orPos === 'ABOVE OR HIGH' ? '#22c55e' : orPos === 'BELOW OR LOW' ? '#ef4444' : '#9ca3af'

  return (
    <div className="card" style={{ marginBottom: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '0.1em' }}>CANDLE READER</span>
          <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'JetBrains Mono, monospace', background: connected ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)', color: connected ? '#22c55e' : 'var(--text-secondary)' }}>
            {connected ? '● LIVE' : '○ OFF'}
          </span>
          {orPos && <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'JetBrains Mono, monospace', background: `${orPosColor}15`, color: orPosColor }}>{orPos}</span>}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[1, 3, 5].map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer',
              border: '1px solid', borderColor: timeframe === tf ? 'var(--border-bright)' : 'transparent',
              background: timeframe === tf ? 'var(--surface)' : 'transparent',
              color: timeframe === tf ? 'var(--text-primary)' : 'var(--text-dim)', transition: 'all 0.15s',
            }}>{tf}M</button>
          ))}
        </div>
      </div>

      {/* Price ticker */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '10px' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: '700', letterSpacing: '-0.02em', transition: 'color 0.2s',
          color: priceDir === 'up' ? '#22c55e' : priceDir === 'down' ? '#ef4444' : 'var(--text-primary)' }}>
          {lastPrice ? lastPrice.toFixed(2) : '—'}
        </span>
        {priceDir && <span style={{ fontSize: '16px', color: priceDir === 'up' ? '#22c55e' : '#ef4444' }}>{priceDir === 'up' ? '▲' : '▼'}</span>}
        {liveCandle && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', marginLeft: '4px',
            color: priceChangeInCandle > 0 ? '#22c55e' : priceChangeInCandle < 0 ? '#ef4444' : 'var(--text-secondary)' }}>
            {priceChangeInCandle >= 0 ? '+' : ''}{priceChangeInCandle.toFixed(1)} pts · {liveCandle.ticks} ticks
          </span>
        )}
      </div>

      {/* Chart — SVG scales to 100% width via viewBox */}
      <div style={{ background: 'var(--surface)', borderRadius: '8px', padding: '6px', marginBottom: '12px' }}>
        {visibleCandles.length === 0 ? (
          <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
            Waiting for first tick...
          </div>
        ) : (
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" style={{ display: 'block', width: '100%', height: 'auto' }} preserveAspectRatio="xMidYMid meet">

            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(pct => {
              const y = PAD_T + innerH * pct
              const price = priceMax - pct * priceRange
              return (
                <g key={pct}>
                  <line x1={PAD_L} y1={y} x2={VB_W - PAD_R} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  <text x={VB_W - PAD_R + 3} y={y + 3} fill="var(--text-dim)" fontSize="8" fontFamily="monospace">{price.toFixed(0)}</text>
                </g>
              )
            })}

            {/* OR High */}
            {orHigh && orHigh > 0 && orHigh >= priceMin && orHigh <= priceMax && (
              <>
                <line x1={PAD_L} y1={toY(orHigh)} x2={VB_W - PAD_R} y2={toY(orHigh)} stroke="#22c55e" strokeWidth="1" strokeDasharray="5,4" opacity={0.6} />
                <text x={VB_W - PAD_R + 3} y={toY(orHigh) + 3} fill="#22c55e" fontSize="7" fontFamily="monospace">OR H</text>
              </>
            )}

            {/* OR Low */}
            {orLow && orLow > 0 && orLow >= priceMin && orLow <= priceMax && (
              <>
                <line x1={PAD_L} y1={toY(orLow)} x2={VB_W - PAD_R} y2={toY(orLow)} stroke="#ef4444" strokeWidth="1" strokeDasharray="5,4" opacity={0.6} />
                <text x={VB_W - PAD_R + 3} y={toY(orLow) + 3} fill="#ef4444" fontSize="7" fontFamily="monospace">OR L</text>
              </>
            )}

            {/* Candles */}
            {visibleCandles.map((c, i) => {
              const globalIdx = allCandles.length - visibleCandles.length + i
              const isLive    = globalIdx >= candles.length
              const isSel     = selectedIdx === globalIdx
              const bull      = c.close >= c.open
              const color     = bull ? '#22c55e' : '#ef4444'
              const cx        = PAD_L + (slotOffset + i) * slotW + slotW / 2
              const bodyTop   = toY(Math.max(c.open, c.close))
              const bodyBot   = toY(Math.min(c.open, c.close))
              const bodyH     = Math.max(bodyBot - bodyTop, 2)
              const pat       = !isLive ? detectPattern(candles, globalIdx) : null

              return (
                <g key={i} style={{ cursor: isLive ? 'default' : 'pointer' }}
                  onClick={() => !isLive && setSelectedIdx(isSel ? null : globalIdx)}>

                  {isSel && <rect x={PAD_L + (slotOffset + i) * slotW + 1} y={PAD_T} width={slotW - 2} height={innerH} fill="rgba(255,255,255,0.05)" rx="2" />}

                  {/* Wick */}
                  <line x1={cx} y1={toY(c.high)} x2={cx} y2={toY(c.low)} stroke={isLive ? '#facc15' : color} strokeWidth="1.5" opacity={isLive ? 0.8 : 1} />

                  {/* Body */}
                  <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH}
                    fill={isLive ? '#facc1540' : color} stroke={isLive ? '#facc15' : color}
                    strokeWidth={isSel ? 1.5 : 0.8} rx="1.5" opacity={isLive ? 0.9 : 1} />

                  {/* LIVE label */}
                  {isLive && <text x={cx} y={PAD_T - 5} fill="#facc15" fontSize="7" textAnchor="middle" fontFamily="monospace">LIVE</text>}

                  {/* Pattern emoji */}
                  {pat && !isLive && (
                    <text x={cx} y={bull ? bodyTop - 4 : bodyBot + 11}
                      fill={isSel ? '#fff' : 'var(--text-secondary)'} fontSize="9" textAnchor="middle">{pat.emoji}</text>
                  )}

                  {/* Time label every 3 candles */}
                  {i % 3 === 0 && (
                    <text x={cx} y={VB_H - 5} fill="var(--text-dim)" fontSize="7" textAnchor="middle" fontFamily="monospace">
                      {new Date(c.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>

      {/* OHLC row for live candle */}
      {liveCandle && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
          {(['open', 'high', 'low', 'close'] as const).map(k => (
            <div key={k} style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: k === 'close' ? '700' : '400',
                color: k === 'close' ? (liveCandle.close >= liveCandle.open ? '#22c55e' : '#ef4444') : k === 'high' ? '#22c55e' : k === 'low' ? '#ef4444' : 'var(--text-secondary)' }}>
                {liveCandle[k].toFixed(0)}
              </div>
            </div>
          ))}
          <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', paddingLeft: '10px', flex: 1 }}>
            <div style={{ fontSize: '8px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em' }}>TICKS</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>{liveCandle.ticks}</div>
          </div>
        </div>
      )}

      {/* Pattern panel */}
      {selectedCandle && selectedIdx !== null && !selectedIsLive && selectedPattern ? (() => {
        const sig = sigColors[selectedPattern.signal]
        return (
          <div style={{ background: sig.bg, border: `1px solid ${sig.border}`, borderRadius: '10px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '22px' }}>{selectedPattern.emoji}</span>
                <div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: '700', color: sig.color }}>{selectedPattern.name}</div>
                  <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                    O:{selectedCandle.open.toFixed(0)} H:{selectedCandle.high.toFixed(0)} L:{selectedCandle.low.toFixed(0)} C:{selectedCandle.close.toFixed(0)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <span style={{ padding: '2px 8px', borderRadius: '4px', background: `${sig.color}20`, color: sig.color, fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', fontWeight: '700', letterSpacing: '0.08em' }}>{sig.label}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: 'var(--text-dim)' }}>{selectedPattern.strength}% strength</span>
              </div>
            </div>
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden', marginBottom: '10px' }}>
              <div style={{ width: `${selectedPattern.strength}%`, height: '100%', background: sig.color, boxShadow: `0 0 6px ${sig.color}50` }} />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', marginBottom: '4px' }}>WHAT THIS MEANS</div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.55', margin: 0 }}>{selectedPattern.meaning}</p>
            </div>
            <div style={{ marginBottom: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', marginBottom: '4px' }}>ORB CONTEXT</div>
              <p style={{ fontSize: '12px', color: sig.color, lineHeight: '1.55', margin: 0 }}>{selectedPattern.orbContext}</p>
            </div>
            <div style={{ background: `${sig.color}10`, border: `1px solid ${sig.color}25`, borderRadius: '6px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚡</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: sig.color, fontWeight: '700' }}>{selectedPattern.action}</span>
            </div>
          </div>
        )
      })() : selectedIsLive ? (
        <div style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#facc15', margin: 0 }}>⏳ Live candle forming — pattern reads on close</p>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', margin: 0 }}>
            {candles.length === 0 ? 'Building first candle...' : '👆 Click any candle to read the pattern'}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>{candles.length} candles · {timeframe}M · MNQ · ET</span>
        <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>🟡 forming</span>
      </div>
    </div>
  )
}
