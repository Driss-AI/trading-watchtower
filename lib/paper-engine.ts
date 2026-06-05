// ─── PAPER TRADING ENGINE ─────────────────────────────────────────────────────
// Server-side singleton that watches the live MNQ price stream and simulates
// ORB breakout trades. No real orders are placed — trades are recorded to the
// database with source="paper" for later analysis.
//
// State machine: idle → forming → monitoring → closed
//   idle:       engine off or outside trading hours
//   forming:    9:30–9:45 AM ET — building the opening range from live ticks
//   monitoring: 9:45–11:30 AM ET — watching for breakout, managing positions
//   closed:     after 11:30 AM ET — session done, no new trades

import { PrismaClient } from '@prisma/client'
import {
  subscribe,
  connectMarketHub,
  subscribeToQuote,
  type WSQuote,
  type WSEvent,
} from './topstepx-ws'
import { getActiveMNQContractId } from './topstepx'
import { getDailyLevels } from './levels'
import { calculateRisk, POINT_VALUES } from './scoring'
import {
  analyzePreSession,
  analyzeOpeningRange,
  summarizeSession,
  type PreSessionDecision,
  type ORAssessment,
  type BreakoutDecision,
  type SessionDebriefInput,
} from './trading-ai'
import { fetchMarketBriefing, fetchMacroSentiment } from './market-data'
import { getSessionImpact } from './calendar-intel'
import {
  startOrderflow,
  resetOrderflowDay,
  assessBreakout,
  getOrderflowSnapshot,
  type OrderflowAssessment,
  type OrderflowSnapshot,
} from './orderflow'
import {
  startCandles,
  resetCandlesDay,
  getLatestClosedCandle,
  getRecentCandles,
  getAvgVolume,
  getCandleSnapshot,
  type CandleSnapshot,
  type EngineCandle,
} from './candles'
import type { PatternGate, VolumeGate } from './breakout-gate'
import { sendTelegramAlert } from './telegram'

// Sprint 1: shared signal engine + opportunity log.
import { evaluateSignal } from './signal-engine'
import { collectBreakoutSignalState } from './signal-context/collect'
import { writeSignalOpportunity, linkPaperTrade } from './opportunity-log/record'
import { resolveOutcome } from './opportunity-log/attach-outcome'
import {
  trackSkipped,
  onTick as monitorOnTick,
  resolveAllAtSessionEnd as monitorResolveAll,
  resetMonitorDay,
} from './opportunity-log/monitor-skipped'
import { renderTradeCard } from './trade-card/render'

// ─── TELEGRAM HELPER ────────────────────────────────────────────────────────

function notify(message: string): void {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
  if (!token || !chatId) return
  sendTelegramAlert({ botToken: token, chatId }, message).catch(() => {})
}

const prisma = new PrismaClient()
const MNQ_POINT_VALUE = POINT_VALUES['MNQ'] // $2 per point

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface OpenPaperTrade {
  dbId: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  stopPrice: number
  targetPrice: number
  contracts: number
  entryTime: string
  livePnlPts: number
  livePnlDollars: number
}

interface ClosedPaperTrade {
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  contracts: number
  resultPts: number
  resultDollars: number
  status: 'WIN' | 'LOSS' | 'BE'
  entryTime: string
  exitTime: string
}

interface EngineConfig {
  bufferPoints: number
  targetMultiple: number
  maxContracts: number
  sessionEndMinute: number // NY minutes (e.g., 690 = 11:30 AM)
  enableBreakevenStop: boolean
  enableOrderflowVeto: boolean // hard-skip breakouts on strong delta divergence / absorbing wall
  enableWaitForClose: boolean // require the 1-min bar to close past OR before entering
  enablePatternGate: boolean  // hard-skip trap patterns (shooting star / doji / etc.) at the break
  enableVolumeGate: boolean   // hard-skip thin break bars (<0.8x 20-bar average volume)
}

export interface PendingBreak {
  direction: 'LONG' | 'SHORT'
  armedAtPrice: number
  armedAtTs: number
  armedAtBarTime: number // bar that was open when we armed; we won't act until a later bar closes
}

export interface AIState {
  preSession: PreSessionDecision | null
  orAssessment: ORAssessment | null
  lastBreakout: BreakoutDecision | null
  analysisInProgress: boolean
}

export interface PaperEngineState {
  enabled: boolean
  phase: 'idle' | 'forming' | 'monitoring' | 'closed'
  contractId: string | null
  orHigh: number | null
  orLow: number | null
  orSize: number | null
  orLocked: boolean
  openTrade: OpenPaperTrade | null
  dailyPnl: number
  tradesCount: number
  winsCount: number
  lossesCount: number
  lastPrice: number
  todayTrades: ClosedPaperTrade[]
  config: EngineConfig
  ai: AIState
  pendingBreak: PendingBreak | null
  candles: CandleSnapshot | null
  lastPatternGate: PatternGate | null
  lastVolumeGate: VolumeGate | null
  orderflow: OrderflowSnapshot | null
  lastOrderflow: OrderflowAssessment | null
  orderflowVetoes: { count: number; reasons: string[] }
  debrief: string | null
}

// ─── DB WRITE QUEUE (resilience for Postgres outages) ───────────────────────

interface PendingWrite {
  fn: () => Promise<void>
  label: string
  retries: number
}

const _writeQueue: PendingWrite[] = []
const MAX_RETRIES = 5

async function safeDbWrite(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    if (_writeQueue.length > 0) drainWriteQueue()
  } catch (err) {
    console.error(`[PaperEngine] DB write failed (${label}):`, err)
    _writeQueue.push({ fn, label, retries: 0 })
    notify(`⚠️ <b>DB WRITE FAILED</b>\n${label}\nQueued for retry (${_writeQueue.length} pending)`)
  }
}

async function drainWriteQueue(): Promise<void> {
  if (_writeQueue.length === 0) return
  const batch = [..._writeQueue]
  _writeQueue.length = 0

  for (const item of batch) {
    try {
      await item.fn()
      console.log(`[PaperEngine] Retry succeeded: ${item.label}`)
    } catch {
      item.retries++
      if (item.retries < MAX_RETRIES) {
        _writeQueue.push(item)
      } else {
        console.error(`[PaperEngine] Giving up on write after ${MAX_RETRIES} retries: ${item.label}`)
        notify(`🔴 <b>DB WRITE LOST</b>\n${item.label}\nFailed after ${MAX_RETRIES} retries`)
      }
    }
  }
}

