# wstETH (Arbitrum) fork PoC — how to run it, and what it needs

## 1. The addresses in the brief are wrong (3 of 6)

Checked against the official address book, `IPOR-Labs/ipor-abi` → `mainnet/mainnet-arbitrum/addresses.json`
(clone of `main`, read 2026-10-31):

| contract | in the brief | official (Arbitrum) | verdict |
|---|---|---|---|
| AmmPoolsServiceWstEth | `0x8cD6db83…719A7f` | `0x2e53879feb7F9BC8E97d1bcc848356F781402b6c` | **wrong** |
| AmmOpenSwapServiceWstEth | `0x221A9A6A…98d856` | `0x7138B130F255fa4B65dFE6DEA9ade89dBF1E6461` | **wrong** |
| AmmCloseSwapServiceWstEth | `0x32365802…3f5eC` | `0x4a76fBe02C6e816B33584CEc2a63b1A420016938` | **wrong** |
| AmmTreasuryWstEthProxy | `0xBd013Ea2…882A5D` | same | correct |
| AmmStorageWstEthProxy | `0x32680433…1c5C28` | same | correct |
| IporProtocolRouterProxy | `0x760Fa0aB…F118db` | same | correct |

Forensics on the three:

* `0x8cD6db83…719A7f` **is** a real `AmmPoolsServiceWstEth`, but from the *old* book — it appears only in
  `mainnet/mainnet-arbitrum-harvest/addresses.json` and the `testnet/pilot-*` books. Superseded.
* `0x221A9A6A…dFF98d856` is a real, verified contract on Arbitrum named **`AmmOpenSwapServiceWstEth`**, deployed by
  *IPOR: Deployer* **2 yr 273 days ago**, compiler **0.8.20 / paris** (`arbiscan.io/address/0x221A…`) — i.e. the 2023 v1
  deployment, not the live `0x7138B130…6461` (v2, 0.8.26). It holds 0 ETH and has no recent activity.
* `0x32365802…3f5eC` appears in **no** address book and has no IPOR deployer history — unverifiable.

So the list mixes v1-era deployments with the live ones. Running a PoC against them would test dead contracts. The PoC therefore uses only the official entries, and reaches every pool function **through the router**
(`0x760Fa0aB…`), which dispatches by `msg.sig`; that way no per-service address is needed.

Official values used by `IporWstEthFork.t.sol`:

```
ROUTER   0x760Fa0aB719c4067D3A8d4727Cf07E8f3Bf118db   IporProtocolRouterProxy
WSTETH   0x5979D7b546E38E414F7E9822514be443A4800529
IPWSTETH 0xbDa4b3e17a9B0ecb811E68c6f08907156CBa503C
TREASURY 0xBd013Ea2E01C2Ab3462dd67e9C83aa3834882A5D
STORAGE  0x326804339eC2a210e5f9246F4959aE50961c5C28
ORACLE   0x70DdDE503edf4816B5991Ca5E2f9DE79e295F2D0
LENS     0xd903D63Fb57a055a280D6DbAe91B261592B82dd3
```

## 1b. Before you run anything: the wstETH pool on Arbitrum is dust

Read directly from chain state (Blockscout API, 2026-10-31) — this is the number that decides whether the fork test is worth
your time:

| address | holding |
|---|---|
| `AmmTreasuryWstEthProxy` 0xBd01…2A5D | **8.9345 wstETH ≈ 25 006 USD** (wstETH @ 2 798.66) |
| `PlasmaVaultWstETH` (its asset manager) | **0** — the wstETH pool has no asset-management leg |
| `AmmTreasuryUsdcProxy` (Arbitrum) | 995.79 USDC + 22 642.24 `ipUSDCfusion` shares |
| `AmmTreasuryUsdcProxy` (Ethereum) | 2 794.92 USDC + 8 038.83 `ipUSDCfusion` shares |
| `AmmTreasuryUsdcProxy` (Base) | 29.29 USDC + vault shares |

The wstETH pool can therefore pay **at most ~8.9 wstETH** no matter how big the phantom mark gets — a fork PoC there proves
the mechanism and steals ~25 k. The stablecoin pools are in the same order of magnitude (low thousands of USDC idle, plus
whatever the Fusion vault shares are worth). This is a correction to the earlier "100 k–300 k per pool" estimate in
`REPORT.md` §7: the *TVL* is 484 k, but the *liquid cash inside each AMM pool* is one to two orders of magnitude smaller,
because most LP funds live in the asset managers.

