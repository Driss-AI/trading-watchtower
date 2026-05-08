'use client'
import { useEffect, useState } from 'react'

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
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

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

  useEffect(() => { load() }, [])

  async function load() {
    const [trRes, sessRes] = await Promise.all([
      fetch('/api/trades'),
      fetch('/api/sessions'),
    ])
    const { trades } = await trRes.json()
    setTrades(trades ?? [])
    const sessData = await sessRes.json()
    setSessions(sessData.sessions ?? [])
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    const session = sessions.find((s: any) => s.date === form.date) ?? sessions[0]
    if (!session) { alert('Create a session first'); setSaving(false); return }

    await fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, sessionId: session.id }),
    })

    setShowAdd(false)
    setSaving(false)
    setForm({ date: today, market: 'MNQ', direction: 'LONG', contracts: '1', entry: '', stop: '', target: '', exit: '', setupScore: '', ruleFollowed: true, emotionLevel: '3', mistakeNotes: '', notes: '' })
    load()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/trades?id=${id}`, { method: 'DELETE' })
    load()
  }

  async function handleImport() {
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/trades/import', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setImportMsg(`Error: ${data.error}`)
      } else {
        setImportMsg(`Imported ${data.imported} trade(s), skipped ${data.skipped} duplicate(s)`)
        load()
      }
    } catch (err) {
      setImportMsg('Import failed — check connection')
    }
    setImporting(false)
    setTimeout(() => setImportMsg(null), 8000)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>TRADE JOURNAL</h1>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>{trades.length} trades logged</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '600',
              padding: '10px 18px', borderRadius: '6px', cursor: importing ? 'wait' : 'pointer',
              border: '1px solid var(--green-border)',
              background: 'var(--green-bg)',
              color: 'var(--green)',
              opacity: importing ? 0.6 : 1,
            }}
          >
            {importing ? '⏳ Importing...' : '⚡ Import from TopStepX'}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="btn btn-primary"
          >
            + Log Trade
          </button>
        </div>
      </div>

      {/* Import feedback */}
      {importMsg && (
        <div style={{
          background: importMsg.startsWith('Error') ? 'var(--red-bg)' : 'var(--green-bg)',
          border: `1px solid ${importMsg.startsWith('Error') ? 'var(--red-border)' : 'var(--green-border)'}`,
          borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px',
          color: importMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)',
        }}>
          {importMsg}
        </div>
      )}

      {/* Add Trade Form */}
      {showAdd && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '16px' }}>LOG NEW TRADE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
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
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </div>
            <div>
              <label>Contracts</label>
              <input type="number" min="1" value={form.contracts} onChange={e => set('contracts', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div><label>Entry</label><input type="number" step="0.25" value={form.entry} onChange={e => set('entry', e.target.value)} /></div>
            <div><label>Stop</label><input type="number" step="0.25" value={form.stop} onChange={e => set('stop', e.target.value)} /></div>
            <div><label>Target</label><input type="number" step="0.25" value={form.target} onChange={e => set('target', e.target.value)} /></div>
            <div><label>Exit</label><input type="number" step="0.25" value={form.exit} onChange={e => set('exit', e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div><label>Setup Score</label><input type="number" min="0" max="100" value={form.setupScore} onChange={e => set('setupScore', e.target.value)} /></div>
            <div>
              <label>Emotion (1-5)</label>
              <select value={form.emotionLevel} onChange={e => set('emotionLevel', e.target.value)}>
                <option value="1">1 - Calm</option>
                <option value="2">2 - Focused</option>
                <option value="3">3 - Neutral</option>
                <option value="4">4 - Anxious</option>
                <option value="5">5 - Tilted</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '24px' }}>
              <input type="checkbox" checked={form.ruleFollowed} onChange={e => set('ruleFollowed', e.target.checked)} />
              <label style={{ margin: 0 }}>Rules followed</label>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label>Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleSave} disabled={saving} className="btn btn-primary">{saving ? 'Saving...' : 'Save Trade'}</button>
            <button onClick={() => setShowAdd(false)} className="btn btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {/* Trades Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading...</div>
        ) : trades.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '36px', marginBottom: '16px' }}>◎</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)', marginBottom: '12px' }}>No trades logged yet</div>
            <button onClick={handleImport} disabled={importing} style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '600',
              padding: '10px 18px', borderRadius: '6px', cursor: 'pointer',
              border: '1px solid var(--green-border)', background: 'var(--green-bg)', color: 'var(--green)',
            }}>
              {importing ? '⏳ Importing...' : '⚡ Import from TopStepX'}
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['DATE', 'MARKET', 'DIR', 'CONTRACTS', 'ENTRY', 'STOP', 'EXIT', 'P&L', 'R', 'SCORE', 'STATUS', ''].map(h => (
                  <th key={h} style={{ padding: '12px 10px', textAlign: 'left', fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 10px', color: 'var(--text-secondary)' }}>{t.date}</td>
                  <td style={{ padding: '14px 10px', fontWeight: '600' }}>{t.market}</td>
                  <td style={{ padding: '14px 10px' }}>
                    <span style={{ color: t.direction === 'LONG' ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>
                      {t.direction === 'LONG' ? '↑' : '↓'} {t.direction}
                    </span>
                  </td>
                  <td style={{ padding: '14px 10px', textAlign: 'center' }}>{t.contracts}</td>
                  <td style={{ padding: '14px 10px' }}>{t.entry}</td>
                  <td style={{ padding: '14px 10px', color: 'var(--red)' }}>{t.stop}</td>
                  <td style={{ padding: '14px 10px' }}>{t.exit ?? '—'}</td>
                  <td style={{ padding: '14px 10px', color: (t.resultDollars ?? 0) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: '700' }}>
                    {t.resultDollars != null ? `${t.resultDollars >= 0 ? '+' : ''}$${t.resultDollars.toFixed(0)}` : '—'}
                  </td>
                  <td style={{ padding: '14px 10px', color: (t.resultR ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {t.resultR != null ? `${t.resultR >= 0 ? '+' : ''}${t.resultR.toFixed(2)}R` : '—'}
                  </td>
                  <td style={{ padding: '14px 10px', color: 'var(--text-dim)' }}>{t.setupScore ?? '—'}</td>
                  <td style={{ padding: '14px 10px' }}>
                    <span style={{ color: t.status === 'WIN' ? 'var(--green)' : t.status === 'LOSS' ? 'var(--red)' : 'var(--yellow)', fontWeight: '700' }}>
                      {t.status}
                    </span>
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    <button onClick={() => handleDelete(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
