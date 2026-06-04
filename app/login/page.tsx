'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'

const MONO = 'JetBrains Mono, monospace'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    setLoading(true)
    await signIn('google', { callbackUrl: '/' })
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      fontFamily: MONO,
    }}>
      {/* Scanlines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
      }} />
      {/* Subtle lime grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage:
          'linear-gradient(rgba(200,255,0,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(200,255,0,0.035) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      {/* Corner accents */}
      <div style={{ position: 'absolute', top: 24, left: 24, width: 40, height: 40, borderTop: '2px solid var(--lime-border)', borderLeft: '2px solid var(--lime-border)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: 24, right: 24, width: 40, height: 40, borderBottom: '2px solid var(--lime-border)', borderRight: '2px solid var(--lime-border)', pointerEvents: 'none' }} />

      {/* Login card */}
      <div style={{
        position: 'relative',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '48px 44px 40px',
        width: '100%',
        maxWidth: '400px',
        background: 'var(--card)',
        boxShadow: '0 0 80px rgba(200,255,0,0.05), 0 32px 64px rgba(0,0,0,0.6)',
        textAlign: 'center',
      }}>
        {/* top accent stripe */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--lime), transparent 80%)' }} />

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginBottom: 24 }}>
          <span className="syspulse" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green)' }} />
          <span style={{ color: 'var(--lime)', fontSize: 19, fontWeight: 700, letterSpacing: '0.05em', textShadow: '0 0 16px rgba(200,255,0,0.4)' }}>WATCHTOWER</span>
        </div>

        <div style={{ color: 'var(--text-dim)', fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 18 }}>
          NQ / MNQ · ORB DECISION OS
        </div>

        <h1 style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, margin: '0 0 6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Restricted Access
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 11, margin: '0 0 32px', lineHeight: 1.7, letterSpacing: '0.04em' }}>
          TopStep 50K Evaluation Terminal
        </p>

        {/* Divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--lime-border), transparent)', marginBottom: 28 }} />

        {/* Google Sign-in */}
        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: '100%',
            padding: '13px 20px',
            background: 'var(--lime)',
            color: '#060607',
            border: 'none',
            borderRadius: '4px',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: MONO,
            letterSpacing: '0.16em',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            transition: 'all 0.2s',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ background: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#4285F4', flexShrink: 0, fontFamily: 'Arial, sans-serif', letterSpacing: 0 }}>G</span>
          {loading ? 'CONNECTING…' : 'Sign in with Google'}
        </button>

        <p style={{ color: 'var(--text-dim)', fontSize: 9, margin: '20px 0 0', letterSpacing: '0.16em' }}>
          ▸ AUTHORIZED PERSONNEL ONLY
        </p>
      </div>
    </div>
  )
}
