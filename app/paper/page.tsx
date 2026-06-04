'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'

interface DailyRow { date: string; trades: number; wins: number; losses: number; pnl: number; winRate: number; cumPnl: number }
interface Criterion { label: string; passed: boolean; value: string }
interface RecentTrade { id: string; date: string; time: string | null; direction: string; contracts: number; entry: number; exit: number | null; resultPts: number | null; resultDollars: number | null; resultR: number | null; status: string; aiReasoning: string | null }

interface Debrief { date: string; text: string | null }

interface PaperStats {
  totalTrades: number; totalDays: number; wins: number; losses: number; winRate: string
  totalPnl: number; totalR: number; avgR: number; expectancy: number; profitFactor: string
  avgWin: number; avgLoss: number; maxDrawdown: number
  worstDay: { date: string; pnl: number }; bestDay: { date: string; pnl: number }
  streak: { current: number; type: 'win' | 'loss' | null; longestWin: number; longestLoss: number }
  aiPct: number; criteria: Criterion[]; criteriaPassedCount: number; allCriteriaMet: boolean
  dailyBreakdown: DailyRow[]; recentTrades: RecentTrade[]
  debriefs: Debrief[]
  byDirection: { LONG: { trades: number; pnl: number }; SHORT: { trades: number; pnl: number } }
}

