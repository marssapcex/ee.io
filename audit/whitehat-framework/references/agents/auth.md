# Lens: authorisation & roles

Ask of every state-changing external function:

- Who is `msg.sender` allowed to be? Trace the modifier chain to the root, including inherited
  `onlyOwner`, `onlyRole`, and the router's own dispatch table. A function that is "protected" only
  because a router does not route its selector is **unprotected** — the service may be callable
  directly.
- Is the *beneficiary* parameter checked against `msg.sender`? `f(address to, ...)` with no check is an
  open mint/burn to any address.
- Is `tx.origin` used for auth? Is `msg.sender` compared to a user-supplied address?
- `initialize()` — callable once, by whom, on the proxy or on the implementation? An uninitialised
  implementation behind a proxy is the Nomad/Wormhole shape.
- Signature paths: domain separator includes chainid + verifying contract? nonce consumed? signature
  malleable? replayable across chains or across functions?
- Callback functions (`onFlashLoan`, `uniswapV2Call`, `swapCallback`): is the caller verified against
  the pool that was just called?

Corpus: `corpus/classes/access-control.md`, `signature-replay.md`, `unprotected-callback.md`.
