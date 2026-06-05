'use client'
import { useEffect, useState } from 'react'

const MONO = 'JetBrains Mono, monospace'

interface FVG { dir: 'bullish' | 'bearish'; top: number; bottom: number; mid: number; ageBars: number }
interface LiquidityData {
  levels: { pdh: number; pdl: number; pdc: number; source: string } | null
  lastPrice: number | null
  fvgs: FVG[]
  classification: string | null
  reversalNote: string | null
}

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Level({ label, value, last }: { label: string; value: number; last: number | null }) {
  const rel = last != null ? (value >= last ? `▲ ${fmt(value - last)}` : `▼ ${fmt(last - value)}`) : ''
  const color = last == null ? 'var(--text-primary)' : value >= last ? 'var(--green)' : 'var(--red)'
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-dim)', fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO }}>{fmt(value)}</div>
      {rel && <div style={{ fontSize: 9, color, fontFamily: MONO }}>{rel} pts</div>}
    </div>
  )
}

export default function LiquidityCard() {
  const [data, setData] = useState<LiquidityData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/liquidity')
        if (!res.ok) return
        const d = await res.json()
        if (alive) setData(d)
      } catch { /* ignore */ }
      finally { if (alive) setLoaded(true) }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const bull = data?.fvgs?.filter(f => f.dir === 'bullish') ?? []
  const bear = data?.fvgs?.filter(f => f.dir === 'bearish') ?? []
  const nearestBull = bull[0]
  const nearestBear = bear[0]

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-primary)' }}>LIQUIDITY MAP</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: MONO }}>PDH / PDL · SWEEP · FVG</span>
        {data?.levels && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-dim)', fontFamily: MONO }}>src: {data.levels.source}</span>}
      </div>

      {!loaded ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)' }}>Loading…</div>
      ) : !data?.levels ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)' }}>
          Prior-day levels unavailable (no daily-bars feed). Liquidity map activates when the data source is live.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <Level label="PDH" value={data.levels.pdh} last={data.lastPrice} />
            <Level label="PDL" value={data.levels.pdl} last={data.lastPrice} />
            <Level label="PDC" value={data.levels.pdc} last={data.lastPrice} />
          </div>

          {/* Active FVGs */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: data?.reversalNote ? 12 : 0 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--text-secondary)' }}>
              Active FVGs: {data.fvgs.length}
            </span>
            {nearestBull && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 4, padding: '1px 6px' }}>
                ▲ {fmt(nearestBull.bottom)}–{fmt(nearestBull.top)}
              </span>
            )}
            {nearestBear && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 4, padding: '1px 6px' }}>
                ▼ {fmt(nearestBear.bottom)}–{fmt(nearestBear.top)}
              </span>
            )}
          </div>

          {/* Sweep-reversal recommendation (manual execution only) */}
          {data.reversalNote && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              background: 'var(--lime-bg)', border: '1px solid var(--lime-border)', borderLeft: '2px solid var(--lime)',
              borderRadius: 4, padding: '9px 12px',
            }}>
              <span style={{ fontSize: 13 }}>⚠</span>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--lime)', fontFamily: MONO, marginBottom: 3 }}>
                  SWEEP-REVERSAL · MANUAL EXECUTE
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: MONO, lineHeight: 1.5 }}>
                  {data.reversalNote}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
