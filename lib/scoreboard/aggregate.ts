// ─── SCOREBOARD — PURE AGGREGATION ──────────────────────────────────────────
// Turns a flat list of SignalOpportunity rows into the AI-vs-mechanical
// scoreboard + execution-quality analytics. Pure (no I/O, no clock) so it's
// unit-testable; the API route does the querying and hands rows in.
//
// The data asset makes this possible: `outcomeR` is resolved uniformly for
// BOTH taken trades (real fill) and skipped trades (would-have, via the
// skipped-monitor). So every cohort below is measured on the same R scale.
//
// AI VALUE, stated plainly: when the AI removes a trade the mechanical layer
// greenlit, its contribution is the NEGATIVE of that trade's would-have R —
// vetoing a would-be loss is positive value; vetoing a would-be win is a cost.

export interface ScoreboardRow {
  finalDecision: 'take' | 'skip'
  skipSource: string | null
  mechanicalVerdict: string
  direction: 'LONG' | 'SHORT'
  outcomeStatus: string
  outcomeLabel: string | null
  outcomeR: number | null
  mfeR: number | null
  maeR: number | null
  manualExecutionStatus: string
  entry: number
  actualEntry: number | null
  maxChaseDistance: number | null
  executionDelaySeconds: number | null
}

export type CohortKey = 'taken' | 'ai-veto' | 'ai-uncertain' | 'ai-unavailable' | 'mechanical' | 'other'

const COHORT_LABEL: Record<CohortKey, string> = {
  taken: 'Taken (AI-approved)',
  'ai-veto': 'AI veto',
  'ai-uncertain': 'AI uncertain',
  'ai-unavailable': 'AI unavailable',
  mechanical: 'Mechanical skip',
  other: 'Other',
}

// Cohorts the AI removed from the mechanical-greenlit set. The counterfactual
// "take everything mechanical approved, ignore AI" adds these back.
const AI_REMOVED: CohortKey[] = ['ai-veto', 'ai-uncertain', 'ai-unavailable']

const COHORT_ORDER: CohortKey[] = ['taken', 'ai-veto', 'ai-uncertain', 'ai-unavailable', 'mechanical', 'other']

export interface CohortStats {
  key: CohortKey
  label: string
  total: number
  resolved: number
  wins: number
  losses: number
  be: number
  inconclusive: number
  winRate: number | null // wins / (wins + losses); null when nothing decisive
  avgR: number | null
  totalR: number
  avgMfeR: number | null
  avgMaeR: number | null
}

export interface AiScoreboard {
  vetoValueR: number // sum(−wouldR) over resolved AI-vetoes; +ve = vetoes saved R
  goodVetoes: number // vetoed a would-be loss/breakeven
  badVetoes: number // vetoed a would-be win
  vetoAccuracy: number | null // goodVetoes / (good + bad)
  netEdgeR: number // actual taken R − counterfactual; +ve = AI beat take-everything
  takenTotalR: number
  counterfactualAllMechR: number
}

export interface ExecutionQuality {
  takeSignals: number
  taken: number
  missed: number // MISSED + EXPIRED
  skippedByUser: number
  cancelled: number
  notLogged: number
  avgDelaySeconds: number | null
  avgAdverseSlippagePts: number | null // +ve = filled worse than the signal price
  overChaseCount: number // filled past the engine's max-chase line
}

export interface Scoreboard {
  cohorts: CohortStats[]
  ai: AiScoreboard
  execution: ExecutionQuality
  totalRows: number
  resolvedRows: number
  pendingRows: number
}

function cohortOf(r: ScoreboardRow): CohortKey {
  if (r.finalDecision === 'take') return 'taken'
  switch (r.skipSource) {
    case 'ai-veto': return 'ai-veto'
    case 'ai-uncertain': return 'ai-uncertain'
    case 'ai-unavailable': return 'ai-unavailable'
    case 'mechanical': return 'mechanical'
    default: return 'other'
  }
}

function isResolved(r: ScoreboardRow): boolean {
  return r.outcomeStatus === 'resolved' && typeof r.outcomeR === 'number'
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
}

function round(x: number | null, dp = 2): number | null {
  if (x == null) return null
  const f = 10 ** dp
  return Math.round(x * f) / f
}