A fork test is still worth running — for the exchange-rate number, not for the money.

## 2. Why this cannot be run inside Arena's sandbox

Both dependencies of a fork test are blocked there; measured, not assumed:

* **RPC:** `arb1.arbitrum.io`, `rpc.ankr.com`, `mainnet.base.org`, `eth.llamarpc.com` all resolve in DNS but every TCP/TLS
  connection is refused (`curl` → `http_code 000`). No fork is possible without an RPC endpoint.
* **forge:** `github.com/foundry-rs/foundry/releases/...` answers `302` to `objects.githubusercontent.com`, which is also
  refused (`size_download 0`). The binary cannot be installed.
* `marssapcex/arc_hedgefun` contains `lib/forge-std`, `lib/openzeppelin-contracts`, `lib/v4-core` as **empty submodule
  directories** and no `forge`/`cast`/`anvil` binary — Foundry itself is installed on your machine, not vendored in the repo.

So the test below is the deliverable, and it is compiled here against the real `forge-std` (solc 0.8.26, `evm_version =
cancun`, no errors) but **it has never been executed**, because nothing here can reach Arbitrum. Do not treat its output as
known until you run it.

## 3. Run it

```bash
cd ~/arc_hedgefun                      # the repo you already have (has lib/forge-std)
git submodule update --init --recursive # only if lib/ is still empty
cp /path/to/ee.io/audit/ipor/fork/IporWstEthFork.t.sol test/
ARB_RPC=https://arb1.arbitrum.io/rpc forge test --match-contract IporWstEthFork -vv
```

If the public RPC rate-limits, use any other Arbitrum endpoint (Alchemy/Infura/QuickNode) — `ARB_RPC` is the only knob.

Sizing overrides (18-decimal wei):

```bash
ARB_RPC=... ATK_LP=5000000000000000000 TOTAL=185000000000000000 DAYS=45 \
  forge test --match-contract IporWstEthFork --match-test test_01_attack -vv
```

`test_00_recon` is read-only and always safe — run it first. It prints the pool's real depth, exchange rate, ipToken supply
and the router owner. **If `liquidityPool` comes back tiny (a few wstETH), the pool is not worth attacking and the whole
exercise is academic** — that is the first thing to check.

## 4. What the test does, and the one thing it cheats

Real: fork state, the pool's accounting, the attacker's capital, the swap, the accrual, the redemption, the guards.

Cheated: `openSwapReceiveFixed90daysWstEth` requires risk indicators signed by IPOR's off-chain signer. A fork cannot forge
that key, so `test_01_attack` impersonates the router owner once and points the message signer at a key the test controls
(`vm.prank(owner); router.setMessageSigner(signer)`). The signed payload then claims `maxLeveragePerLeg = 1000e18` — which is
also the repo's own test default, but **is not necessarily what production signs**. A real attacker cannot set that number; he
gets whatever IPOR's risk service gives him. Two consequences, both stated in the report (§10.2):

* if production signs ≤250×, the attack does not pay at current depth;
* the exact production value is **not** readable from the chain (the six risk numbers travel inside the signature, they are
  not stored), so it has to be observed from a real open-swap transaction or obtained from IPOR's API.

An honest fork PoC that does not cheat here would have to replay a captured signature from a real open-swap tx — same
mechanism, just with someone else's leverage number.

## 5. What to send back

Paste the full `-vv` output of both tests. The numbers that decide the finding:

1. `treasury wstETH` and `liquidityPool` — real depth of the wstETH pool;
2. `ipToken exchange rate` before/after the warp — the size of the phantom mark on a live pool;
3. `NET PROFIT` / `NET LOSS` and `attacker received back`;
4. any revert message (e.g. `IPOR_313` acceptable-rate, `IPOR_309` leverage, `IPOR_015` paused) — each one narrows what
   production actually allows, which is exactly the unknown above.

With that output the fork numbers go into `REPORT.md` next to the local-EVM ones, and the signer cheat gets replaced by a
replayed production signature.
