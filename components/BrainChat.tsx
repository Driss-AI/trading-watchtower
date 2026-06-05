'use client'
import { useEffect, useRef, useState } from 'react'

const MONO = 'JetBrains Mono, monospace'

interface Msg { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'What\'s your read right now?',
  'Read the last 30 candles for me',
  'Is the OR worth trading today?',
  'Where\'s the order flow leaning?',
]

export default function BrainChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return
    setError(null)
    setInput('')
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setLoading(true)
    try {
      const res = await fetch('/api/brain/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Brain unavailable')
      setMessages([...next, { role: 'assistant', content: data.reply }])
    } catch (e: any) {
      setError(e?.message || 'Brain unavailable right now.')
    } finally {
      setLoading(false)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* ── Launcher ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 8000,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 16px', borderRadius: 4, cursor: 'pointer',
            fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: '#060607',
            background: 'var(--cyan)', border: '1px solid var(--cyan)',
            boxShadow: '0 0 22px rgba(0,212,232,0.4), 0 6px 20px rgba(0,0,0,0.5)',
          }}
        >
          <span style={{ fontSize: 15 }}>🧠</span> Ask the Brain
        </button>
      )}

      {/* ── Drawer ── */}
      {open && (
        <div
          style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 8001,
            width: 'min(440px, 100vw)', display: 'flex', flexDirection: 'column',
            background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
            boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* accent stripe */}
          <div style={{ height: 2, background: 'linear-gradient(90deg, var(--cyan), transparent 80%)', flexShrink: 0 }} />

          {/* header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <span style={{ fontSize: 16 }}>🧠</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--cyan)' }}>WATCHTOWER BRAIN</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span className="syspulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
                <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', color: 'var(--text-dim)' }}>
                  LIVE CONTEXT · 100 BARS · OR · FLOW · MACRO
                </span>
              </div>
            </div>
            {messages.length > 0 && (
              <button onClick={() => { setMessages([]); setError(null) }} title="Clear"
                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontFamily: MONO, fontSize: 10, padding: '4px 8px', cursor: 'pointer', letterSpacing: '0.08em' }}>
                CLEAR
              </button>
            )}
            <button onClick={() => setOpen(false)} title="Close"
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontFamily: MONO, fontSize: 13, width: 28, height: 28, cursor: 'pointer', lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {/* messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ margin: 'auto 0', textAlign: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16 }}>
                  Ask the brain about the live setup.<br />It sees the current tape, OR, order flow,<br />macro, and today&apos;s signals.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}
                      style={{ fontFamily: MONO, fontSize: 11, textAlign: 'left', padding: '9px 12px', borderRadius: 4, cursor: 'pointer', color: 'var(--text-primary)', background: 'var(--card)', border: '1px solid var(--border)', transition: 'all 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.color = 'var(--cyan)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-primary)' }}>
                      ▸ {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '88%', padding: '9px 12px', borderRadius: 4,
                  fontFamily: MONO, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: 'var(--text-primary)',
                  background: m.role === 'user' ? 'var(--surface)' : 'var(--card)',
                  border: m.role === 'user' ? '1px solid var(--border)' : '1px solid var(--cyan-border, rgba(0,212,232,0.28))',
                  borderLeft: m.role === 'assistant' ? '2px solid var(--cyan)' : undefined,
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '9px 12px', borderRadius: 4, borderLeft: '2px solid var(--cyan)', background: 'var(--card)', fontFamily: MONO, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span className="blink">▋</span> reading the tape…
                </div>
              </div>
            )}

            {error && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 4, padding: '8px 12px' }}>
                {error}
              </div>
            )}
          </div>

          {/* input */}
          <div style={{ borderTop: '1px solid var(--border)', padding: 10, flexShrink: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask the brain…  (Enter to send)"
              rows={2}
              style={{ flex: 1, resize: 'none', fontFamily: MONO, fontSize: 12, lineHeight: 1.5, padding: '8px 10px' }}
            />
            <button onClick={() => send()} disabled={loading || !input.trim()}
              style={{
                flexShrink: 0, height: 38, padding: '0 16px', borderRadius: 4, cursor: loading || !input.trim() ? 'default' : 'pointer',
                fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: '#060607', background: 'var(--cyan)', border: '1px solid var(--cyan)',
                opacity: loading || !input.trim() ? 0.5 : 1,
              }}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
