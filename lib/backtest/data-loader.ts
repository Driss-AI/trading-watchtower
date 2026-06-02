// ─── BACKTEST — DATA LOADER (I/O) ───────────────────────────────────────────
// The ONLY non-pure module in the backtest. Fetches historical 1-min MNQ/NQ
// bars from TopstepX (sim subscription, live=false — correct for combine/eval)
// day-by-day and groups them into SessionBars the pure replay consumes.
//
// We fetch a narrow ET window per session day (09:25–11:05) — enough for the
// 15-min OR plus the trade window, ~100 bars/call, comfortably under the API
// limit. Weekend days are skipped; market holidays simply return no bars and
// are dropped. A tiny in-process cache avoids refetching the same day.

import { getMinuteBars, getActiveMNQContractId, getActiveNQContractId } from '../topstepx'
import type { BacktestBar, SessionBars } from './types'

// 09:25 ET → 16:00 ET (RTH close). We must load the FULL session, not just the
// morning: breaks are only armed in the trade window (≤11:00 ET) but a taken
// trade needs the rest of the day to actually reach its target or stop. A
// morning-only window force-exits every open trade ~11:00, which strangles the
// target logic and makes the target multiple inert. Start has a small pre-OR
// buffer; end is the regular-session close.
const WINDOW_START_ET = 9 * 60 + 25 // 09:25 ET
const WINDOW_END_ET = 16 * 60       // 16:00 ET (RTH close)

const _cache = new Map<string, SessionBars>() // key: `${market}:${date}`

/** ET offset (hours) for a given date — DST-aware. e.g. EDT → 4, EST → 5. */
function etOffsetHours(date: Date): number {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const et = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return Math.round((utc.getTime() - et.getTime()) / 3_600_000)
}

/** Build a UTC Date for a given YYYY-MM-DD + ET minutes-of-day. */
function etDateTimeToUtc(dateStr: string, etMinutes: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)) // anchor mid-day to get stable offset
  const off = etOffsetHours(noonUtc)
  const hh = Math.floor(etMinutes / 60)
  const mm = etMinutes % 60
  return new Date(Date.UTC(y, m - 1, d, hh + off, mm, 0))
}

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 || dow === 6
}

/** Enumerate YYYY-MM-DD weekdays in [start, end] inclusive. */
export function enumerateSessionDates(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const cur = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10)
    if (!isWeekend(ds)) out.push(ds)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

async function resolveContractId(market: string): Promise<string> {
  return market === 'NQ' ? getActiveNQContractId() : getActiveMNQContractId()
}

/** Fetch one session day's bars. Returns null if the day has no bars (holiday). */
export async function loadSessionDay(market: string, dateStr: string): Promise<SessionBars | null> {
  const key = `${market}:${dateStr}`
  const cached = _cache.get(key)
  if (cached) return cached

  const contractId = await resolveContractId(market)
  const from = etDateTimeToUtc(dateStr, WINDOW_START_ET)
  const to = etDateTimeToUtc(dateStr, WINDOW_END_ET)

  // ~395 one-minute bars across 09:25–16:00 ET; 450 leaves headroom.
  const raw = await getMinuteBars(contractId, from, to, false, 450)
  if (!raw.length) return null

  const bars: BacktestBar[] = raw
    .map((b) => ({ t: new Date(b.t).getTime(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
    .filter((b) => Number.isFinite(b.t) && b.o > 0)
    .sort((a, b) => a.t - b.t)

  if (!bars.length) return null
  const session: SessionBars = { date: dateStr, bars }
  _cache.set(key, session)
  return session
}

export interface LoadProgress {
  loaded: number
  total: number
  date: string
  ok: boolean
}

/** Load a date range, day-by-day. `onProgress` lets callers stream status for
 *  long runs. Days with no bars (holidays) are silently skipped. */
export async function loadSessions(
  market: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<SessionBars[]> {
  const dates = enumerateSessionDates(startDate, endDate)
  const out: SessionBars[] = []
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]
    let ok = false
    try {
      const s = await loadSessionDay(market, date)
      if (s) { out.push(s); ok = true }
    } catch (err) {
      console.error(`[Backtest] loadSessionDay ${date} failed:`, err instanceof Error ? err.message : err)
    }
    onProgress?.({ loaded: out.length, total: dates.length, date, ok })
  }
  return out
}

export function clearBacktestCache(): void {
  _cache.clear()
}
