'use client'
import { useEffect, useState, useCallback } from 'react'
import { getEventIntel, getSessionImpact } from '@/lib/calendar-intel'

interface NewsEvent {
  time: string; title: string; currency: string
  impact: 'high' | 'medium' | 'low'; forecast?: string; previous?: string
}
interface CalendarDay {
  date: string; dateLabel: string; isToday: boolean; isTomorrow: boolean
  events: NewsEvent[]; hasHighImpact: boolean
}
interface MarketStatus {
  isWeekend: boolean; isPreMarket: boolean; isMarketHours: boolean
  isAfterHours: boolean; nextSessionLabel: string; contextLabel: string
}

export default function EconomicCalendar() {
  const [days, setDays] = useState<CalendarDay[]>([])
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/market-data')
      const data = await res.json()
      setDays(data.weekCalendar ?? [])
      setMarketStatus(data.marketStatus ?? null)
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [])
  useEffect(() => { if (marketStatus?.isWeekend) setExpanded(true) }, [marketStatus])

  // Find today/tomorrow/rest
  const todayDay = days.find(d => d.isToday)
  const tomorrowDay = days.find(d => d.isTomorrow)
  const otherDays = days.filter(d => !d.isToday && !d.isTomorrow)

  // Session impact for today (or next weekday on weekends)
  const focusDay = todayDay ?? days[0]
  const sessionImpact = focusDay ? getSessionImpact(focusDay.events) : null

  const markerLabel = marketStatus?.isWeekend ? 'WEEK AHEAD — ECONOMIC CALENDAR'
    : marketStatus?.isMarketHours ? 'LIVE ECONOMIC CALENDAR'
    : marketStatus?.isPreMarket ? "TODAY'S ECONOMIC CALENDAR"
    : 'ECONOMIC CALENDAR'

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>📅</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: '700', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
            {markerLabel}
          </span>
          <MarketBadge status={marketStatus} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setExpanded(!expanded)} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>
            {expanded ? 'Collapse' : '📅 Full Week'}
          </button>
          <button onClick={load} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>↻</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '16px 20px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>Loading calendar...</div>
      ) : (
        <div style={{ padding: '14px 20px' }}>

          {/* ── SESSION VERDICT BANNER ── */}
          {sessionImpact && (
            <SessionVerdictBanner impact={sessionImpact} isWeekend={marketStatus?.isWeekend ?? false} dayLabel={focusDay?.dateLabel ?? ''} />
          )}

          {/* Today */}
          {todayDay && <DaySection day={todayDay} badge="TODAY" showIntel />}

          {/* Tomorrow */}
          {tomorrowDay && <DaySection day={tomorrowDay} badge="TOMORROW" showIntel />}

          {/* Full week */}
          {expanded && otherDays.map(day => <DaySection key={day.date} day={day} showIntel />)}

          {/* Weekend: show all days */}
          {marketStatus?.isWeekend && !todayDay && days.map(day => <DaySection key={day.date} day={day} showIntel />)}

          {/* Expand toggle */}
          {!expanded && otherDays.length > 0 && !marketStatus?.isWeekend && (
            <button onClick={() => setExpanded(true)} style={{ marginTop: '8px', background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: '12px', padding: 0, fontFamily: 'JetBrains Mono, monospace' }}>
              + Show rest of week ({otherDays.length} more day{otherDays.length > 1 ? 's' : ''}) →
            </button>
          )}

          {days.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}>No USD events found for this week</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Session verdict banner ───────────────────────────────────────────────────
function SessionVerdictBanner({ impact, isWeekend, dayLabel }: { impact: ReturnType<typeof getSessionImpact>; isWeekend: boolean; dayLabel: string }) {
  const borderColor = impact.verdictColor === 'red' ? 'var(--red-border)' : impact.verdictColor === 'yellow' ? 'var(--yellow-border)' : 'var(--green-border)'
  const bgColor    = impact.verdictColor === 'red' ? 'var(--red-bg)'    : impact.verdictColor === 'yellow' ? 'var(--yellow-bg)'    : 'var(--green-bg)'
  const textColor  = impact.verdictColor === 'red' ? 'var(--red)'       : impact.verdictColor === 'yellow' ? 'var(--yellow)'       : 'var(--green)'

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: impact.keyEvents.length > 0 ? '10px' : 0 }}>
        <div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: textColor, fontWeight: '700', letterSpacing: '0.1em', marginBottom: '4px' }}>
            {isWeekend ? `${dayLabel.toUpperCase()} TRADING VERDICT` : "TODAY'S TRADING VERDICT"}
          </div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: '700', color: textColor }}>
            {impact.verdictLabel}
          </div>
        </div>
        {impact.scoreAdjustment < 0 && (
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '18px', fontWeight: '700', color: textColor }}>
            {impact.scoreAdjustment} pts
          </div>
        )}
      </div>

      {/* Key event notes */}
      {impact.keyEvents.map((e, i) => (
        <div key={i} style={{ fontSize: '11px', color: textColor, marginBottom: '4px', opacity: 0.9 }}>
          <span style={{ fontWeight: '700' }}>{e.time} {e.title}:</span>{' '}
          <span style={{ opacity: 0.85 }}>{e.note}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Day section ─────────────────────────────────────────────────────────────
function DaySection({ day, badge, showIntel }: { day: CalendarDay; badge?: string; showIntel?: boolean }) {
  const highImpact = day.events.filter(e => e.impact === 'high')
  const others = day.events.filter(e => e.impact !== 'high')

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
          {day.dateLabel}
        </span>
        {badge && (
          <span style={{ fontSize: '10px', fontWeight: '700', color: badge === 'TODAY' ? 'var(--blue)' : 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
            {badge}
          </span>
        )}
        {day.hasHighImpact && <span style={{ fontSize: '10px', color: 'var(--red)', fontWeight: '600' }}>⚠️ High impact</span>}
        {day.events.length === 0 && <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>No USD events</span>}
      </div>

      {highImpact.map((e, i) => <EventRow key={i} event={e} showIntel={showIntel} />)}
      {others.map((e, i) => <EventRow key={i} event={e} showIntel={showIntel} />)}
    </div>
  )
}

// ─── Event row with expandable intel ─────────────────────────────────────────
function EventRow({ event, showIntel }: { event: NewsEvent; showIntel?: boolean }) {
  const [open, setOpen] = useState(false)
  const intel = getEventIntel(event.title)

  const impactColor  = event.impact === 'high' ? 'var(--red)' : event.impact === 'medium' ? 'var(--yellow)' : 'var(--text-dim)'
  const impactBg     = event.impact === 'high' ? 'var(--red-bg)' : event.impact === 'medium' ? 'var(--yellow-bg)' : 'var(--surface)'
  const impactBorder = event.impact === 'high' ? 'var(--red-border)' : event.impact === 'medium' ? 'var(--yellow-border)' : 'var(--border)'

  const riskColor = intel
    ? intel.orbRisk === 'extreme' ? 'var(--red)'
    : intel.orbRisk === 'high' ? '#ff8c00'
    : intel.orbRisk === 'medium' ? 'var(--yellow)'
    : 'var(--green)'
    : 'var(--text-dim)'

  return (
    <div style={{ marginBottom: '2px' }}>
      <div
        onClick={() => intel && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: intel ? 'pointer' : 'default' }}
      >
        {/* Impact dot */}
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: impactColor, flexShrink: 0 }} />

        {/* Time */}
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)', width: '54px', flexShrink: 0 }}>{event.time}</span>

        {/* Title */}
        <span style={{ fontSize: '12px', color: event.impact === 'high' ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, fontWeight: event.impact === 'high' ? '600' : '400' }}>
          {event.title}
        </span>

        {/* NQ Risk badge (from intel) */}
        {intel && (
          <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface)', color: riskColor, border: `1px solid ${riskColor}40`, letterSpacing: '0.06em', flexShrink: 0 }}>
            NQ: {intel.orbRisk.toUpperCase()}
          </span>
        )}

        {/* Impact label */}
        <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: impactBg, color: impactColor, border: `1px solid ${impactBorder}`, letterSpacing: '0.06em', flexShrink: 0 }}>
          {event.impact.toUpperCase()}
        </span>

        {/* Forecast/Previous */}
        {(event.forecast || event.previous) && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0, textAlign: 'right', minWidth: '90px' }}>
            {event.forecast ? `F:${event.forecast}` : ''} {event.previous ? `P:${event.previous}` : ''}
          </span>
        )}

        {/* Expand chevron */}
        {intel && (
          <span style={{ color: 'var(--text-dim)', fontSize: '10px', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
        )}
      </div>

      {/* Expanded intel panel */}
      {open && intel && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px', margin: '4px 0 8px 18px' }}>
          {/* What is this */}
          <div style={{ marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-dim)', letterSpacing: '0.08em', fontFamily: 'JetBrains Mono, monospace' }}>WHAT IT IS</span>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{intel.description}</div>
          </div>

          {/* NQ context */}
          <div style={{ marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-dim)', letterSpacing: '0.08em', fontFamily: 'JetBrains Mono, monospace' }}>HOW IT AFFECTS NQ</span>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{intel.nqContext}</div>
          </div>

          {/* Beat direction */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ background: 'var(--card)', borderRadius: '6px', padding: '8px 12px', fontSize: '11px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '10px', marginBottom: '2px' }}>BETTER THAN EXPECTED</div>
              <div style={{ color: intel.beatDirection === 'bullish' ? 'var(--green)' : intel.beatDirection === 'bearish' ? 'var(--red)' : 'var(--yellow)', fontWeight: '700' }}>
                {intel.beatDirection === 'bullish' ? '↑ Bullish for NQ' : intel.beatDirection === 'bearish' ? '↓ Bearish for NQ' : '↔ Mixed — depends on context'}
              </div>
            </div>
            <div style={{ background: 'var(--card)', borderRadius: '6px', padding: '8px 12px', fontSize: '11px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '10px', marginBottom: '2px' }}>AVOID WINDOW</div>
              <div style={{ color: 'var(--yellow)', fontWeight: '700' }}>
                {intel.avoidBefore} min before → {intel.avoidAfter} min after
              </div>
            </div>
          </div>

          {/* Trader note — the most important part */}
          <div style={{ background: riskColor === 'var(--red)' ? 'var(--red-bg)' : riskColor === 'var(--green)' ? 'var(--green-bg)' : 'var(--yellow-bg)', border: `1px solid ${riskColor}40`, borderRadius: '6px', padding: '10px 12px', fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.6' }}>
            <span style={{ fontWeight: '700', color: riskColor }}>YOUR ACTION: </span>{intel.traderNote}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Market status badge ──────────────────────────────────────────────────────
function MarketBadge({ status }: { status: MarketStatus | null }) {
  if (!status) return null
  const label = status.isMarketHours ? '● MARKET OPEN' : status.isWeekend ? '◌ WEEKEND' : status.isPreMarket ? '◐ PRE-MARKET' : '◌ AFTER HOURS'
  const color  = status.isMarketHours ? 'var(--green)' : status.isPreMarket ? 'var(--yellow)' : 'var(--text-dim)'
  const bg     = status.isMarketHours ? 'var(--green-bg)' : status.isPreMarket ? 'var(--yellow-bg)' : 'var(--surface)'
  const border = status.isMarketHours ? 'var(--green-border)' : status.isPreMarket ? 'var(--yellow-border)' : 'var(--border)'
  return (
    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', fontFamily: 'JetBrains Mono, monospace', fontWeight: '600', background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  )
}
