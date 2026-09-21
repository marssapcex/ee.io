# ee.io — `e > f`

**Non-custodial instant swaps.** FixedFloat's interface, without the custody.

An instant-swap front end that keeps the familiar two-box UX — pick a pair, paste
an address, get coins — but removes the part that makes those services
dangerous: the exchange never holds your money. Funds move from your wallet
through a public DEX router to your destination inside a single transaction, and
the affiliate fee rides along as a parameter of that same call.

```
FixedFloat:  you → their hot wallet → (trust) → you
ee.io:       you → public DEX router → you          (fee is a call parameter)
```

---

## Why this exists

Instant exchanges are convenient because they ask nothing of you. That same
design makes them a liability:

| Failure mode | Custodial instant exchange | ee.io |
| --- | --- | --- |
| Hot-wallet breach | User funds are pooled and stealable | Nothing is pooled — there is no balance to steal |
| Account freeze / "AML review" | Exchange can hold funds indefinitely | No account exists to freeze |
| Retroactive KYC | Withdrawal blocked pending documents | No signup, no documents |
| Exit scam | Total loss | Operator controls no funds at any point |
| Opaque pricing | Spread hidden in the rate | Every route, fee and gas cost shown side by side |

The trade-off is honest: custodial services can offer pairs that no on-chain
route supports, and can absorb a failed swap on their own balance sheet. ee.io
cannot. It only quotes what public liquidity can actually settle.

---

## Quick start

```bash
npm install
cp .env.example .env     # optional — runs in simulation mode without it
npm run dev              # API on :8787, web on :5173
```

Open <http://localhost:5173>.

With no API keys the server answers from a deterministic simulator and labels
every route `SIMULATED` in the UI. That is a working demo, not tradeable
pricing. Add keys to `.env` to fetch real quotes and executable calldata.

```bash
npm test         # 120 tests
npm run typecheck
npm run build
```

---

## Architecture

```
src/                     React 18 + Tailwind. Talks only to relative /api/*.
  components/            SwapCard, RouteComparison, ExecutionInspector, …
  hooks/useQuote.ts      Debounced fetch with out-of-order response guarding
  lib/wallet.ts          EIP-1193 bridge (MetaMask / Rabby), no WalletConnect

server/                  Express. Holds the API keys; the browser never sees them.
  aggregators/           One adapter per venue, all behind a single interface
  quoteEngine.ts         Parallel fan-out, ranking, reverse-quote convergence
  executionPlanner.ts    Builds the signable transaction + custody proof
  simulation.ts          Deterministic fallback (FNV-1a seeded, no randomness)

shared/                  Imported by BOTH sides, so rules cannot drift
  money.ts               bigint base-unit arithmetic
  address.ts             bech32/bech32m, base58check, EIP-55
  thorchain.ts           Memo construction and OP_RETURN fitting
  assets.ts / chains.ts  37 assets across 17 chains
```

Validation logic lives in `shared/` deliberately. The browser and the execution
path run the *same* address validator, so a destination that turns green in the
UI is the destination the server will encode.

### Money is never a float

Every amount that can reach a transaction is a `bigint` of base units.
Floating point appears only in USD estimates and display strings.

This is not pedantry. The original prototype multiplied `Number`s and called
`.toFixed(6)`; for an 18-decimal token that silently drops precision and
produces amounts that do not round-trip. A test in `tests/money.test.ts` pins
this down by round-tripping 10²⁷ wei exactly.

---

## Fee collection, per venue

Each aggregator monetises differently. Getting this wrong is the difference
between earning the fee and quietly earning nothing.

| Venue | Parameters | Side | Cap | Key |
| --- | --- | --- | --- | --- |
| **0x Swap API v2** | `swapFeeRecipient`, `swapFeeBps`, `swapFeeToken` | either | 1000 bps | required |
| **KyberSwap** | `feeReceiver`, `feeAmount`, `isInBps`, `chargeFeeBy` | either | — | `x-client-id` only |
| **1inch Classic** | `referrer`, `fee` *(percent, not bps)* | input | 3% | required |
| **1inch Fusion** | `integratorFee: {receiver, value}` | — | — | required |
| **OpenOcean** | `referrer`, `referrerFee` *(percent)* | **input** | 5% | optional |
| **ParaSwap v6.2** | `partnerAddress`, `partnerFeeBps`, `partner` | output | 300 bps | optional |
| **THORChain** | memo `…:AFFILIATE:BPS` | output | 1000 bps | none |
| **Jupiter** | `platformFeeBps` + `feeAccount` | output | — | optional |

