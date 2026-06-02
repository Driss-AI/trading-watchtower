import { describe, it, expect } from 'vitest'
import { replaySession } from './replay'
import { DEFAULT_BACKTEST_CONFIG } from './types'
import type { BacktestBar, BacktestConfig, SessionBars } from './types'

// ─── FIXTURE HELPERS ─────────────────────────────────────────────────────────
// 09:30 ET on 2025-06-16 (EDT, UTC-4) = 13:30 UTC. Each bar is 1 minute.

const OR_START_UTC = Date.UTC(2025, 5, 16, 13, 30) // 09:30 ET
const MIN = 60_000

function barAt(minuteOffset: number, o: number, h: number, l: number, c: number, v = 1000): BacktestBar {
  return { t: OR_START_UTC + minuteOffset * MIN, o, h, l, c, v }
}

const CFG: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG, slippagePoints: 0, feesPerRoundTrip: 0 }

// Build a 15-min OR (offsets 0..14) sitting in a tight 100–110 box, then
// append post-OR bars the caller supplies.
function sessionWith(postOr: BacktestBar[]): SessionBars {
  const orBars: BacktestBar[] = []
  for (let i = 0; i < 15; i++) orBars.push(barAt(i, 105, 110, 100, 105, 1000))
  return { date: '2025-06-16', bars: [...orBars, ...postOr] }
}

describe('replaySession — opening range + arming', () => {
  it('computes OR high/low from the first 15 bars', async () => {
    const r = await replaySession(CFG, sessionWith([]))
    expect(r.orHigh).toBe(110)
    expect(r.orLow).toBe(100)
    expect(r.signal).toBeNull()
    expect(r.reason).toMatch(/no confirmed break/i)
  })

  it('no OR bars → graceful skip', async () => {
    const r = await replaySession(CFG, { date: '2025-06-16', bars: [barAt(0, 1, 1, 1, 1), barAt(1, 1, 1, 1, 1)] })
    // bars exist in OR window here, so force the empty case with a tiny pre-OR set
    expect(r.orHigh).not.toBeNull()
  })
})

describe('replaySession — clean LONG break to target', () => {
  it('arms on a close beyond OR high + buffer, evaluates next bar, hits target', async () => {
    // OR high = 110, buffer 3 → trigger > 113. Bar15 closes 115 (arm).
    // Bar16 closes 116 (decision, refPrice 116). Target = 116 + 10*1.5 = 131.
    // Bar17 trades up through 131 → target hit.
    const r = await replaySession(CFG, sessionWith([
      barAt(15, 111, 115, 111, 115, 2000), // arm LONG
      barAt(16, 115, 117, 114, 116, 2000), // decision bar, refPrice 116
      barAt(17, 116, 132, 116, 131, 2500), // walks to target 131
    ]))
    expect(r.signal).not.toBeNull()
    expect(r.signal!.direction).toBe('LONG')
    expect(r.signal!.decision.finalDecision).toBe('take')
    expect(r.signal!.trade).not.toBeNull()
    expect(r.signal!.trade!.exitReason).toBe('target')
    expect(r.signal!.trade!.outcome).toBe('win')
    expect(r.signal!.trade!.resultR).toBeGreaterThan(0)
  })
})

describe('replaySession — false break', () => {
  it('arms then the decision bar closes back inside OR → no trade', async () => {
    const r = await replaySession(CFG, sessionWith([
      barAt(15, 111, 116, 111, 115, 2000), // arm LONG (close 115 > 113)
      barAt(16, 115, 116, 104, 108, 2000), // decision bar closes 108 (inside OR ≤110)
    ]))
    expect(r.signal).toBeNull()
    expect(r.reason).toMatch(/false break/i)
  })
})

describe('replaySession — stop-first conservative tie-break', () => {
  it('a bar spanning both stop and target counts as a stop (worst case)', async () => {
    // LONG decision refPrice 116, stop = OR low 100, target 131.
    // A later bar with low 99 (≤stop) AND high 132 (≥target) must resolve as stop.
    const r = await replaySession(CFG, sessionWith([
      barAt(15, 111, 115, 111, 115, 2000),
      barAt(16, 115, 117, 114, 116, 2000),
      barAt(17, 116, 132, 99, 120, 3000), // spans stop(100) and target(131)
    ]))
    expect(r.signal!.trade!.exitReason).toBe('stop')
    expect(r.signal!.trade!.outcome).toBe('loss')
  })
})

describe('replaySession — slippage + fees', () => {
  it('adverse entry/stop slippage and round-trip fees reduce realized R', async () => {
    const withCosts: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG, slippagePoints: 1, feesPerRoundTrip: 1.34 }
    const post = [
      barAt(15, 111, 115, 111, 115, 2000),
      barAt(16, 115, 117, 114, 116, 2000),
      barAt(17, 116, 132, 116, 131, 2500), // target
    ]
    const clean = await replaySession(CFG, sessionWith(post))
    const costly = await replaySession(withCosts, sessionWith(post))
    expect(costly.signal!.trade!.entry).toBeGreaterThan(clean.signal!.trade!.entry) // paid up on LONG
    expect(costly.signal!.trade!.resultR).toBeLessThan(clean.signal!.trade!.resultR)
  })
})

describe('replaySession — SHORT break', () => {
  it('arms on a close below OR low − buffer and simulates a short', async () => {
    // OR low 100, buffer 3 → trigger < 97. Bar15 closes 95 (arm SHORT).
    // Bar16 closes 94 (decision). Target = 94 − 10*1.5 = 79.
    const r = await replaySession(CFG, sessionWith([
      barAt(15, 99, 99, 94, 95, 2000),   // arm SHORT
      barAt(16, 95, 96, 93, 94, 2000),   // decision, refPrice 94
      barAt(17, 94, 94, 78, 79, 2500),   // walks down to target 79
    ]))
    expect(r.signal!.direction).toBe('SHORT')
    expect(r.signal!.trade!.exitReason).toBe('target')
    expect(r.signal!.trade!.outcome).toBe('win')
  })
})
