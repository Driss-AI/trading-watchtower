// ─── BACKTEST — RUNNER (I/O orchestration) ──────────────────────────────────
// Ties load → replay → metrics → persist. Loads historical sessions, replays
// each through the pure engine, computes split metrics, then (optionally)
// writes a BacktestRun summary plus one SignalOpportunity row per evaluated
// signal (source:'backtest') with the simulated outcome resolved.

import { prisma } from '../prisma'
import { writeSignalOpportunity } from '../opportunity-log/record'
import { resolveOutcome } from '../opportunity-log/attach-outcome'
import { loadSessions, type LoadProgress } from './data-loader'
import { replayRange } from './replay'
import { computeSplitMetrics, signalsFromSessions, tradesFromSessions } from './metrics'
import { DEFAULT_BACKTEST_CONFIG } from './types'
import type { BacktestConfig, SessionReplay, SplitMetrics } from './types'
import type { SignalState } from '../signal-engine/types'

export interface RunBacktestInput {
  name: string
  startDate: string // YYYY-MM-DD
  endDate: string
  config?: Partial<BacktestConfig>
  persist?: boolean // write BacktestRun + opportunity rows (default true)
  onProgress?: (p: LoadProgress) => void
}

export interface RunBacktestResult {
  runId: string | null
  config: BacktestConfig
  sessionsLoaded: number
  metrics: SplitMetrics
  sessions: SessionReplay[]
}

export async function runBacktest(input: RunBacktestInput): Promise<RunBacktestResult> {
  const config: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG, ...input.config }
  const persist = input.persist ?? true

  const sessions = await loadSessions(config.market, input.startDate, input.endDate, input.onProgress)
  const replays = await replayRange(config, sessions)
  const metrics = computeSplitMetrics(replays)

  let runId: string | null = null
  if (persist) {
    runId = await persistRun(input, config, replays, metrics)
  }

  return {
    runId,
    config,
    sessionsLoaded: sessions.length,
    metrics,
    sessions: replays,
  }
}

async function persistRun(
  input: RunBacktestInput,
  config: BacktestConfig,
  replays: SessionReplay[],
  metrics: SplitMetrics,
): Promise<string> {
  const m = metrics.all

  const run = await prisma.backtestRun.create({
    data: {
      name: input.name,
      market: config.market,
      startDate: input.startDate,
      endDate: input.endDate,
      strategyVersion: 'degraded-v1',
      settingsJson: config as unknown as object,
      totalSessions: replays.length,
      totalSignals: m.totalSignals,
      totalTrades: m.totalTrades,
      wins: m.wins,
      losses: m.losses,
      winRate: m.winRate,
      totalR: m.totalR,
      expectancyR: m.expectancyR,
      profitFactor: Number.isFinite(m.profitFactor) ? m.profitFactor : 999,
      maxDrawdownR: m.maxDrawdownR,
      maxLosingStreak: m.maxLosingStreak,
      splitDate: metrics.splitDate,
      oosExpectancyR: metrics.outOfSample.expectancyR,
      oosTrades: metrics.outOfSample.totalTrades,
      metricsJson: metrics as unknown as object,
    },
  })

  // Per-signal rows (best-effort — a failed row never kills the run).
  const signals = signalsFromSessions(replays)
  for (const sig of signals) {
    try {
      const opportunityId = await writeSignalOpportunity({
        // The replayed decision carries a SignalState-shaped context; rebuild the
        // minimal state record() needs from the decision + session.
        state: stateFromSignal(sig.date, sig.decision),
        decision: sig.decision,
        source: 'backtest',
      })
      if (sig.trade) {
        await resolveOutcome({
          opportunityId,
          label: sig.trade.outcome === 'be' ? 'be' : sig.trade.outcome,
          outcomeR: sig.trade.resultR,
          mfeR: 0,
          maeR: 0,
        })
      }
    } catch (err) {
      console.error('[Backtest] persist signal failed:', err instanceof Error ? err.message : err)
    }
  }

  return run.id
}

// record() reads a handful of fields off SignalState. The decision already
// carries the geometry/gates; reconstruct the slim state it needs.
function stateFromSignal(date: string, decision: import('../signal-engine/types').SignalDecision): SignalState {
  return {
    date,
    barTime: decision.barTime,
    market: decision.market,
    decisionPoint: 'breakout',
    direction: decision.direction,
    orHigh: decision.orHigh,
    orLow: decision.orLow,
    orSize: Math.abs(decision.orHigh - decision.orLow),
    bufferPoints: 0,
    refPrice: decision.entry,
    stopPrice: decision.stop,
    targetPrice: decision.target,
    targetMultiple: 0,
    account: {
      dailyPnl: 0, tradesCount: 0, lossesCount: 0,
      dailyLossLimit: 0, trailingDrawdownRemaining: 0, maxContractsConfig: 0,
    },
    structural: {
      vwap: null, vwapDistance: null,
      priorDayHigh: null, priorDayLow: null,
      overnightHigh: null, overnightLow: null,
    },
    prior: { preSession: null, orAssessment: null },
    breakBar: null,
    recent: null,
    orderflow: decision.orderflow,
    candleFreshness: decision.candleFreshness,
    orderflowFreshness: decision.orderflowFreshness,
    macroFreshness: decision.macroFreshness,
    accountFreshness: decision.accountFreshness,
    config: { enablePatternGate: true, enableVolumeGate: true, enableOrderflowVeto: true },
  }
}
