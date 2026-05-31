// ─── TRADE CARD — RENDER ────────────────────────────────────────────────────
// Pure rendering of a SignalDecision into the manual-execution card the user
// reads in Telegram and the cockpit. The card is the user-facing surface — the
// place where "the system tells you what it sees" actually lands.
//
// Two shapes:
//   TAKE  → action card with entry/stop/target/contracts and the why
//   SKIP  → reasoning card with why-skip and "manual action: stay out"
//
// Format: Telegram HTML (<b> tags) — also reads cleanly as plain text in the UI.

import type { SignalDecision } from '../signal-engine/types'

export interface TradeCardContext {
  /** Account dollars-at-risk-per-contract (entry vs stop × point value). */
  riskDollarsPerContract: number
  /** Daily loss budget remaining after this trade's risk is hypothetically taken. */
  dailyBudgetRemaining: number
}

export function renderTradeCard(decision: SignalDecision, ctx: TradeCardContext): string {
  return decision.finalDecision === 'take'
    ? renderTake(decision, ctx)
    : renderSkip(decision, ctx)
}

// ─── TAKE CARD ──────────────────────────────────────────────────────────────

function renderTake(d: SignalDecision, ctx: TradeCardContext): string {
  const lines: string[] = []
  lines.push(`📣 <b>CALL: ${d.direction}</b> ${d.market}`)
  lines.push(`Time: ${formatTime(d.barTime)}`)
  lines.push('')
  lines.push(`<b>Entry:</b> ${d.entry.toFixed(2)}`)
  lines.push(`<b>Stop:</b>  ${d.stop.toFixed(2)}  (${d.riskPts.toFixed(1)} pts risk)`)
  lines.push(`<b>Target:</b> ${d.target.toFixed(2)}  (${d.rewardPts.toFixed(1)} pts reward)`)
  lines.push(`R:R: ${d.rrRatio.toFixed(2)}:1`)
  lines.push('')
  lines.push(`<b>Recommended:</b> ${d.finalContracts} contract${d.finalContracts === 1 ? '' : 's'}`)
  lines.push(`Max allowed: ${d.hardCap} (mechanical) — capped at ${d.finalContracts} ${capReason(d)}`)
  lines.push(`Risk per contract: $${ctx.riskDollarsPerContract.toFixed(0)}`)
  lines.push(`Total $ risk: $${(ctx.riskDollarsPerContract * d.finalContracts).toFixed(0)} of $${ctx.dailyBudgetRemaining.toFixed(0)} remaining`)
  lines.push('')
  if (d.ai.status === 'ok') {
    lines.push(`<b>Confidence:</b> ${d.ai.confidence}% — ${qualityLabel(d.ai.confidence)}`)
  }
  lines.push(`<b>Setup:</b> ${setupLine(d)}`)
  lines.push('')
  lines.push(`<b>Why take it:</b> ${d.rationale}`)
  lines.push(`<b>Invalidation:</b> a close back inside OR at ${invalidationPrice(d)}, or a candle close past your stop.`)
  lines.push('')
  lines.push(`<b>⏱ Valid until:</b> ${formatClock(d.signalExpiresAt)} (${d.validForSeconds}s)`)
  if (d.entryBandLow != null && d.entryBandHigh != null) {
    lines.push(`<b>Entry band:</b> ${d.entryBandLow.toFixed(2)}–${d.entryBandHigh.toFixed(2)} — CAUTION: take only on a pullback into this zone, do NOT chase.`)
  } else {
    lines.push(`<b>Max chase:</b> ${d.maxChaseDistance.toFixed(1)} pts — cancel if price moves beyond ${d.cancelIfBeyond.toFixed(2)}.`)
  }
  lines.push(`<b>Cancel if:</b> price closes back inside OR, or the window above expires.`)
  lines.push('')
  lines.push(`<b>Manual action:</b> work the order at ${d.entry.toFixed(2)}, hard stop ${d.stop.toFixed(2)}, target ${d.target.toFixed(2)}, ${d.finalContracts} MNQ.`)
  return lines.join('\n')
}

