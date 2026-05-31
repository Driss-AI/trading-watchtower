'use client'
import { useCallback, useEffect, useState } from 'react'

// ─── SCOREBOARD ──────────────────────────────────────────────────────────────
// Does the AI layer actually add value over pure mechanical? Measured on the
// opportunity log, where taken trades and skipped "would-haves" share one R
// scale. Plus execution quality — did I take the signals, and how cleanly?

interface CohortStats {
  key: string; label: string; total: number; resolved: number
  wins: number; losses: number; be: number; inconclusive: number
  winRate: number | null; avgR: number | null; totalR: number
  avgMfeR: number | null; avgMaeR: number | null
}
interface AiScoreboard {
  vetoValueR: number; goodVetoes: number; badVetoes: number; vetoAccuracy: number | null
  netEdgeR: number; takenTotalR: number; counterfactualAllMechR: number
}
interface ExecutionQuality {
  takeSignals: number; taken: number; missed: number; skippedByUser: number
  cancelled: number; notLogged: number; avgDelaySeconds: number | null
  avgAdverseSlippagePts: number | null; overChaseCount: number
}
interface Scoreboard {
  cohorts: CohortStats[]; ai: AiScoreboard; execution: ExecutionQuality
  totalRows: number; resolvedRows: number; pendingRows: number
}

const SOURCES = [
  { key: '', label: 'All' },
  { key: 'paper', label: 'Paper' },
  { key: 'live-signal', label: 'Live' },
]

