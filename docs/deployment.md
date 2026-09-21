# Deploying ee.io

> **This guide describes a demo deployment, not a production launch.**
> Read [Before you take real money](#before-you-take-real-money) first — there
> are things the current code does not do that you would need before any real
> user sends funds.

---

## How the pieces fit together

In development there are two processes; in production there is one.

```
DEVELOPMENT                             PRODUCTION
┌──────────────┐                        ┌────────────────────────────┐
│ Vite  :5173  │  browser loads here    │  Express  :8080            │
│  /api/*  ────┼──proxy──┐              │   GET  /          → dist/  │
└──────────────┘         ▼              │   GET  /assets/*  → dist/  │
┌──────────────┐  ┌──────────────┐      │   POST /api/quote → engine │
│ Express :8787│  │ Express :8787│      └────────────────────────────┘
└──────────────┘  └──────────────┘         one origin, no CORS
```

`server/index.ts` detects `dist/index.html` at boot. If it exists, the same
process serves the frontend; if not, it runs API-only and Vite owns the browser.
Nothing to configure — building is what flips the switch.

**Why a server at all, for a non-custodial app?** Three reasons, none of them
custody: API keys for 0x and 1inch must not ship in a browser bundle; several
aggregator APIs refuse direct browser calls (CORS); and rate limits are per-IP
(THORChain's quote endpoint allows 1 request/second). The server returns
transaction payloads — **your wallet signs and broadcasts them.** The server
holds no key that can move user funds.

---

## Run it locally

### Development — hot reload

```bash
npm install
npm run dev
```

Vite on <http://localhost:5173>, API on `:8787`. Edits reload instantly.

### Production — exactly what a server would run

```bash
npm run build     # typecheck + bundle → dist/
npm start         # one process on :8080, serving dist/ and /api
```

Open <http://localhost:8080>. Or do both in one step with `npm run serve`.

Verify it came up correctly:

```bash
curl -s localhost:8080/api/health | jq
curl -s localhost:8080/ | grep -o 'id="root"'
```

You should see this on boot — note the warnings, they are deliberate:

```
  ee.io quote server → http://0.0.0.0:8080
  fee policy: 50 bps float / 100 bps fixed, charged on output
  fee recipient (EVM): 0x8829C3516E8E67f5B6aC815F89a50aE68840a664
  ⚠  Using the placeholder fee address. Set EE_FEE_RECIPIENT_EVM before taking volume.
  ⚠  EE_THORNAME is unset — THORChain affiliate fees are disabled.
  live providers: kyberswap, paraswap, thorchain, openocean, jupiter
  serving built frontend from /app/dist
```

---

## Docker

```bash
docker build -t ee-io .
docker run -p 8080:8080 --env-file .env ee-io
```

The image is multi-stage: the build stage runs the typecheck, the bundle and
`npm ci` with full dev dependencies; the runtime stage carries production
dependencies only, drops to the non-root `node` user, and ships a
`HEALTHCHECK` that fails the container if `/api/health` stops answering.

---

## Where to host it

The app is a single Node process listening on one port, so anywhere that runs a
container works. What matters is the port binding and the env vars.

| Platform | Notes |
| --- | --- |
| **Fly.io / Railway / Render** | Point at the Dockerfile. Set `API_PORT` to the port the platform injects (usually `$PORT`). |
| **A VPS** | `docker run` behind nginx or Caddy for TLS. |
| **Vercel / Netlify** | Frontend-only hosts. The Express server needs rework into serverless functions, and per-IP rate limits behave badly across a function fleet. Not recommended as-is. |

Two rules that matter regardless of host:

1. **Bind to `0.0.0.0`, not `127.0.0.1`.** The server already does; do not
   "fix" it. A container bound to loopback is unreachable from outside.
2. **Terminate TLS in front.** The app speaks plain HTTP by design — let the
   platform or a reverse proxy handle certificates.

### Minimal nginx

```nginx
server {
    listen 443 ssl http2;
    server_name ee.io;

    ssl_certificate     /etc/letsencrypt/live/ee.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ee.io/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

---

## Configuration

Everything is environment variables — see `.env.example` for the annotated
list. The ones that decide whether the app earns anything:

| Variable | Without it |
| --- | --- |
| `EE_FEE_RECIPIENT_EVM` | Fees go to the placeholder address, not you |
| `EE_THORNAME` | THORChain affiliate fields are omitted; cross-chain swaps earn **zero** |
| `EE_FEE_RECIPIENT_SOLANA` | Solana routes are quoted but earn nothing |
| `ZEROX_API_KEY` | 0x is skipped entirely — it serves no anonymous traffic |
| `ONEINCH_API_KEY` | 1inch is skipped |

KyberSwap, ParaSwap, OpenOcean, Jupiter and THORChain all work with no key.

> **The fee address needs its correct EIP-55 checksum.** The literal from the
> original spec, `0x8829C3516E8e67F5B6Ac815F89A50aE68840A664`, has an
> **invalid** checksum — the correct casing is
> `0x8829C3516E8E67f5B6aC815F89a50aE68840a664`. Same bytes, but 0x and ParaSwap
> reject the malformed form. The server normalises it at load time, so this is
> handled; it is worth knowing if you paste the address elsewhere.

### Registering a THORName

Cross-chain swaps are the whole point of this app, and they earn nothing
without one. A THORName is also far shorter inside a memo than a raw `thor1…`
address — which matters, because Bitcoin's OP_RETURN caps the memo at 80 bytes.

See <https://dev.thorchain.org/affiliate-guide/thorname-guide.html>, then set
`EE_THORNAME=yourname`. You can confirm it took effect:

```bash
curl -s -X POST localhost:8080/api/plan \
  -H 'Content-Type: application/json' \
  -d '{"fromAssetId":"BTC.BITCOIN","toAssetId":"USDT.ETHEREUM",
       "sendAmount":"5000000",
       "destinationAddress":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
       "rateType":"float","aggregator":"thorchain"}' | jq -r .plan.transaction.memo
```

```
=:ETH.USDT-EC7:0xd8dA…6045:471e9/1/0:ee:50
                                      ^^ ^^
                                       │  └─ 50 bps
                                       └──── your THORName
```

If the last two fields are missing, `EE_THORNAME` is not set.

---

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR:
typecheck → 120 tests → build → **boot the real production server and hit it
with curl**. That last step matters: a bundle that builds but cannot start is
still broken, and only starting it catches that.

The test suite sets `EE_FORCE_SIMULATION=1`, so CI is hermetic — no network, no
API keys, identical results on every run.

---

## Before you take real money

The honest list. None of these are hypothetical.

**Quotes are simulated right now.** With no API keys the server answers from a
deterministic simulator and labels every route `SIMULATED` in the UI. Those
numbers are realistic but **not tradeable**. Worse, the adapters have never
been exercised against live endpoints — this environment has no outbound
network. They are written against the documented contracts, which is not the
same as being verified. Expect to debug real responses.

**The Execution Inspector refuses to broadcast simulated calldata**, which is
the correct behaviour — preview calldata shows where the fee and amount sit in
the call, but signing it would be meaningless. Add keys to get executable
calldata.

**Order tracking is in-memory** (`server/orders.ts`, capped at 500 entries) and
lost on restart. The state machine advances on block-time estimates, not on
observed confirmations. Real deployments need a database and a chain watcher.

**Fixed-rate quotes are not hedged.** A 10-minute price lock is a genuine
financial position. The window is enforced; the risk is not covered. If the
market moves against a locked quote, someone absorbs that — currently nobody.

**There is no rate limiting on the API.** THORChain allows 1 request/second per
IP and returns 503 beyond it; a handful of users will exhaust that shared
budget. Add per-IP limits and run your own THORNode before opening this up.

**No monitoring, no error tracking, no logging pipeline.** The server logs to
stdout and that is all.

---

## Troubleshooting

**Blank page, API works.** `dist/` is missing or stale. Run `npm run build`.
The boot log tells you which mode you are in — look for
`serving built frontend from …`.

**`/api/*` returns HTML instead of JSON.** The SPA fallback is shadowing the
API. The route regex `/^\/(?!api\/).*/` excludes `/api/`; if you add routes,
register them *before* the fallback.

**Users see a stale app after deploy.** `index.html` is served `no-store` and
hashed assets `immutable` — correct as shipped. A CDN in front may be
overriding it.

**Every route says SIMULATED.** Expected without API keys. Check
`/api/health` → `providers`.

**THORChain returns 503.** The public endpoint rate-limits at 1 req/s/IP. Set
`THORNODE_URL` to your own node.
