export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Auto-start the paper trading engine on server boot.
    // The module's top-level initAutoStart() runs on import.
    await import('./lib/paper-engine')
    console.log('[Instrumentation] Paper trading engine module loaded')

    // Start the in-app market-alert scheduler (DST-aware, follows New York
    // time). Its top-level initMarketAlerts() runs on import.
    await import('./lib/market-alerts')
    console.log('[Instrumentation] Market alert scheduler module loaded')
  }
}
