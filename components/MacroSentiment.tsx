'use client'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

interface FearGreed {
  score: number; rating: string; previousClose: number; previousWeek: number
  direction: string; nqBias: string; color: string
}
interface YieldData {
  name: string; current: number; change: number; changePct: number
  direction: string; nqImpact: string; label: string
}
interface ESData {
  price: number; changePct: number; premarketChangePct: number | null; direction: string
}
interface MarketStatus { isWeekend: boolean; isPreMarket: boolean; isMarketHours: boolean; isAfterHours: boolean; nextSessionLabel: string; contextLabel: string }
interface Macro {
  fearGreed: FearGreed | null; us10y: YieldData | null; dxy: YieldData | null; es: ESData | null
  nqBias: string; nqBiasLabel: string
  bullishSignals: string[]; bearishSignals: string[]
  suggestUS10yAgainst: boolean; suggestDXYAgainst: boolean
  marketStatus: MarketStatus | null
  fetchedAt: string; errors: string[]
}

interface Props {
  onMacroLoad?: (data: { us10yAgainst: boolean; dxyAgainst: boolean }) => void
}

export default function MacroSentiment({ onMacroLoad }: Props) {
  const { data, isLoading, refetch } = useQuery<{ macro: Macro }>({
    queryKey: ['macro'],
    queryFn: () => fetch('/api/macro', { cache: 'no-store' }).then(r => r.json()),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const macro = data?.macro ?? null
  const lastUpdated = macro?.fetchedAt
    ? new Date(macro.fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
    : ''

  // Notify parent when macro data is ready
  useEffect(() => {
    if (macro && onMacroLoad) {
      onMacroLoad({ us10yAgainst: macro.suggestUS10yAgainst, dxyAgainst: macro.suggestDXYAgainst })
    }
  }, [macro, onMacroLoad])

  if (isLoading) return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px 20px', marginBottom: '16px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
      Loading macro sentiment...
    </div>
  )

  if (!macro) return null

  const biasColor =
    macro.nqBias === 'strong-bullish' ? 'var(--green)' :
    macro.nqBias === 'bullish' ? 'var(--green)' :
    macro.nqBias === 'neutral' ? 'var(--yellow)' :
    'var(--red)'

  const biasBorder =
    macro.nqBias.includes('bullish') ? 'var(--green-border)' :
    macro.nqBias === 'neutral' ? 'var(--yellow-border)' :
    'var(--red-border)'

  const biasBg =
    macro.nqBias.includes('bullish') ? 'var(--green-bg)' :
    macro.nqBias === 'neutral' ? 'var(--yellow-bg)' :
    'var(--red-bg)'

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px' }}>🌐</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: '700', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
            {macro.marketStatus?.isWeekend ? "WEEKEND MACRO OUTLOOK — NEXT WEEK'S NQ BIAS" : macro.marketStatus?.isMarketHours ? 'LIVE MACRO SENTIMENT — NQ BIAS' : 'MACRO MARKET SENTIMENT — NQ BIAS'}
          </span>
          {lastUpdated && <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>· {lastUpdated} ET</span>}
        </div>
        <button onClick={() => refetch()} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>↻</button>
      </div>

      <div style={{ padding: '14px 20px' }}>
        {/* NQ Bias Banner */}
        <div style={{ background: biasBg, border: `1px solid ${biasBorder}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: biasColor, fontWeight: '700', letterSpacing: '0.1em', marginBottom: '4px' }}>
              {macro.marketStatus?.isWeekend ? "NEXT WEEK'S NQ MACRO BIAS" : macro.marketStatus?.isAfterHours ? "NEXT SESSION'S NQ MACRO BIAS" : macro.marketStatus?.isMarketHours ? 'LIVE NQ MACRO BIAS' : "PRE-MARKET NQ MACRO BIAS"}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '15px', fontWeight: '700', color: biasColor }}>
              {macro.nqBiasLabel}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
            <span style={{ color: 'var(--green)' }}>▲ {macro.bullishSignals.length}</span>
            <span style={{ color: 'var(--red)' }}>▼ {macro.bearishSignals.length}</span>
          </div>
        </div>

        {/* Indicator Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
          {macro.fearGreed && <FGCard data={macro.fearGreed} />}
          {macro.us10y && (
            <MacroCard
              label="US 10Y Yield"
              icon={macro.us10y.direction === 'rising' ? '📈' : macro.us10y.direction === 'falling' ? '📉' : '➡️'}
              value={`${macro.us10y.current}%`}
              sub={`${macro.us10y.changePct >= 0 ? '+' : ''}${macro.us10y.changePct}% · ${macro.us10y.direction}`}
              impact={macro.us10y.nqImpact}
              impactLabel={macro.us10y.nqImpact === 'bearish' ? '⚠️ NQ headwind' : macro.us10y.nqImpact === 'bullish' ? '✓ NQ tailwind' : '→ Neutral'}
              border={macro.us10y.nqImpact === 'bearish' ? 'var(--red-border)' : macro.us10y.nqImpact === 'bullish' ? 'var(--green-border)' : 'var(--border)'}
            />
          )}
          {macro.dxy && (
            <MacroCard
              label="US Dollar (DXY)"
              icon={macro.dxy.direction === 'rising' ? '💵↑' : macro.dxy.direction === 'falling' ? '💵↓' : '💵'}
              value={`${macro.dxy.current}`}
              sub={`${macro.dxy.changePct >= 0 ? '+' : ''}${macro.dxy.changePct}% · ${macro.dxy.direction}`}
              impact={macro.dxy.nqImpact}
              impactLabel={macro.dxy.nqImpact === 'bearish' ? '⚠️ NQ headwind' : macro.dxy.nqImpact === 'bullish' ? '✓ NQ tailwind' : '→ Neutral'}
              border={macro.dxy.nqImpact === 'bearish' ? 'var(--red-border)' : macro.dxy.nqImpact === 'bullish' ? 'var(--green-border)' : 'var(--border)'}
            />
          )}
          {macro.es && (
            <MacroCard
              label="S&P 500 Futures"
              icon={macro.es.direction === 'bullish' ? '🟢' : macro.es.direction === 'bearish' ? '🔴' : '⬜'}
              value={macro.es.price.toLocaleString()}
              sub={`${(macro.es.premarketChangePct ?? macro.es.changePct) >= 0 ? '+' : ''}${macro.es.premarketChangePct ?? macro.es.changePct}%${macro.es.premarketChangePct != null ? ' pre' : ''}`}
              impact={macro.es.direction === 'bullish' ? 'bullish' : macro.es.direction === 'bearish' ? 'bearish' : 'neutral'}
              impactLabel={macro.es.direction === 'bullish' ? '✓ Risk-on' : macro.es.direction === 'bearish' ? '⚠️ Risk-off' : '→ Neutral'}
              border={macro.es.direction === 'bullish' ? 'var(--green-border)' : macro.es.direction === 'bearish' ? 'var(--red-border)' : 'var(--border)'}
            />
          )}
        </div>

        {/* Signal breakdown */}
        {(macro.bullishSignals.length > 0 || macro.bearishSignals.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {macro.bullishSignals.length > 0 && (
              <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--green)', letterSpacing: '0.08em', marginBottom: '6px' }}>▲ BULLISH SIGNALS</div>
                {macro.bullishSignals.map((s, i) => <div key={i} style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>· {s}</div>)}
              </div>
            )}
            {macro.bearishSignals.length > 0 && (
              <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--red)', letterSpacing: '0.08em', marginBottom: '6px' }}>▼ BEARISH SIGNALS</div>
                {macro.bearishSignals.map((s, i) => <div key={i} style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>· {s}</div>)}
              </div>
            )}
          </div>
        )}

        {macro.errors.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            ⚠ {macro.errors.join(' · ')}
          </div>
        )}
      </div>
    </div>
  )
}

// Fear & Greed Gauge
function FGCard({ data }: { data: FearGreed }) {
  const color =
    data.color === 'extreme-fear' ? '#ff3d3d' :
    data.color === 'fear' ? '#ff8c00' :
    data.color === 'neutral' ? '#ffb300' :
    data.color === 'greed' ? '#00c853' :
    '#00e676'

  const bgColor =
    data.color === 'extreme-fear' || data.color === 'fear' ? 'var(--red-bg)' :
    data.color === 'neutral' ? 'var(--yellow-bg)' :
    'var(--green-bg)'

  const borderColor =
    data.color === 'extreme-fear' || data.color === 'fear' ? 'var(--red-border)' :
    data.color === 'neutral' ? 'var(--yellow-border)' :
    'var(--green-border)'

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
        😱 Fear & Greed Index
      </div>
      <div style={{ marginBottom: '6px' }}>
        <div style={{ background: 'var(--surface)', borderRadius: '4px', height: '6px', overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: `${data.score}%`, height: '100%', background: `linear-gradient(to right, #ff3d3d, #ff8c00, #ffb300, #00c853, #00e676)`, borderRadius: '4px' }} />
          <div style={{ position: 'absolute', top: '-1px', left: `${data.score}%`, width: '3px', height: '8px', background: 'white', transform: 'translateX(-50%)', borderRadius: '2px' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px', fontSize: '9px', color: 'var(--text-dim)' }}>
          <span>Fear</span><span>Neutral</span><span>Greed</span>
        </div>
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: '700', color, lineHeight: 1 }}>{data.score}</div>
      <div style={{ fontSize: '11px', color, fontWeight: '600', marginTop: '2px' }}>{data.rating}</div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' }}>
        Prev: {data.previousClose} · Week: {data.previousWeek}
      </div>
    </div>
  )
}

function MacroCard({ label, icon, value, sub, impact, impactLabel, border }: {
  label: string; icon: string; value: string; sub: string
  impact: string; impactLabel: string; border: string
}) {
  const valueColor = impact === 'bearish' ? 'var(--red)' : impact === 'bullish' ? 'var(--green)' : 'var(--text-primary)'
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${border}`, borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
        {icon} {label}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: '700', color: valueColor, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{sub}</div>
      <div style={{ fontSize: '11px', color: valueColor, marginTop: '4px', fontWeight: '600' }}>{impactLabel}</div>
    </div>
  )
}
