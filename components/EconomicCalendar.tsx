'use client'
import { useEffect, useState, useCallback } from 'react'

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
  const [expanded, setExpanded] = useState(false) // week view toggle

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

  // On weekends, default to showing full week
  useEffect(() => {
    if (marketStatus?.isWeekend) setExpanded(true)
  }, [marketStatus])

  const todayDay = days.find(d => d.isToday)
  const tomorrowDay = days.find(d => d.isTomorrow)
  const otherDays = days.filter(d => !d.isToday && !d.isTomorrow)

  const totalHighImpact = days.reduce((n, d) => n + d.events.filter(e => e.impact === 'high').length, 0)
  const todayHighImpact = todayDay?.events.filter(e => e.impact === 'high').length ?? 0

  // Header label — market-aware
  const headerLabel = marketStatus?.isWeekend
    ? 'WEEK AHEAD — ECONOMIC CALENDAR'
    : marketStatus?.isPreMarket
    ? "TODAY'S ECONOMIC CALENDAR"
    : marketStatus?.isMarketHours
    ? 'LIVE ECONOMIC CALENDAR'
    : "ECONOMIC CALENDAR"

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '16px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>📅</span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', fontWeight: '700', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
            {headerLabel}
          </span>
          {marketStatus && (
            <span style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '4px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: '600',
              background: marketStatus.isMarketHours ? 'var(--green-bg)' : marketStatus.isWeekend ? 'var(--surface)' : 'var(--yellow-bg)',
              color: marketStatus.isMarketHours ? 'var(--green)' : marketStatus.isWeekend ? 'var(--text-dim)' : 'var(--yellow)',
              border: `1px solid ${marketStatus.isMarketHours ? 'var(--green-border)' : marketStatus.isWeekend ? 'var(--border)' : 'var(--yellow-border)'}`,
            }}>
              {marketStatus.isMarketHours ? '● MARKET OPEN' : marketStatus.isWeekend ? '◌ WEEKEND' : marketStatus.isPreMarket ? '◐ PRE-MARKET' : '◌ AFTER HOURS'}
            </span>
          )}
          {totalHighImpact > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--red)', fontWeight: '600' }}>
              ⚠️ {totalHighImpact} high-impact event{totalHighImpact !== 1 ? 's' : ''} this week
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setExpanded(!expanded)}
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            {expanded ? 'Today only' : '📅 Full week'}
          </button>
          <button onClick={load} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>↻</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '16px 20px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px' }}>Loading calendar...</div>
      ) : (
        <div style={{ padding: '14px 20px' }}>
          {/* Today */}
          {todayDay && (
            <DaySection day={todayDay} badge="TODAY" badgeColor="var(--blue)" highlight />
          )}

          {/* Tomorrow */}
          {tomorrowDay && (
            <DaySection day={tomorrowDay} badge="TOMORROW" badgeColor="var(--text-secondary)" />
          )}

          {/* Rest of week — only when expanded */}
          {expanded && otherDays.map(day => (
            <DaySection key={day.date} day={day} />
          ))}

          {/* Weekend: no "today" — show Mon as first */}
          {marketStatus?.isWeekend && !todayDay && days.length > 0 && (
            days.map(day => <DaySection key={day.date} day={day} />)
          )}

          {/* Toggle rest of week */}
          {!expanded && otherDays.length > 0 && !marketStatus?.isWeekend && (
            <button
              onClick={() => setExpanded(true)}
              style={{ marginTop: '8px', background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: '12px', padding: 0, fontFamily: 'IBM Plex Mono, monospace' }}
            >
              + Show {otherDays.length} more day{otherDays.length !== 1 ? 's' : ''} this week →
            </button>
          )}

          {days.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace' }}>
              No USD events found for this week
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DaySection({ day, badge, badgeColor, highlight }: {
  day: CalendarDay; badge?: string; badgeColor?: string; highlight?: boolean
}) {
  const highImpact = day.events.filter(e => e.impact === 'high')
  const others = day.events.filter(e => e.impact !== 'high')

  return (
    <div style={{
      marginBottom: '14px',
      background: highlight ? 'var(--surface)' : 'transparent',
      border: highlight ? '1px solid var(--border)' : 'none',
      borderRadius: '8px',
      padding: highlight ? '10px 14px' : '0',
    }}>
      {/* Day header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
          {day.dateLabel}
        </span>
        {badge && (
          <span style={{ fontSize: '10px', fontWeight: '700', color: badgeColor, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.08em' }}>
            {badge}
          </span>
        )}
        {day.hasHighImpact && (
          <span style={{ fontSize: '10px', color: 'var(--red)', fontWeight: '600' }}>⚠️ High impact</span>
        )}
        {day.events.length === 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>No USD events</span>
        )}
      </div>

      {/* High impact first */}
      {highImpact.map((e, i) => <EventRow key={i} event={e} />)}

      {/* Others */}
      {others.map((e, i) => <EventRow key={i} event={e} />)}
    </div>
  )
}

function EventRow({ event }: { event: NewsEvent }) {
  const impactColor = event.impact === 'high' ? 'var(--red)' : event.impact === 'medium' ? 'var(--yellow)' : 'var(--text-dim)'
  const impactBg = event.impact === 'high' ? 'var(--red-bg)' : event.impact === 'medium' ? 'var(--yellow-bg)' : 'var(--surface)'
  const impactBorder = event.impact === 'high' ? 'var(--red-border)' : event.impact === 'medium' ? 'var(--yellow-border)' : 'var(--border)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      {/* Impact dot */}
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: impactColor, flexShrink: 0 }} />
      
      {/* Time */}
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)', width: '52px', flexShrink: 0 }}>
        {event.time}
      </span>

      {/* Title */}
      <span style={{ fontSize: '12px', color: event.impact === 'high' ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, fontWeight: event.impact === 'high' ? '600' : '400' }}>
        {event.title}
      </span>

      {/* Impact badge */}
      <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: impactBg, color: impactColor, border: `1px solid ${impactBorder}`, letterSpacing: '0.06em', flexShrink: 0 }}>
        {event.impact.toUpperCase()}
      </span>

      {/* Forecast / Previous */}
      {(event.forecast || event.previous) && (
        <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0, minWidth: '80px', textAlign: 'right' }}>
          {event.forecast ? `F: ${event.forecast}` : ''}{event.forecast && event.previous ? ' ' : ''}{event.previous ? `P: ${event.previous}` : ''}
        </span>
      )}
    </div>
  )
}
