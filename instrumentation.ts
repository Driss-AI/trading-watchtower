export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Auto-start the paper trading engine on server boot.
    // The module's top-level initAutoStart() runs on import.
    await import('./lib/paper-engine')
    console.log('[Instrumentation] Paper trading engine module loaded')
  }
}
