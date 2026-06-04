'use client'
import { useCallback, useEffect, useState } from 'react'

// ─── OPPORTUNITIES COCKPIT ───────────────────────────────────────────────────
// Every armed-break the engine evaluated (taken or skipped), with a per-row
// control to log what you actually did by hand. Closes the loop between signal
// quality (what the engine said) and execution quality (what you did).

const EXEC_STATUSES = ['NOT_TAKEN', 'TAKEN', 'SKIPPED', 'MISSED', 'CANCELLED', 'EXPIRED'] as const
type ExecStatus = (typeof EXEC_STATUSES)[number]

interface Opp {
  id: string
  date: string
  barTime: string
  market: string
  direction: 'LONG' | 'SHORT'
  finalDecision: 'take' | 'skip'
  finalContracts: number
  skipSource: string | null
  skipReason: string | null
  mechanicalVerdict: string
  entry: number
  stop: number
  target: number
  rrRatio: number
  signalExpiresAt: string | null
  validForSeconds: number | null
  maxChaseDistance: number | null
  cancelIfBeyond: number | null
  entryBandLow: number | null
  entryBandHigh: number | null
  isExpired: boolean
  manualExecutionStatus: ExecStatus
  actualEntry: number | null
  actualContracts: number | null
  executionDelaySeconds: number | null
  manualOverrideReason: string | null
  outcomeStatus: string
  outcomeLabel: string | null
  outcomeR: number | null
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD
}

function clockET(iso: string | null, withSeconds = false): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    })
  } catch {
    return '—'
  }
}

