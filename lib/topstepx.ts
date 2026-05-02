// ─── TOPSTEPX READ-ONLY API SCAFFOLD ─────────────────────────────────────────
// ⚠️  NOT ACTIVATED — Scaffold ready for when API credentials are provided
// ⚠️  ORDER EXECUTION IS PERMANENTLY DISABLED
// ⚠️  This provider is READ-ONLY: account status, P&L, positions, orders only

export interface BrokerProvider {
  getAccountStatus(): Promise<AccountStatus>
  getDailyPnL(): Promise<DailyPnL>
  getOpenPositions(): Promise<Position[]>
  getOrders(): Promise<Order[]>
  getExecutions(): Promise<Execution[]>
}

export interface AccountStatus {
  accountId: string
  balance: number
  equity: number
  dailyPnl: number
  trailingDrawdown: number
  maxDailyLoss: number
  profitTarget: number
  status: 'active' | 'breach' | 'funded'
}

export interface DailyPnL {
  date: string
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
}

export interface Position {
  symbol: string
  direction: 'LONG' | 'SHORT'
  contracts: number
  entryPrice: number
  currentPrice: number
  unrealizedPnl: number
}

export interface Order {
  orderId: string
  symbol: string
  direction: 'BUY' | 'SELL'
  contracts: number
  type: string
  status: string
  price?: number
}

export interface Execution {
  executionId: string
  orderId: string
  symbol: string
  direction: 'BUY' | 'SELL'
  contracts: number
  price: number
  timestamp: string
}

// ─── TOPSTEPX PROVIDER IMPLEMENTATION ────────────────────────────────────────
// Placeholder — implement when official API docs are provided

export class TopstepXProvider implements BrokerProvider {
  private apiKey: string
  private accountId: string
  private baseUrl: string
  private enabled: boolean

  constructor() {
    this.apiKey = process.env.TOPSTEPX_API_KEY ?? ''
    this.accountId = process.env.TOPSTEPX_ACCOUNT_ID ?? ''
    this.baseUrl = process.env.TOPSTEPX_BASE_URL ?? 'https://api.topstepx.com'
    // Only activate if explicitly enabled AND credentials are present
    this.enabled = Boolean(
      this.apiKey &&
      this.accountId &&
      process.env.ENABLE_ORDER_EXECUTION !== 'true' // always read-only
    )
  }

  private notReady(): never {
    throw new Error(
      'TopstepX API not configured. Add TOPSTEPX_API_KEY and TOPSTEPX_ACCOUNT_ID to your .env file.'
    )
  }

  async getAccountStatus(): Promise<AccountStatus> {
    if (!this.enabled) this.notReady()
    // TODO: Implement when API docs are provided
    // GET ${this.baseUrl}/v1/account/${this.accountId}
    throw new Error('TopstepX API: getAccountStatus not yet implemented')
  }

  async getDailyPnL(): Promise<DailyPnL> {
    if (!this.enabled) this.notReady()
    // TODO: Implement when API docs are provided
    // GET ${this.baseUrl}/v1/account/${this.accountId}/daily-pnl
    throw new Error('TopstepX API: getDailyPnL not yet implemented')
  }

  async getOpenPositions(): Promise<Position[]> {
    if (!this.enabled) this.notReady()
    // TODO: Implement when API docs are provided
    // GET ${this.baseUrl}/v1/account/${this.accountId}/positions
    throw new Error('TopstepX API: getOpenPositions not yet implemented')
  }

  async getOrders(): Promise<Order[]> {
    if (!this.enabled) this.notReady()
    // TODO: Implement when API docs are provided
    // GET ${this.baseUrl}/v1/account/${this.accountId}/orders
    throw new Error('TopstepX API: getOrders not yet implemented')
  }

  async getExecutions(): Promise<Execution[]> {
    if (!this.enabled) this.notReady()
    // TODO: Implement when API docs are provided
    // GET ${this.baseUrl}/v1/account/${this.accountId}/executions
    throw new Error('TopstepX API: getExecutions not yet implemented')
  }

  // ─── ORDER EXECUTION — PERMANENTLY DISABLED ──────────────────────────────
  // These methods intentionally throw errors and will never be implemented

  placeOrder(): never {
    throw new Error('⛔ ORDER EXECUTION IS DISABLED. This app is read-only.')
  }

  cancelOrder(): never {
    throw new Error('⛔ ORDER EXECUTION IS DISABLED. This app is read-only.')
  }

  modifyOrder(): never {
    throw new Error('⛔ ORDER EXECUTION IS DISABLED. This app is read-only.')
  }
}

export const topstepx = new TopstepXProvider()
