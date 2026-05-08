'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { calculateRisk, POINT_VALUES } from '@/lib/scoring'

// ─── AUTOMATED RISK CALCULATOR ────────────────────────────────────────────────
// Now with:
//   ✓ Live entry price from SSE stream (toggle on/off)
//   ✓ Auto-populate stop loss from Opening Range (OR High/Low)
//   ✓ Auto-calculated position size from $2K daily loss limit
//   ✓ Direction-aware: LONG → stop = OR Low, SHORT → stop = OR High

interface SessionData {
  orHigh?: number
  orLow?: number
  tradeDirection?: string
  directionBias?: string
}

export default function RiskPage() {
  const [settings, setSettings]     = useState<any>(null)
  const [session, setSession]       = useState<SessionData | null>(null)
  const [dailyPnl, setDailyPnl]    = useState(0)
  const [liveEntry, setLiveEntry]   = useState(false)
  const [livePrice, setLivePrice]   = useState<number | null>(null)
  const [streaming, setStreaming]   = useState(false)
  const [direction, setDirection]   = useState<'LONG' | 'SHORT'>('LONG')
  const esRef = useRef<EventSource | null>(null)

  const [form, setForm] = useState({
    market: 'MNQ',
    entry:  '',
    stop:   '',
    target: '',
    contracts: '1',
  })

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const [setRes, sessRes] = await Promise.all([
        fetch('/api/settings'),
        fetch(`/api/sessions?date=${today}`),
      ])
      const { settings } = await setRes.json()
      const { session: sess } = await sessRes.json()
      setSettings(settings)
      setDailyPnl(sess?.dailyPnl ?? 0)

      if (sess) {
        setSession(sess)
        if (sess.tradeDirection) {
          setDirection(sess.tradeDirection as 'LONG' | 'SHORT')
        }
      }
    }
    load()
  }, [])

  useEffect(() => {
    let cancelled = false
    const es = new EventSource('/api/topstepx/stream?hub=market&symbol=MNQ')
    esRef.current = es

    es.onopen = () => { if (!cancelled) setStreaming(true) }
    es.onerror = () => { if (!cancelled) setStreaming(false) }
    es.onmessage = (e) => {
      if (cancelled) return
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'quote' && event.data?.price > 0) {
          setLivePrice(event.data.price)
        }
      } catch {}
    }

    return () => {
      cancelled = true
      es.close()
      esRef.current = null
    }
  }, [])

  useEffect(() => {
    if (liveEntry && livePrice) {
      setForm(f => ({ ...f, entry: livePrice.toFixed(2) }))
    }
  }, [liveEntry, livePrice])

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function autoPopulateFromSession() {
    if (!session?.orHigh || !session?.orLow) return
    const isLong = direction === 'LONG'
    setForm(f => ({
      ...f,
      stop: isLong ? session.orLow!.toFixed(2) : session.orHigh!.toFixed(2),
      entry: livePrice ? livePrice.toFixed(2) : (isLong ? session.orHigh!.toFixed(2) : session.orLow!.toFixed(2)),
    }))
  }

  function autoCalcContracts() {
    if (!form.entry || !form.stop || !settings) return
    const pointValue = POINT_VALUES[form.market] ?? 2
    const riskPts = Math.abs(parseFloat(form.entry) - parseFloat(form.stop))
    const riskPerContract = riskPts * pointValue
    const remainingDailyRisk = settings.dailyLossLimit - Math.abs(dailyPnl)
    const maxContracts = Math.max(1, Math.floor(remainingDailyRisk / (riskPerContract || 1)))
    setForm(f => ({ ...f, contracts: String(maxContracts) }))
  }

  function autoCalcTarget() {
    if (!form.entry || !form.stop) return
    const entry = parseFloat(form.entry)
    const stop = parseFloat(form.stop)
    const risk = Math.abs(entry - stop)
    const isLong = direction === 'LONG'
    const target = isLong ? entry + risk * 2 : entry - risk * 2
    setForm(f => ({ ...f, target: target.toFixed(2) }))
  }

  const calc = form.entry && form.stop && form.target && settings
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
  const hasOR = session?.orHigh && session?.orLow && session.orHigh > 0 && session.orLow > 0

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

      {/* Auto-populate banner */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '14px 16px', marginBottom: '20px',
        display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: streaming ? 'var(--green)' : 'var(--text-dim)',
            animation: streaming ? 'livePulse 1.5s ease-in-out infinite' : 'none',
          }} />
          <style>{`@keyframes livePulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: streaming ? 'var(--green)' : 'var(--text-dim)', fontWeight: '600' }}>
            {streaming ? `NQ LIVE ${livePrice?.toFixed(2) ?? ''}` : 'CONNECTING...'}
          </span>
        </div>

        <span style={{ color: 'var(--text-dim)' }}>·</span>

        <button
          onClick={() => setLiveEntry(!liveEntry)}
          style={{
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '600',
            padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
            border: `1px solid ${liveEntry ? 'var(--green-border)' : 'var(--border)'}`,
            background: liveEntry ? 'var(--green-bg)' : 'var(--surface)',
            color: liveEntry ? 'var(--green)' : 'var(--text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          {liveEntry ? '● LIVE ENTRY ON' : '○ LIVE ENTRY OFF'}
        </button>

        {['LONG', 'SHORT'].map(d => (
          <button
            key={d}
            onClick={() => setDirection(d as 'LONG' | 'SHORT')}
            style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '600',
              padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
              border: `1px solid ${direction === d ? (d === 'LONG' ? 'var(--green-border)' : 'var(--red-border)') : 'var(--border)'}`,
              background: direction === d ? (d === 'LONG' ? 'var(--green-bg)' : 'var(--red-bg)') : 'var(--surface)',
              color: direction === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {d === 'LONG' ? '↑ LONG' : '↓ SHORT'}
          </button>
        ))}

        <button
          onClick={() => {
            autoPopulateFromSession()
            setTimeout(() => {
              autoCalcTarget()
              setTimeout(autoCalcContracts, 50)
            }, 50)
          }}
          disabled={!hasOR}
          style={{
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '600',
            padding: '6px 12px', borderRadius: '4px', cursor: hasOR ? 'pointer' : 'not-allowed',
            border: '1px solid var(--blue-border, var(--border))',
            background: 'var(--surface)',
            color: hasOR ? 'var(--blue)' : 'var(--text-dim)',
            marginLeft: 'auto',
            transition: 'all 0.15s',
          }}
        >
          ⚡ {hasOR ? 'Auto-fill from Session OR' : 'No OR data — set up session first'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', gap: '20px', alignItems: 'start' }}>
        <div className="card">
          <div style={st.sectionTitle}>01 · INSTRUMENT</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            {['MNQ', 'NQ'].map((m) => (
              <button key={m} onClick={() => set('market', m)} className="btn" style={{
                borderColor: form.market === m ? 'var(--blue)' : 'var(--border)',
                background: form.market === m ? 'var(--blue-bg)' : 'var(--surface)',
                color: form.market === m ? '#fff' : 'var(--text-secondary)', padding: '14px',
              }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: '700' }}>{m}</div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>${POINT_VALUES[m]}/point</div>
              </button>
            ))}
          </div>

          <div style={st.sectionTitle}>02 · TRADE LEVELS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Entry Price
                {liveEntry && (
                  <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--green)', background: 'var(--green-bg)', padding: '2px 6px', borderRadius: '3px' }}>● LIVE</span>
                )}
              </label>
              <input type="number" step="0.25" placeholder="21505.00" value={form.entry}
                onChange={e => { setLiveEntry(false); set('entry', e.target.value) }}
                style={liveEntry ? { borderColor: 'var(--green-border)', background: 'var(--green-bg)' } : undefined}
              />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Stop Loss
                {form.stop && hasOR && (
                  <span style={{ fontSize: '9px', fontWeight: '700', color: 'var(--blue)', background: 'var(--surface)', padding: '2px 6px', borderRadius: '3px', border: '1px solid var(--border)' }}>FROM OR</span>
                )}
              </label>
              <input type="number" step="0.25" placeholder="21475.00" value={form.stop} onChange={e => set('stop', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Target Price
                <button onClick={autoCalcTarget} style={{ fontSize: '9px', fontWeight: '600', color: 'var(--blue)', background: 'none', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer' }}>2:1 R:R</button>
              </label>
              <input type="number" step="0.25" placeholder="21565.00" value={form.target} onChange={e => set('target', e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Contracts
                <button onClick={autoCalcContracts} disabled={!form.entry || !form.stop} style={{ fontSize: '9px', fontWeight: '600', color: 'var(--blue)', background: 'none', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: '3px', cursor: form.entry && form.stop ? 'pointer' : 'not-allowed' }}>MAX SAFE</button>
              </label>
              <input type="number" min="1" max="20" value={form.contracts} onChange={e => set('contracts', e.target.value)} />
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>
            1 point {form.market} = ${pointValue} · 1 tick (0.25 pts) = ${pointValue * 0.25}
          </div>

          {hasOR && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', marginTop: '8px' }}>
              <span style={{ color: 'var(--text-dim)' }}>Today's OR:</span>{' '}
              <span style={{ color: 'var(--green)' }}>High {session!.orHigh!.toFixed(2)}</span>{' '}
              <span style={{ color: 'var(--text-dim)' }}>·</span>{' '}
              <span style={{ color: 'var(--red)' }}>Low {session!.orLow!.toFixed(2)}</span>{' '}
              <span style={{ color: 'var(--text-dim)' }}>·</span>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>Range {((session!.orHigh! - session!.orLow!).toFixed(0))} pts</span>
            </div>
          )}
        </div>

        <div>
          {calc ? (
            <>
              {calc.violationMessage && (
                <div style={{
                  background: calc.violatesLimit ? 'var(--red-bg)' : 'var(--yellow-bg)',
                  border: `1px solid ${calc.violatesLimit ? 'var(--red-border)' : 'var(--yellow-border)'}`,
                  borderRadius: '8px', padding: '14px 16px', fontSize: '13px',
                  color: calc.violatesLimit ? 'var(--red)' : 'var(--yellow)',
                  marginBottom: '16px', fontFamily: 'IBM Plex Mono, monospace',
                }}>{calc.violationMessage}</div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div className="card" style={{ background: 'var(--red-bg)', borderColor: 'var(--red-border)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--red)', fontWeight: '600', letterSpacing: '0.08em', marginBottom: '8px' }}>RISK</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: 'var(--red)' }}>${calc.totalRisk.toFixed(0)}</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{calc.riskPts.toFixed(2)} pts</div>
                </div>
                <div className="card" style={{ background: 'var(--green-bg)', borderColor: 'var(--green-border)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--green)', fontWeight: '600', letterSpacing: '0.08em', marginBottom: '8px' }}>REWARD</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: 'var(--green)' }}>${calc.totalReward.toFixed(0)}</div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{calc.rewardPts.toFixed(2)} pts</div>
                </div>
              </div>

              <div className="card">
                <div style={st.sectionTitle}>POSITION DETAILS</div>
                {[
                  { label: 'R:R Ratio', value: `${calc.rrRatio.toFixed(2)} : 1`, color: calc.rrRatio >= 2 ? 'var(--green)' : calc.rrRatio >= 1.5 ? 'var(--yellow)' : 'var(--red)' },
                  { label: 'Risk per Contract', value: `$${calc.riskPerContract.toFixed(0)}` },
                  { label: 'Max Contracts Allowed', value: `${calc.maxContractsAllowed}`, color: calc.maxContractsAllowed < parseInt(form.contracts) ? 'var(--red)' : 'var(--green)' },
                  { label: 'Remaining Daily Risk', value: `$${calc.remainingDailyRisk.toFixed(0)}`, color: calc.remainingDailyRisk < 500 ? 'var(--red)' : 'var(--green)' },
                  { label: 'Point Value', value: `$${calc.pointValue}/pt` },
                  { label: 'Direction', value: direction, color: direction === 'LONG' ? 'var(--green)' : 'var(--red)' },
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
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
                Enter entry, stop, and target to calculate risk
              </div>
              {hasOR && (
                <button
                  onClick={() => {
                    autoPopulateFromSession()
                    setTimeout(() => { autoCalcTarget(); setTimeout(autoCalcContracts, 50) }, 50)
                  }}
                  className="btn btn-primary" style={{ fontSize: '12px', padding: '10px 20px' }}
                >⚡ Auto-fill from Session ({direction})</button>
              )}
            </div>
          )}

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
    fontSize: '10px', fontWeight: '600',
    letterSpacing: '0.12em', color: 'var(--text-dim)',
    textTransform: 'uppercase', marginBottom: '16px',
  } as React.CSSProperties,
}
