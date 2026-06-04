'use client'
// ─── LIVE POSITION BANNER ─────────────────────────────────────────────────────
// Streams GatewayUserPosition events. Shows "LONG MNQ @ 21505" the instant
// you enter a trade. Disappears when flat.

import { useEffect, useRef, useState } from 'react'

interface Position {
  contractId:   string
  direction:    'LONG' | 'SHORT' | 'FLAT'
  size:         number
  averagePrice: number
}

interface Trade {
  contractId: string
  side:       number   // 0=BUY 1=SELL
  price:      number
  size:       number
  pnl:        number
  time:       string
}

export default function LivePosition() {
  const [position, setPosition]     = useState<Position | null>(null)
  const [lastTrade, setLastTrade]   = useState<Trade | null>(null)
  const [streaming, setStreaming]   = useState(false)
  const esRef                       = useRef<EventSource | null>(null)

  // Also fetch current open positions via REST on mount
  useEffect(() => {
    fetch('/api/topstepx/positions')
      .then(r => r.json())
      .then(data => {
        if (data.positions?.length > 0) {
          const p = data.positions[0]
          setPosition({
            contractId:   p.contractId,
            direction:    p.type === 1 ? 'LONG' : 'SHORT',
            size:         p.size,
            averagePrice: p.averagePrice,
          })
        }
      }).catch(() => {})

    // SSE stream
    const es = new EventSource('/api/topstepx/stream?hub=user')
    esRef.current = es

    es.onopen  = () => setStreaming(true)
    es.onerror = () => setStreaming(false)

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)

        if (event.type === 'position' && event.data) {
          const { contractId, type, size, averagePrice } = event.data
          if (type === 0 || size === 0) {
            setPosition(null)  // flat
          } else {
            setPosition({
              contractId,
              direction: type === 1 ? 'LONG' : 'SHORT',
              size,
              averagePrice,
            })
          }
        }

        if (event.type === 'trade' && event.data) {
          const { contractId, side, price, size, profitAndLoss, creationTimestamp } = event.data
          setLastTrade({
            contractId,
            side,
            price,
            size,
            pnl: profitAndLoss ?? 0,
            time: creationTimestamp ? new Date(creationTimestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
          })
        }
      } catch {}
    }

    return () => { es.close() }
  }, [])

  const ticker = (id: string) => id?.split('.').pop()?.replace('M26','').replace('M25','') ?? id

  if (!position && !lastTrade) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--text-dim)' }} />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
          FLAT — No open position
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: streaming ? 'var(--green)' : 'var(--text-dim)' }}>
          {streaming ? '● LIVE' : '○ connecting...'}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {/* Active position */}
      {position && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 20px',
          background: position.direction === 'LONG'
            ? 'rgba(93, 202, 165, 0.1)'
            : 'rgba(210, 90, 48, 0.1)',
          border: `1px solid ${position.direction === 'LONG' ? 'var(--green)' : 'var(--red)'}`,
          borderRadius: '10px',
          flexWrap: 'wrap',
        }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 800,
            fontSize: '20px',
            color: position.direction === 'LONG' ? 'var(--green)' : 'var(--red)',
            letterSpacing: '0.05em',
          }}>
            {position.direction === 'LONG' ? '▲' : '▼'} {position.direction}
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: '18px', color: 'var(--text-primary)' }}>
            {ticker(position.contractId)}
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', color: 'var(--text-secondary)' }}>
            {position.size} contract{position.size !== 1 ? 's' : ''} @ <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{position.averagePrice.toFixed(2)}</span>
          </div>
          <div style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: streaming ? 'var(--green)' : 'var(--text-dim)' }}>
            {streaming ? '● LIVE' : '○'}
          </div>
        </div>
      )}

      {/* Last trade fill */}
      {lastTrade && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 14px',
          background: 'var(--bg-secondary)',
          borderRadius: '6px',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)' }}>LAST FILL</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: lastTrade.side === 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
            {lastTrade.side === 0 ? 'BUY' : 'SELL'} {lastTrade.size}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-primary)' }}>
            {ticker(lastTrade.contractId)} @ {lastTrade.price.toFixed(2)}
          </span>
          {lastTrade.pnl !== 0 && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 700, color: lastTrade.pnl > 0 ? 'var(--green)' : 'var(--red)' }}>
              {lastTrade.pnl > 0 ? '+' : ''}${lastTrade.pnl.toFixed(0)}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)' }}>{lastTrade.time}</span>
        </div>
      )}
    </div>
  )
}
