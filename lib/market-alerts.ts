// ─── IN-APP MARKET ALERT SCHEDULER ───────────────────────────────────────────
// Sends the pre-market / session Telegram alerts from inside the always-on
// server instead of an external GitHub Actions cron. Because it reads the live
// America/New_York clock, it follows US Eastern time automatically — including
// daylight-saving switches — no matter where the user is. Dubai times in the
// copy are also computed live, so they stay correct year-round.
//
// Replaces the GitHub Actions "Market Alerts" workflow (disable that workflow
// in the repo's Actions tab to avoid duplicate messages).

import { sendTelegramAlert } from './telegram'

export type AlertType = 'warning15' | 'warning5' | 'open' | 'trade' | 'close'

export const ALERT_TYPES: AlertType[] = ['warning15', 'warning5', 'open', 'trade', 'close']

// Target times in US Eastern (24h). Each fires once per trading day.
const SCHEDULE: { h: number; m: number; type: AlertType }[] = [
  { h: 9,  m: 15, type: 'warning15' },
  { h: 9,  m: 25, type: 'warning5' },
  { h: 9,  m: 30, type: 'open' },
  { h: 9,  m: 45, type: 'trade' },
  { h: 11, m: 30, type: 'close' },
]

// Still fire if a tick lands up to this many minutes late (restart / jitter),
// but never replay an alert that is more than this far in the past.
const GRACE_MIN = 5

// ─── TIME HELPERS ─────────────────────────────────────────────────────────────

// Render a given ET wall-clock time *today* in an arbitrary timezone, e.g.
// dubai/ET label. Uses the offset trick so it works on any server timezone.
function labelFor(timeZone: string, etHour: number, etMin: number): string {
  const now = new Date()
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offsetMs = now.getTime() - etNow.getTime()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  const etTarget = new Date(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day), etHour, etMin, 0, 0)
  const instant = new Date(etTarget.getTime() + offsetMs)
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(instant)
}

const dubai = (h: number, m: number) => labelFor('Asia/Dubai', h, m)

function getNY(): { weekday: string; totalMin: number; date: string } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  let hour = parseInt(p.hour)
  if (hour === 24) hour = 0 // some environments emit '24' at midnight with hour12:false
  return {
    weekday: p.weekday,
    totalMin: hour * 60 + parseInt(p.minute),
    date: `${p.year}-${p.month}-${p.day}`,
  }
}

// ─── MESSAGE BUILDERS (HTML — matches sendTelegramAlert parse_mode) ───────────

export function buildAlertMessage(type: AlertType): string {
  switch (type) {
    case 'warning15':
      return [
        '⏰ <b>Trading Watchtower</b>',
        '',
        'Market opens in <b>15 minutes</b>',
        `🕐 9:30 AM ET  |  ${dubai(9, 30)} Dubai`,
        '',
        'Review your OR plan and bias 📋',
      ].join('\n')

    case 'warning5':
      return [
        '⚠️ <b>Trading Watchtower</b>',
        '',
        'Market opens in <b>5 minutes</b>',
        '',
        'Final checks:',
        '• NQ pre-market direction',
        '• VIX level',
        '• QQQ bias',
        '• Economic events today',
      ].join('\n')

    case 'open':
      return [
        '🟢 <b>Trading Watchtower</b>',
        '',
        '<b>MARKET OPEN</b>',
        'Opening Range is now building (15-min)',
        '⏱ 9:30 → 9:45 AM ET',
        '',
        'Watch and wait — do NOT trade yet',
      ].join('\n')

    case 'trade':
      return [
        '⚡ <b>Trading Watchtower</b>',
        '',
        '<b>TRADE WINDOW OPEN</b>',
        'OR is complete — breakout alerts active',
        `⏱ 9:45 → 11:30 AM ET  |  ${dubai(9, 45)} → ${dubai(11, 30)} Dubai`,
        '',
        'Max 2 trades · $1K daily limit · 2:1 R:R minimum',
      ].join('\n')

    case 'close':
      return [
        '🔴 <b>Trading Watchtower</b>',
        '',
        '<b>SESSION CLOSED</b>',
        `11:30 AM ET  |  ${dubai(11, 30)} Dubai`,
        '',
        'Trade window ended. Log your trades 📊',
      ].join('\n')
  }
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

export async function sendMarketAlert(type: AlertType): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
  if (!botToken || !chatId) {
    console.log('[MarketAlerts] Telegram not configured — skipping', type)
    return false
  }
  const ok = await sendTelegramAlert({ botToken, chatId }, buildAlertMessage(type))
  console.log(`[MarketAlerts] Sent ${type}: ${ok}`)
  return ok
}

// ─── SCHEDULER ─────────────────────────────────────────────────────────────────

let _sentDate = ''
const _sent = new Set<AlertType>()

function tick(): void {
  const { weekday, totalMin, date } = getNY()

  if (date !== _sentDate) {
    _sentDate = date
    _sent.clear()
  }

  if (weekday === 'Sat' || weekday === 'Sun') return

  for (const slot of SCHEDULE) {
    if (_sent.has(slot.type)) continue
    const target = slot.h * 60 + slot.m
    if (totalMin >= target && totalMin < target + GRACE_MIN) {
      _sent.add(slot.type)
      console.log(`[MarketAlerts] Firing ${slot.type} (NY ${slot.h}:${String(slot.m).padStart(2, '0')})`)
      sendMarketAlert(slot.type).catch(() => {})
    }
  }
}

let _timer: ReturnType<typeof setInterval> | null = null

export function initMarketAlerts(): void {
  // Prevent duplicate timers across Next.js module contexts (same process).
  const g = globalThis as Record<string, unknown>
  if (g.__marketAlertsTimer) return
  g.__marketAlertsTimer = true

  // Pre-seed today's "sent" set so a mid-day boot doesn't replay past alerts —
  // anything already more than GRACE_MIN past its target is marked as sent.
  const { date, totalMin } = getNY()
  _sentDate = date
  for (const slot of SCHEDULE) {
    if (totalMin >= slot.h * 60 + slot.m + GRACE_MIN) _sent.add(slot.type)
  }

  _timer = setInterval(() => {
    try { tick() } catch (err) { console.error('[MarketAlerts] tick error:', err) }
  }, 60_000)

  console.log('[MarketAlerts] In-app alert scheduler initialized')
}

// Boot on module load (mirrors paper-engine's auto-start pattern).
initMarketAlerts()
