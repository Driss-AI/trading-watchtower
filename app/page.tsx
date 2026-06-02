'use client'
import { useEffect, useState } from 'react'
import MorningBriefing from '@/components/MorningBriefing'
import MacroSentiment from '@/components/MacroSentiment'
import EconomicCalendar from '@/components/EconomicCalendar'
import DrawdownMeter from '@/components/DrawdownMeter'
import LivePosition from '@/components/LivePosition'
import LiveStats from '@/components/LiveStats'
import ORBAlerts from '@/components/ORBAlerts'
import CandleReader from '@/components/CandleReader'
import PaperTrading from '@/components/PaperTrading'
import ManualExecutionLog from '@/components/ManualExecutionLog'

interface Session {
  orHigh?: number; orLow?: number
}
interface Settings {
  dailyLossLimit: number; trailingDrawdown: number; profitTarget: number
  maxTradesPerDay: number; maxLosingTradesPerDay: number
}

export default function Cockpit() {
  const [session, setSession]   = useState<Session | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
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
    }
    load()
  }, [])

  const nyTime = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric',
  })

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          BOT COMMAND
        </h1>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
          {nyTime} · NY Session · Autonomous ORB engine on MNQ
        </p>
      </div>

      {/* ── Primary: cockpit ── */}
      <PaperTrading />

      {/* ── Manual execution log (system decides · you execute · system audits) ── */}
      <ManualExecutionLog />

      {/* ── Live breakout monitor ── */}
      <ORBAlerts />

      {/* ── Account state (real TopStep account, not paper) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px', alignItems: 'start' }}>
        <LivePosition />
        <div className="card">
          <DrawdownMeter />
        </div>
      </div>

      {/* ── Risk limits strip ── */}
      {settings && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '28px' }}>
          <LimitCard label="Daily Loss Limit"  value={`$${settings.dailyLossLimit.toFixed(0)}`} />
          <LimitCard label="Trailing Drawdown" value={`$${settings.trailingDrawdown.toFixed(0)}`} />
          <LimitCard label="Profit Target"     value={`$${settings.profitTarget.toFixed(0)}`} />
          <LimitCard label="Max Trades / Day"  value={`${settings.maxTradesPerDay}`} />
        </div>
      )}

      {/* ── Context (secondary) ── */}
      <SectionHeading>CONTEXT</SectionHeading>

      <MorningBriefing />

      <div style={{
        display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '16px',
        alignItems: 'start', marginBottom: '0',
      }}>
        <CandleReader orHigh={session?.orHigh} orLow={session?.orLow} />
        <MacroSentiment />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px',
        alignItems: 'start', marginTop: '0',
      }}>
        <LiveStats />
        <EconomicCalendar />
      </div>

      {/* ── Quick links ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '20px' }}>
        <QuickLink href="/paper"       label="Paper Performance"     icon="◇" desc="Engine trade log + debriefs" />
        <QuickLink href="/risk"        label="Risk Calculator"       icon="⚡" desc="Size your position safely" />
        <QuickLink href="/journal"     label="Log a Trade"           icon="◎" desc="Journal your execution" />
        <QuickLink href="/session"     label="Manual Session Scorer" icon="◈" desc="Optional 0–100 quality score" />
      </div>
    </div>
  )
}

function LimitCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600' }}>{label}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0 12px',
    }}>
      <div style={{
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: 700,
        letterSpacing: '0.12em', color: 'var(--text-dim)',
      }}>
        {children}
      </div>
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
    </div>
  )
}

function QuickLink({ href, label, icon, desc }: { href: string; label: string; icon: string; desc: string }) {
  return (
    <a href={href} style={{
      display: 'block', background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '16px', textDecoration: 'none', transition: 'all 0.15s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-bright)'; (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--card)' }}>
      <div style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--blue)' }}>{icon}</div>
      <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{desc}</div>
    </a>
  )
}
