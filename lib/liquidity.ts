// ─── LIQUIDITY MAP (PDH/PDL + OR sweeps + FVG) ────────────────────────────────
// Turns the raw candle tape + daily levels into the "liquidity-aware ORB" read
// the brain reasons over: where liquidity rests (PDH/PDL/OR), whether a level was
// just swept and rejected, which side has room, and the active fair-value gaps.
// Pure logic — takes candles + levels as inputs so it is fully testable.

import type { Candle } from './patterns'
import { detectFVGs, nearestFVG, type FairValueGap } from './fvg'
import type { DailyLevels } from './levels'

export interface SweepResult {
  swept: boolean
  level: number
  side: 'above' | 'below'
  atIdx: number | null
  rejected: boolean // poked through then closed back on the inside
}

// Most recent poke beyond `level` within `lookback` bars, and whether price has
// since closed back inside (the rejection that makes a sweep tradeable).
export function detectSweep(
  candles: Candle[], level: number, side: 'above' | 'below', lookback = 12,
): SweepResult {
  const n = candles.length
  const base: SweepResult = { swept: false, level, side, atIdx: null, rejected: false }
  if (!n || !Number.isFinite(level) || level <= 0) return base

  const start = Math.max(0, n - lookback)
  let pokeIdx = -1
  for (let i = n - 1; i >= start; i--) {
    const c = candles[i]
    if (side === 'above' && c.high > level) { pokeIdx = i; break }
    if (side === 'below' && c.low < level) { pokeIdx = i; break }
  }
  if (pokeIdx < 0) return base

  const after = candles.slice(pokeIdx)
  const rejected = side === 'above' ? after.some(b => b.close < level) : after.some(b => b.close > level)
  return { swept: true, level, side, atIdx: pokeIdx, rejected }
}

export interface LiquidityInput {
  candles: Candle[]
  lastPrice: number
  orHigh?: number | null
  orLow?: number | null
  levels?: DailyLevels | null
  breakDirection?: 'LONG' | 'SHORT' | null
}

export interface LiquidityRead {
  text: string
  fvgs: FairValueGap[]
  classification: 'continuation' | 'sweep-reversal' | 'no-room' | 'neutral'
  reversalHint: string | null
}

