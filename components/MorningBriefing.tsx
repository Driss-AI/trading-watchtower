'use client'
import { useEffect, useState, useCallback } from 'react'

interface VIXData { level: number; changePct: number; extreme: boolean; elevated: boolean; status: string; label: string }
interface QQQData { price: number; premarketPrice: number | null; premarketChangePct: number | null; regularChangePct: number; direction: string }
interface NQData { price: number; overnightHigh: number; overnightLow: number; change: number; changePct: number }
interface NewsEvent { time: string; title: string; impact: 'high' | 'medium' | 'low' }
interface Briefing { vix: VIXData | null; qqq: QQQData | null; nq: NQData | null; news: NewsEvent[]; hasHighImpactNewsToday: boolean; fetchedAt: string; errors: string[] }

interface TopstepXAccount { id: number; name: string; balance: number; canTrade: boolean }

interface Props {
  onAutoPopulate?: (data: {
    vixLevel: string
    vixExtreme: boolean
    qqpAligned: boolean
    hasHighImpactNews: boolean
  }) => void
}

export default function MorningBriefing({ onAutoPopulate }: Props) {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [account, setAccount] = useState<TopstepXAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountLoading, setAccountLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  const loadMarketData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/market-data')
      const { briefing: b } = await res.json()
      setBriefing(b)
      if (b?.fetchedAt) {
        setLastUpdated(new Date(b.fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
      }
    } catch {
      setError('Failed to load market data')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAccount = useCallback(async () => {
    setAccountLoading(true)
    try {
      const res = await fetch('/api/topstepx/account')
      if (res.ok) {
        const { account: acc } = await res.json()
        setAccount(acc)
      }
    } catch {} finally {
      setAccountLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMarketData()
    loadAccount()
  }, [])

  function handleAutoPopulate() {
    if (!briefing || !onAutoPopulate) return
    onAutoPopulate({
      vixLevel: briefing.vix ? String(briefing.vix.level) : '',
      vixExtreme: briefing.vix?.extreme ?? false,
      qqpAligned: briefing.qqq?.direction === 'bullish',
      hasHighImpactNews: briefing.hasHighImpactNewsToday,
    })
  }

  const vix = briefing?.vix
  const qqq = briefing?.qqq
  const nq  = briefing?.nq
  const news = briefing?.news ?? []
  const highImpactNews = news.filter((e) => e.impact === 'high')

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '20px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '14px' }}>🌅</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '700', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
            MORNING PRE-SESSION BRIEFING
          </span>
          {lastUpdated && (
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>
              · Updated {lastUpdated} ET
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onAutoPopulate && briefing && (
            <button
              onClick={handleAutoPopulate}
              className="btn btn-green"
              style={{ fontSize: '11px', padding: '6px 14px' }}
            >
              ⚡ Auto-fill Session
            </button>
          )}
          <button
            onClick={() => { loadMarketData(); loadAccount() }}
            disabled={loading}
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '6px 12px' }}
          >
            {loading ? '⟳ Loading...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
          Fetching market data...
        </div>
      ) : error ? (
        <div style={{ padding: '16px 20px', color: 'var(--red)', fontSize: '12px' }}>{error}</div>
      ) : briefing ? (
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: highImpactNews.length > 0 ? '14px' : 0 }}>

            {/* VIX */}
            <DataCard
              label="VIX"
              icon="📊"
              status={vix ? (vix.extreme ? 'red' : vix.elevated ? 'yellow' : 'green') : 'dim'}
            >
              {vix ? (
                <>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: vix.extreme ? 'var(--red)' : vix.elevated ? 'var(--yellow)' : 'var(--green)', lineHeight: 1 }}>
                    {vix.level}
                  </div>
                  <div style={{ fontSize: '11px', color: vix.extreme ? 'var(--red)' : vix.elevated ? 'var(--yellow)' : 'var(--text-secondary)', marginTop: '4px' }}>
                    {vix.extreme ? '⛔ EXTREME — NO TRADE' : vix.elevated ? '⚠️ Elevated' : '✓ Normal range'}
                    <span style={{ color: vix.changePct >= 0 ? 'var(--red)' : 'var(--green)', marginLeft: '6px' }}>
                      {vix.changePct >= 0 ? '+' : ''}{vix.changePct}%
                    </span>
                  </div>
                </>
              ) : <Placeholder />}
            </DataCard>

            {/* QQQ */}
            <DataCard
              label="QQQ Premarket"
              icon="📈"
              status={qqq ? (qqq.direction === 'bullish' ? 'green' : qqq.direction === 'bearish' ? 'red' : 'yellow') : 'dim'}
            >
              {qqq ? (
                <>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: qqq.direction === 'bullish' ? 'var(--green)' : qqq.direction === 'bearish' ? 'var(--red)' : 'var(--yellow)', lineHeight: 1 }}>
                    {qqq.premarketChangePct != null ? `${qqq.premarketChangePct >= 0 ? '+' : ''}${qqq.premarketChangePct}%` : `${qqq.regularChangePct >= 0 ? '+' : ''}${qqq.regularChangePct}%`}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {qqq.premarketPrice != null ? `Pre: $${qqq.premarketPrice.toFixed(2)}` : `Price: $${qqq.price.toFixed(2)}`}
                    {' · '}{qqq.direction === 'bullish' ? '↑ Bullish' : qqq.direction === 'bearish' ? '↓ Bearish' : '→ Neutral'}
                  </div>
                </>
              ) : <Placeholder />}
            </DataCard>

            {/* NQ */}
            <DataCard
              label="NQ Futures"
              icon="⚡"
              status={nq ? (nq.changePct >= 0 ? 'green' : 'red') : 'dim'}
            >
              {nq ? (
                <>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: nq.changePct >= 0 ? 'var(--green)' : 'var(--red)', lineHeight: 1 }}>
                    {nq.price.toFixed(0)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    H: {nq.overnightHigh} · L: {nq.overnightLow}
                    <span style={{ color: nq.changePct >= 0 ? 'var(--green)' : 'var(--red)', marginLeft: '6px' }}>
                      {nq.changePct >= 0 ? '+' : ''}{nq.changePct}%
                    </span>
                  </div>
                </>
              ) : <Placeholder />}
            </DataCard>

            {/* TopstepX Account */}
            <DataCard
              label="TopStep Account"
              icon="🏦"
              status={account ? 'green' : 'dim'}
            >
              {accountLoading ? (
                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Connecting...</div>
              ) : account ? (
                <>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--green)', lineHeight: 1 }}>
                    ${account.balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {account.name} · {account.canTrade ? '✓ Can Trade' : '⛔ Blocked'}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  Not connected<br />
                  <span style={{ fontSize: '10px' }}>Set TOPSTEPX_USERNAME + API_KEY in Railway</span>
                </div>
              )}
            </DataCard>
          </div>

          {/* High Impact News Today */}
          {highImpactNews.length > 0 && (
            <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', color: 'var(--red)', fontWeight: '700', letterSpacing: '0.1em', marginBottom: '8px' }}>
                ⚠️ HIGH-IMPACT NEWS TODAY (DO NOT TRADE AROUND THESE TIMES)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {highImpactNews.map((e, i) => (
                  <div key={i} style={{ background: '#2a0505', border: '1px solid var(--red-border)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px' }}>
                    <span style={{ color: 'var(--red)', fontFamily: 'IBM Plex Mono, monospace', fontWeight: '700' }}>{e.time}</span>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>{e.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No high-impact news */}
          {news.length > 0 && highImpactNews.length === 0 && (
            <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: '8px', padding: '10px 16px', fontSize: '12px', color: 'var(--green)' }}>
              ✓ No high-impact USD news scheduled today
            </div>
          )}

          {/* Data errors */}
          {briefing.errors.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>
              ⚠ Some data unavailable: {briefing.errors.join(' · ')}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function DataCard({ label, icon, status, children }: { label: string; icon: string; status: string; children: React.ReactNode }) {
  const borderColor = status === 'green' ? 'var(--green-border)' : status === 'red' ? 'var(--red-border)' : status === 'yellow' ? 'var(--yellow-border)' : 'var(--border)'
  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${borderColor}`, borderRadius: '8px', padding: '12px 14px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
        {icon} {label}
      </div>
      {children}
    </div>
  )
}

function Placeholder() {
  return <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', color: 'var(--text-dim)' }}>—</div>
}
