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

  // Auto-stick to the newest message (manual scroll-up is unaffected between turns)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  function newChat() {
    setMessages([])
    setError(null)
    setInput('')
  }
  function minimize() { setOpen(false) }            // hide, KEEP conversation
  function close() { setOpen(false); newChat() }    // hide AND reset

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

  const headerBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-secondary)', fontFamily: MONO, cursor: 'pointer',
    height: 28, lineHeight: 1, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', transition: 'all 0.15s',
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
          <span style={{ fontSize: 15 }}>🧠</span>
          {messages.length > 0 ? 'Resume Brain' : 'Ask the Brain'}
          {messages.length > 0 && (
            <span style={{ background: '#060607', color: 'var(--cyan)', borderRadius: 999, fontSize: 10, padding: '1px 7px', fontWeight: 700 }}>
              {messages.filter(m => m.role === 'user').length}
            </span>
          )}
        </button>
      )}

      {/* ── Drawer ── */}
      {open && (
        <div
          style={{
            // top:90 clears the sticky navbar (~89.5px, z:100) so the drawer
            // header (title + NEW/–/✕ controls) isn't occluded by it. top+bottom
            // define the height, so no explicit height needed.
            position: 'fixed', top: 90, right: 0, bottom: 0, zIndex: 8001,
            width: 'min(440px, 100vw)',
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
            boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* accent stripe */}
          <div style={{ height: 2, background: 'linear-gradient(90deg, var(--cyan), transparent 80%)', flexShrink: 0 }} />

          {/* header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
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

            {/* New chat */}
            <button onClick={newChat} title="Start a new chat" disabled={messages.length === 0 && !error}
              style={{ ...headerBtn, padding: '0 9px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', opacity: messages.length === 0 && !error ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!(messages.length === 0 && !error)) { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.color = 'var(--cyan)' } }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
              + NEW
            </button>
            {/* Minimize (keep conversation) */}
            <button onClick={minimize} title="Minimize (keep chat)"
              style={{ ...headerBtn, width: 28, fontSize: 16 }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-bright)'; e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
              –
            </button>
            {/* Close (end + reset) */}
            <button onClick={close} title="Close (end chat)"
              style={{ ...headerBtn, width: 28, fontSize: 13 }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--red-border)'; e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
              ✕
            </button>
          </div>

          {/* messages — minHeight:0 lets this flex child actually scroll */}
          <div ref={scrollRef} style={{
            flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
            padding: '14px', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
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
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', flexShrink: 0 }}>
                <div style={{
                  maxWidth: '88%', padding: '9px 12px', borderRadius: 4,
                  fontFamily: MONO, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: 'var(--text-primary)',
                  background: m.role === 'user' ? 'var(--surface)' : 'var(--card)',
                  border: m.role === 'user' ? '1px solid var(--border)' : '1px solid rgba(0,212,232,0.28)',
                  borderLeft: m.role === 'assistant' ? '2px solid var(--cyan)' : undefined,
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', flexShrink: 0 }}>
                <div style={{ padding: '9px 12px', borderRadius: 4, borderLeft: '2px solid var(--cyan)', background: 'var(--card)', fontFamily: MONO, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span className="blink">▋</span> reading the tape…
                </div>
              </div>
            )}

            {error && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 4, padding: '8px 12px', flexShrink: 0 }}>
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
