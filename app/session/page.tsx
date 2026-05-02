'use client'
import { useEffect, useState } from 'react'
import MorningBriefing from '@/components/MorningBriefing'

interface ScoreFactor { label: string; points: number; met: boolean }

export default function SessionPage() {
  const today = new Date().toISOString().split('T')[0]
  const [saving, setSaving]  = useState(false)
  const [saved, setSaved]    = useState(false)
  const [result, setResult]  = useState<any>(null)
  const [orbLoading, setOrbLoading] = useState(false)
  const [orbError, setOrbError]     = useState<string | null>(null)

  const [form, setForm] = useState({
    date: today, market: 'MNQ',
    orHigh: '', orLow: '',
    directionBias: 'neutral', tradeDirection: 'LONG',
    hasHighImpactNews: false, newsNotes: '',
    vixLevel: '', vixExtreme: false,
    qqpAligned: false, us10yAgainst: false, dxyAgainst: false,
    cleanRoomToTarget: true,
  })

  const set = (k: string, v: any) => {
    setSaved(false)
    setForm((f) => ({ ...f, [k]: v }))
  }

  // Auto-populate from Morning Briefing
  function handleAutoPopulate(data: { vixLevel: string; vixExtreme: boolean; qqpAligned: boolean; hasHighImpactNews: boolean }) {
    setForm((f) => ({
      ...f,
      vixLevel: data.vixLevel,
      vixExtreme: data.vixExtreme,
      qqpAligned: data.qqpAligned,
      hasHighImpactNews: data.hasHighImpactNews,
    }))
  }

  // Fetch OR from TopstepX API
  async function fetchORFromTopstepX() {
    setOrbLoading(true)
    setOrbError(null)
    try {
      const res = await fetch(`/api/topstepx/orb?symbol=${form.market === 'MNQ' ? 'MNQ' : 'NQ'}&live=true`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const orb = data.orb
      setForm((f) => ({
        ...f,
        orHigh: orb.orHigh.toFixed(2),
        orLow: orb.orLow.toFixed(2),
      }))
    } catch (err) {
      setOrbError(err instanceof Error ? err.message : 'Failed to fetch OR')
    } finally {
      setOrbLoading(false)
    }
  }

  const orSize = form.orHigh && form.orLow
    ? parseFloat(form.orHigh) - parseFloat(form.orLow)
    : null

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, orSize, vixLevel: form.vixLevel ? parseFloat(form.vixLevel) : null }),
      })
      const data = await res.json()
      setResult(data.scoreResult)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>
          SESSION SETUP
        </h1>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
          Enter conditions before the NY open · 9:30 AM EST (6:30 PM Dubai)
        </p>
      </div>

      {/* Morning Briefing with auto-populate */}
      <MorningBriefing onAutoPopulate={handleAutoPopulate} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', gap: '20px', alignItems: 'start' }}>
        {/* Left: Form */}
        <div>
          {/* Instrument */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={sectionTitle}>01 · INSTRUMENT</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label>Date</label>
                <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
              <div>
                <label>Market</label>
                <select value={form.market} onChange={e => set('market', e.target.value)}>
                  <option value="MNQ">MNQ (Micro Nasdaq · $2/pt)</option>
                  <option value="NQ">NQ (E-mini Nasdaq · $20/pt)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Opening Range */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={sectionTitle as React.CSSProperties}>02 · OPENING RANGE (09:30–10:00 NY)</div>
              <button
                onClick={fetchORFromTopstepX}
                disabled={orbLoading}
                className="btn btn-ghost"
                style={{ fontSize: '11px', padding: '6px 12px', marginBottom: 0 }}
              >
                {orbLoading ? '⟳ Fetching...' : '⚡ Auto-fetch OR from TopstepX'}
              </button>
            </div>

            {orbError && (
              <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', color: 'var(--red)', marginBottom: '12px', fontFamily: 'IBM Plex Mono, monospace' }}>
                {orbError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label>OR High</label>
                <input type="number" step="0.25" placeholder="21550.00" value={form.orHigh} onChange={e => set('orHigh', e.target.value)} />
              </div>
              <div>
                <label>OR Low</label>
                <input type="number" step="0.25" placeholder="21480.00" value={form.orLow} onChange={e => set('orLow', e.target.value)} />
              </div>
            </div>

            {orSize !== null && orSize > 0 && (
              <div style={{ padding: '12px 16px', background: orSize >= 50 && orSize <= 150 ? 'var(--green-bg)' : orSize < 30 || orSize > 200 ? 'var(--red-bg)' : 'var(--yellow-bg)', border: `1px solid ${orSize >= 50 && orSize <= 150 ? 'var(--green-border)' : orSize < 30 || orSize > 200 ? 'var(--red-border)' : 'var(--yellow-border)'}`, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: orSize >= 50 && orSize <= 150 ? 'var(--green)' : orSize < 30 || orSize > 200 ? 'var(--red)' : 'var(--yellow)' }}>
                  {orSize.toFixed(2)}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  pts · {orSize < 30 ? '⚠️ Too tight' : orSize > 200 ? '⚠️ Too wide' : orSize >= 50 && orSize <= 150 ? '✓ Ideal range' : '~ Acceptable'}
                </span>
              </div>
            )}

            <div style={{ marginTop: '12px' }}>
              <label>Trade Direction</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {(['LONG', 'SHORT'] as const).map((d) => (
                  <button key={d} onClick={() => set('tradeDirection', d)} className="btn"
                    style={{ borderColor: form.tradeDirection === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--border)', background: form.tradeDirection === d ? (d === 'LONG' ? 'var(--green-bg)' : 'var(--red-bg)') : 'var(--surface)', color: form.tradeDirection === d ? (d === 'LONG' ? 'var(--green)' : 'var(--red)') : 'var(--text-secondary)' }}>
                    {d === 'LONG' ? '↑ LONG' : '↓ SHORT'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Market Conditions */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={sectionTitle}>03 · MARKET CONDITIONS</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label>Daily Bias</label>
                <select value={form.directionBias} onChange={e => set('directionBias', e.target.value)}>
                  <option value="bullish">Bullish</option>
                  <option value="bearish">Bearish</option>
                  <option value="neutral">Neutral</option>
                </select>
              </div>
              <div>
                <label>VIX Level {form.vixLevel && <span style={{ color: 'var(--green)', fontSize: '10px' }}>✓ Auto-filled</span>}</label>
                <input type="number" step="0.1" placeholder="18.5" value={form.vixLevel}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    set('vixLevel', e.target.value)
                    set('vixExtreme', v >= 30)
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { key: 'hasHighImpactNews',  label: '⚠️ High-impact news today', danger: true },
                { key: 'vixExtreme',         label: '📊 VIX extreme (>30)', danger: true },
                { key: 'qqpAligned',         label: '✓ QQQ premarket aligned', danger: false },
                { key: 'cleanRoomToTarget',  label: '✓ Clean room to target', danger: false },
                { key: 'us10yAgainst',       label: '⚠️ US 10Y against trade', danger: true },
                { key: 'dxyAgainst',         label: '⚠️ DXY against trade', danger: true },
              ].map(({ key, label, danger }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', textTransform: 'none', letterSpacing: 'normal', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '400' }}>
                  <input type="checkbox" checked={!!(form as any)[key]} onChange={e => set(key, e.target.checked)} style={{ width: 'auto', accentColor: danger ? 'var(--red)' : 'var(--green)' }} />
                  {label}
                </label>
              ))}
            </div>

            {form.hasHighImpactNews && (
              <div style={{ marginTop: '12px' }}>
                <label>News Notes</label>
                <input type="text" placeholder="e.g. CPI at 8:30 AM, FOMC at 2:00 PM" value={form.newsNotes} onChange={e => set('newsNotes', e.target.value)} />
              </div>
            )}
          </div>

          {/* Save */}
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ width: '100%', padding: '14px', fontSize: '14px' }}>
            {saving ? 'Calculating...' : saved ? '✓ Session Saved — Go to Dashboard' : 'Calculate Score & Save'}
          </button>
        </div>

        {/* Right: Score Result */}
        <div>
          {result ? (
            <ScorePanel result={result} />
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '36px', marginBottom: '16px' }}>◈</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
                Click "Auto-fill Session" above or fill in manually, then Calculate Score
              </div>
            </div>
          )}

          {/* Checklist */}
          <div className="card" style={{ marginTop: '16px' }}>
            <div style={sectionTitle}>PRE-TRADE CHECKLIST</div>
            {[
              'Check TopStep dashboard: trailing drawdown OK?',
              'Note NQ premarket high/low (auto-fetched above)',
              'Any high-impact news at 9:30 AM? (auto-fetched)',
              'VIX level — elevated or extreme? (auto-fetched)',
              'QQQ premarket direction (auto-fetched)',
              'After 10:00 AM — click Auto-fetch OR from TopstepX',
              'Set max 2 trades for today',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', marginTop: '2px', flexShrink: 0 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScorePanel({ result }: { result: any }) {
  const color  = result.decision === 'TRADE' ? 'var(--green)' : result.decision === 'CAUTION' ? 'var(--yellow)' : 'var(--red)'
  const bg     = result.decision === 'TRADE' ? 'var(--green-bg)' : result.decision === 'CAUTION' ? 'var(--yellow-bg)' : 'var(--red-bg)'
  const border = result.decision === 'TRADE' ? 'var(--green-border)' : result.decision === 'CAUTION' ? 'var(--yellow-border)' : 'var(--red-border)'
  return (
    <>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '10px', padding: '28px', textAlign: 'center', marginBottom: '16px', boxShadow: `0 0 30px ${color}30` }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '64px', fontWeight: '700', color, lineHeight: 1, textShadow: `0 0 20px ${color}80` }}>{result.score}</div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: '16px' }}>/ 100</div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: '700', color }}>{result.decisionLabel}</div>
      </div>
      <div className="card">
        <div style={sectionTitle}>SCORE BREAKDOWN</div>
        {result.factors.map((f: ScoreFactor, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: f.met ? 'var(--text-primary)' : 'var(--text-dim)' }}>
              <span style={{ color: f.met ? 'var(--green)' : 'var(--text-dim)', fontSize: '14px' }}>{f.met ? '✓' : '✗'}</span>
              {f.label}
            </div>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '700', color: f.points > 0 ? 'var(--green)' : 'var(--red)', flexShrink: 0, marginLeft: '12px' }}>
              {f.points > 0 ? '+' : ''}{f.points}
            </span>
          </div>
        ))}
        {result.blockers.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            {result.blockers.map((b: string, i: number) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: '6px', fontSize: '12px', color: 'var(--red)', marginBottom: '6px' }}>
                ⛔ {b}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

const sectionTitle: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', fontWeight: '600',
  letterSpacing: '0.12em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '16px',
}