export default function PaperPage() {
  const [stats, setStats] = useState<PaperStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/performance/paper')
      .then((r) => r.json())
      .then((d) => { setStats(d.stats); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', padding: '40px' }}>Loading...</div>
  if (!stats) return null

  const noData = stats.totalTrades === 0

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>
          PAPER VALIDATION
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
          30 days · 50 trades · Prove the edge before automation
        </p>
      </div>

      {/* A. Validation Scorecard */}
      <ValidationScorecard stats={stats} />

      {noData ? (
        <div className="card" style={{ textAlign: 'center', padding: '80px' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>◇</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
            No paper trades yet. Start the Paper Trading Engine on the Dashboard.
          </div>
        </div>
      ) : (
        <>
          {/* B. Core Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <Stat label="Trades" value={String(stats.totalTrades)} />
            <Stat label="Win Rate" value={`${stats.winRate}%`} color={parseFloat(stats.winRate) >= 50 ? 'var(--green)' : parseFloat(stats.winRate) >= 40 ? 'var(--yellow)' : 'var(--red)'} />
            <Stat label="Total P&L" value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(0)}`} color={stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
            <Stat label="Expectancy" value={`$${stats.expectancy.toFixed(2)}`} color={stats.expectancy > 0 ? 'var(--green)' : 'var(--red)'} />
            <Stat label="Profit Factor" value={stats.profitFactor} color={parseFloat(stats.profitFactor) >= 1.5 ? 'var(--green)' : parseFloat(stats.profitFactor) >= 1 ? 'var(--yellow)' : 'var(--red)'} />
            <Stat label="Avg R" value={`${stats.avgR >= 0 ? '+' : ''}${stats.avgR}R`} color={stats.avgR >= 0 ? 'var(--green)' : 'var(--red)'} />
            <Stat label="Avg Win" value={`$${stats.avgWin}`} color="var(--green)" />
            <Stat label="Avg Loss" value={`$${stats.avgLoss}`} color="var(--red)" />
            <Stat label="Max Drawdown" value={`$${stats.maxDrawdown.toFixed(0)}`} color="var(--red)" />
            <Stat label="Worst Day" value={`$${stats.worstDay.pnl.toFixed(0)}`} sub={stats.worstDay.date} color="var(--red)" />
            <Stat label="Best Day" value={`+$${stats.bestDay.pnl.toFixed(0)}`} sub={stats.bestDay.date} color="var(--green)" />
            <Stat label="Streak" value={stats.streak.current > 0 ? `${stats.streak.current} ${stats.streak.type}` : '—'} color={stats.streak.type === 'win' ? 'var(--green)' : stats.streak.type === 'loss' ? 'var(--red)' : undefined} sub={`Best: ${stats.streak.longestWin}W / ${stats.streak.longestLoss}L`} />
          </div>

          {/* Direction + AI */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div className="card" style={{ borderColor: 'var(--green-border)' }}>
              <div style={{ fontSize: '10px', color: 'var(--green)', fontWeight: 600, letterSpacing: '0.08em', marginBottom: '8px' }}>↑ LONG</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: 700 }}>{stats.byDirection.LONG.trades}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: stats.byDirection.LONG.pnl >= 0 ? 'var(--green)' : 'var(--red)', marginTop: '2px' }}>
                {stats.byDirection.LONG.pnl >= 0 ? '+' : ''}${stats.byDirection.LONG.pnl.toFixed(0)}
              </div>
            </div>
            <div className="card" style={{ borderColor: 'var(--red-border)' }}>
              <div style={{ fontSize: '10px', color: 'var(--red)', fontWeight: 600, letterSpacing: '0.08em', marginBottom: '8px' }}>↓ SHORT</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: 700 }}>{stats.byDirection.SHORT.trades}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: stats.byDirection.SHORT.pnl >= 0 ? 'var(--green)' : 'var(--red)', marginTop: '2px' }}>
                {stats.byDirection.SHORT.pnl >= 0 ? '+' : ''}${stats.byDirection.SHORT.pnl.toFixed(0)}
              </div>
            </div>
            <div className="card" style={{ borderColor: 'rgba(99,102,241,0.3)' }}>
              <div style={{ fontSize: '10px', color: 'rgba(129,140,248,0.9)', fontWeight: 600, letterSpacing: '0.08em', marginBottom: '8px' }}>AI BRAIN</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: 700 }}>{stats.aiPct}%</div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>AI-confirmed entries</div>
            </div>
          </div>

          {/* C. Equity Curve */}
          {stats.dailyBreakdown.length > 1 && (
            <div className="card" style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '16px' }}>
                EQUITY CURVE
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.dailyBreakdown}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cumulative P&L']}
                    labelFormatter={(l: string) => l}
                  />
                  <ReferenceLine y={0} stroke="var(--text-dim)" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="cumPnl" stroke="var(--green)" strokeWidth={2} dot={{ r: 3, fill: 'var(--green)' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* D. Daily Breakdown */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '12px' }}>
              DAILY BREAKDOWN ({stats.totalDays} days)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Trades</th>
                    <th>W/L</th>
                    <th>Win%</th>
                    <th>P&L</th>
                    <th>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dailyBreakdown.map((d) => (
                    <tr key={d.date}>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.date}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.trades}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        <span style={{ color: 'var(--green)' }}>{d.wins}</span>/<span style={{ color: 'var(--red)' }}>{d.losses}</span>
                      </td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', color: d.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>{d.winRate}%</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', color: d.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(0)}
                      </td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace', color: d.cumPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {d.cumPnl >= 0 ? '+' : ''}${d.cumPnl.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* E. Recent Paper Trades */}
          <div className="card">
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '12px' }}>
              RECENT PAPER TRADES
            </div>
            {stats.recentTrades.map((t) => (
              <div key={t.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 0', borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: t.direction === 'LONG' ? 'var(--green)' : 'var(--red)' }}>
                      {t.direction}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {t.contracts}x {t.entry.toFixed(2)} → {t.exit?.toFixed(2) ?? '—'}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{t.date} {t.time ?? ''}</span>
                  </div>
                  {t.aiReasoning && (
                    <div style={{ fontSize: '11px', color: 'rgba(129,140,248,0.7)', lineHeight: '1.4' }}>
                      {t.aiReasoning}
                    </div>
                  )}
                </div>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: 600, flexShrink: 0, marginLeft: '12px',
                  color: t.status === 'WIN' ? 'var(--green)' : t.status === 'LOSS' ? 'var(--red)' : 'var(--text-secondary)',
                }}>
                  {(t.resultDollars ?? 0) >= 0 ? '+' : ''}${(t.resultDollars ?? 0).toFixed(0)}
                </div>
              </div>
            ))}
            {stats.recentTrades.length === 0 && (
              <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>No paper trades recorded yet.</div>
            )}
          </div>

          {/* F. Session Debriefs */}
          {stats.debriefs && stats.debriefs.length > 0 && (
            <div className="card" style={{ marginTop: '20px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '12px' }}>
                SESSION DEBRIEFS ({stats.debriefs.length} most recent)
              </div>
              {stats.debriefs.map((d) => (
                <DebriefRow key={d.date} debrief={d} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DebriefRow({ debrief }: { debrief: Debrief }) {
  const [open, setOpen] = useState(false)
  if (!debrief.text) return null
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'rgba(129,140,248,0.95)', textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em' }}>
          {open ? '▾' : '▸'} {debrief.date}
        </span>
      </button>
      {open && (
        <div style={{
          fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55,
          marginTop: '8px', whiteSpace: 'pre-wrap',
        }}>
          {debrief.text}
        </div>
      )}
    </div>
  )
}

function ValidationScorecard({ stats }: { stats: PaperStats }) {
  const allMet = stats.allCriteriaMet
  const pct = stats.criteria.length > 0 ? (stats.criteriaPassedCount / stats.criteria.length) * 100 : 0

  return (
    <div className="card" style={{
      marginBottom: '20px',
      borderColor: allMet ? 'rgba(0,230,118,0.4)' : 'var(--border)',
      background: allMet ? 'rgba(0,230,118,0.04)' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600 }}>
          VALIDATION STATUS
        </div>
        <span style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
          padding: '3px 12px', borderRadius: '4px',
          background: allMet ? 'rgba(0,230,118,0.15)' : 'rgba(255,255,255,0.06)',
          color: allMet ? 'var(--green)' : 'var(--text-secondary)',
          border: `1px solid ${allMet ? 'rgba(0,230,118,0.3)' : 'var(--border)'}`,
        }}>
          {allMet ? 'READY FOR AUTOMATION' : `IN PROGRESS — ${stats.criteriaPassedCount}/${stats.criteria.length}`}
        </span>
      </div>

      {/* Progress bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <ProgressBar label="Trading Days" current={stats.totalDays} target={30} />
        <ProgressBar label="Total Trades" current={stats.totalTrades} target={50} />
      </div>

      {/* Criteria checklist */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
        {stats.criteria.map((c) => (
          <div key={c.label} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', borderRadius: '6px',
            background: c.passed ? 'rgba(0,230,118,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${c.passed ? 'rgba(0,230,118,0.2)' : 'var(--border)'}`,
          }}>
            <span style={{ fontSize: '14px', color: c.passed ? 'var(--green)' : 'var(--text-dim)' }}>
              {c.passed ? '✓' : '○'}
            </span>
            <div>
              <div style={{ fontSize: '11px', color: c.passed ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c.label}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 600, color: c.passed ? 'var(--green)' : 'var(--text-dim)' }}>
                {c.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProgressBar({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = Math.min(100, (current / target) * 100)
  const done = current >= target
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: 600, color: done ? 'var(--green)' : 'var(--text-primary)' }}>
          {current}/{target}
        </span>
      </div>
      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: done ? 'var(--green)' : 'var(--blue)',
          borderRadius: '3px',
          transition: 'width 0.6s ease',
          boxShadow: done ? '0 0 8px rgba(0,230,118,0.5)' : undefined,
        }} />
      </div>
    </div>
  )
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '20px', fontWeight: 700, color: color ?? 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}
