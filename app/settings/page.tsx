'use client'
import { useEffect, useState } from 'react'
import TopstepXStatus from '@/components/TopstepXStatus'

export default function SettingsPage() {
  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => setForm(d.settings))
  }, [])

  const set = (k: string, v: any) => {
    setSaved(false)
    setForm((f: any) => ({ ...f, [k]: v }))
  }

  async function save() {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const { settings } = await res.json()
    setForm(settings)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!form) return <div style={{ color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', padding: '40px' }}>Loading...</div>

  return (
    <div>
      <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)' }}>SETTINGS</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>TopStep 50K evaluation configuration</p>
        </div>
        <button onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Account */}
        <div className="card">
          <div style={st.title}>01 · ACCOUNT — TOPSTEP 50K</div>
          <Field label="Account Size ($)" value={form.accountSize} onChange={v => set('accountSize', parseFloat(v))} type="number" />
          <Field label="Daily Loss Limit ($)" value={form.dailyLossLimit} onChange={v => set('dailyLossLimit', parseFloat(v))} type="number" note="TopStep 50K = $1,000" />
          <Field label="Trailing Drawdown ($)" value={form.trailingDrawdown} onChange={v => set('trailingDrawdown', parseFloat(v))} type="number" note="TopStep 50K = $2,000" />
          <Field label="Profit Target ($)" value={form.profitTarget} onChange={v => set('profitTarget', parseFloat(v))} type="number" note="TopStep 50K = $3,000" />
        </div>

        {/* Risk Rules */}
        <div className="card">
          <div style={st.title}>02 · RISK RULES</div>
          <Field label="Max Trades Per Day" value={form.maxTradesPerDay} onChange={v => set('maxTradesPerDay', parseInt(v))} type="number" note="Recommended: 2" />
          <Field label="Max Losing Trades Per Day" value={form.maxLosingTradesPerDay} onChange={v => set('maxLosingTradesPerDay', parseInt(v))} type="number" note="Stop after N losses" />

          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>Enabled Markets</div>
            {[
              { key: 'mnqEnabled', label: 'MNQ (Micro Nasdaq · $2/pt) — RECOMMENDED' },
              { key: 'nqEnabled', label: 'NQ (E-mini Nasdaq · $20/pt) — Advanced only' },
            ].map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '400', textTransform: 'none', letterSpacing: 'normal' }}>
                <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} style={{ width: 'auto', accentColor: 'var(--green)' }} />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Telegram */}
        <div className="card">
          <div style={st.title}>03 · TELEGRAM ALERTS</div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Get ORB alerts and risk warnings on Telegram.{' '}
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>Create a bot at BotFather</a>
          </p>
          <Field label="Bot Token" value={form.telegramBotToken ?? ''} onChange={v => set('telegramBotToken', v)} placeholder="123456789:AAFxxxx..." secret />
          <Field label="Chat ID" value={form.telegramChatId ?? ''} onChange={v => set('telegramChatId', v)} placeholder="-1001234567890" />
        </div>

        {/* TradingView Webhook */}
        <div className="card">
          <div style={st.title}>04 · TRADINGVIEW WEBHOOK</div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Receive ORB breakout alerts from TradingView Pine Script. Set this secret in your TradingView alert message.
          </p>
          <Field label="Webhook Secret" value={form.tradingViewWebhookSecret ?? ''} onChange={v => set('tradingViewWebhookSecret', v)} placeholder="your-secret-key" secret />
          <div style={{ marginTop: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 14px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: '600', marginBottom: '6px' }}>WEBHOOK URL</div>
            <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--blue)' }}>
              https://your-app.railway.app/api/webhooks/tradingview
            </code>
          </div>
        </div>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '16px' }}>05 · TOPSTEPX API — INTEGRATION</div>
          <TopstepXStatus />
          <div style={{ marginTop: '16px', padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: '6px', fontSize: '12px', color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>
            ⛔ ORDER EXECUTION IS PERMANENTLY DISABLED — this app never places or cancels trades
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', note, placeholder, secret }: {
  label: string; value: any; onChange: (v: string) => void; type?: string; note?: string; placeholder?: string; secret?: boolean
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label>{label}</label>
      <input
        type={secret ? 'password' : type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        step={type === 'number' ? '1' : undefined}
      />
      {note && <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>{note}</div>}
    </div>
  )
}

const st = {
  title: {
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.12em',
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    marginBottom: '16px',
  } as React.CSSProperties,
}