// ─── MODULE STATE ────────────────────────────────────────────────────────────

let _enabled = false
let _phase: PaperEngineState['phase'] = 'idle'
let _contractId: string | null = null
let _unsubscribe: (() => void) | null = null

// Opening Range
let _orHigh: number | null = null
let _orLow: number | null = null
let _orLocked = false

// Position tracking
let _openTrade: OpenPaperTrade | null = null
let _dailyPnl = 0
let _tradesCount = 0
let _winsCount = 0
let _lossesCount = 0
let _lastPrice = 0
let _todayTrades: ClosedPaperTrade[] = []
let _todayDate = ''

// Config
let _config: EngineConfig = {
  bufferPoints: 3,
  targetMultiple: 1.5,
  maxContracts: 5,
  sessionEndMinute: 690, // 11:30 AM ET
  enableBreakevenStop: false,
  enableOrderflowVeto: true,
  enableWaitForClose: true,
  enablePatternGate: true,
  enableVolumeGate: true,
}

// Wait-for-close state — arm on tick cross, evaluate on next 1-min close.
let _pendingBreak: PendingBreak | null = null
let _lastEvaluatedBarTime = 0
let _lastPatternGate: PatternGate | null = null
let _lastVolumeGate: VolumeGate | null = null

// AI state
let _preSession: PreSessionDecision | null = null
let _orAssessment: ORAssessment | null = null
let _lastBreakout: BreakoutDecision | null = null
let _aiAnalysisInProgress = false
let _ofVetoActive = false // tracks order-flow veto so we notify once, not every tick
let _lastOrderflow: OrderflowAssessment | null = null // assessment at the last evaluated breakout
let _ofVetoCount = 0 // distinct order-flow veto episodes today (for the debrief)
let _ofVetoReasons: string[] = []

// Sprint 1: tie an open paper trade back to its SignalOpportunity row so the
// outcome (mfeR / maeR / outcomeR / label) can be resolved on close.
let _currentOpportunityId: string | null = null
let _openTradeMfePts = 0
let _openTradeMaePts = 0
let _lastDebrief: string | null = null // today's AI debrief once the session closes
let _briefingCache: Awaited<ReturnType<typeof fetchMarketBriefing>> | null = null
let _dailyLevels: Awaited<ReturnType<typeof getDailyLevels>> | null = null

// Settings cache
let _settings: {
  dailyLossLimit: number
  maxTradesPerDay: number
  maxLosingTradesPerDay: number
  accountSize: number
} | null = null

// Next.js loads this module in multiple contexts (instrumentation vs API routes).
// The engine runs in one context but getEngineState() may be called from another.
// Sync a state snapshot to globalThis so both contexts see the same state.
const _g = globalThis as unknown as { __paperEngineState?: PaperEngineState }

function syncStateToGlobal(state: PaperEngineState): void {
  _g.__paperEngineState = state
}

// ─── NY TIME HELPERS ─────────────────────────────────────────────────────────

function getNYTime(): { h: number; m: number; totalMin: number } {
  const now = new Date()
  const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
  const parts = nyStr.split(', ')[1]?.split(':') ?? []
  const h = parseInt(parts[0]) || 0
  const m = parseInt(parts[1]) || 0
  return { h, m, totalMin: h * 60 + m }
}

