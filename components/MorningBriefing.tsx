'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'

// ─── Local types (mirror the API shapes returned by /api/market-data) ─────────
interface VIXData {
  level: number
  change: number
  changePct: number
  extreme: boolean
  elevated: boolean
  status: 'extreme' | 'elevated' | 'normal'
  label: string
}
interface QQQData {
  price: number
  premarketPrice: number | null
  premarketChange: number | null
  premarketChangePct: number | null
  regularChange: number
  regularChangePct: number
  direction: 'bullish' | 'bearish' | 'neutral'
}
interface NQData {
  price: number
  overnightHigh: number
  overnightLow: number
  previousClose: number
  change: number
  changePct: number
  source?: 'topstep' | 'yahoo'
}
interface IBSData {
  value: number
  bias: 'long_caution' | 'short_caution' | 'neutral'
}

interface MarketBriefing {
  vix: VIXData | null
  qqq: QQQData | null
  nq: NQData | null
  ibs: IBSData | null
  vwap: number | null
  news: Array<{ time?: string; title?: string; impact?: string }> | null
  hasHighImpactNewsToday?: boolean
  marketStatus?: unknown
  fetchedAt?: string
  errors?: string[]
}

interface LiveQuote {
  price: number
  change: number
  changePct: number
  timestamp: string
}


interface AutoPopulateSignal {
  vixLevel: string
  vixExtreme: boolean
  qqpAligned: boolean
  hasHighImpactNews: boolean
  us10yAgainst?: boolean
  dxyAgainst?: boolean
}

interface MorningBriefingProps {
  onAutoPopulate?: (data: AutoPopulateSignal) => void
}

