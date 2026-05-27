// ─── PAPER TRADING ENGINE ─────────────────────────────────────────────────────
// Server-side singleton that watches the live MNQ price stream and simulates
// ORB breakout trades. No real orders are placed — trades are recorded to the
// database with source="paper" for later analysis.
//
// State machine: idle → forming → monitoring → closed
//   idle:       engine off or outside trading hours
//   forming:    9:30–10:00 AM ET — building the opening range from live ticks
//   monitoring: 10:00–11:30 AM ET — watching for breakout, managing positions
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
import { calculateRisk, POINT_VALUES } from './scoring'
import {
  analyzePreSession,
  analyzeOpeningRange,
  analyzeBreakout,
  type PreSessionDecision,
  type ORAssessment,
  type BreakoutDecision,
} from './trading-ai'
import { fetchMarketBriefing, fetchMacroSentiment } from './market-data'
import { getSessionImpact } from './calendar-intel'

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
}

// AI state
let _preSession: PreSessionDecision | null = null
let _orAssessment: ORAssessment | null = null
let _lastBreakout: BreakoutDecision | null = null
let _aiAnalysisInProgress = false
let _briefingCache: Awaited<ReturnType<typeof fetchMarketBriefing>> | null = null

// Settings cache
let _settings: {
  dailyLossLimit: number
  maxTradesPerDay: number
  maxLosingTradesPerDay: number
  accountSize: number
} | null = null

// ─── NY TIME HELPERS ─────────────────────────────────────────────────────────

function getNYTime(): { h: number; m: number; totalMin: number } {
  const now = new Date()
  const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })
  const parts = nyStr.split(', ')[1]?.split(':') ?? []
  const h = parseInt(parts[0]) || 0
  const m = parseInt(parts[1]) || 0
  return { h, m, totalMin: h * 60 + m }
}

function getTodayDate(): string {
  return new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
    .split(',')[0]
    .split('/')
    .map((p, i) => i === 2 ? p : p.padStart(2, '0'))
    .reverse()
    .join('-')
    // Format: MM/DD/YYYY → YYYY-MM-DD
    .replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2-$3')
}

