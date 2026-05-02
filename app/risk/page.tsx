'use client'
import { useEffect, useState } from 'react'
import { calculateRisk, POINT_VALUES } from '@/lib/scoring'

export default function RiskPage() {
  const [settings, setSettings] = useState<any>(null)
  const [form, setForm] = useState({
    market: 'MNQ',
    entry: '',
    stop: '',
    target: '',
    contracts: '1',
  })
  const [dailyPnl, setDailyPnl] = useState(0)

  useEffect(() => {
    async function load() {
      const [setRes, sessRes] = await Promise.all([
        fetch('/api/settings'),
        fetch(`/api/sessions?date=${new Date().toISOString().split('T')[0]}`),
      ])
      const { settings } = await setRes.json()
      const { session } = await sessRes.json()
      setSettings(settings)
      setDailyPnl(session?.dailyPnl ?? 0)
    }
    load()
  }, [])

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const calc =
    form.entry && form.stop && form.target && settings
      ? calculateRisk({
          market: form.market,
          entry: parseFloat(form.entry),
          stop: parseFloat(form.stop),
          target: parseFloat(form.target),
          contracts: parseInt(form.contracts) || 1,
          accountSize: settings.accountSize,
          dailyLossLimit: settings.dailyLossLimit,
          currentDailyPnl: dailyPnl,
        })
      : null

  const pointValue = POINT_VALUES[form.market] ?? 2

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>
          RISK CALCULATOR
        </h1>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
          Know your risk before you enter — every time
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', gap: '20px', alignItems: 'start' }}>
        {/* Left: Inputs */}
        <div className="card">
          {/* Market */}
          <div style={st.sectionTitle}>01 · INSTRUMENT</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            {['MNQ', 'NQ'].map((m) => (
              <button key={m} onClick={() => set('market', m)} className="btn"
                style={{
                  borderColor: form.market === m ? 'var(--blue)' : 'var(--border)',
                  background: form.market === m ? 'var(--blue-bg)' : 'var(--surface)',
                  color: form.market === m ? '#fff' : 'var(--text-secondary)',
                  padding: '14px',
                }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: '700' }}>{m}</div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>
                  ${POINT_VALUES[m]}/point
                </div>
              </button>
            ))}
          </div>

          <div style={st.sectionTitle}>02 · TRADE LEVELS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
            <div>
              <label>Entry Price</label>
              <input type="number" step="0.25" placeholder="21505.00" value={form.entry} onChange={e => set('entry', e.target.value)} />
            </div>
            <div>
              <label>Stop Loss</label>
              <input type="number" step="0.25" placeholder="21475.00" value={form.stop} onChange={e => set('stop', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div>
              <label>Target Price</label>
              <input type="number" step="0.25" placeholder="21565.00" value={form.target} onChange={e => set('target', e.target.value)} />
            </div>
            <div>
              <label>Contracts</label>
              <input type="number" min="1" max="20" value={form.contracts} onChange={e => set('contracts', e.target.value)} />
            </div>
          </div>

          {/* Point value reference */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>
            1 point {form.market} = ${pointValue} · 1 tick (0.25 pts) = ${pointValue * 0.25}
          </div>
        </div>

        {/* Right: Results */}
        <div>
          {calc ? (
            <>
              {/* Violation warning */}
              {calc.violationMessage && (
                <div style={{
                  background: calc.violatesLimit ? 'var(--red-bg)' : 'var(--yellow-bg)',
                  border: `1px solid ${calc.violatesLimit ? 'var(--red-border)' : 'var(--yellow-border)'}`,
                  borderRadius: '8px',
                  padding: '14px 16px',
                  fontSize: '13px',
                  color: calc.violatesLimit ? 'var(--red)' : 'var(--yellow)',
                  marginBottom: '16px',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}>
                  {calc.violationMessage}
                </div>
              )}

              {/* Risk vs Reward */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div className="card" style={{ background: 'var(--red-bg)', borderColor: 'var(--red-border)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--red)', fontWeight: '600', letterSpacing: '0.08em', marginBottom: '8px' }}>RISK</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: 'var(--red)' }}>
                    ${calc.totalRisk.toFixed(0)}
                  </div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {calc.riskPts.toFixed(2)} pts
                  </div>
                </div>
                <div className="card" style={{ background: 'var(--green-bg)', borderColor: 'var(--green-border)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--green)', fontWeight: '600', letterSpacing: '0.08em', marginBottom: '8px' }}>REWARD</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: 'var(--green)' }}>
                    ${calc.totalReward.toFixed(0)}
                  </div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {calc.rewardPts.toFixed(2)} pts
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="card">
                <div style={st.sectionTitle}>POSITION DETAILS</div>
                {[
                  { label: 'R:R Ratio', value: `${calc.rrRatio.toFixed(2)} : 1`, color: calc.rrRatio >= 2 ? 'var(--green)' : calc.rrRatio >= 1.5 ? 'var(--yellow)' : 'var(--red)' },
                  { label: 'Risk per Contract', value: `$${calc.riskPerContract.toFixed(0)}` },
                  { label: 'Max Contracts Allowed', value: `${calc.maxContractsAllowed}`, color: calc.maxContractsAllowed < parseInt(form.contracts) ? 'var(--red)' : 'var(--green)' },
                  { label: 'Remaining Daily Risk', value: `$${calc.remainingDailyRisk.toFixed(0)}`, color: calc.remainingDailyRisk < 500 ? 'var(--red)' : 'var(--green)' },
                  { label: 'Point Value', value: `$${calc.pointValue}/pt` },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: '700', color: color ?? 'var(--text-primary)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: '36px', marginBottom: '16px' }}>⚡</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
                Enter entry, stop, and target to calculate risk
              </div>
            </div>
          )}

          {/* Account Status */}
          {settings && (
            <div className="card" style={{ marginTop: '12px' }}>
              <div style={st.sectionTitle}>ACCOUNT LIMITS</div>
              {[
                { label: 'Daily Loss Limit', value: `$${settings.dailyLossLimit.toLocaleString()}`, color: 'var(--red)' },
                { label: "Today's P&L", value: dailyPnl >= 0 ? `+$${dailyPnl.toFixed(0)}` : `-$${Math.abs(dailyPnl).toFixed(0)}`, color: dailyPnl >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Max Trades/Day', value: settings.maxTradesPerDay },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', fontWeight: '700', color: (color as string) ?? 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const st = {
  sectionTitle: {
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.12em',
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    marginBottom: '16px',
  } as React.CSSProperties,
}
