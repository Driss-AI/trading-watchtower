// ─── OPPORTUNITY LOG — SKIPPED-TRADE MONITOR ────────────────────────────────
// Tracks would-have outcomes for skipped opportunities. The paper engine pipes
// every tick through onTick(price); when a skipped signal's would-have stop
// or target is touched, the row is resolved with mfeR / maeR / outcome label.
// Unresolved trackers at session end become 'inconclusive' with the current
// price excursion baked in.
//
// MFE = max favorable excursion, MAE = max adverse excursion, both in R units
// where R = |would-entry − would-stop|. This makes outcomes comparable across
// trades with different stop distances.

import { resolveOutcome, type OutcomeLabel } from './attach-outcome'

interface ActiveSkipped {
  opportunityId: string
  direction: 'LONG' | 'SHORT'
  entry: number
  stop: number
  target: number
  risk: number
  mfePts: number
  maePts: number
}

const _active = new Map<string, ActiveSkipped>()

/** Start tracking a skipped opportunity for would-have outcome. */
export function trackSkipped(input: {
  opportunityId: string
  direction: 'LONG' | 'SHORT'
  wouldEntry: number
  wouldStop: number
  wouldTarget: number
}): void {
  const risk = Math.abs(input.wouldEntry - input.wouldStop)
  if (risk <= 0) return // can't compute R-units; skip tracking
  _active.set(input.opportunityId, {
    opportunityId: input.opportunityId,
    direction: input.direction,
    entry: input.wouldEntry,
    stop: input.wouldStop,
    target: input.wouldTarget,
    risk,
    mfePts: 0,
    maePts: 0,
  })
}

/** Update all active trackers against a new price tick. Resolves outcomes that
 *  hit their stop or target and removes them from the active set. */
export async function onTick(price: number): Promise<void> {
  if (_active.size === 0 || !(price > 0)) return

  const resolutions: Array<{ id: string; label: OutcomeLabel; outcomeR: number; mfeR: number; maeR: number }> = []

  for (const t of Array.from(_active.values())) {
    const favPts = t.direction === 'LONG' ? price - t.entry : t.entry - price
    const advPts = t.direction === 'LONG' ? t.entry - price : price - t.entry
    if (favPts > t.mfePts) t.mfePts = favPts
    if (advPts > t.maePts) t.maePts = advPts

    // Target / stop hit logic — first one to touch wins.
    const targetHit = t.direction === 'LONG' ? price >= t.target : price <= t.target
    const stopHit = t.direction === 'LONG' ? price <= t.stop : price >= t.stop

    if (targetHit) {
      const outcomeR = (Math.abs(t.target - t.entry)) / t.risk
      resolutions.push({
        id: t.opportunityId,
        label: 'win',
        outcomeR,
        mfeR: t.mfePts / t.risk,
        maeR: t.maePts / t.risk,
      })
      _active.delete(t.opportunityId)
    } else if (stopHit) {
      resolutions.push({
        id: t.opportunityId,
        label: 'loss',
        outcomeR: -1,
        mfeR: t.mfePts / t.risk,
        maeR: t.maePts / t.risk,
      })
      _active.delete(t.opportunityId)
    }
  }

  for (const r of resolutions) {
    try {
      await resolveOutcome({
        opportunityId: r.id,
        label: r.label,
        outcomeR: r.outcomeR,
        mfeR: r.mfeR,
        maeR: r.maeR,
      })
    } catch (err) {
      console.error(`[MonitorSkipped] Failed to resolve ${r.id}:`, err)
    }
  }
}

/** Resolve all still-active trackers as 'inconclusive' with current excursion.
 *  Called at session close (11:30 ET) or engine shutdown. */
export async function resolveAllAtSessionEnd(): Promise<void> {
  if (_active.size === 0) return
  const snapshot = Array.from(_active.values())
  _active.clear()

  for (const t of snapshot) {
    // For inconclusive trades, outcomeR is the signed net excursion: the better
    // of MFE and the unrealized direction the price is in at close. We use
    // mfeR - maeR as a coarse net-R signal, capped at ±1 to avoid overstating.
    const mfeR = t.mfePts / t.risk
    const maeR = t.maePts / t.risk
    const netR = Math.max(-1, Math.min(1, mfeR - maeR))
    try {
      await resolveOutcome({
        opportunityId: t.opportunityId,
        label: 'inconclusive',
        outcomeR: netR,
        mfeR,
        maeR,
      })
    } catch (err) {
      console.error(`[MonitorSkipped] Failed to resolve inconclusive ${t.opportunityId}:`, err)
    }
  }
}

/** Clear all in-process state. Called at engine reset / new trading day. */
export function resetMonitorDay(): void {
  _active.clear()
}

/** Diagnostic: number of skipped signals currently being tracked. */
export function activeCount(): number {
  return _active.size
}
