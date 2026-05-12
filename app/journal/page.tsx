'use client'
import { useEffect, useState, useCallback } from 'react'

interface Trade {
  id: string
  date: string
  time?: string
  market: string
  direction: string
  contracts: number
  entry: number
  exit?: number
  resultDollars?: number
  grossPnl?: number
  tradeFees?: number
  status: string
  notes?: string
}

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/trades?limit=200')
    const { trades } = await res.json()
    setTrades(trades ?? [])
    setLoading(false)
  }, [])

  const sync = useCallback(async () => {
    setSyncing(true)
    setMsg(null)
    try {
      const res = await fetch('/api/trades/import?days=7', { method: 'POST' })
      const data = await res.json()
      if (data.error) { setMsg(`Error: ${data.error}`) }
      else { setMsg(`Synced: ${data.imported} new, ${data.skipped} existing`) }
      await load()
    } catch { setMsg('Sync failed') }
    setSyncing(false)
    setTimeout(() => setMsg(null), 6000)
  }, [load])

  useEffect(() => {
    // Auto-sync on page load then fetch
    sync()
  }, [sync])

  // Group trades by date
  const byDate = trades.reduce<Record<string, Trade[]>>((acc, t) => {
    if (!acc[t.date]) acc[t.date] = []
    acc[t.date].push(t)
    return acc
  }, {})

  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  const totalNet = trades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
  const totalGross = trades.reduce((s, t) => s + (t.grossPnl ?? t.resultDollars ?? 0), 0)
  const totalFees = trades.reduce((s, t) => s + (t.tradeFees ?? 0), 0)
  const wins = trades.filter(t => t.status === 'WIN').length
  const losses = trades.filter(t => t.status === 'LOSS').length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>TRADE JOURNAL</h1>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            {trades.length} trades · {wins}W {losses}L · Synced from TopStepX
          </p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          style={{
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '600',
            padding: '10px 18px', borderRadius: '6px', cursor: syncing ? 'wait' : 'pointer',
            border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)',
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? '⏳ Syncing...' : '⚡ Refresh from TopStepX'}
        </button>
      </div>

      {/* Sync feedback */}
      {msg && (
        <div style={{
          background: msg.startsWith('Error') ? 'var(--red-bg)' : 'var(--green-bg)',
          border: `1px solid ${msg.startsWith('Error') ? 'var(--red-border)' : 'var(--green-border)'}`,
          borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
          color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)',
        }}>
          {msg}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'NET P&L', value: `${totalNet >= 0 ? '+' : ''}$${totalNet.toFixed(0)}`, color: totalNet >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'GROSS P&L', value: `${totalGross >= 0 ? '+' : ''}$${totalGross.toFixed(0)}`, color: totalGross >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'TOTAL FEES', value: `-$${Math.abs(totalFees).toFixed(0)}`, color: 'var(--yellow)' },
          { label: 'WIN RATE', value: wins + losses > 0 ? `${((wins / (wins + losses)) * 100).toFixed(0)}%` : '—', color: 'var(--text-primary)' },
        ].map(c => (
          <div key={c.label} className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '6px' }}>{c.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: c.color, fontFamily: 'IBM Plex Mono, monospace' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Trades by date */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading...</div>
      ) : trades.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>◎</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>No trades found on TopStepX</div>
        </div>
      ) : (
        dates.map(date => {
          const dayTrades = byDate[date]
          const dayNet = dayTrades.reduce((s, t) => s + (t.resultDollars ?? 0), 0)
          const dayGross = dayTrades.reduce((s, t) => s + (t.grossPnl ?? t.resultDollars ?? 0), 0)
          const dayFees = dayTrades.reduce((s, t) => s + (t.tradeFees ?? 0), 0)

          return (
            <div key={date} className="card" style={{ marginBottom: '16px', overflow: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', padding: '0 10px' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{date}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', display: 'flex', gap: '16px' }}>
                  <span>Gross: <span style={{ color: dayGross >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>${dayGross.toFixed(0)}</span></span>
                  <span>Fees: <span style={{ color: 'var(--yellow)' }}>-${Math.abs(dayFees).toFixed(0)}</span></span>
                  <span>Net: <span style={{ color: dayNet >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>${dayNet.toFixed(0)}</span></span>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['TIME', 'MARKET', 'DIR', 'QTY', 'ENTRY', 'EXIT', 'GROSS', 'FEES', 'NET', 'STATUS'].map(h => (
                      <th key={h} style={{ padding: '10px 10px', textAlign: h === 'QTY' ? 'center' : 'left', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.08em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayTrades.map(t => {
                    const gross = t.grossPnl ?? t.resultDollars ?? 0
                    const fees = t.tradeFees ?? 0
                    const net = t.resultDollars ?? 0
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 10px', color: 'var(--text-secondary)' }}>{t.time ?? '—'}</td>
                        <td style={{ padding: '12px 10px', fontWeight: '600' }}>{t.market}</td>
                        <td style={{ padding: '12px 10px' }}>
                          <span style={{ color: t.direction === 'LONG' ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>
                            {t.direction === 'LONG' ? '↑' : '↓'} {t.direction}
                          </span>
                        </td>
                        <td style={{ padding: '12px 10px', textAlign: 'center' }}>{t.contracts}</td>
                        <td style={{ padding: '12px 10px' }}>{t.entry}</td>
                        <td style={{ padding: '12px 10px' }}>{t.exit ?? '—'}</td>
                        <td style={{ padding: '12px 10px', color: gross >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: '600' }}>
                          {gross >= 0 ? '+' : ''}${gross.toFixed(0)}
                        </td>
                        <td style={{ padding: '12px 10px', color: 'var(--yellow)' }}>
                          -${Math.abs(fees).toFixed(2)}
                        </td>
                        <td style={{ padding: '12px 10px', color: net >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>
                          {net >= 0 ? '+' : ''}${net.toFixed(0)}
                        </td>
                        <td style={{ padding: '12px 10px' }}>
                          <span style={{ color: t.status === 'WIN' ? 'var(--green)' : t.status === 'LOSS' ? 'var(--red)' : 'var(--yellow)', fontWeight: '700' }}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </div>
  )
}
