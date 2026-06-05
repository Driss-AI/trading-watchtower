// ─── BRAIN LIVE-CONTEXT SNAPSHOT ──────────────────────────────────────────────
// Assembles the current trading picture into a compact text block that gets
// injected into the Brain chat system prompt, so the user can ask "what's your
// read right now?" and the model answers against real data.
//
// Every source is fail-open: if a global isn't populated (market closed, no
// tape) or a DB read throws, that section degrades to a one-line note instead
// of failing the whole snapshot.

import { prisma } from '../prisma'
import {
  getRecentCandles,
  getLatestClosedCandle,
  getAvgVolume,
  isStale as candleIsStale,
} from '../candles'
import { getOrderflowSnapshot } from '../orderflow'
import { fetchMarketBriefing } from '../market-data'

function nyDate(): string {
  // en-CA gives YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function nyTime(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// Macro briefing makes several external calls; cache it briefly so rapid-fire
// chat messages don't refetch on every turn.
let _macroCache: { at: number; text: string } | null = null
const MACRO_TTL_MS = 60_000

async function macroSection(): Promise<string> {
  if (_macroCache && Date.now() - _macroCache.at < MACRO_TTL_MS) return _macroCache.text
  try {
    const briefing: any = await Promise.race([
      fetchMarketBriefing(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('macro timeout')), 2500)),
    ])
    const bits: string[] = []
    if (briefing?.vix?.level != null) bits.push(`VIX ${briefing.vix.level} (${briefing.vix.label ?? briefing.vix.status ?? '—'})`)
    if (briefing?.qqq?.price != null) bits.push(`QQQ ${briefing.qqq.price} ${briefing.qqq.direction ?? ''}`.trim())
    if (briefing?.nq?.price != null) bits.push(`NQ ${briefing.nq.price}`)
    if (briefing?.vwap != null) bits.push(`VWAP ${briefing.vwap}`)
    const text = bits.length ? `\nMACRO: ${bits.join(' | ')}` : '\nMACRO: unavailable.'
    _macroCache = { at: Date.now(), text }
    return text
  } catch {
    return '\nMACRO: unavailable (slow/offline).'
  }
}

export async function buildBrainContext(opts: { includeMacro?: boolean } = {}): Promise<string> {
  const sections: string[] = [`LIVE CONTEXT SNAPSHOT — ${nyTime()} ET`]

  // ── 1-min candles (the live tape) ──
  try {
    const bars = getRecentCandles(100)
    const latest = getLatestClosedCandle()
    const avg = getAvgVolume(20)
    const stale = candleIsStale()
    if (bars.length > 0) {
      const rows = bars.map((b) => {
        const t = new Date(b.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })
        const rng = b.high - b.low
        const bodyPct = rng > 0 ? Math.round((Math.abs(b.close - b.open) / rng) * 100) : 0
        const dir = b.close > b.open ? '↑' : b.close < b.open ? '↓' : '·'
        return `  ${t} ${dir} O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)} body:${bodyPct}% vol:${b.volume}`
      }).join('\n')
      sections.push(`\n1-MIN CANDLES — last ${bars.length}, oldest→newest${stale ? ' [STALE TAPE]' : ''} | last ${latest ? latest.close.toFixed(2) : 'n/a'} | 20-bar avg vol ${avg.toFixed(0)}:\n${rows}`)
    } else {
      sections.push('\n1-MIN CANDLES: none yet (market closed or no live tape).')
    }
  } catch {
    sections.push('\n1-MIN CANDLES: unavailable.')
  }

  // ── Order flow ──
  try {
    const of = getOrderflowSnapshot()
    if (of.available) {
      sections.push(`\nORDER FLOW: cumulative Δ ${of.cumDelta} | recent-window Δ ${of.shortDelta} | book levels ${of.bookLevels} | bid ${of.bestBid ?? 'n/a'} / ask ${of.bestAsk ?? 'n/a'}`)
    } else {
      sections.push('\nORDER FLOW: stale/unavailable (no live DOM/tape).')
    }
  } catch {
    sections.push('\nORDER FLOW: unavailable.')
  }

  // ── Opening range (today) ──
  try {
    const session = await prisma.session.findFirst({ where: { date: nyDate() }, orderBy: { id: 'desc' } })
    if (session && session.orHigh != null && session.orLow != null) {
      const size = session.orSize ?? session.orHigh - session.orLow
      sections.push(`\nOPENING RANGE (today): High ${session.orHigh.toFixed(2)} / Low ${session.orLow.toFixed(2)} (${size.toFixed(2)} pts)`)
    } else {
      sections.push('\nOPENING RANGE: not captured yet today.')
    }
  } catch {
    sections.push('\nOPENING RANGE: unavailable.')
  }

  // ── Risk limits ──
  try {
    const s = await prisma.settings.findFirst()
    if (s) {
      sections.push(`\nRISK LIMITS: daily loss $${s.dailyLossLimit} | trailing drawdown $${s.trailingDrawdown} | profit target $${s.profitTarget} | max ${s.maxTradesPerDay} trades/day, ${s.maxLosingTradesPerDay} losses/day`)
    }
  } catch { /* fail-open */ }

  // ── Recent signals (today) ──
  try {
    const sigs = await prisma.signalOpportunity.findMany({
      where: { date: nyDate() },
      orderBy: { id: 'desc' },
      take: 5,
    })
    if (sigs.length) {
      const rows = sigs.map((s: any) => {
        const ai = s.aiEnter === true ? 'ENTER' : s.aiEnter === false ? 'SKIP' : '—'
        const conf = s.aiConfidence != null ? ` ${s.aiConfidence}%` : ''
        const entry = typeof s.entry === 'number' ? s.entry.toFixed(2) : '?'
        return `  ${s.direction} @ ${entry} → AI ${ai}${conf}`
      }).join('\n')
      sections.push(`\nRECENT SIGNALS (today, newest first):\n${rows}`)
    } else {
      sections.push('\nRECENT SIGNALS: none logged today.')
    }
  } catch { /* fail-open */ }

  // ── Macro (best-effort, cached) ──
  if (opts.includeMacro !== false) {
    sections.push(await macroSection())
  }

  return sections.join('\n')
}
