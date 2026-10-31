# SOP — phases 1 to 5

## 1. MAP (what holds money, what can move it)

Build one table, no prose:

| actor | contract | can move | condition | pause flag | upgradeable |
|---|---|---|---|---|---|

Then four lists:

1. **Custody** — every address that holds tokens (`balanceOf` on chain, not in storage). For each,
   the function that pays out.
2. **Entry** — every external/public function reachable by an unprivileged caller.
3. **Trust edges** — every external call, with the callee's trust assumption ("trusted: canonical
   ERC20", "untrusted: user-supplied address").
4. **Switches** — pause map per selector, admin roles, timelock, upgrade path. Query it, do not assume
   it: `paused(bytes4)` returning 0 on a selector the router never registered is not "open".

## 2. SWEEP (the whole repo, file by file)

For each in-scope file, one row in `02-coverage.tsv` and one short block in `02-files.md`:

```
### contracts/amm/AmmPoolsService.sol   (312 lines, read)
does: provide/redeem LP, mints and burns ipToken against a per-asset AMM
custody: moves treasury funds on redeem
units: asset decimals -> wad at the boundary; rate is 1e18
state written: ipToken supply, storage.liquidityPool
external: treasury.transferFrom, ipToken.mint/burn, asset manager maxWithdraw
classes touched: accounting-desync, precision-rounding, external-call
lines worth a second look: 88, 214, 220-260
```

Coverage is complete only when `wc -l 02-coverage.tsv` equals the `find` count and every row is
`read`, or `skip:<reason>` with a reason a reviewer would accept.

## 3. INVARIANTS

Sendences with a direction and a slack, each tied to the code that maintains it:

- `sum(shares) * rate / 1e18 <= redeemableAssets(treasury) + 1 wei`, maintained by `_redeem`.
- `totalSupply(ipToken) * rate / 1e18 == accountingLiquidity + accrued - soap`, maintained by
  `AmmLib.getExchangeRate`.
- No unprivileged caller can move `treasury` balance except through `provide|redeem` (checked by
  listing callers).

An invariant that no function maintains is a finding candidate on its own.

## 4. MATCH (corpus, then diff by hand)

```bash
python3 tools/triage.py <target> --top 40 > 04-triage-raw.tsv
```

The tool ranks (module × incident) pairs by IDF-weighted identifier overlap. That ranking is a reading
order, nothing more. For each module:

1. class list from the per-module table → `corpus/classes/<class>.md`
2. pick incidents with the **same custody + same price source + same unit**, not the same words
3. read `code_before` / `code_after` / `steps`
4. write the diff in words: what coincides, what differs, and how the difference changes the attack
5. emit `HYP-<n>` as in `SKILL.md`, with `needs:`

Most hypotheses die here. That is the point: a hypothesis that dies in phase 4 costs 10 minutes; one
that dies in phase 6 costs two days.

## 5. TRACE (path to money)

One block per surviving hypothesis:

```
TRACE-1 | HYP-3 | class: accounting-desync
file: contracts/amm/AmmPoolsService.sol:88 (rate read), :214 (redeem)
file: contracts/libraries/AmmLib.sol:33 (formula)
steps:
 1. attacker.provide(1e6) -> ipToken minted at rate r0            [file: :95]
 2. attacker.openReceiveFixed(notional N, collateral C)           [file: OpenSwap:441]
 3. 30 days pass; soap grows linearly in N, unclamped             [file: SoapIndicator:34]
 4. attacker.redeem(all) at inflated rate                         [file: :214]
sink: treasury asset balance decrease by (r1 - fair) * shares
precondition: an open-swap selector is routed and not paused
counter-check: redeem path rebalances from the asset manager, so the sink is not idle-cash-limited
result: PAYS / BLOCKED (why)
```

Every `sink:` names the token and the account whose balance decreases. If you cannot name that
account, there is no trace yet.
