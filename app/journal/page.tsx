'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Trade {
  id: string
  date: string
  time?: string
  market: string
  direction: string
  contracts: number
  entry: number
  stop: number
  target: number
  exit?: number
  resultPts?: number
  resultDollars?: number
  resultR?: number
  status: string
  setupScore?: number
  ruleFollowed: boolean
  emotionLevel?: number
  notes?: string
}

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    date: today,
    market: 'MNQ',
    direction: 'LONG',
    contracts: '1',
    entry: '',
    stop: '',
    target: '',
    exit: '',
    setupScore: '',
    ruleFollowed: true,
    emotionLevel: '3',
    mistakeNotes: '',
    notes: '',
  })

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [trRes, sessRes] = await Promise.all([
      fetch('/api/trades'),
      fetch('/api/sessions'),
    ])
    const { trades } = await trRes.json()
    setTrades(trades ?? [])
    setLoading(false)
  }

  async function addTrade() {
    setSaving(true)
    try {
      // Find or create session for the date
      const sessRes = await fetch(`/api/sessions?date=${form.date}`)
      const { session } = await sessRes.json()

      let sessionId = session?.id
      if (!sessionId) {
        // Create minimal session for the date
        const newSess = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: form.date, market: form.market }),
        })
        const { session: s } = await newSess.json()
        sessionId = s.id
      }

      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sessionId }),
      })

      setShowAdd(false)
      setForm({ date: today, market: 'MNQ', direction: 'LONG', contracts: '1', entry: '', stop: '', target: '', exit: '', setupScore: '', ruleFollowed: true, emotionLevel: '3', mistakeNotes: '', notes: '' })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteTrade(id: string) {
    if (!confirm('Delete this trade?')) return
    await fetch(`/api/trades/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>
            TRADE JOURNAL
          </h1>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            {trades.length} trades logged
          </p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn btn-green">
          {showAdd ? '✕ Cancel' : '+ Log Trade'}
        </button>
      </div>

      {/* Add Trade Form */}
      {showAdd && (
        <div className="card" style={{ marginBottom: '24px', border: '1px solid var(--green-border)', background: '#020d05' }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--green)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '20px' }}>
            LOG NEW TRADE
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div>
              <label>Market</label>
              <select value={form.market} onChange={e => set('market', e.target.value)}>
                <option value="MNQ">MNQ</option>
                <option value="NQ">NQ</option>
              </select>
            </div>
            <div>
              <label>Direction</label>
              <select value={form.direction} onChange={e => set('direction', e.target.value)}>
                <option value="LONG">LONG ↑</option>
                <option value="SHORT">SHORT ↓</option>
              </select>
            </div>
            <div>
              <label>Contracts</label>
              <input type="number" min="1" value={form.contracts} onChange={e => set('contracts', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <div><label>Entry</label><input type="number" step="0.25" value={form.entry} onChange={e => set('entry', e.target.value)} /></div>
            <div><label>Stop</label><input type="number" step="0.25" value={form.stop} onChange={e => set('stop', e.target.value)} /></div>
            <div><label>Target</label><input type="number" step="0.25" value={form.target} onChange={e => set('target', e.target.value)} /></div>
            <div><label>Exit (optional)</label><input type="number" step="0.25" value={form.exit} onChange={e => set('exit', e.target.value)} /></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label>Setup Score (0–100)</label>
              <input type="number" min="0" max="100" value={form.setupScore} onChange={e => set('setupScore', e.target.value)} />
            </div>
            <div>
              <label>Emotion Level (1–5)</label>
              <select value={form.emotionLevel} onChange={e => set('emotionLevel', e.target.value)}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} — {['Very calm','Calm','Neutral','Anxious','Very anxious'][n-1]}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', textTransform: 'none', letterSpacing: 'normal', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '400', marginBottom: 0 }}>
                <input type="checkbox" checked={form.ruleFollowed} onChange={e => set('ruleFollowed', e.target.checked)} />
                Rule followed
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label>Mistake Notes</label>
              <input type="text" placeholder="What went wrong?" value={form.mistakeNotes} onChange={e => set('mistakeNotes', e.target.value)} />
            </div>
            <div>
              <label>Notes</label>
              <input type="text" placeholder="Anything else?" value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>

          <button onClick={addTrade} disabled={saving || !form.entry || !form.stop || !form.target} className="btn btn-green" style={{ width: '100%', padding: '12px' }}>
            {saving ? 'Saving...' : 'Save Trade'}
          </button>
        </div>
      )}

      {/* Trades Table */}
      {loading ? (
        <div style={{ color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading...</div>
      ) : trades.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>◎</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>No trades logged yet</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Market</th>
                <th>Dir</th>
                <th>Contracts</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Exit</th>
                <th>P&L</th>
                <th>R</th>
                <th>Score</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td style={{ color: 'var(--text-secondary)' }}>{t.date}</td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{t.market}</td>
                  <td>
                    <span style={{ color: t.direction === 'LONG' ? 'var(--green)' : 'var(--red)', fontFamily: 'IBM Plex Mono, monospace', fontWeight: '700' }}>
                      {t.direction === 'LONG' ? '↑' : '↓'} {t.direction}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace', textAlign: 'center' }}>{t.contracts}</td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{t.entry}</td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--red)' }}>{t.stop}</td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{t.exit ?? '—'}</td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: '700', color: (t.resultDollars ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {t.resultDollars !== undefined && t.resultDollars !== null
                      ? `${t.resultDollars >= 0 ? '+' : ''}$${t.resultDollars.toFixed(0)}`
                      : '—'}
                  </td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace', color: (t.resultR ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {t.resultR !== undefined && t.resultR !== null ? `${t.resultR >= 0 ? '+' : ''}${t.resultR.toFixed(2)}R` : '—'}
                  </td>
                  <td style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)' }}>
                    {t.setupScore ?? '—'}
                  </td>
                  <td>
                    <span style={{
                      fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '4px',
                      background: t.status === 'WIN' ? 'var(--green-bg)' : t.status === 'LOSS' ? 'var(--red-bg)' : t.status === 'BE' ? 'var(--yellow-bg)' : 'var(--surface)',
                      color: t.status === 'WIN' ? 'var(--green)' : t.status === 'LOSS' ? 'var(--red)' : t.status === 'BE' ? 'var(--yellow)' : 'var(--text-secondary)',
                      border: `1px solid ${t.status === 'WIN' ? 'var(--green-border)' : t.status === 'LOSS' ? 'var(--red-border)' : t.status === 'BE' ? 'var(--yellow-border)' : 'var(--border)'}`,
                    }}>
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => deleteTrade(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
