'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import MorningBriefing from '@/components/MorningBriefing'

interface Session {
  id: string; date: string; market: string; score: number; decision: string
  decisionReason: string; dailyPnl: number; tradesCount: number; losesCount: number
  orHigh?: number; orLow?: number; orSize?: number
}
interface Settings {
  dailyLossLimit: number; trailingDrawdown: number; profitTarget: number
  maxTradesPerDay: number; maxLosingTradesPerDay: number
}

export default function Dashboard() {
  const [session, setSession]   = useState<Session | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading]   = useState(true)
  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    async function load() {
      const [sessRes, setRes] = await Promise.all([
        fetch(`/api/sessions?date=${today}`),
        fetch('/api/settings'),
      ])
      const { session }  = await sessRes.json()
      const { settings } = await setRes.json()
      setSession(session)
      setSettings(settings)
      setLoading(false)
    }
    load()
  }, [])

  const decision = session?.decision ?? 'NO_TRADE'
  const score    = session?.score ?? 0

  const decisionStyle = {
    TRADE:    { color: 'var(--green)',  bg: 'var(--green-bg)',  border: 'var(--green-border)',  glow: '0 0 20px rgba(0,230,118,0.3)' },
    CAUTION:  { color: 'var(--yellow)', bg: 'var(--yellow-bg)', border: 'var(--yellow-border)', glow: '0 0 20px rgba(255,179,0,0.3)' },
    NO_TRADE: { color: 'var(--red)',    bg: 'var(--red-bg)',    border: 'var(--red-border)',    glow: '0 0 20px rgba(255,61,61,0.3)' },
  }[decision] ?? { color: 'var(--text-secondary)', bg: 'var(--surface)', border: 'var(--border)', glow: 'none' }

  const remainingRisk = settings ? settings.dailyLossLimit - Math.abs(session?.dailyPnl ?? 0) : null
  const pnl = session?.dailyPnl ?? 0
  const nyTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            SESSION COMMAND
          </h1>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            {nyTime} · NY Session
          </p>
        </div>
        <Link href="/session" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          + New Session
        </Link>
      </div>

      {/* Morning Briefing Widget */}
      <MorningBriefing />

      {loading ? (
        <div style={{ color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '13px' }}>Loading...</div>
      ) : (
        <>
          {/* Decision Banner */}
          <div style={{ background: decisionStyle.bg, border: `1px solid ${decisionStyle.border}`, borderRadius: '10px', padding: '28px 32px', marginBottom: '20px', boxShadow: decisionStyle.glow, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
            <div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: decisionStyle.color, fontWeight: '600', letterSpacing: '0.1em', marginBottom: '8px' }}>
                TODAY'S DECISION
              </div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '28px', fontWeight: '700', color: decisionStyle.color, textShadow: `0 0 16px ${decisionStyle.color}80`, letterSpacing: '-0.02em' }}>
                {session ? session.decisionReason : '— NO SESSION YET —'}
              </div>
              {!session && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  Set up today's session →{' '}
                  <Link href="/session" style={{ color: 'var(--blue)' }}>Session Setup</Link>
                </div>
              )}
            </div>
            <div style={{ width: '90px', height: '90px', borderRadius: '50%', border: `3px solid ${decisionStyle.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--card)' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '30px', fontWeight: '700', color: decisionStyle.color, lineHeight: 1 }}>{score}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.06em' }}>SCORE</div>
            </div>
          </div>

          {/* Score bar */}
          {session && (
            <div style={{ marginBottom: '20px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.08em' }}>QUALITY SCORE</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>NO TRADE &lt;65 · CAUTION 65–79 · TRADE ≥80</span>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                <div style={{ width: `${score}%`, height: '100%', background: score >= 80 ? 'var(--green)' : score >= 65 ? 'var(--yellow)' : 'var(--red)', borderRadius: '4px', transition: 'width 0.5s ease', boxShadow: `0 0 8px ${score >= 80 ? 'rgba(0,230,118,0.6)' : score >= 65 ? 'rgba(255,179,0,0.6)' : 'rgba(255,61,61,0.6)'}` }} />
              </div>
            </div>
          )}

          {/* Metric Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <MetricCard label="Daily P&L" value={pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`} color={pnl > 0 ? 'green' : pnl < 0 ? 'red' : undefined} />
            <MetricCard label="Remaining Risk" value={remainingRisk !== null ? `$${remainingRisk.toFixed(0)}` : '—'} color={remainingRisk !== null && remainingRisk < settings!.dailyLossLimit * 0.3 ? 'red' : remainingRisk !== null && remainingRisk < settings!.dailyLossLimit * 0.6 ? 'yellow' : 'green'} />
            <MetricCard label="Trades Today" value={`${session?.tradesCount ?? 0} / ${settings?.maxTradesPerDay ?? 2}`} color={(session?.tradesCount ?? 0) >= (settings?.maxTradesPerDay ?? 2) ? 'red' : undefined} />
            <MetricCard label="Losses Today" value={`${session?.losesCount ?? 0} / ${settings?.maxLosingTradesPerDay ?? 2}`} color={(session?.losesCount ?? 0) >= (settings?.maxLosingTradesPerDay ?? 2) ? 'red' : undefined} />
          </div>

          {/* Account Progress */}
          {settings && (
            <div className="card" style={{ marginBottom: '20px' }}>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '16px' }}>
                TOPSTEP 100K · EVALUATION STATUS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                {[
                  { label: 'Profit Target', value: `$${settings.profitTarget.toLocaleString()}`, color: 'var(--green)' },
                  { label: 'Daily Loss Limit', value: `$${settings.dailyLossLimit.toLocaleString()}`, color: 'var(--red)' },
                  { label: 'Trailing DD', value: `$${settings.trailingDrawdown.toLocaleString()}`, color: 'var(--yellow)' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '18px', fontWeight: '700', color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            <QuickLink href="/session" label="Setup Today's Session" icon="◈" desc="Auto-fill + calculate score" />
            <QuickLink href="/risk"    label="Risk Calculator"        icon="⚡" desc="Size your position safely" />
            <QuickLink href="/journal" label="Log a Trade"            icon="◎" desc="Journal your execution" />
            <QuickLink href="/performance" label="View Stats"         icon="◆" desc="Track your edge" />
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = color === 'green' ? 'var(--green)' : color === 'red' ? 'var(--red)' : color === 'yellow' ? 'var(--yellow)' : 'var(--text-primary)'
  return (
    <div className="card">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600' }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '24px', fontWeight: '700', color: c }}>{value}</div>
    </div>
  )
}

function QuickLink({ href, label, icon, desc }: { href: string; label: string; icon: string; desc: string }) {
  return (
    <Link href={href} style={{ display: 'block', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', textDecoration: 'none', transition: 'all 0.15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-bright)'; (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--card)' }}>
      <div style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--blue)' }}>{icon}</div>
      <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{desc}</div>
    </Link>
  )
}
