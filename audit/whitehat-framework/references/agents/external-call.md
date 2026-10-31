# Lens: external calls, reentrancy, arbitrary call

- CEI order in every function that moves value: state written before the transfer? If not, what does
  the callee control?
- Read-only reentrancy: a view (`getRate`, `pricePerShare`, `totalAssets`) that reads a state another
  contract is mid-update on. Check the view's invariants during a callback.
- Arbitrary call: is `target` user-controlled? Is `data` user-controlled with `target = this`?
  `delegatecall` to a user-supplied address is total compromise; `call` to one is a token drain.
- Callbacks: verify the caller is the pool you just interacted with, not "a contract with the right
  function name".
- Native vs ERC20: `msg.value` accounting, `address(this).balance` after a `call`, `transfer` vs
  `call{value:}`.

Corpus: `corpus/classes/reentrancy.md`, `arbitrary-call.md`, `self-balance-exploit.md`.
