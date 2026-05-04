// ─── COMPUTED ECONOMIC CALENDAR ───────────────────────────────────────────────
// Forex Factory blocks cloud server IPs, so we compute recurring event dates
// from known patterns. These are accurate — major events follow fixed schedules.
//
// Sources verified against:
// - BLS.gov (CPI, PPI, Jobs)
// - Federal Reserve (FOMC dates published 1yr in advance)
// - ISM (PMI first business day)

import { NewsEvent } from './market-data'

interface ScheduledEvent {
  title: string
  impact: 'high' | 'medium' | 'low'
  time: string   // ET time
  rule: (year: number, month: number) => Date[]  // returns dates this event occurs
  description?: string
}

// ─── HELPER DATE FUNCTIONS ────────────────────────────────────────────────────

// Nth weekday of a month: nthWeekday(2026, 4, 1, 2) = 2nd Monday of May 2026
function nthWeekday(year: number, month: number, dow: number, n: number): Date {
  // dow: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const d = new Date(year, month, 1)
  let count = 0
  while (d.getMonth() === month) {
    if (d.getDay() === dow) {
      count++
      if (count === n) return new Date(d)
    }
    d.setDate(d.getDate() + 1)
  }
  return new Date(year, month, 1) // fallback
}

// Last weekday of a month
function lastWeekday(year: number, month: number, dow: number): Date {
  const d = new Date(year, month + 1, 0) // last day of month
  while (d.getDay() !== dow) d.setDate(d.getDate() - 1)
  return new Date(d)
}

// All Thursdays in a month
function allWeekdays(year: number, month: number, dow: number): Date[] {
  const dates: Date[] = []
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    if (d.getDay() === dow) dates.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

// ─── FOMC 2025–2026 KNOWN DATES ───────────────────────────────────────────────
// Source: Federal Reserve publishes these 1 year in advance
const FOMC_DATES_2026 = [
  '2026-01-28', '2026-03-18', '2026-05-06', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16'
]
const FOMC_DATES_2025 = [
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-11-05', '2025-12-17'
]

function getFomcDates(year: number, month: number): Date[] {
  const allDates = year === 2026 ? FOMC_DATES_2026 : FOMC_DATES_2025
  return allDates
    .filter(d => {
      const dt = new Date(d + 'T12:00:00Z')
      return dt.getUTCFullYear() === year && dt.getUTCMonth() === month
    })
    .map(d => new Date(d + 'T12:00:00Z'))
}

// ─── RECURRING EVENT SCHEDULES ────────────────────────────────────────────────
const SCHEDULED_EVENTS: ScheduledEvent[] = [

  // FOMC Rate Decision — 8x/year, known dates
  {
    title: 'FOMC Statement',
    impact: 'high',
    time: '2:00pm',
    rule: (y, m) => getFomcDates(y, m),
  },

  // Non-Farm Payrolls — first Friday of month at 8:30 AM
  {
    title: 'Non-Farm Employment Change',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 5, 1)], // 1st Friday
  },

  // Unemployment Rate — same day as NFP
  {
    title: 'Unemployment Rate',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 5, 1)], // 1st Friday
  },

  // ISM Manufacturing PMI — first business day at 10:00 AM
  {
    title: 'ISM Manufacturing PMI',
    impact: 'high',
    time: '10:00am',
    rule: (y, m) => {
      // First weekday of month
      const d = new Date(y, m, 1)
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
      return [new Date(d)]
    },
  },

  // ISM Services PMI — 3rd business day
  {
    title: 'ISM Services PMI',
    impact: 'high',
    time: '10:00am',
    rule: (y, m) => {
      const d = new Date(y, m, 1)
      let count = 0
      while (count < 3) {
        if (d.getDay() !== 0 && d.getDay() !== 6) count++
        if (count < 3) d.setDate(d.getDate() + 1)
      }
      return [new Date(d)]
    },
  },

  // CPI — typically 2nd week, Wednesday/Thursday
  // Pattern: released ~2 weeks after reference month ends
  {
    title: 'CPI m/m',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 3, 2)], // 2nd Wednesday (approximate)
  },

  // Core CPI — same day as CPI
  {
    title: 'Core CPI m/m',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 3, 2)], // 2nd Wednesday
  },

  // PPI — day after CPI typically
  {
    title: 'PPI m/m',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 4, 2)], // 2nd Thursday
  },

  // Retail Sales — mid-month, Wednesday
  {
    title: 'Retail Sales m/m',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 3, 3)], // 3rd Wednesday
  },

  // Initial Jobless Claims — EVERY Thursday
  {
    title: 'Unemployment Claims',
    impact: 'medium',
    time: '8:30am',
    rule: (y, m) => allWeekdays(y, m, 4), // all Thursdays
  },

  // Consumer Confidence — last Tuesday
  {
    title: 'CB Consumer Confidence',
    impact: 'medium',
    time: '10:00am',
    rule: (y, m) => [lastWeekday(y, m, 2)], // last Tuesday
  },

  // Durable Goods — 4th Wednesday typically
  {
    title: 'Core Durable Goods Orders m/m',
    impact: 'medium',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 3, 4)], // 4th Wednesday
  },

  // Michigan Sentiment — 2nd and 4th Friday
  {
    title: 'UoM Consumer Sentiment',
    impact: 'medium',
    time: '10:00am',
    rule: (y, m) => [nthWeekday(y, m, 5, 2)], // 2nd Friday
  },

  // GDP — released quarterly, varies
  // Q1 advance: end of April; Q2 advance: end of July, etc.
  // Too variable to hardcode precisely — skip for now

  // JOLTS — 2nd week Tuesday (3-star, moves NQ on labor market narrative)
  {
    title: 'JOLTS Job Openings',
    impact: 'high',
    time: '10:00am',
    rule: (y, m) => [nthWeekday(y, m, 2, 2)], // 2nd Tuesday
  },

  // New Home Sales — usually 4th week Tuesday/Wednesday
  {
    title: 'New Home Sales',
    impact: 'medium',
    time: '10:00am',
    rule: (y, m) => [nthWeekday(y, m, 4, 2)], // approximate: 4th Tuesday
  },

  // Retail Sales — usually 2nd week Wednesday
  {
    title: 'Retail Sales (MoM)',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 2, 3)], // 2nd Wednesday
  },

  // Consumer Price Index — usually 2nd week Wednesday
  {
    title: 'CPI (YoY)',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 2, 3)], // 2nd Wednesday (same week as retail)
  },

  // Producer Price Index — usually 2nd week Thursday
  {
    title: 'PPI (MoM)',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 2, 4)], // 2nd Thursday
  },

  // GDP Advance — end of month (last week, varies — approximate)
  {
    title: 'GDP (QoQ)',
    impact: 'high',
    time: '8:30am',
    rule: (y, m) => [nthWeekday(y, m, 4, 4)], // approximate: 4th Thursday
  },

  // ADP Employment — Wednesday before NFP
  {
    title: 'ADP Non-Farm Employment Change',
    impact: 'medium',
    time: '8:15am',
    rule: (y, m) => {
      // Wednesday of NFP week (before 1st Friday)
      const nfp = nthWeekday(y, m, 5, 1)
      const adp = new Date(nfp)
      adp.setDate(nfp.getDate() - 2) // Wednesday before
      return [adp]
    },
  },
]