export default function MorningBriefing({ onAutoPopulate }: MorningBriefingProps = {}) {
  const [briefing, setBriefing] = useState<MarketBriefing | null>(null)
  const [liveNQ, setLiveNQ] = useState<LiveQuote | null>(null)
  const [liveHealthy, setLiveHealthy] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const evtSourceRef = useRef<EventSource | null>(null)

  // ─── POLL  slow tiles (VIX / QQQ / IBS / VWAP) via React Query ─────────────
  const { data: briefingData, error: briefingError } = useQuery({
    queryKey: ['market-data'],
    queryFn: () => fetch('/api/market-data', { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(`briefing fetch ${r.status}`)
      return r.json()
    }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (briefingData) {
      setBriefing((briefingData as any).briefing || briefingData)
      setError(null)
      setLoading(false)
    }
  }, [briefingData])

  useEffect(() => {
    if (briefingError) {
      const msg = briefingError instanceof Error ? briefingError.message : 'fetch failed'
      console.warn('[MorningBriefing]', msg)
      setError((prev) => prev ?? msg)
      setLoading(false)
    }
  }, [briefingError])

  // ─── SSE  open / reconnect helper ──────────────────────────────────────────
  const openSSE = useCallback(() => {
    // Close any existing connection first
    if (evtSourceRef.current) {
      evtSourceRef.current.close()
      evtSourceRef.current = null
    }

    const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
    evtSourceRef.current = es

    es.onopen = () => {
      setLiveHealthy(true)
    }

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (payload?.type === 'quote' && payload?.data) {
          const q = payload.data
          const price = Number(q.price || 0)
          // Never overwrite a real price with 0 — protects against empty
          // ticks during SSE reconnect or gateway hiccups.
          if (price > 0) {
            setLiveNQ({
              price,
              change: Number(q.change || 0),
              changePct: Number(q.changePct || 0),
              timestamp: String(q.timestamp || new Date().toISOString()),
            })
          }
          setLiveHealthy(true)
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      setLiveHealthy(false)
      // EventSource reconnects automatically; don't close it.
    }

    return es
  }, [])

  // ─── MOUNT  start SSE stream ───────────────────────────────────────────────
  useEffect(() => {
    openSSE()
    return () => {
      if (evtSourceRef.current) {
        evtSourceRef.current.close()
        evtSourceRef.current = null
      }
    }
  }, [openSSE])

  // ─── TAB WAKE  reconnect SSE when tab becomes visible ─────────────────────
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        console.log('[MorningBriefing] Tab woke up — reconnecting SSE')
        openSSE()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [openSSE])

  // ─── EMIT  auto-populate signal whenever the briefing snapshot changes ──────
  useEffect(() => {
    if (!briefing || !onAutoPopulate) return
    const vixLevel = briefing.vix?.level != null ? briefing.vix.level.toFixed(2) : '-'
    const vixExtreme = briefing.vix?.extreme ?? false
    const qqpAligned = briefing.qqq?.direction === 'bullish'
    const hasHighImpactNews = !!briefing.hasHighImpactNewsToday
    onAutoPopulate({ vixLevel, vixExtreme, qqpAligned, hasHighImpactNews })
  }, [briefing, onAutoPopulate])
  // ─── RENDER ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="mt-6 rounded-2xl border border-neutral-800 p-6 bg-neutral-950/60">
        <h2 className="text-neutral-400 text-sm font-mono tracking-wide">MORNING PRE-SESSION BRIEFING</h2>
        <p className="text-neutral-500 mt-4">Loading pre-session briefing…</p>
      </section>
    )
  }

  if (!briefing && error) {
    return (
      <section className="mt-6 rounded-2xl border border-red-900/50 p-6 bg-red-950/40">
        <h2 className="text-red-400 text-sm font-mono tracking-wide">MORNING PRE-SESSION BRIEFING — UNAVAILABLE</h2>
        <p className="text-red-300 mt-4 text-sm">{error}</p>
      </section>
    )
  }

  if (!briefing) return null

  // Overlay live NQ ticks on top of the briefing snapshot. When the SSE stream
  // is healthy this is the real-time quote; when down, we fall back to whatever
  // the briefing fetch gave us.
  const nqPrice     = liveNQ?.price     ?? briefing.nq?.price     ?? 0
  const nqChange    = liveNQ?.change    ?? briefing.nq?.change    ?? 0
  const nqChangePct = liveNQ?.changePct ?? briefing.nq?.changePct ?? 0
  const nqUp        = nqChange >= 0

  return (
    <section className="mt-6 space-y-6">
      <header className="flex items-center gap-3">
        <h2 className="text-neutral-400 text-sm font-mono tracking-wide">MORNING PRE-SESSION BRIEFING</h2>
        <span
          className={`flex items-center gap-1.5 text-xs font-mono tracking-wide ${
            liveHealthy ? 'text-green-400' : 'text-neutral-600'
          }`}
          title={liveHealthy ? 'Live MNQ quotes streaming' : 'Live stream not connected yet'}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${liveHealthy ? 'bg-green-400 animate-pulse' : 'bg-neutral-700'}`} />
          NQ LIVE
        </span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* NQ tile — live + VWAP */}
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/60 relative">
          <div className="text-[10px] font-mono tracking-wide text-neutral-500">NQ (MNQ proxy)</div>
          <div className="mt-1 text-xl font-semibold text-neutral-100 tabular-nums">
            {nqPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`mt-1 text-xs font-mono tabular-nums ${nqUp ? 'text-green-400' : 'text-red-400'}`}>
            {nqUp ? '▲' : '▼'} {nqChange.toFixed(2)} ({nqChangePct.toFixed(2)}%)
          </div>
          {briefing.vwap != null && (
            <div className={`mt-1 text-xs font-mono tabular-nums ${nqPrice >= briefing.vwap ? 'text-green-500' : 'text-red-500'}`}>
              {nqPrice >= briefing.vwap ? '▲ above' : '▼ below'} VWAP ({briefing.vwap.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </div>
          )}
        </div>

        {/* VIX tile */}
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/60">
          <div className="text-[10px] font-mono tracking-wide text-neutral-500">VIX</div>
          <div className="mt-1 text-xl font-semibold text-neutral-100 tabular-nums">
            {briefing.vix?.level?.toFixed(2) ?? '-'}
          </div>
          <div
            className={`mt-1 text-xs font-mono ${
              briefing.vix?.status === 'extreme'
                ? 'text-red-400'
                : briefing.vix?.status === 'elevated'
                ? 'text-yellow-400'
                : 'text-green-400'
            }`}
          >
            {briefing.vix?.label ?? '-'}
          </div>
        </div>

        {/* IBS bias tile */}
        {(() => {
          const ibs = briefing.ibs
          if (!ibs) return (
            <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/60">
              <div className="text-[10px] font-mono tracking-wide text-neutral-500">IBS BIAS</div>
              <div className="mt-1 text-xs font-mono text-neutral-600">Unavailable</div>
            </div>
          )
          const isLongCaution  = ibs.bias === 'long_caution'
          const isShortCaution = ibs.bias === 'short_caution'
          const isWarning = isLongCaution || isShortCaution
          return (
            <div className={`rounded-2xl border p-4 ${isWarning ? 'border-yellow-600/50 bg-yellow-950/30' : 'border-neutral-800 bg-neutral-950/60'}`}>
              <div className="text-[10px] font-mono tracking-wide text-neutral-500">IBS BIAS</div>
              <div className={`mt-1 text-base font-semibold font-mono ${isWarning ? 'text-yellow-400' : 'text-neutral-100'}`}>
                {isLongCaution ? '⚠ Long Caution' : isShortCaution ? '⚠ Short Caution' : 'Neutral'}
              </div>
              <div className="mt-1 text-[11px] font-mono text-neutral-400">
                {isLongCaution
                  ? `Overbought overnight (IBS ${ibs.value.toFixed(2)})`
                  : isShortCaution
                  ? `Oversold overnight (IBS ${ibs.value.toFixed(2)})`
                  : `IBS ${ibs.value.toFixed(2)} — no mean-reversion bias`}
              </div>
            </div>
          )
        })()}

        {/* QQQ tile */}
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/60">
          <div className="text-[10px] font-mono tracking-wide text-neutral-500">QQQ</div>
          <div className="mt-1 text-xl font-semibold text-neutral-100 tabular-nums">
            {briefing.qqq?.price?.toFixed(2) ?? '-'}
          </div>
          <div
            className={`mt-1 text-xs font-mono ${
              briefing.qqq?.direction === 'bullish'
                ? 'text-green-400'
                : briefing.qqq?.direction === 'bearish'
                ? 'text-red-400'
                : 'text-neutral-400'
            }`}
          >
            {briefing.qqq?.direction ?? '-'}
          </div>
        </div>
      </div>

      {briefing.news && briefing.news.length > 0 && (
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/60">
          <div className="text-neutral-500 text-xs font-mono tracking-wide">HEADLINES</div>
          <ul className="mt-2 space-y-1 text-sm text-neutral-300">
            {briefing.news.slice(0, 5).map((n, i) => (
              <li key={i} className="list-disc list-inside marker:text-neutral-600">
                {n.title ?? '-'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