const f = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function buildLiquidityRead(input: LiquidityInput): LiquidityRead {
  const { candles, lastPrice } = input
  const orHigh = input.orHigh ?? null
  const orLow = input.orLow ?? null
  const levels = input.levels ?? null
  const dir = input.breakDirection ?? null

  const fvgs = detectFVGs(candles, { maxAgeBars: 60, minSize: 0 })
  const lines: string[] = []
  lines.push(`LIQUIDITY MAP${levels ? ` (source: ${levels.source})` : ''}:`)

  // ── Levels ──
  if (levels) {
    const rel = (lvl: number) => lvl >= lastPrice ? `▲ ${f(lvl - lastPrice)} above` : `▼ ${f(lastPrice - lvl)} below`
    lines.push(`- PDH ${f(levels.pdh)} (${rel(levels.pdh)}) | PDL ${f(levels.pdl)} (${rel(levels.pdl)}) | PDC ${f(levels.pdc)}`)
  } else {
    lines.push('- PDH/PDL/PDC: unavailable (no daily-levels feed).')
  }
  if (orHigh != null && orLow != null) {
    lines.push(`- OR High ${f(orHigh)} | OR Low ${f(orLow)} (${f(orHigh - orLow)} pts)`)
  }

  // ── Room to next opposing liquidity ──
  const liqAbove = [orHigh, levels?.pdh].filter((x): x is number => x != null && x > lastPrice).sort((a, b) => a - b)
  const liqBelow = [orLow, levels?.pdl].filter((x): x is number => x != null && x < lastPrice).sort((a, b) => b - a)
  const nextAbove = liqAbove[0] ?? null
  const nextBelow = liqBelow[0] ?? null
  lines.push(`- Room: next liquidity above ${nextAbove != null ? `${f(nextAbove)} (${f(nextAbove - lastPrice)} pts)` : 'none nearby'}, below ${nextBelow != null ? `${f(nextBelow)} (${f(lastPrice - nextBelow)} pts)` : 'none nearby'}`)

  // ── Sweep state of the key levels ──
  const sweeps: string[] = []
  const orHighSweep = orHigh != null ? detectSweep(candles, orHigh, 'above') : null
  const orLowSweep = orLow != null ? detectSweep(candles, orLow, 'below') : null
  const pdhSweep = levels ? detectSweep(candles, levels.pdh, 'above') : null
  const pdlSweep = levels ? detectSweep(candles, levels.pdl, 'below') : null
  const tag = (name: string, s: SweepResult | null) => {
    if (s?.swept) sweeps.push(`${name} swept${s.rejected ? ' & REJECTED (liquidity taken, reversal risk)' : ' (holding — possible continuation)'}`)
  }
  tag('OR-High', orHighSweep); tag('OR-Low', orLowSweep); tag('PDH', pdhSweep); tag('PDL', pdlSweep)
  lines.push(sweeps.length ? `- Sweeps: ${sweeps.join('; ')}` : '- Sweeps: none in the recent window.')

  // ── Active FVGs near price ──
  const nearBull = nearestFVG(fvgs, lastPrice, 'bullish')
  const nearBear = nearestFVG(fvgs, lastPrice, 'bearish')
  const fvgBits: string[] = []
  if (nearBull) fvgBits.push(`bullish ${f(nearBull.bottom)}–${f(nearBull.top)} (mid ${f(nearBull.mid)})`)
  if (nearBear) fvgBits.push(`bearish ${f(nearBear.bottom)}–${f(nearBear.top)} (mid ${f(nearBear.mid)})`)
  lines.push(fvgBits.length ? `- Active FVGs near price: ${fvgBits.join(', ')}` : '- Active FVGs near price: none.')

  // ── Classification + reversal hint (heuristic; the AI makes the final call) ──
  let classification: LiquidityRead['classification'] = 'neutral'
  let reversalHint: string | null = null

  if (dir) {
    const orSize = (orHigh != null && orLow != null) ? orHigh - orLow : 0
    const noRoomThreshold = orSize > 0 ? orSize : 15
    const roomInDir = dir === 'LONG'
      ? (nextAbove != null ? nextAbove - lastPrice : Infinity)
      : (nextBelow != null ? lastPrice - nextBelow : Infinity)

    // A failed break of the level in the break direction = sweep-reversal setup.
    const dirSweep = dir === 'LONG' ? (pdhSweep?.rejected || orHighSweep?.rejected) : (pdlSweep?.rejected || orLowSweep?.rejected)

    if (dirSweep) {
      classification = 'sweep-reversal'
      const oppDir = dir === 'LONG' ? 'SHORT' : 'LONG'
      const window = candles.slice(Math.max(0, candles.length - 12))
      const sweepExtreme = dir === 'LONG' ? Math.max(...window.map(c => c.high)) : Math.min(...window.map(c => c.low))
      const entryFvg = oppDir === 'SHORT' ? nearestFVG(fvgs, lastPrice, 'bearish') : nearestFVG(fvgs, lastPrice, 'bullish')
      const target = oppDir === 'SHORT' ? nextBelow : nextAbove
      reversalHint =
        `Sweep-reversal: the ${dir} break swept liquidity and was rejected → consider ${oppDir}` +
        (entryFvg ? ` into the ${entryFvg.dir} FVG ${f(entryFvg.bottom)}–${f(entryFvg.top)}` : ` on a retest`) +
        `, stop beyond the sweep extreme ${f(sweepExtreme)}` +
        (target != null ? `, target ${f(target)}.` : '.')
    } else if (roomInDir < noRoomThreshold) {
      classification = 'no-room'
    } else {
      classification = 'continuation'
    }

    lines.push(`- Read hint (${dir} break): ${classification.toUpperCase()}${classification === 'no-room' ? ` — only ${f(roomInDir)} pts to the next opposing liquidity` : ''}.`)
    if (reversalHint) lines.push(`- ${reversalHint}`)
  }

  return { text: lines.join('\n'), fvgs, classification, reversalHint }
}

// Text-only convenience for prompt injection.
export function buildLiquidityContext(input: LiquidityInput): string {
  return buildLiquidityRead(input).text
}