Three traps worth calling out, all of which are handled in the adapters:

1. **1inch and OpenOcean take a percentage, not basis points.** Passing `50`
   where `0.5` is expected is a 100× overcharge that the API will reject — or
   worse, accept.
2. **OpenOcean keeps 20% of the referral fee.** The operator nets 80%. The UI
   shows both numbers rather than the headline.
3. **OpenOcean charges on the *input* token.** The routed amount is therefore
   `sellAmount − fee`, not `sellAmount`. Crediting the full amount overstates
   its output — see the regression note below.

---

## Two bugs found by testing

Both were caught by exercising the running API, and both now have regression
tests.

**Input-side fees were not reducing the routed amount.** OpenOcean skims its
`referrerFee` from the input token, but the engine routed the full `sellAmount`
and subtracted the fee afterwards. That overstated OpenOcean's output enough to
rank it #1 for ETH→USDC — the app would have recommended the *worst* route as
the best. Fixed by feeding `routedAmount = sellAmount − inputFee` into the
conversion.

**Reverse quotes overshot by ~2.4%.** The "I want to receive exactly X" path
used a padded price estimate that could not see slippage, gas, or the venue
spread. Asking for 5,000 USDC produced a send amount worth 5,119. Replaced with
a convergence loop that re-quotes up to twice and exits within ±10 bps; both
tested targets now land inside 0.03%.

Two further defects surfaced while writing the test suite:

- **`convertByUsd` lost 0.06% on wide price ratios.** It computed
  `Math.round((from / to) * 1e12)`, which overflows a float's 53-bit mantissa
  once the ratio passes ~1e9. Round-tripping 1 BTC through a sub-cent token
  lost 61,262 satoshi. Now a single fused bigint multiply-divide.
- **The bech32 decoder accepted strings the spec rejects** — up to 120
  characters instead of 90, and control characters in the human-readable part.
  All 24 BIP-173/BIP-350 conformance vectors now run in CI.

---

## A note on the THORChain docs

`dev.thorchain.org/concepts/memo-length-reduction.html` states the scientific-
notation rule as `NeM` = N × 10^M, and gives two worked examples:

> In memo: `1e8` → THORChain reads: `100000000`
> In memo: `51e7` → THORChain reads: `510000000`

The same page then claims `1612345678` reduces to `161e6` and `10012345678` to
`100e7`. Both contradict the rule above — they decode to one *tenth* of the
intended value.

We follow the stated rule (`1612345678` → `161e7`). Emitting the documented
`161e6` would set a trade limit 10× below the intended floor, silently
disabling the user's slippage protection. `shared/thorchain.ts` documents this
and `tests/thorchain.test.ts` pins the behaviour.

---

## Non-custodial guarantee

The Execution Inspector exposes the full transaction before you sign: router
address, raw calldata, the fee recipient, and the settlement trace.

For EVM routes the swap and the fee transfer occur in **one call frame**. If the
payout to the user reverts, the fee reverts with it — the operator cannot be
paid for a trade the user did not receive. There is no intermediate address
holding funds between the two.

For THORChain routes the user deposits to a vault address controlled by the
network's threshold signature scheme, not by ee.io, with intent encoded in the
memo. The affiliate fee is deducted by the protocol and accrues in the
`AffiliateCollector` module.

The inspector refuses to broadcast simulated calldata. Preview calldata shows
where the fee and amount sit in the call; only a live aggregator response is
signable.

---

## Limitations

- **Order tracking is in-memory** (`server/orders.ts`, capped at 500). A restart
  loses it. Real deployments need a database and a chain watcher; the state
  machine is paced by block times rather than by observed confirmations.
- **No live pricing in this environment.** The sandbox has no outbound network,
  so every quote resolves through the simulator. The adapters are written
  against the real API contracts but have not been exercised against live
  endpoints.
- **Fixed-rate quotes are not hedged.** A ten-minute price lock is a real
  financial position. Honouring it requires inventory or a hedge — the window
  is enforced, the risk is not covered.

---

## License

MIT