// ─── SKIP CARD ──────────────────────────────────────────────────────────────

function renderSkip(d: SignalDecision, _ctx: TradeCardContext): string {
  const lines: string[] = []
  const header = skipHeader(d)
  lines.push(`${header.emoji} <b>${header.title}</b> ${d.market} ${d.direction}`)
  lines.push(`Time: ${formatTime(d.barTime)}`)
  lines.push('')
  lines.push(`<b>Why skip:</b> ${d.skipReason ?? 'no reason recorded'}`)
  if (d.ai.status === 'ok' && d.ai.reasoning && d.ai.reasoning !== d.skipReason) {
    lines.push(`<b>AI read:</b> ${d.ai.reasoning}`)
  }
  lines.push('')
  lines.push(`<b>Setup:</b> ${setupLine(d)}`)
  lines.push('')
  lines.push(`<b>Manual action:</b> ${manualSkipAction(d)}`)
  return lines.join('\n')
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function skipHeader(d: SignalDecision): { emoji: string; title: string } {
  switch (d.skipSource) {
    case 'mechanical': return { emoji: '⛔', title: 'NO TRADE' }
    case 'ai-veto':    return { emoji: '⛔', title: 'AI VETO' }
    case 'ai-uncertain': return { emoji: '⏭️', title: 'AI SKIPPED' }
    case 'ai-unavailable': return { emoji: '⚠️', title: 'AI DOWN — SKIP' }
    default: return { emoji: '⏭️', title: 'SKIP' }
  }
}

function manualSkipAction(d: SignalDecision): string {
  switch (d.skipSource) {
    case 'mechanical':
      return 'Stay out. The setup did not pass mechanical gates — wait for the next clean break or reverse setup.'
    case 'ai-veto':
      return 'Stay out. Mechanical said take but the brain flagged context risk. Trust the veto.'
    case 'ai-uncertain':
      return 'Stay out. Brain conviction not strong enough; consider it a CAUTION setup that did not earn the entry.'
    case 'ai-unavailable':
      return 'Stay out. AI review failed — never trade without the brain. Investigate the failure before the next signal.'
    default:
      return 'Stay out.'
  }
}

function invalidationPrice(d: SignalDecision): string {
  return d.direction === 'LONG'
    ? `${d.orHigh.toFixed(2)} (OR High)`
    : `${d.orLow.toFixed(2)} (OR Low)`
}

function capReason(d: SignalDecision): string {
  if (d.mechanicalVerdict === 'caution') return '(CAUTION downsize)'
  if (d.ai.status === 'ok' && d.ai.contracts < d.hardCap) return '(AI conviction)'
  return '(hardCap)'
}

function qualityLabel(confidence: number): string {
  if (confidence >= 90) return 'A+ conviction'
  if (confidence >= 80) return 'A-grade'
  if (confidence >= 70) return 'B-grade'
  if (confidence >= 60) return 'C-grade — size carefully'
  return 'low — should have skipped'
}

function setupLine(d: SignalDecision): string {
  const parts: string[] = []
  if (d.pattern.patternName) {
    parts.push(`${d.pattern.patternName} (${d.pattern.verdict})`)
  } else {
    parts.push('no pattern')
  }
  if (d.volume.ratio > 0) {
    parts.push(`vol ${d.volume.ratio.toFixed(2)}× (${d.volume.verdict})`)
  }
  if (d.orderflow.available) {
    parts.push(`Δ ${d.orderflow.shortDelta} (${d.orderflow.verdict})`)
  } else {
    parts.push('flow n/a')
  }
  return parts.join(' · ')
}

function formatTime(barTime: number): string {
  try {
    const d = new Date(barTime)
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) + ' ET'
  } catch {
    return 'unknown time'
  }
}

// Like formatTime but with seconds — the validity window is second-sensitive.
function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }) + ' ET'
  } catch {
    return 'unknown time'
  }
}
