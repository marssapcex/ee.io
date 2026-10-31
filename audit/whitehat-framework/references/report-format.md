# Report format

```markdown
# <target> — fund-loss audit

commit <sha> · <chain(s)> · reviewed <date> · corpus <provenance.json commit>
in scope: <n> files, <n> lines · out of scope: <list>

## 1. Summary
| # | title | class | severity | status | blocked_by |
|---|---|---|---|---|---|
| 1 | <one line> | accounting-desync | critical | proven on fork | pause on all deployments |

status ∈ {proven on fork, traced not proven, blocked, parked}

## 2. Findings
### F-1 <title>
- **class**: <kebab> (corpus: `corpus/incidents/<id>.json` × N)
- **module**: `path:line`, `path:line`
- **path**: caller → call → state → sink
- **proof**: `06-poc/<file>.t.sol`, log lines: <the three numbers>
- **impact**: <units> ≈ $<usd> (price source, block)
- **precondition**: ...
- **blocked_by**: ... (and what removes it)
- **fix**: <one sentence>

## 3. Leads (unproven, in priority order)
LEAD rows exactly as produced in phase 5.

## 4. Coverage
files scanned / total, and every `skip:` reason.

## 5. Rescue feasibility
| question | answer |
|---|---|
| can the protocol stop it mid-flight? | <function, role, blocks> |
| is the drain atomic or does it need time? | ... |
| what does the attacker need that we can watch for? | ... |

## 6. Disclosure
- sent to: <channel> at <UTC time>
- content: <one line>
- deadline proposed: <date> (industry default 90 days)
- what we did **not** do: <no mainnet tx, no public PoC>
```

Rules: no severity without a `proof:` or an explicit `blocked_by`; USD always carries its source;
never paste a full PoC into a report that leaves your machine — link the file and the numbers.
