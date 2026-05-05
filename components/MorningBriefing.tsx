'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

interface VIXData { level: number; changePct: number; extreme: boolean; elevated: boolean; status: string; label: string }
interface QQQData { price: number; premarketPrice: number | null; premarketChangePct: number | null; regularChangePct: number; direction: string }
interface NQData { price: number; overnightHigh: number; overnightLow: number; change: number; changePct: number }
interface NewsEvent { time: string; title: string; impact: 'high' | 'medium' | 'low' }
interface Briefing { vix: VIXData | null; qqq: QQQData | null; nq: NQData | null; news: NewsEvent[]; hasHighImpactNewsToday: boolean; fetchedAt: string; errors: string[] }

interface TopstepXAccount { id: number; name: string; balance: number; canTrade: boolean }

// ─── LIVE QUOTE (from /api/topstepx/stream?hub=market&symbol=MNQ) ────────────
interface LiveQuote {
  price: number
  high: number
  low: number
  change: number
  changePct: number
  ts: string
}

interface Props {
  onAutoPopulate?: (data: {
    vixLevel: string
    vixExtreme: boolean
    qqpAligned: boolean
    hasHighImpactNews: boolean
  }) => void
}

// Refresh cadence for the briefing while the page is open.
// VIX/QQQ/account drift slowly; 30s strikes a balance between freshness and
// hammering Yahoo + TopstepX. The NQ tile is independent and tick-driven.
const BRIEFING_REFRESH_MS = 30_000

export default function MorningBriefing({ onAutoPopulate }: Props) {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [account, setAccount] = useState<TopstepXAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountLoading, setAccountLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  // Live MNQ quote layered over briefing.nq for the NQ tile only.
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null)
  const [streaming, setStreaming] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const loadMarketData = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/market-data', { cache: 'no-store' })
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
      const res = await fetch('/api/topstepx/account', { cache: 'no-store' })
      if (res.ok) {
        const { account: acc } = await res.json()
        setAccount(acc)
      }
    } catch {} finally {
      setAccountLoading(false)
    }
  }, [])

  // Initial load + periodic refresh of the slow-changing tiles.
  useEffect(() => {
    loadMarketData()
    loadAccount()
    const t = setInterval(() => {
      loadMarketData()
      loadAccount()
    }, BRIEFING_REFRESH_MS)
    return () => clearInterval(t)
  }, [loadMarketData, loadAccount])

  // Live MNQ stream for the NQ tile.
  useEffect(() => {
    let cancelled = false

    const open = () => {
      if (cancelled) return
      const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
      esRef.current = es

      es.onopen = () => { if (!cancelled) setStreaming(true) }
      es.onerror = () => {
        if (cancelled) return
        setStreaming(false)
        // EventSource auto-reconnects on its own; nothing to do here.
      }
      es.onmessage = (e) => {
        if (cancelled) return
        try {
          const event = JSON.parse(e.data)
          if (event.type === 'quote' && event.data) {
            const q = event.data
            // sanity check — first tick after market open will have non-zero price
            if (typeof q.price === 'number' && q.price > 0) {
              setLiveQuote({
                price: q.price,
                high: q.sessionHigh,
                low: q.sessionLow,
                change: q.change,
                changePct: q.changePct,
                ts: q.timestamp,
              })
            }
          } else if (event.type === 'disconnected') {
            setStreaming(false)
          } else if (event.type === 'connected') {
            setStreaming(true)
          }
        } catch {}
      }
    }

    open()

    return () => {
      cancelled = true
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
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

  // The NQ tile prefers the live tick; falls back to the briefing snapshot.
  const nqDisplay = liveQuote
    ? {
        price: liveQuote.price,
        overnightHigh: liveQuote.high,
        overnightLow: liveQuote.low,
        changePct: liveQuote.changePct,
      }
    : nq

  const liveTickAge = liveQuote
    ? Math.round((Date.now() - new Date(liveQuote.ts).getTime()) / 1000)
    : null

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
          {streaming && (
            <span
              title={`NQ tile streaming live${liveTickAge != null ? ` · last tick ${liveTickAge}s ago` : ''}`}
              style={{ fontSize: '10px', color: 'var(--green)', fontFamily: 'IBM Plex Mono, monospace', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', display: 'inline-block', animation: 'mb-pulse 1.6s ease-in-out infinite' }} />
              NQ LIVE
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

            {/* NQ — live when streaming, briefing snapshot otherwise */}
            <DataCard
              label={streaming ? 'NQ Futures · LIVE' : 'NQ Futures'}
              icon="⚡"
              status={nqDisplay ? ((nqDisplay.changePct ?? 0) >= 0 ? 'green' : 'red') : 'dim'}
            >
              {nqDisplay ? (
                <>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: (nqDisplay.changePct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {nqDisplay.price.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                    H: {nqDisplay.overnightHigh?.toFixed(2)} · L: {nqDisplay.overnightLow?.toFixed(2)}
                    <span style={{ color: (nqDisplay.changePct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)', marginLeft: '6px' }}>
                      {(nqDisplay.changePct ?? 0) >= 0 ? '+' : ''}{nqDisplay.changePct?.toFixed(2)}%
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

      <style>{`@keyframes mb-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
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
