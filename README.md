# Trading Watchtower

> NQ/MNQ ORB Risk Management System — TopStep 100K Evaluation

A semi-automated trading risk and decision system for Opening Range Breakout trading on NQ/MNQ futures during the New York session. Built for TopStep 100K evaluation accounts.

**What it does:**
- Scores your trade setups 0–100 before you enter
- Enforces daily loss limits and TopStep rules
- Logs and journals every trade
- Tracks your performance and edge over time
- Receives ORB breakout alerts from TradingView
- Ready for TopstepX read-only API (Phase 3)

**What it does NOT do:**
- It never places trades
- It never connects to TopStep to execute orders
- It does not scrape your account
- It does not store your TopStep password

---

## Stack

- **Frontend/Backend:** Next.js 14 (App Router)
- **Database:** PostgreSQL via Prisma ORM
- **Hosting:** Railway
- **Alerts:** Telegram
- **Webhooks:** TradingView Pine Script → POST endpoint

---

## Setup Instructions — Copy and Paste These Exactly

### Prerequisites

You need these installed on your computer:
- **Node.js 18+** — download at https://nodejs.org (choose "LTS")
- **Git** — download at https://git-scm.com
- **A GitHub account** — https://github.com

To check if you have them, open Terminal (Mac) or Command Prompt (Windows) and run:
```bash
node --version
git --version
```

---

### Step 1 — Get the code on your computer

```bash
# Go to your home folder
cd ~

# Clone the project
git clone https://github.com/YOUR-USERNAME/trading-watchtower.git

# Enter the project folder
cd trading-watchtower
```

