# whitehat-solidity-audit

An audit framework for a coding agent (Code / Cursor / Codex / Claude Code) that finds **permissionless
fund-loss bugs** in Solidity and proves them with a Foundry test that actually runs.

Inspired by two things, borrowed honestly:

- `pashov/skills` → the *orchestration* idea: ordered phases, specialist lenses, one output grammar,
  a hard line between a finding and a lead.
- `kismp123/DeFi-Security-Incident` → the *corpus*: 821 real incidents (2020–2026) with vulnerable vs
  fixed code, attack flows and root causes. Built here into machine-readable records, not vibes.

What is new: the corpus is **matched, never trusted**. A pattern hit only decides *what to read next*.
Money is proven by a fork test, and the gate refuses to let the report exist before the test passes.

## Install

```bash
git clone <this repo> && cd whitehat-framework
python3 tools/build_corpus.py        # clones the incident repo, builds corpus/ (~7 MB, ~2 s)
```

Then point your agent at `SKILL.md`:

- **Claude Code / Codex**: copy the folder to `.claude/skills/whitehat-solidity-audit/` (or `.codex/`),
  keep `SKILL.md` as the entry file. Ask: *"audit this repo"*.
- **Cursor / Code**: add `SKILL.md` to the rules/context and say *"run the whitehat framework on
  <path>"*.
- **No agent**: run the tools by hand; the phase artifacts are just markdown and tsv in `runs/`.

No Python dependencies. `forge` is needed only for phase 6.

## The eight phases

```
0 SCOPE → 1 MAP → 2 SWEEP → 3 INVARIANTS → 4 MATCH → 5 TRACE → 6 PROVE → 7 REPORT
```

Each phase writes files into `runs/<target>/<stamp>/`; `tools/gate.py` refuses to open phase N+1 until
phase N's artifacts exist and are non-empty, `02-coverage.tsv` covers the repo, `04-match.md` cites
real corpus records, `05-traces.md` has a `sink:`, and `06-poc/run.log` shows a passing run.

```bash
python3 tools/gate.py runs/mytarget/20261101-101500 5   # may I start tracing?
python3 tools/gate.py runs/mytarget/20261101-101500 6 --run   # also execute forge
```

## Tools

| tool | what it does | runtime |
|---|---|---|
| `tools/build_corpus.py` | clones `kismp123/DeFi-Security-Incident` at a pinned commit, parses 821 incident files into `corpus/incidents/*.json`, 24 class pages, 797 patterns, `INDEX.md`, `provenance.json` | ~2 s |
| `tools/triage.py` | IDF-weighted match of every in-scope `.sol` file against the 797 patterns → ranked candidates + per-module class shortlist | ~0.2 s / 120 files |
| `tools/gate.py` | phase gate, exits 1 with the reason | instant |
| `tools/local_chain/` | a hardhat EVM that runs with **no network**: solc-js from npm, `hardhat_setBalance`/`setStorageAt`/`impersonate`, `transplant.js` to replay a hand-dumped mainnet snapshot | verified |
| `tools/start_run.sh` | creates `runs/<target>/<stamp>/` from the templates **and seeds `02-coverage.tsv` with the real in-scope file list as `todo`** | instant |

`triage.py` example:

```bash
python3 tools/triage.py ../ipor-protocol --top 20
```

Output is a *reading order*, and it says so in its own header: `A hit means READ THAT INCIDENT. It is
not a finding.` The second table (`per module: which incident classes to read first`) is usually the
more useful one — it tells you which lens to open for that file.

Typical first 60 seconds:

```bash
tools/start_run.sh /path/to/target mytarget
RUN=$(ls -d runs/mytarget/* | tail -1)
python3 tools/triage.py /path/to/target --top 40 > "$RUN/04-triage-raw.tsv"
python3 tools/gate.py "$RUN" 2      # GATE CLOSED: 119 files still marked todo
```

## Corpus, as built

821 incidents · 739 with vulnerable `code_before` · 741 with parsed attack `steps` · 434 with a USD
figure · **$8.6 B** of quoted losses in total · 24 classes · 797 match patterns · source commit
`65d12c54` (`corpus/provenance.json`).

## The corpus

```
corpus/
├── INDEX.md           821 incidents: date, protocol, chain, loss, class
├── incidents/*.json   one per incident: metadata, code_before, code_after, steps
├── classes/*.md       24 classes, worst-first, with the file to read
├── patterns.jsonl     797 machine patterns: {classes, signals[token, weight], root_cause}
└── provenance.json    source repo + commit sha + build time
```

Rebuild any time; nothing in the corpus is written by hand. `classes/other` holds incidents that the
upstream index does not tag — they are kept, not dropped.

## Design decisions worth arguing about

1. **Pattern matching is a reading order, not a verdict.** Token overlap finds *shape*; the money is in
   the 4–5 step composition, so `references/agents/composition.md` is a first-class lens and phase 5
   must name a `sink:`.
2. **A LEAD is a first-class output.** Most audits fail by silence, not by noise: a smell with a
   partial path and a `why_unproven` is worth more than a deleted hunch.
3. **`blocked_by` instead of hiding.** If the bug is real but every entry point is paused, that is a
   critical with a `blocked_by` field — the flag is one owner call away from being removed.
4. **Deploy scripts are in scope; inherited dependencies are not.** You are responsible for the
   constructor arguments and the ownership handover you wrote.
5. **The PoC must print numbers**, not just pass: attacker delta, treasury delta, victim delta.

## Known limits

- Matching is lexical (IDF over identifiers). It does not parse ASTs or types; a renamed variable can
  lower a true match's score. Mitigation: phase 4 reads the module's class shortlist, not only the top row.
- Non-EVM incidents in the corpus (Sui/Solana/Starknet, ~20) are indexed but their patterns are not
  usable for Solidity targets; `triage.py` will simply never match them.
- The corpus is only as good as its source. `provenance.json` pins the commit; if a claim matters,
  quote the incident `.json`, and the `.json` names its `source_file`.
- No detection of "bug requires two colluding roles" — that is by policy out of scope (not
  permissionless), and `judging.md` says so.
