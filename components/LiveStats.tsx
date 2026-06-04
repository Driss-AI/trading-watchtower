'use client'
// ─── LIVE STATS BAR ───────────────────────────────────────────────────────────
// Shows daily P&L from Topstep fills (auto-refreshing) + ORB breakout alert.
// Auto-creates journal entries for any new fills via /api/topstepx/sync.

import { useEffect, useState, useCallback } from 'react'

interface DailyPnL {
  net: number
  gross: number
  fees: number
  trades: { total: number; winners: number; losers: number }
  autoCreated: number
}

interface ORBData {
  orHigh: number
  orLow: number
  orSize: number
  currentPrice: number
  breakoutDirection: 'LONG' | 'SHORT' | 'NONE'
  contractId: string
}

export default function LiveStats() {
  const [pnl, setPnl]     = useState<DailyPnL | null>(null)
  const [orb, setOrb]     = useState<ORBData | null>(null)
  const [lastSync, setLastSync] = useState<string>('')
  const [orbError, setOrbError] = useState<string | null>(null)

  const syncPnL = useCallback(async () => {
    try {
      const res = await fetch('/api/topstepx/sync')
      if (!res.ok) return
      const data = await res.json()
      setPnl({ net: data.pnl.net, gross: data.pnl.gross, fees: data.pnl.fees, trades: data.trades, autoCreated: data.autoCreated })
      setLastSync(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
    } catch {}
  }, [])

  const fetchORB = useCallback(async () => {
    try {
      setOrbError(null)
      const res = await fetch('/api/topstepx/orb?symbol=MNQ')
      if (!res.ok) { setOrbError('ORB unavailable'); return }
      const { orb: o, error } = await res.json()
      if (error) { setOrbError(error); return }
      if (o) setOrb(o)
    } catch {}
  }, [])

  useEffect(() => {
    syncPnL()
    fetchORB()
    const pnlTimer = setInterval(syncPnL, 60_000)
    const orbTimer = setInterval(fetchORB, 30_000)
    return () => { clearInterval(pnlTimer); clearInterval(orbTimer) }
  }, [syncPnL, fetchORB])

  const pnlColor = !pnl || pnl.net === 0 ? 'var(--text-secondary)' : pnl.net > 0 ? 'var(--green)' : 'var(--red)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>

      {orb && orb.breakoutDirection !== 'NONE' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', padding: '12px 20px', background: orb.breakoutDirection === 'LONG' ? 'rgba(93,202,165,0.12)' : 'rgba(210,90,48,0.12)', border: `1px solid ${orb.breakoutDirection === 'LONG' ? 'var(--green)' : 'var(--red)'}`, borderRadius: '10px', boxShadow: orb.breakoutDirection === 'LONG' ? '0 0 12px rgba(93,202,165,0.2)' : '0 0 12px rgba(210,90,48,0.2)' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: '800', color: orb.breakoutDirection === 'LONG' ? 'var(--green)' : 'var(--red)', letterSpacing: '0.05em' }}>
            {orb.breakoutDirection === 'LONG' ? '▲ ORB BREAKOUT — LONG' : '▼ ORB BREAKOUT — SHORT'}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Price: <strong style={{ color: 'var(--text-primary)' }}>{orb.currentPrice.toFixed(2)}</strong>
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
            OR: <strong style={{ color: 'var(--red)' }}>{orb.orLow.toFixed(2)}</strong>{' – '}<strong style={{ color: 'var(--green)' }}>{orb.orHigh.toFixed(2)}</strong>
            <span style={{ color: 'var(--text-dim)', marginLeft: '6px' }}>({orb.orSize.toFixed(0)} pts)</span>
          </span>
        </div>
      )}

      {orb && orb.breakoutDirection === 'NONE' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', padding: '10px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '700', letterSpacing: '0.08em' }}>📐 OPENING RANGE</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>High: <strong style={{ color: 'var(--green)' }}>{orb.orHigh.toFixed(2)}</strong></span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>Low: <strong style={{ color: 'var(--red)' }}>{orb.orLow.toFixed(2)}</strong></span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>Size: <strong style={{ color: 'var(--text-primary)' }}>{orb.orSize.toFixed(0)} pts</strong></span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>Now: <strong style={{ color: 'var(--text-primary)' }}>{orb.currentPrice.toFixed(2)}</strong></span>
          <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)' }}>● watching for breakout</span>
        </div>
      )}

      {orbError && (
        <div style={{ padding: '8px 16px', background: 'var(--surface)', borderRadius: '8px', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
          📐 ORB: {orbError} — market may be pre-open
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap', padding: '14px 20px', background: 'var(--card)', border: `1px solid ${!pnl || pnl.net === 0 ? 'var(--border)' : pnl.net > 0 ? 'var(--green-border)' : 'var(--red-border)'}`, borderRadius: '10px' }}>
        <div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '700', letterSpacing: '0.1em', marginBottom: '4px' }}>💰 DAILY P&L · LIVE</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '28px', fontWeight: '700', color: pnlColor, lineHeight: 1 }}>
            {pnl ? `${pnl.net >= 0 ? '+' : ''}$${pnl.net.toFixed(0)}` : '$0'}
          </div>
        </div>
        {pnl && pnl.trades.total > 0 && (
          <>
            <div style={{ height: '40px', width: '1px', background: 'var(--border)' }} />
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px' }}>
              <span style={{ color: 'var(--green)', fontWeight: '700' }}>{pnl.trades.winners}W</span>
              <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>·</span>
              <span style={{ color: 'var(--red)', fontWeight: '700' }}>{pnl.trades.losers}L</span>
            </div>
            {pnl.fees > 0 && (
              <>
                <div style={{ height: '40px', width: '1px', background: 'var(--border)' }} />
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-dim)' }}>gross: ${pnl.gross.toFixed(0)}<br />fees: ${pnl.fees.toFixed(0)}</div>
              </>
            )}
          </>
        )}
        {pnl && pnl.autoCreated > 0 && (
          <>
            <div style={{ height: '40px', width: '1px', background: 'var(--border)' }} />
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--green)' }}>✓ {pnl.autoCreated} fill{pnl.autoCreated !== 1 ? 's' : ''} auto-journaled</div>
          </>
        )}
        <div style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', textAlign: 'right' }}>
          {lastSync ? `synced ${lastSync} ET` : 'syncing...'}<br />
          <span style={{ color: 'var(--green)' }}>● Topstep live</span>
        </div>
      </div>
    </div>
  )
}