export default function ScoreboardPage() {
  const [sb, setSb] = useState<Scoreboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('')
  const [days, setDays] = useState(60)

  const load = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (source) qs.set('source', source)
    qs.set('days', String(days))
    fetch(`/api/opportunities/scoreboard?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => { setSb(d.scoreboard ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [source, days])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
            SCOREBOARD
          </h1>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Is the AI earning its seat? · taken vs would-have, on one R scale
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {SOURCES.map((s) => (
            <button key={s.key} onClick={() => setSource(s.key)} style={pillStyle(source === s.key)}>{s.label}</button>
          ))}
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} style={selectStyle}>
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={9999}>All</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : !sb || sb.totalRows === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>◆</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px', color: 'var(--text-dim)' }}>
            No signals in this window yet. The scoreboard fills as the opportunity log grows.
          </div>
        </div>
      ) : (
        <>
          {/* AI VALUE — the headline question */}
          <div className="card" style={{ marginBottom: '20px', borderColor: 'rgba(99,102,241,0.3)' }}>
            <div style={{ fontSize: '10px', color: 'rgba(129,140,248,0.9)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '14px' }}>
              AI VALUE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <Metric label="Net edge vs take-all" value={fmtR(sb.ai.netEdgeR)} color={signColor(sb.ai.netEdgeR)}
                sub={`actual ${fmtR(sb.ai.takenTotalR)} vs ${fmtR(sb.ai.counterfactualAllMechR)}`} />
              <Metric label="Veto value" value={fmtR(sb.ai.vetoValueR)} color={signColor(sb.ai.vetoValueR)}
                sub={`${sb.ai.goodVetoes} good · ${sb.ai.badVetoes} bad`} />
              <Metric label="Veto accuracy" value={sb.ai.vetoAccuracy != null ? `${sb.ai.vetoAccuracy}%` : '—'}
                color={accColor(sb.ai.vetoAccuracy)} sub="vetoed a would-be loss" />
              <Metric label="Signals" value={String(sb.totalRows)} sub={`${sb.resolvedRows} resolved · ${sb.pendingRows} pending`} />
            </div>
          </div>

          {/* EXECUTION QUALITY */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '14px' }}>
              EXECUTION QUALITY · {sb.execution.takeSignals} TAKE signals
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
              <Metric label="You took" value={`${sb.execution.taken}/${sb.execution.takeSignals}`} color="var(--green)" />
              <Metric label="Missed/expired" value={String(sb.execution.missed)} color={sb.execution.missed > 0 ? 'var(--yellow)' : undefined} />
              <Metric label="Avg delay" value={sb.execution.avgDelaySeconds != null ? `${sb.execution.avgDelaySeconds}s` : '—'}
                color={sb.execution.avgDelaySeconds != null && sb.execution.avgDelaySeconds > 30 ? 'var(--yellow)' : undefined} />
              <Metric label="Avg slippage" value={sb.execution.avgAdverseSlippagePts != null ? `${sb.execution.avgAdverseSlippagePts >= 0 ? '+' : ''}${sb.execution.avgAdverseSlippagePts}pt` : '—'}
                color={sb.execution.avgAdverseSlippagePts != null && sb.execution.avgAdverseSlippagePts > 0 ? 'var(--red)' : 'var(--green)'} />
              <Metric label="Over-chased" value={String(sb.execution.overChaseCount)} color={sb.execution.overChaseCount > 0 ? 'var(--red)' : undefined} />
            </div>
          </div>

          {/* COHORT TABLE */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.08em', fontWeight: 600, marginBottom: '12px' }}>
              OUTCOMES BY DECISION COHORT
            </div>
            <table>
              <thead>
                <tr>
                  <th>Cohort</th><th>N</th><th>Resolved</th><th>W/L</th>
                  <th>Win%</th><th>Avg R</th><th>Total R</th><th>MFE</th><th>MAE</th>
                </tr>
              </thead>
              <tbody>
                {sb.cohorts.map((c) => (
                  <tr key={c.key}>
                    <td style={{ fontFamily: 'IBM Plex Mono, monospace', color: cohortColor(c.key) }}>{c.label}</td>
                    <td style={mono}>{c.total}</td>
                    <td style={mono}>{c.resolved}</td>
                    <td style={mono}><span style={{ color: 'var(--green)' }}>{c.wins}</span>/<span style={{ color: 'var(--red)' }}>{c.losses}</span></td>
                    <td style={{ ...mono, color: c.winRate == null ? 'var(--text-dim)' : c.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>{c.winRate != null ? `${c.winRate}%` : '—'}</td>
                    <td style={{ ...mono, color: signColor(c.avgR) }}>{c.avgR != null ? fmtR(c.avgR) : '—'}</td>
                    <td style={{ ...mono, color: signColor(c.totalR) }}>{fmtR(c.totalR)}</td>
                    <td style={{ ...mono, color: 'var(--text-dim)' }}>{c.avgMfeR != null ? c.avgMfeR.toFixed(2) : '—'}</td>
                    <td style={{ ...mono, color: 'var(--text-dim)' }}>{c.avgMaeR != null ? c.avgMaeR.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '10px', lineHeight: 1.5 }}>
              Skipped cohorts show <b>would-have</b> outcomes. A profitable “Taken” row with a losing “AI veto” row = the AI is earning its seat.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function fmtR(r: number | null): string {
  if (r == null) return '—'
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`
}
function signColor(r: number | null): string | undefined {
  if (r == null) return undefined
  return r > 0 ? 'var(--green)' : r < 0 ? 'var(--red)' : undefined
}
function accColor(pct: number | null): string | undefined {
  if (pct == null) return undefined
  return pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)'
}
function cohortColor(key: string): string {
  if (key === 'taken') return 'var(--green)'
  if (key.startsWith('ai-')) return 'rgba(129,140,248,0.95)'
  return 'var(--text-secondary)'
}

const mono: React.CSSProperties = { fontFamily: 'IBM Plex Mono, monospace' }

function Metric({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '20px', fontWeight: 700, color: color ?? 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '3px', fontFamily: 'IBM Plex Mono, monospace' }}>{sub}</div>}
    </div>
  )
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(41,121,255,0.15)' : 'transparent',
    border: `1px solid ${active ? '#2979ff' : '#162040'}`, borderRadius: '6px',
    color: active ? '#dce8ff' : '#6b85b8', fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '11px', fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
  }
}
const selectStyle: React.CSSProperties = {
  background: '#0d1a30', border: '1px solid #162040', borderRadius: '6px',
  color: 'var(--text-primary)', fontFamily: 'IBM Plex Mono, monospace',
  fontSize: '11px', padding: '6px 8px',
}
