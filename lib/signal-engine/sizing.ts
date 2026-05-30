// ─── SIGNAL ENGINE — SIZING ─────────────────────────────────────────────────
// Pure contract-sizing math. Caps stack: by config, by daily budget remaining,
// by trailing drawdown remaining, by after-loss rule. After-loss cap is 2;
// drawdown bands ($800 / $400) are advisory to the AI via prompt — the engine
// enforces only the hard caps so the AI retains room to size down further.

import { POINT_VALUES } from '../scoring'
import type { AccountState } from './types'

export interface SizingInputs {
  market: string // 'MNQ' / 'NQ' / etc.
  riskPts: number // |entry - stop|
  account: AccountState
}

export interface SizingResult {
  pointValue: number
  riskDollarsPerContract: number
  hardCap: number // ceiling the engine will enforce
  mechanicalContracts: number // default contract count without AI input
  dailyBudgetRemaining: number
  trailingDrawdownRemaining: number
  capReason: string
}

export function computeSizing(input: SizingInputs): SizingResult {
  const pointValue = POINT_VALUES[input.market] ?? 2
  const riskDollarsPerContract = input.riskPts * pointValue

  const dailyBudgetRemaining = input.account.dailyLossLimit + input.account.dailyPnl
  const trailingDrawdownRemaining = input.account.trailingDrawdownRemaining

  // Floor of "budget / risk" gives the max contracts we can afford to lose.
  const byBudget = riskDollarsPerContract > 0
    ? Math.floor(dailyBudgetRemaining / riskDollarsPerContract)
    : 0
  const byDrawdown = riskDollarsPerContract > 0
    ? Math.floor(trailingDrawdownRemaining / riskDollarsPerContract)
    : 0

  const byConfig = Math.max(1, Math.min(5, input.account.maxContractsConfig))
  const byAfterLoss = input.account.lossesCount > 0 ? 2 : 5

  const caps = [
    { n: byConfig, label: 'config' },
    { n: byBudget, label: 'daily-budget' },
    { n: byDrawdown, label: 'trailing-drawdown' },
    { n: byAfterLoss, label: 'after-loss' },
  ]
  const tightest = caps.reduce((min, c) => (c.n < min.n ? c : min), { n: 5, label: 'global-max' })
  const hardCap = Math.max(0, tightest.n)

  // Default: take the full hardCap (the AI may downsize from here, never up).
  const mechanicalContracts = Math.max(1, hardCap)

  return {
    pointValue,
    riskDollarsPerContract,
    hardCap,
    mechanicalContracts,
    dailyBudgetRemaining,
    trailingDrawdownRemaining,
    capReason: tightest.label,
  }
}
