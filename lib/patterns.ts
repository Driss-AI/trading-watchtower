// ─── CANDLESTICK PATTERN DETECTION ────────────────────────────────────────────
// Pure logic — no React, no SSE, no browser APIs.
// Imported by CandleReader.tsx for chart rendering and pattern panel.

export interface Candle {
  open: number
  high: number
  low: number
  close: number
  time: number
  ticks: number
}

export interface PatternResult {
  name: string
  emoji: string
  signal: 'bullish' | 'bearish' | 'neutral' | 'caution'
  meaning: string
  orbContext: string
  strength: number
  action: string
}

export function detectPattern(candles: Candle[], idx: number): PatternResult | null {
  if (idx < 0 || idx >= candles.length) return null
  const c     = candles[idx]
  const prev  = idx >= 1 ? candles[idx - 1] : null
  const prev2 = idx >= 2 ? candles[idx - 2] : null

  const body   = Math.abs(c.close - c.open)
  const range  = c.high - c.low
  if (range === 0) return null

  const upperWick      = c.high - Math.max(c.open, c.close)
  const lowerWick      = Math.min(c.open, c.close) - c.low
  const bodyRatio      = body / range
  const upperWickRatio = upperWick / range
  const lowerWickRatio = lowerWick / range
  const isBullish      = c.close > c.open
  const isBearish      = c.close < c.open

  if (prev && prev2) {
    const allBull = isBullish && prev.close > prev.open && prev2.close > prev2.open
    const allBear = isBearish && prev.close < prev.open && prev2.close < prev2.open
    const avgBody  = (body + Math.abs(prev.close - prev.open) + Math.abs(prev2.close - prev2.open)) / 3
    const avgRange = (range + (prev.high - prev.low) + (prev2.high - prev2.low)) / 3
    if (allBull && avgBody / avgRange > 0.55) return { name: '3-Candle Bull Stack', emoji: '🚀', signal: 'bullish', strength: 93,
      meaning: 'Three consecutive bullish candles with solid bodies — a pure institutional buy program is driving price up. No hesitation, no sellers in control.',
      orbContext: 'This is THE ORB confirmation pattern. Three stacked green candles above OR High = institutions committed. Enter long on the next Fib pullback to 50–61.8%.',
      action: 'STRONG LONG — enter on Fib pullback' }
    if (allBear && avgBody / avgRange > 0.55) return { name: '3-Candle Bear Stack', emoji: '💣', signal: 'bearish', strength: 93,
      meaning: 'Three consecutive bearish candles — coordinated institutional selling with zero buyer resistance. Sellers fully in control.',
      orbContext: 'Breakdown confirmed below OR Low. Three stacked red candles = sustained conviction. Short on any bounce to 50–61.8% Fib.',
      action: 'STRONG SHORT — enter on bounce' }
  }

  if (bodyRatio < 0.1) return { name: 'Doji', emoji: '➕', signal: 'neutral', strength: 20,
    meaning: 'Opening and closing price are almost identical — bulls and bears are in perfect equilibrium. The market is paralyzed, neither side willing to commit.',
    orbContext: 'A Doji at the OR boundary is a red flag. Do NOT trade the breakout. Wait for the next candle to show a clear direction before entering.',
    action: 'WAIT — stand aside until next candle commits' }

  if (lowerWickRatio > 0.55 && upperWickRatio < 0.2 && bodyRatio > 0.05) return { name: 'Hammer', emoji: '🔨', signal: 'bullish', strength: 74,
    meaning: 'Sellers drove price aggressively lower during the candle, but buyers stepped in hard and rejected those lows — closing near the top. A classic reversal signal.',
    orbContext: 'Hammer at OR Low = the stop-hunt is complete. Algorithms swept retail stops below support, now buyers are absorbing. Long on the next green confirmation candle.',
    action: 'LONG on next green candle confirmation' }

  if (upperWickRatio > 0.55 && lowerWickRatio < 0.2 && bodyRatio > 0.05 && isBearish) return { name: 'Shooting Star', emoji: '⭐', signal: 'bearish', strength: 71,
    meaning: 'Buyers pushed price sharply higher during the candle, but sellers overwhelmed them and slammed price back down to close near the open. A failed breakout signal.',
    orbContext: 'Shooting Star at OR High = liquidity sweep trap. Breakout buyers are now trapped. Sellers absorbed all demand. Exit longs immediately — short setup forming.',
    action: 'EXIT longs / SHORT on next red candle' }

  if (upperWickRatio > 0.55 && lowerWickRatio < 0.2 && bodyRatio > 0.05 && isBullish && prev && prev.close < prev.open) return { name: 'Inverted Hammer', emoji: '🌟', signal: 'caution', strength: 52,
    meaning: 'After a downtrend, buyers attempted a rally but sellers pushed back. Still closed bullish — could be the first sign of a reversal, but needs confirmation.',
    orbContext: 'Potential reversal at OR Low but not confirmed yet. Watch for a strong bullish candle next. If next candle is red, the downtrend continues.',
    action: 'WAIT — needs bullish confirmation next candle' }

  if (bodyRatio > 0.85 && isBullish) return { name: 'Bullish Marubozu', emoji: '🟩', signal: 'bullish', strength: 88,
    meaning: 'Price opened at the absolute low and closed at the absolute high — zero wick on both sides. Pure, uninterrupted institutional buying with zero seller resistance.',
    orbContext: 'This is momentum candle #1. Watch for 2–3 more stacking on top above OR High. Do NOT chase — wait for the inevitable pullback to 50–61.8% Fib retracement.',
    action: 'LONG — wait for Fib retracement entry' }

  if (bodyRatio > 0.85 && isBearish) return { name: 'Bearish Marubozu', emoji: '🟥', signal: 'bearish', strength: 88,
    meaning: 'Price opened at the absolute high and closed at the absolute low — zero wick. Pure, uninterrupted institutional selling with zero buyer resistance.',
    orbContext: 'Full institutional conviction below OR Low. Sellers own this session. Short on any bounce, minimum 2:1 R:R target.',
    action: 'SHORT — enter on bounce retracement' }

  if (prev && isBullish && prev.close < prev.open) {
    if (body > Math.abs(prev.close - prev.open) * 1.0 && bodyRatio > 0.4) return { name: 'Bullish Engulfing', emoji: '📈', signal: 'bullish', strength: 82,
      meaning: 'The current green candle completely swallows the previous red candle body — buyers decisively overpowered sellers in a single candle. A high-conviction reversal.',
      orbContext: 'After an OR pullback, this is the Fib re-entry confirmation you have been waiting for. Buyers defended support. Long entry here aligns with the 50–61.8% bounce technique.',
      action: 'LONG — confirmation printed, enter now' }
  }

  if (prev && isBearish && prev.close > prev.open) {
    if (body > Math.abs(prev.close - prev.open) * 1.0 && bodyRatio > 0.4) return { name: 'Bearish Engulfing', emoji: '📉', signal: 'bearish', strength: 82,
      meaning: 'The current red candle completely swallows the previous green candle body — sellers overwhelmed buyers in a single decisive move. A high-conviction reversal.',
      orbContext: 'OR High rejection confirmed. The false breakout trap has materialized. Exit any longs immediately. This is the short entry candle.',
      action: 'EXIT longs / SHORT entry — act now' }
  }

  if (prev && c.high < prev.high && c.low > prev.low) return { name: 'Inside Bar', emoji: '📦', signal: 'caution', strength: 50,
    meaning: "This candle is entirely contained within the previous candle's range. The market is in a state of compression and indecision — energy is coiling for a big move.",
    orbContext: 'Do not trade the inside bar itself. The NEXT candle breaking above or below gives the direction. The breakout of an inside bar is typically explosive.',
    action: 'WAIT — trade breakout of this bar next candle' }

  if (lowerWickRatio > 0.45 && upperWickRatio < 0.25 && bodyRatio < 0.3) return { name: 'Pin Bar (Bullish)', emoji: '📌', signal: 'bullish', strength: 68,
    meaning: 'Long lower wick shows algorithms swept price aggressively below support to trigger stop losses. Buyers then absorbed all that selling and pushed price back up.',
    orbContext: 'Long wick below OR Low = stop-hunt is complete. Retail stops were harvested. Institutions are now buying. Long above the pin bar high on the next candle.',
    action: 'LONG above pin bar high on next candle' }

  if (upperWickRatio > 0.45 && lowerWickRatio < 0.25 && bodyRatio < 0.3) return { name: 'Pin Bar (Bearish)', emoji: '📌', signal: 'bearish', strength: 68,
    meaning: 'Long upper wick shows a sharp sweep above resistance to trigger buy-stop orders. Sellers then absorbed all that buying demand and closed price back down.',
    orbContext: 'Long wick above OR High = liquidity sweep trap. Breakout buyers got trapped at the high. Short below the pin bar low on the next candle.',
    action: 'SHORT below pin bar low on next candle' }

  if (bodyRatio > 0.62 && isBullish) return { name: 'Strong Bull Candle', emoji: '💚', signal: 'bullish', strength: 63,
    meaning: 'A solid bullish candle where the body dominates the wicks. Buyers are in control with real momentum — this is not a fake move.',
    orbContext: 'Supports the long ORB thesis. If above OR High, look for a follow-through candle to confirm. Body > 60% of range means buyers mean business.',
    action: 'HOLD longs / watch for continuation' }

  if (bodyRatio > 0.62 && isBearish) return { name: 'Strong Bear Candle', emoji: '❤️', signal: 'bearish', strength: 63,
    meaning: 'A solid bearish candle where the body dominates the wicks. Sellers are in control with real momentum — not a fake reversal.',
    orbContext: 'Supports the short ORB thesis. If below OR Low, look for follow-through. Body > 60% of range means sellers are committed.',
    action: 'HOLD shorts / watch for continuation' }

  return { name: 'Mixed Candle', emoji: '↔️', signal: 'neutral', strength: 18,
    meaning: 'No clear pattern — balanced wicks and body show neither bulls nor bears are in control. The market is undecided and noisy.',
    orbContext: 'Avoid trading this type of candle. Wait for a momentum candle (body > 60% of range) to show a clear directional bias before entering.',
    action: 'WAIT — no clear edge, stay patient' }
}