function formatNYTime(): string {
  const { h, m } = getNYTime()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ET`
}

// ─── SETTINGS LOADER ─────────────────────────────────────────────────────────

async function loadSettings() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const s = await prisma.settings.findFirst()
      if (s) {
        _settings = {
          dailyLossLimit: s.dailyLossLimit,
          maxTradesPerDay: s.maxTradesPerDay,
          maxLosingTradesPerDay: s.maxLosingTradesPerDay,
          accountSize: s.accountSize,
        }
      }
      return
    } catch (err) {
      if (attempt < 3) {
        console.warn(`[PaperEngine] DB settings load attempt ${attempt}/3 failed, retrying in 5s...`)
        await new Promise(r => setTimeout(r, 5000))
      } else {
        console.error('[PaperEngine] DB settings load failed after 3 attempts, using defaults:', err)
        notify(`⚠️ <b>DB SETTINGS FAILED</b>\nUsing 50K defaults (DLL=$1000, max 2 trades)`)
        _settings = {
          dailyLossLimit: 1000,
          maxTradesPerDay: 2,
          maxLosingTradesPerDay: 2,
          accountSize: 50000,
        }
      }
    }
  }
}

// ─── PHASE MANAGEMENT ────────────────────────────────────────────────────────

function updatePhase(): void {
  const { totalMin } = getNYTime()
  const prevPhase = _phase

  if (totalMin < 570) {
    // Before 9:30 AM
    _phase = 'idle'
  } else if (totalMin < 585) {
    // 9:30–9:45 AM: forming OR (15-min window)
    _phase = 'forming'
  } else if (totalMin < _config.sessionEndMinute) {
    // 9:45 AM – session end: monitoring
    if (!_orLocked && _orHigh !== null && _orLow !== null) {
      _orLocked = true
      const orSize = (_orHigh - _orLow).toFixed(2)
      console.log(`[PaperEngine] OR locked: H=${_orHigh} L=${_orLow} Size=${orSize}`)
      notify(`🔒 <b>OR LOCKED</b>\nHigh: ${_orHigh} | Low: ${_orLow}\nSize: ${orSize} pts`)
      persistOR()
      runORAnalysis()
    }
    _phase = 'monitoring'
  } else {
    // After session end
    _phase = 'closed'
  }

  if (prevPhase !== _phase) {
    console.log(`[PaperEngine] Phase: ${prevPhase} → ${_phase}`)
  }
}

async function persistOR(): Promise<void> {
  if (_orHigh === null || _orLow === null) return
  const today = getToday()
  const orH = _orHigh, orL = _orLow
  await safeDbWrite(`Persist OR: H=${orH} L=${orL}`, async () => {
    await prisma.session.upsert({
      where: { date: today },
      update: { orHigh: orH, orLow: orL, orSize: orH - orL },
      create: { date: today, market: 'MNQ', orHigh: orH, orLow: orL, orSize: orH - orL },
    })
  })
}

// ─── AI ANALYSIS ────────────────────────────────────────────────────────────

async function runPreSessionAnalysis(): Promise<void> {
  if (_preSession) return
  _aiAnalysisInProgress = true
  console.log('[PaperEngine] Running AI pre-session analysis...')
  try {
    const [briefing, macro] = await Promise.all([
      fetchMarketBriefing().catch(() => null),
      fetchMacroSentiment().catch(() => null),
    ])
    _briefingCache = briefing

    const calendarImpact = briefing?.news
      ? getSessionImpact(briefing.news.map(e => ({ title: e.title, time: e.time, impact: e.impact })))
      : null

    _preSession = await analyzePreSession(briefing, macro, calendarImpact, {
      dailyPnl: _dailyPnl,
      tradesCount: _tradesCount,
      lossesCount: _lossesCount,
      trailingDrawdownRemaining: _settings ? _settings.dailyLossLimit * 2 : 2000,
    })

    if (_preSession.adjustments?.bufferPoints != null) _config.bufferPoints = _preSession.adjustments.bufferPoints
    if (_preSession.adjustments?.targetMultiple != null) _config.targetMultiple = _preSession.adjustments.targetMultiple
    if (_preSession.adjustments?.maxContracts != null) _config.maxContracts = _preSession.adjustments.maxContracts

    console.log(`[PaperEngine] AI pre-session: trade=${_preSession.shouldTrade} bias=${_preSession.bias} confidence=${_preSession.confidence}%`)
    const verdict = _preSession.shouldTrade ? '✅ TRADE TODAY' : '🚫 NO TRADE'
    notify(
      `🧠 <b>PRE-SESSION ANALYSIS</b>\n${verdict}\n` +
      `Bias: <b>${_preSession.bias.toUpperCase()}</b> | Confidence: ${_preSession.confidence}%\n` +
      `Risk: ${_preSession.riskLevel}\n${_preSession.reasoning}`
    )
  } catch (err) {
    console.error('[PaperEngine] Pre-session AI failed:', err)
    notify(`⚠️ <b>PRE-SESSION AI FAILED</b>\nEngine will use mechanical rules as fallback`)
  } finally {
    _aiAnalysisInProgress = false
  }
}

async function runORAnalysis(): Promise<void> {
  if (!_orHigh || !_orLow) return
  _aiAnalysisInProgress = true
  console.log('[PaperEngine] Running AI OR assessment...')
  try {
    const preSession = _preSession ?? {
      shouldTrade: true, bias: 'neutral' as const, confidence: 50,
      reasoning: 'No pre-session analysis available', riskLevel: 'medium' as const,
      adjustments: {}, keyFactors: [],
    }

    _orAssessment = await analyzeOpeningRange(
      _orHigh, _orLow, _orHigh - _orLow, _lastPrice,
      preSession, _briefingCache,
    )
    console.log(`[PaperEngine] AI OR: quality=${_orAssessment.quality} direction=${_orAssessment.preferredDirection}`)
    notify(
      `📊 <b>OR ASSESSMENT</b>\n` +
      `Quality: <b>${_orAssessment.quality.toUpperCase()}</b>\n` +
      `Direction: ${_orAssessment.preferredDirection} | Trade: ${_orAssessment.shouldTrade ? 'YES' : 'NO'}\n` +
      `${_orAssessment.reasoning}`
    )
  } catch (err) {
    console.error('[PaperEngine] OR AI failed:', err)
    notify(`⚠️ <b>OR ANALYSIS FAILED</b>\nUsing mechanical OR assessment`)
  } finally {
    _aiAnalysisInProgress = false
  }
}

// ─── DAY RESET ───────────────────────────────────────────────────────────────

function getToday(): string {
  const now = new Date()
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const y = ny.getFullYear()
  const m = String(ny.getMonth() + 1).padStart(2, '0')
  const d = String(ny.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function checkDayReset(): void {
  const today = getToday()
  if (_todayDate !== today) {
    console.log(`[PaperEngine] New day: ${today} (was ${_todayDate || 'none'})`)
    _todayDate = today
    _orHigh = null
    _orLow = null
    _orLocked = false
    _openTrade = null
    _dailyPnl = 0
    _tradesCount = 0
    _winsCount = 0
    _lossesCount = 0
    _todayTrades = []
    _phase = 'idle'
    _preSession = null
    _orAssessment = null
    _lastBreakout = null
    _briefingCache = null
    _sessionSummarySent = false
    _ofVetoActive = false
    _lastOrderflow = null
    _ofVetoCount = 0
    _ofVetoReasons = []
    _lastDebrief = null
    _pendingBreak = null
    _lastEvaluatedBarTime = 0
    _lastPatternGate = null
    _lastVolumeGate = null
    resetOrderflowDay()
    resetCandlesDay()
    resetMonitorDay()
    _currentOpportunityId = null
    _openTradeMfePts = 0
    _openTradeMaePts = 0
  }
}

// ─── TICK PROCESSOR ──────────────────────────────────────────────────────────

let _lastDrainTime = 0
let _lastProcessedTick = 0
let _lastGlobalSync = 0
const TICK_THROTTLE_MS = 250
const GLOBAL_SYNC_MS = 1000

function processTick(quote: WSQuote): void {
  if (quote.price <= 0) return
  _lastPrice = quote.price

  // Throttle: process logic at most 4x/second to keep CPU low
  const now = Date.now()
  if (now - _lastProcessedTick < TICK_THROTTLE_MS) return
  _lastProcessedTick = now

  // Sync state to globalThis so API routes in other contexts can read it
  if (now - _lastGlobalSync >= GLOBAL_SYNC_MS) {
    _lastGlobalSync = now
    syncStateToGlobal(getEngineState())
  }

  // Retry failed DB writes every 30 seconds
  if (_writeQueue.length > 0 && now - _lastDrainTime > 30_000) {
    _lastDrainTime = now
    drainWriteQueue().catch(() => {})
  }

  checkDayReset()
  updatePhase()

  // Update would-have outcomes for any tracked skipped signals.
  if (_phase === 'monitoring' || _phase === 'closed') {
    monitorOnTick(quote.price).catch((err) =>
      console.error('[PaperEngine] monitorOnTick failed:', err),
    )
  }

  switch (_phase) {
    case 'forming':
      handleForming(quote.price)
      break
    case 'monitoring':
      handleMonitoring(quote.price)
      break
    case 'closed':
      handleClosed(quote.price)
      break
  }
}

function handleForming(price: number): void {
  if (_orHigh === null || price > _orHigh) _orHigh = price
  if (_orLow === null || price < _orLow) _orLow = price
}

function handleMonitoring(price: number): void {
  if (_orHigh === null || _orLow === null) return

  // Check exit first (if we have an open position)
  if (_openTrade) {
    checkExit(price)
    return
  }

  // Tick-side: arm a pending break when price first crosses OR ± buffer.
  // (Bypass wait-for-close path entirely when the flag is off — old tick-on-cross behavior.)
  if (_config.enableWaitForClose) {
    armPendingIfTriggered(price)
    evaluatePendingOnClose()
  } else {
    checkEntry(price)
  }
}

let _sessionSummarySent = false

function handleClosed(price: number): void {
  if (_openTrade) {
    console.log(`[PaperEngine] Session end — closing open position at ${price}`)
    closePosition(price, 'session_end')
  }

  // Resolve any skipped opportunities that never hit target/stop as 'inconclusive'.
  monitorResolveAll().catch((err) =>
    console.error('[PaperEngine] monitorResolveAll failed:', err),
  )

  // Send an AI-written debrief once per session — but only if a real session
  // ran (OR locked or trades taken), so a late engine boot doesn't post a blank.
  if (!_sessionSummarySent && (_orLocked || _tradesCount > 0)) {
    _sessionSummarySent = true
    sendSessionDebrief().catch((err) => console.error('[PaperEngine] Session debrief error:', err))
  }
}

async function sendSessionDebrief(): Promise<void> {
  const input: SessionDebriefInput = {
    date: getToday(),
    orHigh: _orHigh,
    orLow: _orLow,
    orSize: _orHigh !== null && _orLow !== null ? parseFloat((_orHigh - _orLow).toFixed(2)) : null,
    preSession: _preSession,
    orAssessment: _orAssessment,
    trades: _todayTrades,
    dailyPnl: parseFloat(_dailyPnl.toFixed(2)),
    winsCount: _winsCount,
    lossesCount: _lossesCount,
    vetoCount: _ofVetoCount,
    vetoReasons: _ofVetoReasons,
  }
  console.log(`[PaperEngine] Sending session debrief (${input.trades.length} trades, ${input.vetoCount} vetoes)`)
  const debrief = await summarizeSession(input)
  notify(debrief)

  // Persist a tag-stripped copy so the dashboard can show past debriefs.
  const today = getToday()
  const clean = debrief.replace(/<\/?b>/g, '')
  _lastDebrief = clean
  await safeDbWrite(`Persist debrief ${today}`, async () => {
    await prisma.session.upsert({
      where: { date: today },
      update: { debrief: clean },
      create: { date: today, market: 'MNQ', debrief: clean },
    })
  })
}

// ─── ENTRY LOGIC ─────────────────────────────────────────────────────────────

let _entryLock = false

// Pass guard checks shared between the legacy tick path and the wait-for-close path.
function passesGuards(): boolean {
  if (!_settings) return false
  if (_orHigh === null || _orLow === null) return false
  if (_tradesCount >= _settings.maxTradesPerDay) return false
  if (_lossesCount >= _settings.maxLosingTradesPerDay) return false
  if (_dailyPnl <= -_settings.dailyLossLimit) return false
  if (_preSession && !_preSession.shouldTrade) return false
  if (_orAssessment && !_orAssessment.shouldTrade) return false
  return true
}

// Counter-bias trades (against the day's pre-session lean) are HARD-blocked
// only when the AI's pre-session conviction is high. Below that threshold the
// bias is treated as a lean, not a veto: both directions are allowed to arm and
// the per-breakout gates (pattern / volume / order flow) + the per-break AI
// review judge each setup on its own merits. This stops a merely-bullish day
// from silently filtering out every short.
const HARD_BIAS_CONFIDENCE = 70 // % — at/above this, the daily bias is a hard filter

// Direction filter shared by both paths.
function directionAllowed(direction: 'LONG' | 'SHORT'): boolean {
  const biasKnown = !!_preSession && _preSession.bias !== 'neutral'
  const highConviction = !!_preSession && _preSession.confidence >= HARD_BIAS_CONFIDENCE

  // Low-conviction or neutral day → don't veto on direction; let the breakout
  // gates + per-break AI review decide. (The AI review still receives the bias
  // as context and can skip a weak counter-trend break.)
  if (!biasKnown || !highConviction) {
    if (biasKnown && direction !== (_preSession!.bias === 'long' ? 'LONG' : 'SHORT')) {
      console.log(`[PaperEngine] Counter-bias ${direction} allowed to arm — ${_preSession!.bias} bias is low-conviction (${_preSession!.confidence}% < ${HARD_BIAS_CONFIDENCE}%); gates will decide`)
    }
    return true
  }

  // High-conviction day → enforce the directional bias (and the OR read) as before.
  const aiBias = _preSession!.bias === 'long' ? 'LONG' : 'SHORT'
  if (direction !== aiBias) {
    console.log(`[PaperEngine] AI filtered: ${direction} blocked — high-conviction ${_preSession!.bias} bias (${_preSession!.confidence}%)`)
    return false
  }
  if (_orAssessment && _orAssessment.preferredDirection !== 'either' && _orAssessment.preferredDirection !== 'none') {
    const orBias = _orAssessment.preferredDirection === 'long' ? 'LONG' : 'SHORT'
    if (direction !== orBias) {
      console.log(`[PaperEngine] AI OR filtered: ${direction} blocked — OR prefers ${_orAssessment.preferredDirection} on a high-conviction day`)
      return false
    }
  }
  return true
}

// Record a veto (any source) into the shared veto feed.
function recordVeto(source: 'pattern' | 'volume' | 'orderflow', direction: 'LONG' | 'SHORT', refPrice: number, message: string): void {
  _ofVetoCount++
  if (_ofVetoReasons.length < 20) {
    _ofVetoReasons.push(`[${source}] ${direction} @ ${refPrice.toFixed(2)}: ${message}`)
  }
  console.log(`[PaperEngine] ${source.toUpperCase()} VETO: ${direction} — ${message}`)
}

// Arm a pending breakout when the live tick first crosses OR ± buffer.
// We do not enter on the tick — we wait for the next 1-min bar to close.
function armPendingIfTriggered(price: number): void {
  if (_entryLock || _pendingBreak) return
  if (!passesGuards()) return
  if (_orHigh === null || _orLow === null) return

  const longTrigger = _orHigh + _config.bufferPoints
  const shortTrigger = _orLow - _config.bufferPoints

  let direction: 'LONG' | 'SHORT' | null = null
  if (price > longTrigger) direction = 'LONG'
  else if (price < shortTrigger) direction = 'SHORT'
  if (!direction) return

  if (!directionAllowed(direction)) return

  const live = getLatestClosedCandle()
  _pendingBreak = {
    direction,
    armedAtPrice: price,
    armedAtTs: Date.now(),
    armedAtBarTime: live ? live.time : 0,
  }
  console.log(`[PaperEngine] Pending ${direction} break armed @ ${price.toFixed(2)} — waiting for 1-min close`)
  notify(`⏳ <b>BREAK ARMED</b>\n${direction} @ ${price.toFixed(2)}\nWaiting for 1-min close to confirm`)
}

// Once per closed 1-min bar, evaluate any armed pending break through the
// shared signal engine. The engine does the mechanical gates + AI review +
// finalization; this function orchestrates: collect → evaluate → log → render
// → notify → openPosition (or track skipped). Pure logic lives in lib/signal-engine.
function evaluatePendingOnClose(): void {
  if (!_pendingBreak || _entryLock) return
  if (!passesGuards()) return
  if (_orHigh === null || _orLow === null) return
  if (!_settings) return

  const latest = getLatestClosedCandle()
  if (!latest) return
  if (latest.time <= _lastEvaluatedBarTime) return
  // Don't act on the very bar we armed on — we need at least one fully-closed bar afterwards.
  if (latest.time <= _pendingBreak.armedAtBarTime) return
  _lastEvaluatedBarTime = latest.time

  const { direction } = _pendingBreak

  // Did the close come back inside the OR? (false break — no engine call needed)
  const closedInsideLong = direction === 'LONG' && latest.close <= _orHigh
  const closedInsideShort = direction === 'SHORT' && latest.close >= _orLow
  if (closedInsideLong || closedInsideShort) {
    console.log(`[PaperEngine] Pending ${direction} break failed — bar closed back inside OR (${latest.close.toFixed(2)})`)
    notify(`↩️ <b>FALSE BREAK</b>\n${direction} closed back inside OR @ ${latest.close.toFixed(2)} — arm cleared`)
    _pendingBreak = null
    return
  }

  _entryLock = true
  const pendingDirection = direction
  runSignalEvaluation(direction, latest.close)
    .finally(() => {
      _entryLock = false
      if (_pendingBreak && _pendingBreak.direction === pendingDirection) _pendingBreak = null
    })
}

// Sprint 1 orchestration: collect state, run the pure signal engine, log one
// SignalOpportunity row (taken or skipped), render the trade card, notify,
// and act on the decision (open position or track would-have outcome).
async function runSignalEvaluation(
  direction: 'LONG' | 'SHORT',
  refPrice: number,
): Promise<void> {
  if (!_settings) return
  if (_orHigh === null || _orLow === null) return

  // Daily liquidity levels (PDH/PDL/PDC) — cached per NY date, fail-open.
  try { _dailyLevels = await getDailyLevels('MNQ') } catch { /* keep prior */ }

  // Collect state — this is the ONE I/O point.
  const state = collectBreakoutSignalState({
    date: getToday(),
    market: 'MNQ',
    direction,
    orHigh: _orHigh,
    orLow: _orLow,
    bufferPoints: _config.bufferPoints,
    targetMultiple: _config.targetMultiple,
    refPrice,
    dailyPnl: _dailyPnl,
    tradesCount: _tradesCount,
    lossesCount: _lossesCount,
    dailyLossLimit: _settings.dailyLossLimit,
    trailingDrawdownRemaining: _settings.dailyLossLimit * 2,
    maxContractsConfig: _config.maxContracts,
    preSession: _preSession,
    orAssessment: _orAssessment,
    briefing: _briefingCache,
    dailyLevels: _dailyLevels,
    enablePatternGate: _config.enablePatternGate,
    enableVolumeGate: _config.enableVolumeGate,
    enableOrderflowVeto: _config.enableOrderflowVeto,
  })

  // Pure decision — same code path paper, backtest, and live will share.
  _aiAnalysisInProgress = true
  const decision = await evaluateSignal(state)
  _aiAnalysisInProgress = false

  // Mirror gate reads into legacy cockpit state (so the UI stays unchanged).
  _lastPatternGate = decision.pattern as unknown as PatternGate
  _lastVolumeGate = decision.volume as unknown as VolumeGate
  _lastOrderflow = decision.orderflow as unknown as OrderflowAssessment
  _lastBreakout = {
    enter: decision.finalDecision === 'take',
    reasoning: decision.rationale,
    confidence: decision.ai.status === 'ok' ? decision.ai.confidence : 0,
    contracts: decision.finalContracts,
    vetoTake: decision.ai.status === 'ok' ? decision.ai.vetoTake : undefined,
    vetoReason: decision.ai.vetoReason ?? undefined,
    reversalNote: decision.ai.status === 'ok' ? (decision.ai.reversalNote ?? undefined) : undefined,
  }

  // Record veto in the shared feed for the cockpit / debrief.
  if (decision.finalDecision === 'skip' && decision.skipSource) {
    recordVeto(
      decision.skipSource === 'mechanical' ? 'pattern' :
      decision.skipSource === 'ai-veto' ? 'orderflow' :
      'orderflow',
      direction,
      refPrice,
      `[${decision.skipSource}] ${decision.skipReason}`,
    )
  }

  // Persist the opportunity row.
  let opportunityId: string | null = null
  try {
    opportunityId = await writeSignalOpportunity({ state, decision, source: 'paper' })
  } catch (err) {
    console.error('[PaperEngine] writeSignalOpportunity failed:', err)
  }

  // Render the trade card and notify.
  const card = renderTradeCard(decision, {
    riskDollarsPerContract: Math.abs(decision.entry - decision.stop) * MNQ_POINT_VALUE,
    dailyBudgetRemaining: _settings.dailyLossLimit + _dailyPnl,
  })
  notify(card)

  if (decision.finalDecision === 'take' && !_openTrade && _enabled && _phase === 'monitoring') {
    _currentOpportunityId = opportunityId
    _openTradeMfePts = 0
    _openTradeMaePts = 0
    const useEntry = _lastPrice > 0 ? _lastPrice : decision.entry
    await openPosition(direction, useEntry, decision.stop, decision.target, decision.finalContracts)
    // After openPosition, _openTrade may have been set — read through an
    // un-narrowing accessor so TS doesn't keep the pre-await null narrowing.
    const tradeDbId = (_openTrade as { dbId: string } | null)?.dbId ?? null
    if (opportunityId && tradeDbId) {
      try {
        await linkPaperTrade(opportunityId, tradeDbId)
      } catch (err) {
        console.error('[PaperEngine] linkPaperTrade failed:', err)
      }
    }
  } else if (decision.finalDecision === 'skip' && opportunityId) {
    // Track would-have outcome for the skipped signal.
    trackSkipped({
      opportunityId,
      direction,
      wouldEntry: decision.entry,
      wouldStop: decision.stop,
      wouldTarget: decision.target,
    })
  }
}

// Legacy tick-on-cross path. Active only when enableWaitForClose=false. Now
// routes through the shared signal engine instead of inlining gate logic — so
// both paths produce SignalOpportunity rows with identical decision semantics.
function checkEntry(price: number): void {
  if (_entryLock) return
  if (!passesGuards()) return
  if (_orHigh === null || _orLow === null) return

  const longTrigger = _orHigh + _config.bufferPoints
  const shortTrigger = _orLow - _config.bufferPoints

  let direction: 'LONG' | 'SHORT' | null = null
  if (price > longTrigger) direction = 'LONG'
  else if (price < shortTrigger) direction = 'SHORT'
  if (!direction) return

  if (!directionAllowed(direction)) return

  _entryLock = true
  const evaluatingDirection = direction
  runSignalEvaluation(evaluatingDirection, price)
    .finally(() => { _entryLock = false })
}

// ─── EXIT LOGIC ──────────────────────────────────────────────────────────────

function checkExit(price: number): void {
  if (!_openTrade) return

  // Update live P&L
  const pnlPts = _openTrade.direction === 'LONG'
    ? price - _openTrade.entryPrice
    : _openTrade.entryPrice - price
  _openTrade.livePnlPts = pnlPts
  _openTrade.livePnlDollars = pnlPts * MNQ_POINT_VALUE * _openTrade.contracts

  // Sprint 1: track MFE / MAE on the open trade for opportunity-log resolution.
  if (pnlPts > _openTradeMfePts) _openTradeMfePts = pnlPts
  if (-pnlPts > _openTradeMaePts) _openTradeMaePts = -pnlPts

  // Breakeven stop: move stop to entry after 1x OR gain
  if (_config.enableBreakevenStop && _orHigh !== null && _orLow !== null) {
    const orSize = _orHigh - _orLow
    if (pnlPts >= orSize) {
      if (_openTrade.direction === 'LONG' && _openTrade.stopPrice < _openTrade.entryPrice) {
        _openTrade.stopPrice = _openTrade.entryPrice
        console.log(`[PaperEngine] Breakeven stop activated at ${_openTrade.entryPrice}`)
      } else if (_openTrade.direction === 'SHORT' && _openTrade.stopPrice > _openTrade.entryPrice) {
        _openTrade.stopPrice = _openTrade.entryPrice
        console.log(`[PaperEngine] Breakeven stop activated at ${_openTrade.entryPrice}`)
      }
    }
  }

  // Check stop
  if (_openTrade.direction === 'LONG' && price <= _openTrade.stopPrice) {
    closePosition(_openTrade.stopPrice, 'stop')
    return
  }
  if (_openTrade.direction === 'SHORT' && price >= _openTrade.stopPrice) {
    closePosition(_openTrade.stopPrice, 'stop')
    return
  }

  // Check target
  if (_openTrade.direction === 'LONG' && price >= _openTrade.targetPrice) {
    closePosition(_openTrade.targetPrice, 'target')
    return
  }
  if (_openTrade.direction === 'SHORT' && price <= _openTrade.targetPrice) {
    closePosition(_openTrade.targetPrice, 'target')
    return
  }
}

// ─── POSITION MANAGEMENT ────────────────────────────────────────────────────

async function openPosition(
  direction: 'LONG' | 'SHORT',
  entry: number,
  stop: number,
  target: number,
  contracts: number,
): Promise<void> {
  const today = getToday()
  const timeStr = formatNYTime()

  console.log(`[PaperEngine] ENTRY: ${direction} ${contracts} MNQ @ ${entry} | Stop=${stop} Target=${target}`)

  const riskPts = Math.abs(entry - stop)
  const riskDollars = riskPts * MNQ_POINT_VALUE * contracts
  const rewardPts = Math.abs(target - entry)

  notify(
    `${direction === 'LONG' ? '🟢' : '🔴'} <b>PAPER TRADE ENTRY</b>\n` +
    `${direction} ${contracts} MNQ @ ${entry}\n` +
    `Stop: ${stop} | Target: ${target}\n` +
    `Risk: ${riskPts.toFixed(1)}pts ($${riskDollars.toFixed(0)}) | Reward: ${rewardPts.toFixed(1)}pts\n` +
    `⏰ ${timeStr}`
  )

  // Build AI reasoning summary
  const aiParts: string[] = []
  if (_preSession) aiParts.push(`Pre-session: ${_preSession.reasoning}`)
  if (_orAssessment) aiParts.push(`OR: ${_orAssessment.quality} — ${_orAssessment.reasoning}`)
  if (_lastBreakout) aiParts.push(`Breakout: ${_lastBreakout.reasoning}`)
  if (_lastPatternGate?.patternName) {
    aiParts.push(`Pattern: ${_lastPatternGate.patternName} (${_lastPatternGate.patternSignal}, ${_lastPatternGate.patternStrength}%) — gate ${_lastPatternGate.verdict}`)
  }
  if (_lastVolumeGate && _lastVolumeGate.avgVolume > 0) {
    aiParts.push(`Volume: ${_lastVolumeGate.ratio.toFixed(2)}× avg — gate ${_lastVolumeGate.verdict}`)
  }
  if (_lastOrderflow?.available) aiParts.push(`Order flow: ${_lastOrderflow.verdict} — ${_lastOrderflow.reasons.join('; ')}`)
  const aiReasoning = aiParts.length > 0 ? aiParts.join(' | ') : null

  // Optimistic in-memory tracking — DB write may be queued if Postgres is down
  const tempId = `paper_${Date.now()}`
  _openTrade = {
    dbId: tempId,
    direction,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    contracts,
    entryTime: timeStr,
    livePnlPts: 0,
    livePnlDollars: 0,
  }
  _tradesCount++

  // Write to DB with resilience
  await safeDbWrite(`Create trade: ${direction} ${contracts}@${entry}`, async () => {
    let session = await prisma.session.findUnique({ where: { date: today } })
    if (!session) {
      session = await prisma.session.create({
        data: { date: today, market: 'MNQ', orHigh: _orHigh, orLow: _orLow, orSize: _orHigh && _orLow ? _orHigh - _orLow : null },
      })
    }

    const trade = await prisma.trade.create({
      data: {
        sessionId: session.id,
        date: today,
        time: timeStr,
        market: 'MNQ',
        direction,
        contracts,
        entry,
        stop,
        target,
        status: 'OPEN',
        source: 'paper',
        aiReasoning,
      },
    })

    if (_openTrade && _openTrade.dbId === tempId) {
      _openTrade.dbId = trade.id
    }
  })
}

async function closePosition(exitPrice: number, reason: 'stop' | 'target' | 'session_end'): Promise<void> {
  if (!_openTrade) return

  const pnlPts = _openTrade.direction === 'LONG'
    ? exitPrice - _openTrade.entryPrice
    : _openTrade.entryPrice - exitPrice
  const riskPts = Math.abs(_openTrade.entryPrice - _openTrade.stopPrice)
  const pnlDollars = pnlPts * MNQ_POINT_VALUE * _openTrade.contracts
  const resultR = riskPts > 0 ? pnlPts / riskPts : 0

  let status: 'WIN' | 'LOSS' | 'BE'
  if (Math.abs(pnlPts) < 1) status = 'BE'
  else if (pnlPts > 0) status = 'WIN'
  else status = 'LOSS'

  console.log(`[PaperEngine] EXIT (${reason}): ${_openTrade.direction} @ ${exitPrice} | P&L=${pnlPts.toFixed(2)}pts $${pnlDollars.toFixed(2)} | ${status}`)

  const emoji = status === 'WIN' ? '💰' : status === 'LOSS' ? '💔' : '➖'
  notify(
    `${emoji} <b>PAPER TRADE EXIT</b> — ${status}\n` +
    `${_openTrade.direction} ${_openTrade.contracts} MNQ\n` +
    `Entry: ${_openTrade.entryPrice} → Exit: ${exitPrice}\n` +
    `P&L: ${pnlPts >= 0 ? '+' : ''}${pnlPts.toFixed(2)} pts ($${pnlDollars >= 0 ? '+' : ''}${pnlDollars.toFixed(2)})\n` +
    `Reason: ${reason} | R: ${resultR >= 0 ? '+' : ''}${resultR.toFixed(1)}R\n` +
    `Daily P&L: $${(_dailyPnl + pnlDollars) >= 0 ? '+' : ''}${(_dailyPnl + pnlDollars).toFixed(2)}`
  )

  // Update daily stats (in-memory — always works)
  _dailyPnl += pnlDollars
  if (status === 'WIN') _winsCount++
  if (status === 'LOSS') _lossesCount++

  _todayTrades.push({
    direction: _openTrade.direction,
    entryPrice: _openTrade.entryPrice,
    exitPrice,
    contracts: _openTrade.contracts,
    resultPts: parseFloat(pnlPts.toFixed(2)),
    resultDollars: parseFloat(pnlDollars.toFixed(2)),
    status,
    entryTime: _openTrade.entryTime,
    exitTime: formatNYTime(),
  })

  // DB writes with resilience
  const tradeDbId = _openTrade.dbId
  const tradeDirection = _openTrade.direction

  await safeDbWrite(`Close trade: ${tradeDirection} exit@${exitPrice} ${status}`, async () => {
    if (tradeDbId.startsWith('paper_')) return
    await prisma.trade.update({
      where: { id: tradeDbId },
      data: {
        exit: exitPrice,
        resultPts: parseFloat(pnlPts.toFixed(2)),
        resultDollars: parseFloat(pnlDollars.toFixed(2)),
        resultR: parseFloat(resultR.toFixed(2)),
        grossPnl: parseFloat(pnlDollars.toFixed(2)),
        tradeFees: 0,
        status,
        notes: `Paper trade — exit reason: ${reason}`,
      },
    })
  })

  await safeDbWrite(`Update session P&L: $${_dailyPnl.toFixed(2)}`, async () => {
    const today = getToday()
    await prisma.session.update({
      where: { date: today },
      data: {
        dailyPnl: _dailyPnl,
        tradesCount: _tradesCount,
        losesCount: _lossesCount,
      },
    })
  })

  // Sprint 1: resolve the linked SignalOpportunity row with realized outcome.
  if (_currentOpportunityId && riskPts > 0) {
    const label = status === 'WIN' ? 'win' : status === 'LOSS' ? 'loss' : 'be'
    const opportunityId = _currentOpportunityId
    const mfeR = _openTradeMfePts / riskPts
    const maeR = _openTradeMaePts / riskPts
    try {
      await resolveOutcome({ opportunityId, label, outcomeR: resultR, mfeR, maeR })
    } catch (err) {
      console.error('[PaperEngine] resolveOutcome failed:', err)
    }
  }
  _currentOpportunityId = null
  _openTradeMfePts = 0
  _openTradeMaePts = 0

  _openTrade = null
}

// ─── ENGINE CONTROL ──────────────────────────────────────────────────────────

export async function startEngine(): Promise<void> {
  if (_enabled) {
    console.log('[PaperEngine] Already running')
    return
  }

  console.log('[PaperEngine] Starting...')
  await loadSettings()

  // Ensure MNQ stream is active
  try {
    _contractId = await getActiveMNQContractId()
    await connectMarketHub()
    await subscribeToQuote(_contractId)
    await startOrderflow(_contractId)
    await startCandles(_contractId)
    console.log(`[PaperEngine] Subscribed to ${_contractId} (quotes + order flow + candles)`)
  } catch (err) {
    console.error('[PaperEngine] Failed to connect to market stream:', err)
    notify(`🔴 <b>ENGINE START FAILED</b>\nCould not connect to MNQ stream\n${String(err)}`)
    return
  }

  // Reset day state
  checkDayReset()

  // Subscribe to quote events
  _unsubscribe = subscribe((event: WSEvent) => {
    if (event.type !== 'quote') return
    if (_contractId && event.data.contractId !== _contractId) return
    processTick(event.data)
  })

  _enabled = true
  syncStateToGlobal(getEngineState())
  console.log('[PaperEngine] Running — waiting for trading hours')
  notify(`🟢 <b>ENGINE STARTED</b>\nSubscribed to MNQ (${_contractId})\n⏰ ${formatNYTime()}`)

  // Run AI pre-session analysis in the background
  runPreSessionAnalysis().catch(err =>
    console.error('[PaperEngine] Pre-session analysis error:', err)
  )
}

export async function stopEngine(): Promise<void> {
  if (!_enabled) return

  console.log('[PaperEngine] Stopping...')

  // Close any open position at last known price
  if (_openTrade && _lastPrice > 0) {
    await closePosition(_lastPrice, 'session_end')
  }

  if (_unsubscribe) {
    _unsubscribe()
    _unsubscribe = null
  }

  _enabled = false
  _phase = 'idle'
  syncStateToGlobal(getEngineState())
  console.log('[PaperEngine] Stopped')

  const summary = _tradesCount > 0
    ? `Trades: ${_tradesCount} | W/L: ${_winsCount}/${_lossesCount} | P&L: $${_dailyPnl >= 0 ? '+' : ''}${_dailyPnl.toFixed(2)}`
    : 'No trades today'
  notify(`🔴 <b>ENGINE STOPPED</b>\n${summary}\n⏰ ${formatNYTime()}`)
}

export function configureEngine(config: Partial<EngineConfig>): void {
  _config = { ..._config, ...config }
  console.log('[PaperEngine] Config updated:', _config)
}

// ─── AUTO-START ─────────────────────────────────────────────────────────────
// Engine starts itself on server boot. No manual action needed.
// Checks every 60s if it should be running (weekday, market hours or pre-market).
// Stops itself after market close and restarts next morning.

function shouldBeRunning(): boolean {
  const now = new Date()
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now)

  const weekday = ny.find(p => p.type === 'weekday')?.value ?? ''
  const hour = parseInt(ny.find(p => p.type === 'hour')?.value ?? '0')
  const min = parseInt(ny.find(p => p.type === 'minute')?.value ?? '0')
  const timeDecimal = hour + min / 60

  if (['Sat', 'Sun'].includes(weekday)) return false
  // Run from 9:00 AM (pre-session analysis) to 12:00 PM (buffer after 11:30 close)
  return timeDecimal >= 9 && timeDecimal < 12
}

let _autoStartTimer: ReturnType<typeof setInterval> | null = null

function initAutoStart(): void {
  if (_autoStartTimer) return
  // Prevent duplicate timers across Next.js module contexts
  const g = globalThis as Record<string, unknown>
  if (g.__paperEngineTimer) return
  g.__paperEngineTimer = true

  async function tick() {
    if (shouldBeRunning() && !_enabled) {
      console.log('[PaperEngine] Auto-starting for trading session')
      await startEngine()
    } else if (!shouldBeRunning() && _enabled) {
      console.log('[PaperEngine] Auto-stopping — outside trading hours')
      await stopEngine()
    }
  }

  tick().catch(err => console.error('[PaperEngine] Auto-start error:', err))
  _autoStartTimer = setInterval(() => {
    tick().catch(err => console.error('[PaperEngine] Auto-start tick error:', err))
  }, 60_000)

  console.log('[PaperEngine] Auto-start scheduler initialized')
}

// Boot on module load
initAutoStart()

export function getEngineState(): PaperEngineState {
  // If this context owns the engine, build fresh state
  if (_enabled) {
    checkDayReset()
    updatePhase()

    const state: PaperEngineState = {
      enabled: _enabled,
      phase: _phase,
      contractId: _contractId,
      orHigh: _orHigh,
      orLow: _orLow,
      orSize: _orHigh !== null && _orLow !== null ? parseFloat((_orHigh - _orLow).toFixed(2)) : null,
      orLocked: _orLocked,
      openTrade: _openTrade,
      dailyPnl: parseFloat(_dailyPnl.toFixed(2)),
      tradesCount: _tradesCount,
      winsCount: _winsCount,
      lossesCount: _lossesCount,
      lastPrice: _lastPrice,
      todayTrades: _todayTrades,
      config: { ..._config },
      ai: {
        preSession: _preSession,
        orAssessment: _orAssessment,
        lastBreakout: _lastBreakout,
        analysisInProgress: _aiAnalysisInProgress,
      },
      pendingBreak: _pendingBreak,
      candles: getCandleSnapshot(),
      lastPatternGate: _lastPatternGate,
      lastVolumeGate: _lastVolumeGate,
      orderflow: getOrderflowSnapshot(),
      lastOrderflow: _lastOrderflow,
      orderflowVetoes: { count: _ofVetoCount, reasons: _ofVetoReasons },
      debrief: _lastDebrief,
    }
    syncStateToGlobal(state)
    return state
  }

  // This context doesn't own the engine — read from the shared global snapshot
  if (_g.__paperEngineState) return _g.__paperEngineState

  // No engine running anywhere
  return {
    enabled: false,
    phase: 'idle',
    contractId: null,
    orHigh: null,
    orLow: null,
    orSize: null,
    orLocked: false,
    openTrade: null,
    dailyPnl: 0,
    tradesCount: 0,
    winsCount: 0,
    lossesCount: 0,
    lastPrice: 0,
    todayTrades: [],
    config: { ..._config },
    ai: { preSession: null, orAssessment: null, lastBreakout: null, analysisInProgress: false },
    pendingBreak: null,
    candles: null,
    lastPatternGate: null,
    lastVolumeGate: null,
    orderflow: null,
    lastOrderflow: null,
    orderflowVetoes: { count: 0, reasons: [] },
    debrief: null,
  }
}
