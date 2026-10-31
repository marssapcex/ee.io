# Shared rules

## Scope command (paste it, do not re-derive it)

```bash
find . -type f -name '*.sol' \
  -not -path '*/node_modules/*' -not -path '*/lib/*' -not -path '*/artifacts/*' \
  -not -path '*/cache/*' -not -path '*/out/*' -not -path '*/broadcast/*' \
  -not -path '*/coverage/*' -not -path '*/typechain*/*' \
  -not -path '*/interfaces/*' -not -path '*/mocks/*' -not -path '*/test/*' \
  -not -name '*.t.sol' -not -name '*Test*.sol' -not -name '*Mock*.sol'
```

`-type f` is required: Hardhat writes artifacts into directories named `Foo.sol/`.

**Deploy scripts stay in scope** (`script/`, `deploy/`, `*.s.sol`). A deploy script sets the owner,
the oracle, the initial price and the pause flags. Inherited code is still in scope when it is *your*
inherited code — read the parent, skip the dependency.

A file named explicitly on the command line is always in scope, wherever it lives.

## Cite or drop

- About the target: `path/to/File.sol:123` — line numbers, not file names.
- About an incident: `corpus/incidents/<id>.json` — the id is the filename without `.json`.
- About behaviour: quote the line. "It probably rounds down" is not a citation.
- No citation → the sentence does not go in the report.

## Output grammar

Two kinds of item. Everything you notice is one of them; nothing is "just a note".

```
FINDING | module: <file:line> | class: <kebab> | severity: critical|high|medium
path: caller -> function -> state change -> money out
proof: <poc file + the numbers the run printed>
impact: <who loses what, in units and USD>
fix: <one sentence>

LEAD | module: <file:line> | class: <kebab> | confidence: low|medium
smell: <what you saw>
why_unproven: <the one missing link: entry point paused / no fork / needs an oracle feed>
next_check: <the exact command or read that would settle it>
```

Rules for both:

- **One root cause per item.** Two different fixes = two items. Same cause in five files = one item
  with five `module:` lines.
- `FINDING` requires a `proof:` that a run produced. No run, no FINDING.
- Default to LEAD over dropping: a real smell with a partial path is worth a row.
- Every LEAD carries `why_unproven`. "I did not try" is a valid answer and is better than a fake path.

## Cross-contract weaponisation

When you find one instance, search the whole bundle for the same shape before moving on: by function
name (with and without the `_` prefix), by modifier, by the same arithmetic expression. A repeated
bug reported once is an audit failure.

## Escalate before you file

Do not file a DoS if it is really a theft. Ask of every finding: "can this be pushed one step further,
into a state where value leaves?" Only downgrade when you can say why not.

## Do not report

- Admin-only functions doing admin things, unless the admin path is reachable by anyone.
- Standard trade-offs: MEV, rounding dust, first-depositor with `MINIMUM_LIQUIDITY`, `unchecked` with
  an argument that it cannot overflow.
- Self-harm: a user who can only hurt themselves.
- "Admin could rug" without a mechanism and without a value at risk.

## Numbers

- Keep units in the label: `wad`, `6dec`, `share`, `USD`. Most audit disagreements are unit bugs.
- Every USD figure says how it was converted (price source + block).
- When you quote a pool size, quote the *redeemable* number, not the accounting number, and say which
  function produced it.

## Stop conditions

Stop auditing a module and write why when: (a) you have read every in-scope file at least once, (b)
every invariant has either a passing probe or a named reason it cannot be probed, or (c) the module
custodies nothing and calls nothing.