export default function OpportunitiesPage() {
  const [date, setDate] = useState(todayISO())
  const [rows, setRows] = useState<Opp[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/opportunities?date=${date}&limit=200`)
      .then((r) => r.json())
      .then((d) => { setRows(d.opportunities ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [date])

  useEffect(() => { load() }, [load])

  const taken = rows.filter((r) => r.manualExecutionStatus === 'TAKEN')
  const avgDelay = taken.length
    ? Math.round(taken.reduce((s, r) => s + (r.executionDelaySeconds ?? 0), 0) / taken.length)
    : null
  const expiredUnacted = rows.filter((r) => r.isExpired).length

  return (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
            OPPORTUNITIES
          </h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Every armed break the engine saw · log what you actually did
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px',
            color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace',
            fontSize: '12px', padding: '6px 10px',
          }}
        />
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <Stat label="Signals" value={String(rows.length)} />
        <Stat label="Takes" value={String(rows.filter((r) => r.finalDecision === 'take').length)} color="var(--green)" />
        <Stat label="You Took" value={String(taken.length)} color="var(--green)" />
        <Stat label="Avg Delay" value={avgDelay != null ? `${avgDelay}s` : '—'} color={avgDelay != null && avgDelay > 30 ? 'var(--yellow)' : undefined} />
        <Stat label="Expired" value={String(expiredUnacted)} color={expiredUnacted > 0 ? 'var(--yellow)' : undefined} />
      </div>

      {loading ? (
        <div className="card" style={{ color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', padding: '40px', textAlign: 'center' }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>◇</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
            No opportunities logged for {date}.
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Dir</th>
                <th>Call</th>
                <th>Setup</th>
                <th>Valid&nbsp;until</th>
                <th>Outcome</th>
                <th>You did</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  open={openId === r.id}
                  onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                  onSaved={() => { setOpenId(null); load() }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Row({ r, open, onToggle, onSaved }: { r: Opp; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const isTake = r.finalDecision === 'take'
  return (
    <>
      <tr>
        <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{clockET(r.barTime)}</td>
        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: r.direction === 'LONG' ? 'var(--green)' : 'var(--red)' }}>
          {r.direction === 'LONG' ? '↑' : '↓'}
        </td>
        <td>
          {isTake ? (
            <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: '11px' }}>
              TAKE {r.finalContracts}x
            </span>
          ) : (
            <span title={r.skipReason ?? ''} style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
              SKIP · {r.skipSource ?? '—'}
            </span>
          )}
          {r.mechanicalVerdict === 'caution' && (
            <span style={{ color: 'var(--yellow)', fontSize: '9px', marginLeft: '6px', letterSpacing: '0.05em' }}>CAUTION</span>
          )}
        </td>
        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
          {r.entry.toFixed(2)} → {r.target.toFixed(2)} <span style={{ color: 'var(--text-dim)' }}>(stop {r.stop.toFixed(2)} · {r.rrRatio.toFixed(1)}R)</span>
        </td>
        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
          {clockET(r.signalExpiresAt, true)}
          {r.isExpired && (
            <span style={{ color: 'var(--yellow)', fontSize: '9px', marginLeft: '6px', fontWeight: 700 }}>EXPIRED</span>
          )}
        </td>
        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
          {r.outcomeStatus === 'resolved' && r.outcomeLabel ? (
            <span style={{ color: outcomeColor(r.outcomeLabel) }}>
              {r.outcomeLabel.toUpperCase()}{r.outcomeR != null ? ` ${r.outcomeR >= 0 ? '+' : ''}${r.outcomeR.toFixed(1)}R` : ''}
            </span>
          ) : (
            <span style={{ color: 'var(--text-dim)' }}>pending</span>
          )}
        </td>
        <td><ExecBadge r={r} /></td>
        <td>
          <button onClick={onToggle} style={logBtnStyle(open)}>{open ? 'Close' : 'Log'}</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: 'rgba(255,255,255,0.02)', padding: '14px 12px' }}>
            <LogForm r={r} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  )
}

function LogForm({ r, onSaved }: { r: Opp; onSaved: () => void }) {
  const [status, setStatus] = useState<ExecStatus>(
    r.manualExecutionStatus !== 'NOT_TAKEN' ? r.manualExecutionStatus : r.finalDecision === 'take' ? 'TAKEN' : 'SKIPPED',
  )
  const [actualEntry, setActualEntry] = useState(r.actualEntry != null ? String(r.actualEntry) : '')
  const [actualContracts, setActualContracts] = useState(r.actualContracts != null ? String(r.actualContracts) : String(r.finalContracts || ''))
  const [reason, setReason] = useState(r.manualOverrideReason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsFill = status === 'TAKEN'

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/opportunities/${r.id}/execution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          actualEntry: actualEntry ? parseFloat(actualEntry) : null,
          actualContracts: actualContracts ? parseInt(actualContracts, 10) : null,
          manualOverrideReason: reason || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to save')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  // Did the user chase past the engine's max-chase line?
  const chase = needsFill && actualEntry && r.cancelIfBeyond != null
    ? r.direction === 'LONG'
      ? parseFloat(actualEntry) - r.entry
      : r.entry - parseFloat(actualEntry)
    : null
  const overChased = chase != null && r.maxChaseDistance != null && chase > r.maxChaseDistance

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
      <Field label="What you did">
        <select value={status} onChange={(e) => setStatus(e.target.value as ExecStatus)} style={inputStyle}>
          {EXEC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      {needsFill && (
        <>
          <Field label="Actual entry">
            <input type="number" step="0.25" value={actualEntry} onChange={(e) => setActualEntry(e.target.value)} placeholder={r.entry.toFixed(2)} style={inputStyle} />
          </Field>
          <Field label="Contracts">
            <input type="number" step="1" value={actualContracts} onChange={(e) => setActualContracts(e.target.value)} style={{ ...inputStyle, width: '70px' }} />
          </Field>
        </>
      )}
      <Field label="Note / override reason">
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" style={{ ...inputStyle, width: '220px' }} />
      </Field>
      <button onClick={save} disabled={saving} style={saveBtnStyle(saving)}>{saving ? 'Saving…' : 'Save'}</button>
      {overChased && (
        <span style={{ fontSize: '11px', color: 'var(--yellow)', fontFamily: 'JetBrains Mono, monospace' }}>
          ⚠ chased {chase!.toFixed(2)}pt — past the {r.maxChaseDistance}pt limit
        </span>
      )}
      {error && <span style={{ fontSize: '11px', color: 'var(--red)' }}>{error}</span>}
    </div>
  )
}

function ExecBadge({ r }: { r: Opp }) {
  const s = r.manualExecutionStatus
  if (s === 'NOT_TAKEN') {
    return <span style={{ fontSize: '10px', color: r.isExpired ? 'var(--yellow)' : 'var(--text-dim)' }}>{r.isExpired ? 'expired' : '—'}</span>
  }
  const color = s === 'TAKEN' ? 'var(--green)' : s === 'MISSED' || s === 'EXPIRED' ? 'var(--yellow)' : 'var(--text-secondary)'
  return (
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', fontWeight: 700, color }}>
      {s}
      {s === 'TAKEN' && r.actualEntry != null && (
        <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> @{r.actualEntry.toFixed(2)}{r.executionDelaySeconds != null ? ` ·${r.executionDelaySeconds}s` : ''}</span>
      )}
    </span>
  )
}

function outcomeColor(label: string): string {
  if (label === 'win') return 'var(--green)'
  if (label === 'loss') return 'var(--red)'
  return 'var(--text-secondary)'
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '20px', fontWeight: 700, color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px',
  color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace',
  fontSize: '12px', padding: '6px 8px', width: '110px',
}

function logBtnStyle(open: boolean): React.CSSProperties {
  return {
    background: open ? 'rgba(41,121,255,0.15)' : 'transparent',
    border: '1px solid var(--border)', borderRadius: '6px',
    color: open ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: 600,
    padding: '4px 12px', cursor: 'pointer',
  }
}

function saveBtnStyle(saving: boolean): React.CSSProperties {
  return {
    background: saving ? 'rgba(0,230,118,0.1)' : 'rgba(0,230,118,0.15)',
    border: '1px solid rgba(0,230,118,0.3)', borderRadius: '6px',
    color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace',
    fontSize: '12px', fontWeight: 700, padding: '6px 16px',
    cursor: saving ? 'default' : 'pointer',
  }
}
