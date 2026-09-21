# Aggregator integration reference

Field-by-field notes taken from each provider's public documentation, recording
the details that are easy to get wrong. Every claim here is reflected in the
corresponding adapter under `server/aggregators/`.

The recurring theme: **fee parameters are not interchangeable between venues.**
Some take basis points, some take a percentage; some skim the input, some the
output; one keeps a cut of your cut.

---

## 0x Swap API v2

- Docs: <https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap>
- Endpoints: `https://api.0x.org/swap/permit2/{price,quote}` and
  `/swap/allowance-holder/{price,quote}`
- Headers: `0x-api-key`, `0x-version: v2` — **both required**, no anonymous tier

### Fee parameters

| Parameter | Meaning |
| --- | --- |
| `swapFeeRecipient` | Address that receives the fee |
| `swapFeeBps` | Basis points, 0–1000 |
| `swapFeeToken` | Must equal either `buyToken` or `sellToken` |
| `tradeSurplusRecipient` | Optional; captures positive slippage |

### Gotchas

- **v1 parameter names were renamed in v2.** `takerAddress` → `taker`,
  `slippagePercentage` → `slippageBps`, and
  `feeRecipient`/`buyTokenFeePercentage` → `swapFeeRecipient`/`swapFeeBps`/
  `swapFeeToken`. Old tutorials silently produce unfee'd swaps.
- **Never hardcode the router address.** `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`
  is the legacy v1 Exchange Proxy. Always send to the returned
  `transaction.to`.
- `buyAmount` is already **net** of the integrator fee. Gross is
  `buyAmount + fees.integratorFee.amount`.
- Check `liquidityAvailable` before treating a 200 response as routable, and
  surface `issues` (allowance, balance) to the user.

---

## KyberSwap Aggregator

- Docs: <https://docs.kyberswap.com>
- Two-step: `GET /{chain}/api/v1/routes` → `POST /{chain}/api/v1/route/build`
- Header: `x-client-id` — **required**, but no API key needed

### Fee parameters

| Parameter | Meaning |
| --- | --- |
| `feeReceiver` | Address that receives the fee |
| `feeAmount` | Basis points when `isInBps=true`, else raw token units |
| `isInBps` | Interpret `feeAmount` as basis points |
| `chargeFeeBy` | `currency_in` or `currency_out`; **empty means no fee** |

### Gotchas

- **`routeSummary` must be forwarded to the build step verbatim.** It is an
  opaque signed structure; mutating any field invalidates the route.
- Chain identifiers are names, not numeric chain IDs: `ethereum`, `bsc`,
  `polygon`, `arbitrum`, `optimism`, `base`.
- `slippageTolerance` is in basis points (0–2000), not a percentage.
- Omitting `chargeFeeBy` silently disables fee collection — the swap succeeds
  and earns nothing.

---

## 1inch

- Docs: <https://business.1inch.com>, <https://portal.1inch.dev>
- Base URL migrated from `api.1inch.dev` to **`api.1inch.com`**
- `authKey` / API key required

### Classic Swap (REST v6.x)

| Parameter | Meaning |
| --- | --- |
| `referrer` | Address that receives the fee |
| `fee` | **Percentage**, max `3` — i.e. `0.5` means 0.5% |

**The `fee` parameter must be identical on `/quote` and `/swap`.** A mismatch
is rejected.

### Fusion / Cross-Chain SDK

```ts
integratorFee: { receiver: new Address('0x…'), value: new Bps(50n) }
```

Here the value *is* basis points. The response echoes
`IntegratorFeeResponse { receiver, value, share }`.

### Gotchas

- **Classic takes a percentage; Fusion takes basis points.** Passing `50` to
  Classic requests a 50% fee and is rejected.
- Other limits: `slippage` 0–50, `complexityLevel` ≤ 3, `parts` ≤ 100.

---

## OpenOcean

- Docs: <https://apis.openocean.finance/developer/apis/swap-api/api-v4>
- Endpoints: `https://open-api.openocean.finance/v4/{chainId}/{quote,swap}`
- Keyless public tier at **2 requests/second**

### Fee parameters

| Parameter | Meaning |
| --- | --- |
| `referrer` | Address that receives the fee |
| `referrerFee` | **Percentage**, 0.01–5 — `0.5` means 0.5% |