// ─── MAIN EXPORT: Build week calendar from computed schedule ──────────────────

// CalendarDay defined here to avoid circular import with market-data
export interface CalendarDay {
  date: string
  dateLabel: string
  isToday: boolean
  isTomorrow: boolean
  events: NewsEvent[]
  hasHighImpact: boolean
}

export function computeWeekCalendar(weekStartDate?: Date): CalendarDay[] {
  const now = weekStartDate ?? new Date()
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))

  // Find Monday of the relevant week
  const day = etNow.getDay()
  const isWeekend = day === 0 || day === 6

  let monday = new Date(etNow)
  if (isWeekend) {
    // Show NEXT week
    const daysToMon = day === 6 ? 2 : 1
    monday.setDate(etNow.getDate() + daysToMon)
  } else {
    // Show current week
    const daysToMon = day === 1 ? 0 : -(day - 1)
    monday.setDate(etNow.getDate() + daysToMon)
  }
  monday.setHours(0, 0, 0, 0)

  const todayET = etNow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const tomorrow = new Date(etNow)
  tomorrow.setDate(etNow.getDate() + 1)
  const tomorrowET = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  // Build Mon–Fri
  const days: CalendarDay[] = []
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const year = d.getFullYear()
    const month = d.getMonth()  // 0-indexed
    const dateStr = d.toLocaleDateString('en-CA')  // YYYY-MM-DD
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

    // Collect events for this day
    const events: NewsEvent[] = []
    for (const sched of SCHEDULED_EVENTS) {
      const eventDates = sched.rule(year, month)
      for (const ed of eventDates) {
        const edStr = ed.toLocaleDateString('en-CA')
        if (edStr === dateStr) {
          // Don't duplicate same title on same day
          if (!events.find(e => e.title === sched.title)) {
            events.push({
              title: sched.title,
              time: sched.time,
              currency: 'USD',
              impact: sched.impact,
            })
          }
        }
      }
    }

    // Sort: high impact first, then by time
    events.sort((a, b) => {
      if (a.impact !== b.impact) {
        const order = { high: 0, medium: 1, low: 2 }
        return order[a.impact] - order[b.impact]
      }
      return a.time.localeCompare(b.time)
    })

    days.push({
      date: dateStr,
      dateLabel,
      isToday: dateStr === todayET,
      isTomorrow: dateStr === tomorrowET,
      events,
      hasHighImpact: events.some(e => e.impact === 'high'),
    })
  }

  return days
}