function formatNYTime(): string {
  const { h, m } = getNYTime()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ET`
}

// ─── SETTINGS LOADER ─────────────────────────────────────────────────────────

async function loadSettings() {
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
  } catch {
    // Use defaults if DB not available
    _settings = {
      dailyLossLimit: 1000,
      maxTradesPerDay: 2,
      maxLosingTradesPerDay: 2,
      accountSize: 50000,
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
  } else if (totalMin < 600) {
    // 9:30–10:00 AM: forming OR
    _phase = 'forming'
  } else if (totalMin < _config.sessionEndMinute) {
    // 10:00 AM – session end: monitoring
    if (!_orLocked && _orHigh !== null && _orLow !== null) {
      _orLocked = true
      console.log(`[PaperEngine] OR locked: H=${_orHigh} L=${_orLow} Size=${(_orHigh - _orLow).toFixed(2)}`)
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
  try {
    await prisma.session.upsert({
      where: { date: today },
      update: { orHigh: _orHigh, orLow: _orLow, orSize: _orHigh - _orLow },
      create: { date: today, market: 'MNQ', orHigh: _orHigh, orLow: _orLow, orSize: _orHigh - _orLow },
    })
  } catch (err) {
    console.error('[PaperEngine] Failed to persist OR:', err)
  }
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

    if (_preSession.adjustments.bufferPoints != null) _config.bufferPoints = _preSession.adjustments.bufferPoints
    if (_preSession.adjustments.targetMultiple != null) _config.targetMultiple = _preSession.adjustments.targetMultiple
    if (_preSession.adjustments.maxContracts != null) _config.maxContracts = _preSession.adjustments.maxContracts

    console.log(`[PaperEngine] AI pre-session: trade=${_preSession.shouldTrade} bias=${_preSession.bias} confidence=${_preSession.confidence}%`)
  } catch (err) {
    console.error('[PaperEngine] Pre-session AI failed:', err)
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
  } catch (err) {
    console.error('[PaperEngine] OR AI failed:', err)
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
  }
}

// ─── TICK PROCESSOR ──────────────────────────────────────────────────────────

function processTick(quote: WSQuote): void {
  if (quote.price <= 0) return
  _lastPrice = quote.price

  checkDayReset()
  updatePhase()

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

  // Check entry (if no open position)
  checkEntry(price)
}

function handleClosed(price: number): void {
  if (_openTrade) {
    console.log(`[PaperEngine] Session end — closing open position at ${price}`)
    closePosition(price, 'session_end')
  }
}

// ─── ENTRY LOGIC ─────────────────────────────────────────────────────────────

let _entryLock = false

function checkEntry(price: number): void {
  if (_entryLock) return
  if (!_settings) return
  if (_orHigh === null || _orLow === null) return

  // Risk guards
  if (_tradesCount >= _settings.maxTradesPerDay) return
  if (_lossesCount >= _settings.maxLosingTradesPerDay) return
  if (Math.abs(_dailyPnl) >= _settings.dailyLossLimit) return

  // AI pre-session says no trade
  if (_preSession && !_preSession.shouldTrade) {
    return
  }

  // AI OR assessment says no trade
  if (_orAssessment && !_orAssessment.shouldTrade) {
    return
  }

  const orSize = _orHigh - _orLow
  const longTrigger = _orHigh + _config.bufferPoints
  const shortTrigger = _orLow - _config.bufferPoints

  let direction: 'LONG' | 'SHORT' | null = null
  let entryPrice = price
  let stopPrice: number
  let targetPrice: number

  if (price > longTrigger) {
    direction = 'LONG'
    stopPrice = _orLow
    targetPrice = entryPrice + orSize * _config.targetMultiple
  } else if (price < shortTrigger) {
    direction = 'SHORT'
    stopPrice = _orHigh
    targetPrice = entryPrice - orSize * _config.targetMultiple
  } else {
    return
  }

  // AI direction filter: if AI has a directional bias, only take trades in that direction
  if (_preSession && _preSession.bias !== 'neutral') {
    const aiBias = _preSession.bias === 'long' ? 'LONG' : 'SHORT'
    if (direction !== aiBias) {
      console.log(`[PaperEngine] AI filtered: ${direction} trade blocked, bias is ${_preSession.bias}`)
      return
    }
  }
  if (_orAssessment && _orAssessment.preferredDirection !== 'either' && _orAssessment.preferredDirection !== 'none') {
    const orBias = _orAssessment.preferredDirection === 'long' ? 'LONG' : 'SHORT'
    if (direction !== orBias) {
      console.log(`[PaperEngine] AI OR filtered: ${direction} trade blocked, OR prefers ${_orAssessment.preferredDirection}`)
      return
    }
  }

  // Position sizing via risk calculator
  const riskCalc = calculateRisk({
    market: 'MNQ',
    entry: entryPrice,
    stop: stopPrice,
    target: targetPrice,
    contracts: _config.maxContracts,
    accountSize: _settings.accountSize,
    dailyLossLimit: _settings.dailyLossLimit,
    currentDailyPnl: _dailyPnl,
  })

  if (riskCalc.violatesLimit) {
    console.log(`[PaperEngine] Entry blocked — risk violation: ${riskCalc.violationMessage}`)
    return
  }

  const contracts = Math.min(_config.maxContracts, Math.max(1, riskCalc.maxContractsAllowed))

  // Consult AI for final breakout confirmation (async)
  _entryLock = true
  consultAIForBreakout(direction, entryPrice, stopPrice, targetPrice, contracts)
    .finally(() => { _entryLock = false })
}

async function consultAIForBreakout(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  stopPrice: number,
  targetPrice: number,
  mechanicalContracts: number,
): Promise<void> {
  if (!_orHigh || !_orLow) return

  const preSession = _preSession ?? {
    shouldTrade: true, bias: 'neutral' as const, confidence: 50,
    reasoning: 'No pre-session available', riskLevel: 'medium' as const,
    adjustments: {}, keyFactors: [],
  }
  const orAssess = _orAssessment ?? {
    quality: 'fair' as const, shouldTrade: true,
    preferredDirection: 'either' as const, reasoning: 'No OR assessment available',
  }

  try {
    _aiAnalysisInProgress = true
    const decision = await analyzeBreakout(
      direction, entryPrice, stopPrice, targetPrice,
      _orHigh, _orLow, _orHigh - _orLow,
      preSession, orAssess,
      {
        dailyPnl: _dailyPnl,
        tradesCount: _tradesCount,
        lossesCount: _lossesCount,
        trailingDrawdownRemaining: _settings ? _settings.dailyLossLimit * 2 : 2000,
      },
    )
    _lastBreakout = decision
    _aiAnalysisInProgress = false

    if (!decision.enter) {
      console.log(`[PaperEngine] AI SKIPPED breakout: ${decision.reasoning}`)
      return
    }

    // AI picks contracts, but risk calculator and hard rules get final say
    let contracts = Math.min(decision.contracts || mechanicalContracts, _config.maxContracts)
    if (_lossesCount > 0) contracts = Math.min(contracts, 2)
    const remainingBudget = _settings ? _settings.dailyLossLimit + _dailyPnl : 1000
    const riskPerContract = Math.abs(entryPrice - stopPrice) * MNQ_POINT_VALUE
    if (riskPerContract > 0) contracts = Math.min(contracts, Math.floor(remainingBudget / riskPerContract))
    contracts = Math.max(1, contracts)
    const useEntry = _lastPrice > 0 ? _lastPrice : entryPrice

    if (!_openTrade && _enabled && _phase === 'monitoring') {
      console.log(`[PaperEngine] AI APPROVED entry: ${decision.reasoning}`)
      await openPosition(direction, useEntry, decision.adjustedStop ?? stopPrice, decision.adjustedTarget ?? targetPrice, contracts)
    }
  } catch (err) {
    console.error('[PaperEngine] AI breakout check failed, using mechanical entry:', err)
    _aiAnalysisInProgress = false
    _lastBreakout = { enter: true, reasoning: 'AI failed — mechanical fallback', confidence: 50, contracts: mechanicalContracts }
    if (!_openTrade && _enabled && _phase === 'monitoring') {
      await openPosition(direction, _lastPrice > 0 ? _lastPrice : entryPrice, stopPrice, targetPrice, mechanicalContracts)
    }
  }
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

  // Find or create today's session
  let session = await prisma.session.findUnique({ where: { date: today } })
  if (!session) {
    session = await prisma.session.create({
      data: { date: today, market: 'MNQ', orHigh: _orHigh, orLow: _orLow, orSize: _orHigh && _orLow ? _orHigh - _orLow : null },
    })
  }

  // Build AI reasoning summary
  const aiParts: string[] = []
  if (_preSession) aiParts.push(`Pre-session: ${_preSession.reasoning}`)
  if (_orAssessment) aiParts.push(`OR: ${_orAssessment.quality} — ${_orAssessment.reasoning}`)
  if (_lastBreakout) aiParts.push(`Breakout: ${_lastBreakout.reasoning}`)
  const aiReasoning = aiParts.length > 0 ? aiParts.join(' | ') : null

  // Create trade record
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

  _openTrade = {
    dbId: trade.id,
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

  // Update trade in DB
  try {
    await prisma.trade.update({
      where: { id: _openTrade.dbId },
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
  } catch (err) {
    console.error('[PaperEngine] Failed to update trade:', err)
  }

  // Update daily stats
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

  // Update session daily P&L
  try {
    const today = getToday()
    await prisma.session.update({
      where: { date: today },
      data: {
        dailyPnl: _dailyPnl,
        tradesCount: _tradesCount,
        losesCount: _lossesCount,
      },
    })
  } catch {}

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
    console.log(`[PaperEngine] Subscribed to ${_contractId}`)
  } catch (err) {
    console.error('[PaperEngine] Failed to connect to market stream:', err)
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
  console.log('[PaperEngine] Running — waiting for trading hours')

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
  console.log('[PaperEngine] Stopped')
}

export function configureEngine(config: Partial<EngineConfig>): void {
  _config = { ..._config, ...config }
  console.log('[PaperEngine] Config updated:', _config)
}

export function getEngineState(): PaperEngineState {
  // Refresh phase on read
  if (_enabled) {
    checkDayReset()
    updatePhase()
  }

  return {
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
  }
}