*(You'll push this to GitHub in Step 4)*

---

### Step 2 — Install dependencies

```bash
npm install
```

This downloads all required packages. It takes 1–2 minutes.

---

### Step 3 — Set up local database (for testing on your computer)

**Option A — Use Railway for everything (easiest)**

Skip this step and go to Step 4. Railway gives you a free PostgreSQL database.

**Option B — Run locally first**

1. Install PostgreSQL from https://postgresql.org/download
2. Create a database:
```bash
# On Mac/Linux:
psql -U postgres -c "CREATE DATABASE trading_watchtower;"

# On Windows (in Command Prompt as admin):
psql -U postgres -c "CREATE DATABASE trading_watchtower;"
```

3. Copy the example environment file:
```bash
cp .env.example .env
```

4. Edit `.env` and set your database URL:
```
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/trading_watchtower"
```

5. Run database migrations and seed:
```bash
npm run db:push
npm run db:seed
```

6. Start the app locally:
```bash
npm run dev
```

7. Open http://localhost:3000 in your browser. You should see the dashboard.

---

### Step 4 — Push to GitHub

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# First commit
git commit -m "Initial Trading Watchtower setup"

# Create a repo on GitHub at https://github.com/new
# Name it: trading-watchtower
# Set to Private
# Do NOT initialize with README

# Add your GitHub repo as remote (replace YOUR-USERNAME)
git remote add origin https://github.com/YOUR-USERNAME/trading-watchtower.git

# Push
git push -u origin main
```

---

### Step 5 — Deploy to Railway

1. Go to https://railway.app and sign in with GitHub

2. Click **"New Project"**

3. Click **"Deploy from GitHub repo"**

4. Select your `trading-watchtower` repository

5. Railway will auto-detect it's a Next.js app. Click **"Deploy"**

6. **Add a PostgreSQL database:**
   - In your project dashboard, click **"+ New"**
   - Click **"Database"**
   - Click **"Add PostgreSQL"**
   - Railway automatically sets `DATABASE_URL` — you don't need to copy it

7. **Add environment variables:**
   - Click your app service (not the database)
   - Click **"Variables"** tab
   - Click **"+ New Variable"** and add each one:

```
TRADINGVIEW_WEBHOOK_SECRET = pick-any-random-string-like-watchtower-secret-2026
ENABLE_ORDER_EXECUTION = false
NODE_ENV = production
```

*(Telegram and TopstepX are optional — leave blank for now)*

8. Click **"Deploy"** (or it deploys automatically)

9. Wait 2–3 minutes. Click **"View Logs"** to watch it build.

10. When done, click the URL (looks like `https://trading-watchtower-production.up.railway.app`)

**You should see the Trading Watchtower dashboard.**

---

### Step 6 — First use

1. Go to **Settings** and verify your account rules (daily loss limit = $2,000 for TopStep 100K)

2. Every trading day, go to **Session** before market open and fill in:
   - Opening range (9:30–10:00 NY)
   - Market conditions (VIX, news, bias)
   - Hit **"Calculate Score"**

3. The dashboard will show you: **TRADE ALLOWED / CAUTION / NO TRADE**

4. After each trade, go to **Journal** and log it.

5. Check **Performance** weekly to track your edge.

---

### Optional: Telegram Alerts

1. Open Telegram and message `@BotFather`
2. Type `/newbot` and follow the prompts
3. Copy the token BotFather gives you
4. Message `@userinfobot` to get your Chat ID
5. In Railway Variables, add:
   ```
   TELEGRAM_BOT_TOKEN = your-token-here
   TELEGRAM_CHAT_ID = your-chat-id-here
   ```
6. Redeploy. You'll now get alerts when TradingView sends signals.

---

### Optional: TradingView Webhook (Phase 2)

When you're ready to receive ORB breakout alerts from TradingView:

1. In TradingView, create an alert on your ORB breakout condition
2. Set the alert message to:
```json
{
  "secret": "your-webhook-secret-from-settings",
  "symbol": "MNQ",
  "event": "ORB_BREAKOUT",
  "direction": "LONG",
  "price": {{close}},
  "or_high": 0,
  "or_low": 0,
  "timestamp": "{{time}}"
}
```
3. Set webhook URL to: `https://your-app.railway.app/api/webhooks/tradingview`

---

## Pages

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/` | Today's decision, P&L, status |
| Session | `/session` | Set up trade conditions & get score |
| Risk Calc | `/risk` | Calculate position risk before entering |
| Journal | `/journal` | Log and review all trades |
| Performance | `/performance` | Stats, win rate, edge analysis |
| Settings | `/settings` | Account rules, Telegram, TopstepX scaffold |

---

## Scoring Logic (0–100)

| Factor | Points |
|--------|--------|
| No high-impact news | +20 |
| OR size acceptable (30–200 pts) | +15 |
| Direction aligned with daily bias | +20 |
| VIX not extreme (< 30) | +10 |
| QQQ premarket aligned | +10 |
| US 10Y not against trade | +10 |
| DXY not against trade | +5 |
| Clean room to target | +10 |
| **High-impact news (penalty)** | -30 |
| **OR too wide (> 200 pts)** | -20 |
| **OR too narrow (< 30 pts)** | -10 |
| **VIX extreme penalty** | -20 |
| **Direction against bias** | -20 |
| **Already at max trades today** | BLOCKED |
| **Already at max losses today** | BLOCKED |
| **Daily loss limit hit** | BLOCKED |

**Decision:** ≥80 = Trade · 65–79 = Caution · <65 = No Trade

---

## TopStep 100K Rules (built in)

- Daily Loss Limit: $2,000 (configurable)
- Trailing Drawdown: $3,000
- Profit Target: $6,000
- Max Trades/Day: 2 (configurable)
- Consistency Rule: No day >40% of profit target
- No Weekend Holds: Close before Friday 4:15 PM EST

---

## Important Safety Notes

- `ENABLE_ORDER_EXECUTION` is always `false` — the app **never** places trades
- TopstepX API fields are scaffold only — not active until Phase 3
- Your TopStep username and password are never stored anywhere in this app

---

## File Structure

```
trading-watchtower/
├── app/                    # Next.js pages and API routes
│   ├── page.tsx            # Dashboard
│   ├── session/page.tsx    # Session setup + scoring
│   ├── risk/page.tsx       # Risk calculator
│   ├── journal/page.tsx    # Trade journal
│   ├── performance/page.tsx # Performance stats
│   ├── settings/page.tsx   # Settings
│   └── api/                # Backend API routes
├── components/             # Shared UI components
├── lib/                    # Core logic
│   ├── scoring.ts          # Trade quality scoring engine
│   ├── telegram.ts         # Telegram alert service
│   ├── topstepx.ts         # TopstepX read-only scaffold
│   └── prisma.ts           # Database client
├── prisma/
│   └── schema.prisma       # Database schema
├── .env.example            # Environment template
└── railway.json            # Railway deployment config
```

---

## Troubleshooting

**"Cannot find module '@prisma/client'"**
```bash
npm run db:generate
```

**"DATABASE_URL is not set"**
Make sure you added the PostgreSQL service in Railway and the `DATABASE_URL` variable exists.

**Railway build fails**
Check the build logs in Railway. Most common fix:
```bash
# Make sure you've committed all files
git add .
git commit -m "Fix"
git push
```

**App loads but shows blank data**
The database migration probably didn't run. In Railway, go to your service → Settings → and verify the start command is:
```
npx prisma migrate deploy && npm start
```

---

## Version

- v1.0.0 — Phase 1 MVP (Manual Mode)
- Phase 2 — TradingView webhook (ready, just enable)
- Phase 3 — TopstepX read-only API (scaffold ready)
- Phase 4 — Auto-journal from TopstepX executions

---

Built for Driss — TopStep 100K Trading Combine
