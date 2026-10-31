# Lens: proxy, storage, config, governance

- Proxy: storage layout between proxy and implementation, `initializer`/`reinitializer`, unprotected
  `initialize` on the implementation, `upgradeTo` guarded by whom.
- `delegatecall` targets: fixed or settable? Who sets them?
- Config values that can change a price, a cap or a fee, and the timelock in front of them.
- Pause map: which selectors are paused, which are not, and whether a service is reachable directly
  when its router path is closed.
- Governance: flash-loanable voting, quorum based on a balance that can be borrowed, proposal that
  executes in the same block.
- Ownership transfer / renouncement paths, `appointedOwner` accept flows.

Corpus: `corpus/classes/proxy-storage.md`, `governance.md`, `approval-abuse.md`.
