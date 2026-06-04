'use client'
import { useEffect, useState } from 'react'

export default function PerformancePage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/performance')
      .then(r => r.json())
      .then(d => { setStats(d.stats); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', padding: '40px' }}>Loading...</div>
  if (!stats) return null

  const noTrades = stats.totalTrades === 0

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>
          PERFORMANCE
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
          {stats.totalTrades} trades · Track your edge
        </p>
      </div>

      {noTrades ? (
        <div className="card" style={{ textAlign: 'center', padding: '80px' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>◆</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
            No completed trades yet. Log your first trade in the Journal.
          </div>
        </div>
      ) : (
        <>
          {/* Core Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            {[
              { label: 'Total Trades', value: stats.totalTrades, color: undefined },
              { label: 'Win Rate', value: `${stats.winRate}%`, color: parseFloat(stats.winRate) >= 50 ? 'var(--green)' : 'var(--red)' },
              { label: 'Total P&L', value: `${parseFloat(stats.totalPnl) >= 0 ? '+' : ''}$${stats.totalPnl}`, color: parseFloat(stats.totalPnl) >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'Profit Factor', value: stats.profitFactor, color: parseFloat(stats.profitFactor) >= 1.5 ? 'var(--green)' : parseFloat(stats.profitFactor) >= 1 ? 'var(--yellow)' : 'var(--red)' },
              { label: 'Total R', value: `${parseFloat(stats.totalR) >= 0 ? '+' : ''}${stats.totalR}R`, color: parseFloat(stats.totalR) >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'Avg R', value: `${stats.avgR}R`, color: parseFloat(stats.avgR) >= 0 ? 'var(--green)' : 'var(--red)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card">
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600' }}>{label}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '24px', fontWeight: '700', color: color ?? 'var(--text-primary)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Win/Loss Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            {[
              { label: 'Wins', value: stats.wins, color: 'var(--green)' },
              { label: 'Losses', value: stats.losses, color: 'var(--red)' },
              { label: 'Avg Win', value: `$${stats.avgWin}`, color: 'var(--green)' },
              { label: 'Avg Loss', value: `$${stats.avgLoss}`, color: 'var(--red)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card">
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600' }}>{label}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: '700', color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Win Rate Bar */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '12px' }}>WIN RATE VISUAL</div>
            <div style={{ background: 'var(--surface)', borderRadius: '4px', height: '12px', overflow: 'hidden', display: 'flex' }}>
              <div style={{
                width: `${stats.winRate}%`,
                background: 'var(--green)',
                height: '100%',
                boxShadow: '0 0 8px rgba(0,230,118,0.6)',
                transition: 'width 0.8s ease',
              }} />
              <div style={{ flex: 1, background: 'var(--red)', opacity: 0.5 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--green)' }}>Wins: {stats.wins} ({stats.winRate}%)</span>
              <span style={{ color: 'var(--red)' }}>Losses: {stats.losses}</span>
            </div>
          </div>

          {/* By Direction */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            {(['LONG', 'SHORT'] as const).map((dir) => {
              const d = stats.byDirection[dir]
              const pnl = d.pnl
              return (
                <div key={dir} className="card" style={{ borderColor: dir === 'LONG' ? 'var(--green-border)' : 'var(--red-border)' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: dir === 'LONG' ? 'var(--green)' : 'var(--red)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '12px' }}>
                    {dir === 'LONG' ? '↑' : '↓'} {dir} TRADES
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '28px', fontWeight: '700', color: 'var(--text-primary)' }}>{d.trades}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', color: pnl >= 0 ? 'var(--green)' : 'var(--red)', marginTop: '4px' }}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Score Buckets */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '16px' }}>
              PERFORMANCE BY SETUP SCORE
            </div>
            <table>
              <thead>
                <tr>
                  <th>Score Range</th>
                  <th>Trades</th>
                  <th>Win Rate</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {stats.byScoreBucket.filter((b: any) => b.trades > 0).map((b: any) => (
                  <tr key={b.label}>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{b.label}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{b.trades}</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', color: parseInt(b.winRate) >= 50 ? 'var(--green)' : 'var(--red)' }}>{b.winRate}%</td>
                    <td style={{ fontFamily: 'JetBrains Mono, monospace', color: b.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {b.pnl >= 0 ? '+' : ''}${b.pnl.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rule Following */}
          <div className="card">
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '12px' }}>
              DISCIPLINE METRICS
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '36px', fontWeight: '700', color: parseInt(stats.ruleFollowingPct) >= 80 ? 'var(--green)' : 'var(--yellow)' }}>
                {stats.ruleFollowingPct}%
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Rule compliance rate<br />
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  Target: 90%+
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