### Gotchas

- **The fee is taken from the input token**, before routing. The routed amount
  is `sellAmount − fee`. Treating the full `sellAmount` as routed overstates
  the output; this exact mistake made OpenOcean rank first for ETH→USDC during
  development. See `tests/quoteEngine.test.ts`.
- **OpenOcean retains 20% of the referral fee.** A 50 bps fee nets the operator
  40 bps. `OPENOCEAN_PLATFORM_SHARE_BPS = 2000` encodes this, and the UI shows
  gross and net separately.
- `slippage` is a percentage (0.05–50), and amounts use `amountDecimals`.

---

## ParaSwap / Velora v6.2

- Docs: <https://paraswap-network.gitbook.io>
- `GET https://api.paraswap.io/prices` → `POST /transactions/{chainId}`

### Fee parameters

| Parameter | Meaning |
| --- | --- |
| `partnerAddress` | Address that receives the fee |
| `partnerFeeBps` | Basis points, max **300** (Delta: 200) |
| `partner` | Attribution string |
| `isDirectFeeTransfer` | Pay directly, skipping the FeeClaimer contract |
| `takeSurplus` | Capture positive slippage |

### Gotchas

- `priceRoute` must be passed to the transaction step **unmodified**.
- `version: "6.2"` must be set explicitly in the transaction body.
- Without `isDirectFeeTransfer`, fees accumulate in the FeeClaimer and require
  a separate claim transaction.

---

## THORChain

- Docs: <https://dev.thorchain.org>
- `GET {thornode}/thorchain/quote/swap`
- No key. Public endpoint rate-limits at **1 request/second/IP** → HTTP 503.

### Fee parameters

`affiliate=<thorname|thor1…>` and `affiliate_bps=<0–1000>`, or encoded directly
into the memo:

```
=:ASSET:DESTADDR:LIM/INTERVAL/QUANTITY:AFFILIATE:BPS
```

### Gotchas

- **All amounts are 1e8**, regardless of the asset's native decimals. 1 ETH
  (18 dp) and 1 BTC (8 dp) are both `100000000` in a memo.
- **Field 4 is LIM — a *minimum* output that triggers a refund if unmet.** It
  is not "the amount the user receives". Putting the expected output there
  refunds the swap on any adverse price move.
- **Never cache `inbound_address`.** Vaults rotate; sending to a stale vault
  loses the funds.
- Memos are capped at 250 bytes, and at **80 bytes** on Bitcoin's OP_RETURN.
  `buildSwapMemoForChain()` falls back to the compact encoding automatically.
- Up to 5 affiliates (`a/b/c`), summing to ≤ 1000 bps.
- The affiliate fee is paid in RUNE (or the THORName's preferred asset) out of
  the `AffiliateCollector` module — not as a second outbound transfer.
- A fee too small to cover the outbound gas is **silently skipped**.

### Documentation error

The scientific-notation examples on `memo-length-reduction.html` contradict the
decoding rule stated on the same page. See the README section "A note on the
THORChain docs" — we follow the rule, not the examples.

---

## Jupiter (Solana)

- Docs: <https://dev.jup.ag/docs/swap-api/add-fees-to-swap>
- `GET https://api.jup.ag/swap/v1/quote` → `POST /swap`

### Fee parameters

| Parameter | Meaning |
| --- | --- |
| `platformFeeBps` | Basis points, on `/quote` |
| `feeAccount` | Token account, on `/swap` |

### Gotchas

- **Since January 2025 the Referral Program is no longer required.**
  `feeAccount` may be any valid token account for one of the mints in the pair.
- `lite-api.jup.ag` is deprecated as of **31 January 2026**.
- Set `restrictIntermediateTokens=true` to avoid routes through illiquid
  intermediate tokens.

---

## Summary: units by venue

The single most error-prone dimension.

| Venue | Fee unit | Side | Operator receives |
| --- | --- | --- | --- |
| 0x | basis points | either | 100% |
| KyberSwap | basis points (`isInBps`) | either | 100% |
| 1inch Classic | **percent** | input | 100% |
| 1inch Fusion | basis points | — | per `share` |
| OpenOcean | **percent** | **input** | **80%** |
| ParaSwap | basis points | output | 100% |
| THORChain | basis points | output | 100% |
| Jupiter | basis points | output | 100% |
