// ─── BREAKOUT GATE ────────────────────────────────────────────────────────────
// Turns the just-closed 1-min bar at the OR boundary into a verdict the engine
// uses to decide whether to even ask the AI about entering. Two gates:
//
//   1. PATTERN GATE — uses lib/patterns.ts on the latest closed bar (and the
//      few before it for multi-bar setups). Trap patterns at the level produce
//      a hard veto so the engine never even prompts the LLM. Confirm patterns
//      flow through to the AI with full size headroom.
//
//   2. VOLUME GATE — the break-bar must trade with conviction. Volume below
//      0.8x of the trailing 20-bar average suggests an algo wick rather than
//      real participation.
//
// Both gates FAIL-OPEN by design: if data is missing (no candles yet, no
// average volume, pattern returns null) the gate returns 'neutral' so the AI
// is the deciding voice. The hard veto only fires on egregious cases.

import { detectPattern, type Candle } from './patterns'
import type { EngineCandle } from './candles'

export type GateVerdict = 'confirm' | 'caution' | 'neutral' | 'veto'

export interface PatternGate {
  verdict: GateVerdict
  patternName: string | null
  patternSignal: 'bullish' | 'bearish' | 'neutral' | 'caution' | null
  patternStrength: number | null
  orbContext: string | null
  reasons: string[]
}

export interface VolumeGate {
  verdict: GateVerdict
  breakVolume: number
  avgVolume: number
  ratio: number
  reasons: string[]
}

// ─── PATTERN GATE ────────────────────────────────────────────────────────────

// Patterns that turn a fresh breakout into a high-probability trap. At OR High
// for LONG: sellers showed up at the level (shooting star, bearish engulfing,
// bearish marubozu, bearish pin) or the market is indecisive (doji). Inverted
// hammer is included because it's "caution" in patterns.ts and at the boundary
// caution = don't take the break.
const LONG_TRAP_PATTERNS = new Set([
  'Shooting Star',
  'Doji',
  'Bearish Engulfing',
  'Bearish Marubozu',
  'Pin Bar (Bearish)',
  'Inverted Hammer',
])

const SHORT_TRAP_PATTERNS = new Set([
  'Hammer',
  'Doji',
  'Bullish Engulfing',
  'Bullish Marubozu',
  'Pin Bar (Bullish)',
])

// Patterns that confirm the breakout side — institutions agree with the move.
const LONG_CONFIRM_PATTERNS = new Set([
  '3-Candle Bull Stack',
  'Bullish Marubozu',
  'Bullish Engulfing',
  'Strong Bull Candle',
  'Hammer',
  'Pin Bar (Bullish)',
])

const SHORT_CONFIRM_PATTERNS = new Set([
  '3-Candle Bear Stack',
  'Bearish Marubozu',
  'Bearish Engulfing',
  'Strong Bear Candle',
  'Shooting Star',
  'Pin Bar (Bearish)',
])

// Inside Bar is a wait-and-see — neither veto nor confirm. The engine should
// re-evaluate on the next close.
const CAUTION_PATTERNS = new Set(['Inside Bar'])

export function evaluatePatternGate(
  direction: 'LONG' | 'SHORT',
  candles: EngineCandle[],
): PatternGate {
  if (candles.length === 0) {
    return {
      verdict: 'neutral',
      patternName: null, patternSignal: null, patternStrength: null,
      orbContext: null,
      reasons: ['no closed candles yet — gate fail-open (neutral)'],
    }
  }

  const idx = candles.length - 1
  // detectPattern expects the wider Candle interface; EngineCandle extends it.
  const pat = detectPattern(candles as Candle[], idx)
  if (!pat) {
    return {
      verdict: 'neutral',
      patternName: null, patternSignal: null, patternStrength: null,
      orbContext: null,
      reasons: ['no recognizable pattern on the break bar'],
    }
  }

  const reasons: string[] = []
  let verdict: GateVerdict

  const trapSet = direction === 'LONG' ? LONG_TRAP_PATTERNS : SHORT_TRAP_PATTERNS
  const confirmSet = direction === 'LONG' ? LONG_CONFIRM_PATTERNS : SHORT_CONFIRM_PATTERNS

  if (trapSet.has(pat.name)) {
    verdict = 'veto'
    reasons.push(`trap pattern at OR boundary — ${pat.name} (${pat.signal}, ${pat.strength}%)`)
    reasons.push(pat.orbContext)
  } else if (CAUTION_PATTERNS.has(pat.name)) {
    verdict = 'caution'
    reasons.push(`${pat.name} — wait-and-see, re-evaluate on next close`)
  } else if (confirmSet.has(pat.name)) {
    verdict = 'confirm'
    reasons.push(`${pat.name} confirms the ${direction} break (${pat.strength}% strength)`)
  } else {
    verdict = 'neutral'
    reasons.push(`${pat.name} — neutral for the ${direction} break`)
  }

  return {
    verdict,
    patternName: pat.name,
    patternSignal: pat.signal,
    patternStrength: pat.strength,
    orbContext: pat.orbContext,
    reasons,
  }
}

// ─── VOLUME GATE ─────────────────────────────────────────────────────────────

const VOLUME_VETO_RATIO   = 0.8  // break bar < 0.8× avg → no conviction → veto
const VOLUME_CAUTION_RATIO = 1.0  // < 1.0× → caution
const VOLUME_CONFIRM_RATIO = 1.4  // >= 1.4× → strong confirm

export function evaluateVolumeGate(breakVolume: number, avgVolume: number): VolumeGate {
  // Fail-open: no average yet (first bars of the day) means we can't judge.
  if (avgVolume <= 0 || breakVolume <= 0) {
    return {
      verdict: 'neutral',
      breakVolume, avgVolume, ratio: 0,
      reasons: ['volume baseline unavailable — gate fail-open (neutral)'],
    }
  }

  const ratio = breakVolume / avgVolume

  if (ratio < VOLUME_VETO_RATIO) {
    return {
      verdict: 'veto',
      breakVolume, avgVolume, ratio,
      reasons: [`thin break bar — ${breakVolume} vs ${avgVolume.toFixed(0)} avg (${ratio.toFixed(2)}×). No participation.`],
    }
  }
  if (ratio < VOLUME_CAUTION_RATIO) {
    return {
      verdict: 'caution',
      breakVolume, avgVolume, ratio,
      reasons: [`light break-bar volume — ${ratio.toFixed(2)}× avg`],
    }
  }
  if (ratio >= VOLUME_CONFIRM_RATIO) {
    return {
      verdict: 'confirm',
      breakVolume, avgVolume, ratio,
      reasons: [`heavy break-bar volume — ${ratio.toFixed(2)}× avg, conviction present`],
    }
  }
  return {
    verdict: 'neutral',
    breakVolume, avgVolume, ratio,
    reasons: [`break-bar volume ${ratio.toFixed(2)}× avg — normal`],
  }
}

// ─── COMBINED GATE VERDICT ───────────────────────────────────────────────────
// The engine asks: given pattern, volume, and order-flow assessments, should
// we proceed to the AI breakout decision at all? Veto if ANY says veto. Then
// the most cautious of the rest sets the cap.
export type CombinedVerdict = 'veto' | 'caution' | 'confirm' | 'neutral'

export function combineVerdicts(verdicts: GateVerdict[]): CombinedVerdict {
  if (verdicts.includes('veto')) return 'veto'
  if (verdicts.includes('caution')) return 'caution'
  if (verdicts.every((v) => v === 'confirm')) return 'confirm'
  return 'neutral'
}
