// ─── TELEGRAM NOTIFICATION SERVICE ──────────────────────────────────────────
// Sends alerts to your Telegram bot for ORB signals and risk warnings

interface TelegramConfig {
  botToken: string
  chatId: string
}

export async function sendTelegramAlert(
  config: TelegramConfig,
  message: string
): Promise<boolean> {
  if (!config.botToken || !config.chatId) {
    console.log('[Telegram] Not configured — skipping alert')
    return false
  }

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[Telegram] Error:', err)
      return false
    }

    return true
  } catch (err) {
    console.error('[Telegram] Failed to send:', err)
    return false
  }
}

// ─── PRE-BUILT ALERT MESSAGES ────────────────────────────────────────────────

export function buildOrbAlert(data: {
  symbol: string
  direction: string
  price: number
  orHigh: number
  orLow: number
  score?: number
  decision?: string
}): string {
  const emoji = data.direction === 'LONG' ? '🟢📈' : '🔴📉'
  const now = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
  })

  return `
${emoji} <b>ORB BREAKOUT ALERT</b>
━━━━━━━━━━━━━━━━━━
📍 Symbol: <b>${data.symbol}</b>
📊 Direction: <b>${data.direction}</b>
💰 Price: <b>${data.price}</b>
🔼 OR High: ${data.orHigh}
🔽 OR Low: ${data.orLow}
${data.score !== undefined ? `⚡ Score: <b>${data.score}/100</b>` : ''}
${data.decision ? `✅ Decision: <b>${data.decision}</b>` : ''}
⏰ Time (NY): ${now}
━━━━━━━━━━━━━━━━━━
<i>Trading Watchtower — Verify before entering</i>
`.trim()
}

export function buildRiskWarning(message: string): string {
  return `⛔ <b>RISK WARNING</b>\n━━━━━━━━━━━━━━━━━━\n${message}\n━━━━━━━━━━━━━━━━━━\n<i>Trading Watchtower</i>`
}
