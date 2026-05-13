'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'

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
      background: 'linear-gradient(135deg, #060a06 0%, #0d1117 50%, #060a0f 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      {/* Subtle grid background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage:
          'linear-gradient(rgba(34,197,94,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.04) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        pointerEvents: 'none',
      }} />

      {/* Corner accent — top left */}
      <div style={{
        position: 'absolute', top: 24, left: 24,
        width: 40, height: 40,
        borderTop: '2px solid rgba(34,197,94,0.3)',
        borderLeft: '2px solid rgba(34,197,94,0.3)',
        pointerEvents: 'none',
      }} />
      {/* Corner accent — bottom right */}
      <div style={{
        position: 'absolute', bottom: 24, right: 24,
        width: 40, height: 40,
        borderBottom: '2px solid rgba(34,197,94,0.3)',
        borderRight: '2px solid rgba(34,197,94,0.3)',
        pointerEvents: 'none',
      }} />

      {/* Login card */}
      <div style={{
        position: 'relative',
        border: '1px solid rgba(34,197,94,0.2)',
        borderRadius: '12px',
        padding: '52px 44px 44px',
        width: '100%',
        maxWidth: '400px',
        background: 'rgba(10,17,10,0.96)',
        backdropFilter: 'blur(24px)',
        boxShadow:
          '0 0 80px rgba(34,197,94,0.06), 0 0 0 1px rgba(34,197,94,0.04), 0 32px 64px rgba(0,0,0,0.6)',
        textAlign: 'center',
      }}>
        {/* Icon */}
        <div style={{
          width: 52, height: 52,
          borderRadius: '10px',
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 28px',
          fontSize: 22,
        }}>📡</div>

        {/* Brand label */}
        <div style={{
          color: '#22c55e',
          fontSize: '10px',
          letterSpacing: '5px',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}>Trading Watchtower</div>

        <h1 style={{
          color: '#f0fdf4',
          fontSize: '20px',
          fontWeight: 700,
          margin: '0 0 8px',
          fontFamily: 'monospace',
          letterSpacing: '-0.3px',
        }}>Restricted Access</h1>

        <p style={{
          color: '#374151',
          fontSize: '12px',
          margin: '0 0 36px',
          fontFamily: 'monospace',
          lineHeight: 1.7,
        }}>
          TopStep 100K Evaluation<br />
          NQ / MNQ ORB Dashboard
        </p>

        {/* Divider */}
        <div style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(34,197,94,0.15), transparent)',
          marginBottom: 32,
        }} />

        {/* Google Sign-in button */}
        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: '100%',
            padding: '13px 20px',
            background: loading ? 'rgba(34,197,94,0.6)' : '#22c55e',
            color: '#000',
            border: 'none',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 800,
            fontFamily: 'monospace',
            letterSpacing: '2.5px',
            cursor: loading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            transition: 'all 0.2s',
            textTransform: 'uppercase',
          }}
        >
          {/* Google G badge */}
          <span style={{
            background: '#fff',
            borderRadius: '50%',
            width: 22, height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 900,
            color: '#4285F4',
            flexShrink: 0,
            fontFamily: 'Arial, sans-serif',
            letterSpacing: 0,
          }}>G</span>
          {loading ? 'Connecting...' : 'Sign in with Google'}
        </button>

        <p style={{
          color: '#1f2937',
          fontSize: '10px',
          margin: '20px 0 0',
          fontFamily: 'monospace',
          letterSpacing: '1px',
        }}>AUTHORIZED PERSONNEL ONLY</p>
      </div>
    </div>
  )
}
