# Backtest Runbook — proving the mechanical edge

**Goal:** answer one question before automating anything — *does the ORB mechanical
edge actually exist out-of-sample?*

This runs the **degraded gate set**: the same `evaluateSignal()` paper/live use, but
with the order-flow gate disabled (not replayable from history) and the AI skipped.
So it measures the **pure mechanical edge** — ORB structure + candle pattern + volume
+ risk math, nothing else. If this has no edge, no amount of AI/order-flow polish on
top is trustworthy yet.

Endpoints (both behind login):
- `POST /api/backtest/run` — load history → replay → metrics → persist
- `GET  /api/backtest` — list past runs

---

## Prerequisites

1. **TopStepX creds must be live** in Railway env (`TOPSTEPX_USERNAME`, `TOPSTEPX_API_KEY`).
   The backtest pulls 1-min MNQ bars via the History API (`live=false`, the sim/combine
   feed). With no creds the run returns `503 TopStepX not configured`.
2. **You must be logged in.** The route is behind NextAuth middleware, so a plain `curl`
   gets the login wall. Easiest path: run the `fetch()` below from the **browser devtools
   console** while logged into the dashboard — it reuses your session cookie automatically.

---

## Step 1 — a smoke run (1 week, no persistence)

Confirms creds + data flow before committing a long run. `persist:false` skips writing
rows, so it's a throwaway.

Open the deployed site, log in, open devtools console (F12 → Console), paste:

```js
await fetch('/api/backtest/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'smoke 1wk',
    startDate: '2026-05-26',   // a recent Mon
    endDate:   '2026-05-30',   // that Fri
    persist: false
  })
}).then(r => r.json()).then(console.log)
```

Expect `{ runId: null, sessionsLoaded: ~5, metrics: {...}, config: {...} }`.
- `sessionsLoaded` should ≈ the number of weekdays (holidays drop out).
- If `sessionsLoaded: 0` → creds/data problem, not a strategy result. Stop and check env.

---

## Step 2 — the real run (several months, persisted)

```js
await fetch('/api/backtest/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'MNQ 6mo degraded-v1',
    startDate: '2025-12-01',
    endDate:   '2026-05-31'
    // persist defaults to true → writes a BacktestRun + per-signal rows (source:'backtest')
  })
}).then(r => r.json()).then(console.log)
```

Notes:
- **Range cap is 200 days.** For a full year, run two halves and compare.
- This can take a while (one API call per trading day, sequential). The route allows up
  to 300s. If it times out, split the range smaller.
- Defaults baked in: 15-min OR (09:30–09:45 ET), 3pt buffer, 1.5× target, 0.5pt slippage,
  $1.34/RT fees, 33% out-of-sample holdout. Override any via a `config` object in the body
  (e.g. `config: { targetMultiple: 2, slippagePoints: 1 }`).

---

## Step 3 — read the result (this is the whole point)

The response `metrics` has three blocks: `all`, `inSample`, `outOfSample`, plus `splitDate`.
**`inSample` is the first ~2/3 of dates; `outOfSample` is the held-out last ~1/3.**

### Look at `outOfSample` FIRST. In-sample is the data the strategy "saw"; OOS is the honest test.

Per block:
| Field | What it means | Healthy-ish |
|---|---|---|
| `expectancyR` | avg R per trade (net of fees+slippage) | **> 0** is the bar; > 0.15 is interesting |
| `winRate` | fraction of trades that won (0..1) | context-dependent — high target multiple → lower win rate is fine |
| `profitFactor` | gross win R ÷ gross loss R | > 1 = profitable; > 1.3 meaningful (`Infinity` = no losers, usually too-small sample) |
| `maxDrawdownR` | worst peak-to-trough on the R curve | compare to `totalR` — DD > total = a rough ride |
| `maxLosingStreak` | consecutive losers | gut-check vs your psychology |
| `totalTrades` | takes only (not skips) | **< ~30 OOS = don't trust any of it** (sample too small) |
| `totalSignals` | takes + skips evaluated | shows how selective the gates were |

### The decision rule
- **OOS `expectancyR` ≤ 0** → no demonstrated edge. Do **not** progress toward automation.
  Iterate the strategy (target multiple, OR length, buffer) — but treat in-sample
  improvements with suspicion until OOS agrees.
- **OOS `expectancyR` > 0 AND OOS `totalTrades` ≥ ~30 AND in-sample and OOS roughly agree**
  → the mechanical base has a plausible edge. *Now* the order-flow gate + AI layer have
  something real to improve, and forward paper validation is worth the time.
- **In-sample great, OOS bad** → overfit. The "edge" is curve-fitting, not real.

⚠️ **Degraded-set caveat:** this is the mechanical edge *without* order flow. Live results
will differ — the order-flow veto removes some trades (hopefully bad ones). So treat this
as the **floor**: if the floor isn't profitable, the full system is unproven, not proven.

---

## Step 4 — review persisted runs

```js
await fetch('/api/backtest').then(r => r.json()).then(console.log)
```

Returns recent `BacktestRun` rows (headline metrics + `oosExpectancyR`, `oosTrades`,
`splitDate`, full `metricsJson`). Per-signal detail is in `SignalOpportunity` rows with
`source: 'backtest'` — these flow into the existing `/scoreboard` and `/opportunities`
views if you filter by source.

---

## If something breaks
- `503 ... TopStepX` → creds missing/expired in Railway env.
- `400 Range too large` → > 200 days; split it.
- `sessionsLoaded: 0` with creds present → History API returned no bars (wrong contract
  rollover window, or a date range with no trading days). Try a known-good recent week.
- Run hangs / 504 → range too long for one call; shrink it.
