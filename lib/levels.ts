// ─── DAILY LIQUIDITY LEVELS (PDH / PDL / PDC) ─────────────────────────────────
// Previous-day High / Low / Close — the strongest intraday liquidity reference
// points. Resting stops cluster above PDH (buy-side liquidity) and below PDL
// (sell-side liquidity); a sweep of these followed by a reversal is the core
// ICT/Smart-Money setup the brain now reasons about.
//
// Fail-open + cached per NY date (levels only change once per session):
//   1. TopStepX daily bars (true prior-session OHLC).
//   2. Fallback: fetchNQ() proxy (previousClose + overnight high/low).
//   3. null — the brain then notes liquidity levels are unavailable.

import { getDailyBars } from './topstepx'
import { fetchNQ } from './market-data'

export interface DailyLevels {
  pdh: number
  pdl: number
  pdc: number
  source: 'topstepx-daily' | 'nq-proxy'
  asOf: string // NY date the levels were computed for
}

let _cache: { date: string; levels: DailyLevels | null } | null = null

function nyDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export async function getDailyLevels(symbol: 'NQ' | 'MNQ' = 'MNQ'): Promise<DailyLevels | null> {
  const date = nyDate()
  if (_cache && _cache.date === date) return _cache.levels

  let levels: DailyLevels | null = null

  // 1) True prior-day OHLC from the broker's daily bars.
  try {
    const bars = await getDailyBars(symbol, 6)
    if (bars.length >= 1) {
      const prev = bars[bars.length - 1] // newest completed day (partial excluded)
      if (prev && prev.h > 0 && prev.l > 0) {
        levels = { pdh: prev.h, pdl: prev.l, pdc: prev.c, source: 'topstepx-daily', asOf: date }
      }
    }
  } catch { /* fall through to proxy */ }

  // 2) Proxy fallback — overnight extremes + previous close.
  if (!levels) {
    try {
      const nq = await fetchNQ()
      if (nq && nq.previousClose > 0 && nq.overnightHigh > 0 && nq.overnightLow > 0) {
        levels = { pdh: nq.overnightHigh, pdl: nq.overnightLow, pdc: nq.previousClose, source: 'nq-proxy', asOf: date }
      }
    } catch { /* leave null */ }
  }

  _cache = { date, levels }
  return levels
}

// Reset cache (tests / manual refresh).
export function _resetLevelsCache(): void { _cache = null }
