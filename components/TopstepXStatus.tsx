'use client'
import { useEffect, useState, useCallback } from 'react'

interface Check {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
  ms: number
  data?: Record<string, unknown>
}

interface VerifyResult {
  configured: boolean
  passed?: number
  failed?: number
  total?: number
  ready?: boolean
  checks?: Check[]
  summary?: string
  timestamp?: string
}

interface LiveEvent {
  type: string
  data?: Record<string, unknown>
  hub?: string
  message?: string
}

export default function TopstepXStatus() {
  const [result, setResult]       = useState<VerifyResult | null>(null)
  const [loading, setLoading]     = useState(false)
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [streaming, setStreaming] = useState(false)
  const [sseRef, setSseRef]       = useState<EventSource | null>(null)

  const runVerify = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/topstepx/verify')
      setResult(await r.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { runVerify() }, [runVerify])

  const startStream = () => {
    if (sseRef) { sseRef.close(); setSseRef(null); setStreaming(false); return }
    const es = new EventSource('/api/topstepx/stream?hub=user')
    es.onmessage = (e) => {
      try {
        const event: LiveEvent = JSON.parse(e.data)
        setLiveEvents((prev) => [event, ...prev].slice(0, 20))
      } catch {}
    }
    es.onerror = () => setStreaming(false)
    es.onopen  = () => setStreaming(true)
    setSseRef(es)
  }

  useEffect(() => () => { sseRef?.close() }, [sseRef])

  const statusColor = (s: 'pass' | 'fail' | 'skip') =>
    s === 'pass' ? 'var(--green)' : s === 'fail' ? 'var(--red)' : 'var(--text-dim)'

  const statusIcon = (s: 'pass' | 'fail' | 'skip') =>
    s === 'pass' ? '●' : s === 'fail' ? '●' : '○'

  if (!result) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px' }}>
        Checking TopstepX connection…
      </div>
    )
  }

  if (!result.configured) {
    return (
      <div className="card" style={{ borderColor: 'var(--yellow)', borderWidth: '1px', borderStyle: 'solid' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--yellow)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '12px' }}>
          TOPSTEPX — NOT CONFIGURED
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          Add these variables to Railway to activate the integration:
        </div>
        {[
          ['TOPSTEPX_USERNAME', 'Your TopstepX login email'],
          ['TOPSTEPX_API_KEY',  'Settings → API tab in TopstepX'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: '12px', marginBottom: '8px', alignItems: 'flex-start' }}>
            <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--green)', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>{k}</code>
            <span style={{ fontSize: '12px', color: 'var(--text-dim)', paddingTop: '2px' }}>{v}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header bar */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '4px' }}>
            TOPSTEPX API — INTEGRATION STATUS
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ color: result.ready ? 'var(--green)' : 'var(--red)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: '18px' }}>
              {result.ready ? '● CONNECTED' : '● ERRORS DETECTED'}
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
              {result.passed}/{result.total} checks passed
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={runVerify}
            disabled={loading}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', padding: '6px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            {loading ? 'Checking…' : '↻ Re-run'}
          </button>
          <button
            onClick={startStream}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', padding: '6px 14px', background: streaming ? 'var(--red)' : 'var(--green)', border: 'none', borderRadius: '6px', color: '#000', cursor: 'pointer', fontWeight: 600 }}
          >
            {streaming ? '■ Stop stream' : '▶ Test live stream'}
          </button>
        </div>
      </div>

      {/* Check results */}
      <div className="card">
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '16px' }}>
          INTEGRATION CHECKS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {result.checks?.map((check) => (
            <div key={check.name} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ color: statusColor(check.status), fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', minWidth: '12px', marginTop: '1px' }}>
                {statusIcon(check.status)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {check.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {check.ms}ms
                  </span>
                </div>
                {check.status === 'fail' && (
                  <div style={{ fontSize: '12px', color: 'var(--red)', marginTop: '2px', fontFamily: 'JetBrains Mono, monospace' }}>
                    {check.detail}
                  </div>
                )}
                {check.status === 'pass' && check.data && (
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', fontFamily: 'JetBrains Mono, monospace' }}>
                    {Object.entries(check.data)
                      .filter(([, v]) => v !== null && typeof v !== 'object')
                      .map(([k, v]) => `${k}: ${v}`)
                      .join('  ·  ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live stream panel */}
      {(streaming || liveEvents.length > 0) && (
        <div className="card">
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            LIVE EVENT STREAM — USER HUB
            {streaming && <span style={{ color: 'var(--green)', animation: 'pulse 1.5s infinite' }}>● LIVE</span>}
          </div>
          {liveEvents.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}>
              Waiting for events… (trades, account updates, position changes will appear here)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
              {liveEvents.map((ev, i) => (
                <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: '4px', borderLeft: `3px solid ${ev.type === 'trade' ? 'var(--green)' : ev.type === 'error' ? 'var(--red)' : 'var(--yellow)'}` }}>
                  <span style={{ color: 'var(--text-dim)' }}>[{ev.type.toUpperCase()}]</span>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {JSON.stringify(ev.data ?? { hub: ev.hub, msg: ev.message })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result.timestamp && (
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
          Last checked: {new Date(result.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
