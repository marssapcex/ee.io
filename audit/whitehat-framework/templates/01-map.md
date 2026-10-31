# 1. Money map

| actor | contract | can move | condition | pause selector | upgradeable |
|---|---|---|---|---|---|

## Custody

| holder | token | amount | payout function |
|---|---|---|---|

## Unprivileged entry points

| function | contract:line | moves funds? | notes |
|---|---|---|---|

## Trust edges

| call | callee trusted because |
|---|---|

## Switches

| selector / role | state | how it can change |
|---|---|---|

Pause map must come from a **call**, not from a flag read alone:
`cast call <router> "paused(bytes4)(uint256)" <sel>`; `0` on a selector the router does not route means
nothing.
