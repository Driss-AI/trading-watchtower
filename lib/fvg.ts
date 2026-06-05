// ─── FAIR VALUE GAP (FVG) DETECTION ───────────────────────────────────────────
// Pure logic — no React, no I/O. A Fair Value Gap (a.k.a. imbalance) is a
// 3-candle inefficiency: a fast displacement leaves a price band that the
// middle candle never traded through. Price tends to return to "rebalance" it,
// which makes the unfilled band a high-probability entry zone.
//
//   Bullish FVG: candle[i-2].high < candle[i].low
//     → gap band = [candle[i-2].high, candle[i].low], sits BELOW current price
//       (a demand zone — pullback-buy on a return into it).
//   Bearish FVG: candle[i-2].low  > candle[i].high
//     → gap band = [candle[i].high, candle[i-2].low], sits ABOVE current price
//       (a supply zone — rally-sell on a return into it).
//
// "filled" = a later candle traded fully through the far edge of the band.

import type { Candle } from './patterns'

export interface FairValueGap {
  dir: 'bullish' | 'bearish'
  top: number        // upper bound of the gap band
  bottom: number     // lower bound of the gap band
  mid: number        // midpoint (consequent encroachment)
  size: number       // band height in points
  originIdx: number  // index of the 3rd (confirming) candle in the series
  ageBars: number    // bars since formed, relative to the end of the series
  filled: boolean    // price later traded through the far edge
}

export interface DetectFVGOptions {
  maxAgeBars?: number   // ignore gaps older than this (default 60)
  includeFilled?: boolean
  minSize?: number      // ignore gaps smaller than this many points (default 0)
}

export function detectFVGs(candles: Candle[], opts: DetectFVGOptions = {}): FairValueGap[] {
  const out: FairValueGap[] = []
  const n = candles.length
  if (n < 3) return out

  const maxAge = opts.maxAgeBars ?? 60
  const minSize = opts.minSize ?? 0

  for (let i = 2; i < n; i++) {
    const a = candles[i - 2] // first candle
    const c = candles[i]     // third (confirming) candle

    let dir: 'bullish' | 'bearish' | null = null
    let top = 0
    let bottom = 0
    if (a.high < c.low) { dir = 'bullish'; top = c.low;  bottom = a.high }
    else if (a.low > c.high) { dir = 'bearish'; top = a.low; bottom = c.high }
    if (!dir) continue

    const size = top - bottom
    if (size < minSize) continue

    const ageBars = (n - 1) - i
    if (ageBars > maxAge) continue

    // Filled when a later candle trades through the FAR edge of the band.
    let filled = false
    for (let j = i + 1; j < n; j++) {
      const f = candles[j]
      if (dir === 'bullish' && f.low <= bottom) { filled = true; break }
      if (dir === 'bearish' && f.high >= top) { filled = true; break }
    }
    if (filled && !opts.includeFilled) continue

    out.push({ dir, top, bottom, mid: (top + bottom) / 2, size, originIdx: i, ageBars, filled })
  }
  return out
}

// Nearest active FVG to a price (optionally constrained to a direction). Returns
// the closest unfilled gap by distance from its nearest edge to the price.
export function nearestFVG(
  fvgs: FairValueGap[],
  price: number,
  dir?: 'bullish' | 'bearish',
): FairValueGap | null {
  let best: FairValueGap | null = null
  let bestDist = Infinity
  for (const g of fvgs) {
    if (g.filled) continue
    if (dir && g.dir !== dir) continue
    const dist = price < g.bottom ? g.bottom - price : price > g.top ? price - g.top : 0
    if (dist < bestDist) { bestDist = dist; best = g }
  }
  return best
}