function statsForCohort(key: CohortKey, rows: ScoreboardRow[]): CohortStats {
  const resolved = rows.filter(isResolved)
  const wins = resolved.filter((r) => r.outcomeLabel === 'win').length
  const losses = resolved.filter((r) => r.outcomeLabel === 'loss').length
  const be = resolved.filter((r) => r.outcomeLabel === 'be').length
  const inconclusive = resolved.filter((r) => r.outcomeLabel === 'inconclusive').length
  const decisive = wins + losses
  const rs = resolved.map((r) => r.outcomeR as number)
  return {
    key,
    label: COHORT_LABEL[key],
    total: rows.length,
    resolved: resolved.length,
    wins, losses, be, inconclusive,
    winRate: decisive ? round((wins / decisive) * 100, 1) : null,
    avgR: round(mean(rs)),
    totalR: round(rs.reduce((s, x) => s + x, 0)) ?? 0,
    avgMfeR: round(mean(resolved.map((r) => r.mfeR).filter((x): x is number => typeof x === 'number'))),
    avgMaeR: round(mean(resolved.map((r) => r.maeR).filter((x): x is number => typeof x === 'number'))),
  }
}

export function buildScoreboard(rows: ScoreboardRow[]): Scoreboard {
  const byCohort = new Map<CohortKey, ScoreboardRow[]>()
  for (const r of rows) {
    const k = cohortOf(r)
    const list = byCohort.get(k) ?? []
    list.push(r)
    byCohort.set(k, list)
  }

  const cohorts = COHORT_ORDER
    .filter((k) => (byCohort.get(k)?.length ?? 0) > 0)
    .map((k) => statsForCohort(k, byCohort.get(k) ?? []))

  // ── AI scoreboard ──
  const vetoResolved = (byCohort.get('ai-veto') ?? []).filter(isResolved)
  const vetoValueR = -vetoResolved.reduce((s, r) => s + (r.outcomeR as number), 0)
  const goodVetoes = vetoResolved.filter((r) => (r.outcomeR as number) <= 0).length
  const badVetoes = vetoResolved.filter((r) => (r.outcomeR as number) > 0).length

  const takenResolved = (byCohort.get('taken') ?? []).filter(isResolved)
  const takenTotalR = takenResolved.reduce((s, r) => s + (r.outcomeR as number), 0)
  const removedR = AI_REMOVED
    .flatMap((k) => (byCohort.get(k) ?? []).filter(isResolved))
    .reduce((s, r) => s + (r.outcomeR as number), 0)
  const counterfactualAllMechR = takenTotalR + removedR
  const netEdgeR = takenTotalR - counterfactualAllMechR // = −removedR

  const ai: AiScoreboard = {
    vetoValueR: round(vetoValueR) ?? 0,
    goodVetoes,
    badVetoes,
    vetoAccuracy: goodVetoes + badVetoes ? round((goodVetoes / (goodVetoes + badVetoes)) * 100, 1) : null,
    netEdgeR: round(netEdgeR) ?? 0,
    takenTotalR: round(takenTotalR) ?? 0,
    counterfactualAllMechR: round(counterfactualAllMechR) ?? 0,
  }

  // ── Execution quality (over TAKE signals only) ──
  const takes = rows.filter((r) => r.finalDecision === 'take')
  const taken = takes.filter((r) => r.manualExecutionStatus === 'TAKEN')
  const delays = taken.map((r) => r.executionDelaySeconds).filter((x): x is number => typeof x === 'number')
  const slippages = taken
    .filter((r) => typeof r.actualEntry === 'number')
    .map((r) => r.direction === 'LONG' ? (r.actualEntry as number) - r.entry : r.entry - (r.actualEntry as number))
  const overChaseCount = taken.filter((r) =>
    typeof r.actualEntry === 'number' && typeof r.maxChaseDistance === 'number' &&
    Math.abs((r.actualEntry as number) - r.entry) > r.maxChaseDistance,
  ).length

  const execution: ExecutionQuality = {
    takeSignals: takes.length,
    taken: taken.length,
    missed: takes.filter((r) => r.manualExecutionStatus === 'MISSED' || r.manualExecutionStatus === 'EXPIRED').length,
    skippedByUser: takes.filter((r) => r.manualExecutionStatus === 'SKIPPED').length,
    cancelled: takes.filter((r) => r.manualExecutionStatus === 'CANCELLED').length,
    notLogged: takes.filter((r) => r.manualExecutionStatus === 'NOT_TAKEN').length,
    avgDelaySeconds: round(mean(delays), 0),
    avgAdverseSlippagePts: round(mean(slippages)),
    overChaseCount,
  }

  const resolvedRows = rows.filter(isResolved).length
  return {
    cohorts,
    ai,
    execution,
    totalRows: rows.length,
    resolvedRows,
    pendingRows: rows.length - resolvedRows,
  }
}
