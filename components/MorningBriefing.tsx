'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

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
interface MarketBriefing {
  vix: VIXData | null
  qqq: QQQData | null
  nq: NQData | null
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

// Poll for slow-moving data (VIX/QQQ) every 30 seconds; the NQ tile gets its
// updates from the SSE stream at /api/topstepx/stream?hub=market&symbol=MNQ.
const BRIEFING_REFRESH_MS = 30_000

export default function MorningBriefing() {
  const [briefing, setBriefing] = useState<MarketBriefing | null>(null)
  const [liveNQ, setLiveNQ] = useState<LiveQuote | null>(null)
  const [liveHealthy, setLiveHealthy] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const evtSourceRef = useRef<EventSource | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── POLL  slow tiles (VIX / QQQ) ───────────────────────────────────────────
  const reloadBriefing = useCallback(async () => {
    try {
      const res = await fetch('/api/market-data', { cache: 'no-store' })
      if (!res.ok) throw new Error(`briefing fetch ${res.status}`)
      const json = (await res.json()) as MarketBriefing
      setBriefing(json)
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch failed'
      console.warn('[MorningBriefing]', msg)
      setError((prev) => (prev ?? msg))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reloadBriefing()
    pollTimerRef.current = setInterval(reloadBriefing, BRIEFING_REFRESH_MS)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [reloadBriefing])

  // ─── SSE  live NQ tick ──────────────────────────────────────────────────────
  useEffect(() => {
    let closed = false

    const openStream = () => {
      if (closed) return
      const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
      evtSourceRef.current = es

      es.onopen = () => {
        if (!closed) setLiveHealthy(true)
      }

      es.onmessage = (ev) => {
        if (closed) return
        try {
          const payload = JSON.parse(ev.data)
          if (payload?.type === 'quote' && payload?.data) {
            const q = payload.data
            setLiveNQ({
              price: Number(q.price || 0),
              change: Number(q.change || 0),
              changePct: Number(q.changePct || 0),
              timestamp: String(q.timestamp || new Date().toISOString()),
            })
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
    }

    openStream()
    return () => {
      closed = true
      if (evtSourceRef.current) {
        evtSourceRef.current.close()
        evtSourceRef.current = null
      }
    }
  }, [])

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* NQ tile — live */}
        <div className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/60 relative">
          <div className="text-[10px] font-mono tracking-wide text-neutral-500">NQ (MNQ proxy)</div>
          <div className="mt-1 text-xl font-semibold text-neutral-100 tabular-nums">
            {nqPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`mt-1 text-xs font-mono tabular-nums ${nqUp ? 'text-green-400' : 'text-red-400'}`}>
            {nqUp ? '▲' : '▼'} {nqChange.toFixed(2)} ({nqChangePct.toFixed(2)}%)
          </div>
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
