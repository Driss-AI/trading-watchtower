# Watchtower — NQ tile live-streaming fix

Three files to replace. They map 1-for-1 onto your existing repo paths.

```
lib/topstepx-ws.ts                    ← REPLACE
app/api/topstepx/stream/route.ts      ← REPLACE
components/MorningBriefing.tsx        ← REPLACE
```

No dependency changes. No env var changes. No DB changes.

---

## What was wrong

### 1. `GatewayQuote` handler had the wrong arg signature

Per ProjectX docs, market hub events take **two** arguments `(contractId, payload)`,
not one like the user hub events. Your handler was binding it as a single arg, so
`data` was actually the contract ID string and the real quote payload was being
discarded silently.

```ts
// Was:
hub.on('GatewayQuote', (data: WSQuote) => { broadcast({ type: 'quote', data }) })

// Now:
hub.on('GatewayQuote', (contractId: string, raw: any) => {
  const data = toWSQuote(contractId, raw)
  _lastQuote.set(contractId, data)
  broadcast({ type: 'quote', data })
})
```

### 2. `WSQuote` field names didn't match the server payload

ProjectX sends `lastPrice / bestBid / bestAsk / changePercent / high / low`.
Your interface used `price / bid / ask / changePct / sessionHigh / sessionLow`.
Even with the arg signature fixed, every field on the consumer side would have
been `undefined`.

The new `toWSQuote()` mapper translates the raw payload into your existing
`WSQuote` shape, so no other code in the repo needs to change.

### 3. `MorningBriefing` never refreshed and didn't consume the market hub

The briefing fetches `/api/market-data` once on mount and stops. The Market Hub
SSE endpoint existed but no component opened a connection to it. Result: the NQ
tile was a snapshot from page-load time, slowly drifting from the actual price
all session.

Now the component:

- **Opens an EventSource** to `/api/topstepx/stream?hub=market&symbol=MNQ` on
  mount, layers the live tick over `briefing.nq` for the NQ tile only.
- **Polls `/api/market-data` every 30s** so VIX, QQQ, and account stay fresh.
  (These are macro tiles where 30s lag is fine — you don't need tick-level on
  VIX.)
- **Falls back gracefully**: if the stream drops, the briefing snapshot still
  renders. If the briefing fetch fails, the live tick still updates the NQ tile.
- **Adds `?cache: 'no-store'`** to the fetches so the browser doesn't cache the
  briefing response.
- **Shows an `● NQ LIVE` indicator** in the header when the stream is healthy.

---

## Bonus: the stream route is also better now

`app/api/topstepx/stream/route.ts` gained two improvements:

1. Accepts `?symbol=NQ|MNQ` and resolves to a contract ID server-side, so the
   frontend never needs to know about contract roll. (`?contractId=` still works.)
2. **Filters market quotes by contractId** so a client that subscribed to MNQ
   doesn't receive quotes for ES if some other client subscribed to that
   simultaneously. Each client now only gets what it asked for.
3. **Replays the last known quote on connect** so a freshly-mounted component
   gets a value immediately instead of waiting for the next tick.

---

## After deploy — verify in this order

1. **Logs**: `[TopstepX WS] Subscribed to quotes: CON.F.US.MNQ.M26` should appear
   shortly after the dashboard is opened.
2. **DevTools → Network**: `/api/topstepx/stream?hub=market&symbol=MNQ` should
   show as an EventSource with steady `data: {"type":"quote",...}` messages.
3. **Visually**: the `● NQ LIVE` indicator next to "MORNING PRE-SESSION BRIEFING"
   should turn green within 1–2 seconds of page load. The NQ tile price should
   tick along with TopStep's chart.
4. **`/api/topstepx/verify`** should still report 9/9 passes.

If the indicator stays grey:

- Check that your account has live data permission (sim accounts on the eval
  may need different routing — but the SignalR hub itself accepts your token).
- Check the Network tab for an EventSource that errors out — message will tell
  you whether it's auth, market hub down, or contract resolution.

---

## What this does NOT change

- Yahoo-sourced VIX/QQQ/DXY/US10Y — still cached 5 min on the server side.
  If you want those tighter, lower `revalidate: 300` in `lib/market-data.ts`
  to e.g. `60`. Keep an eye on Yahoo rate-limiting if you go below ~30s.
- `fetchNQ()` REST fallback path — still uses bars when streaming isn't open.
  Useful for SSR / server-side scoring where you don't have a live SSE client.
- The `LiveStats` and `LivePosition` components — they were already correctly
  wired to the user hub. Untouched.
