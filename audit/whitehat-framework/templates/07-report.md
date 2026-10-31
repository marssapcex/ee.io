# <target> — fund-loss audit (draft, phase 7)

Fill from `references/report-format.md`. Minimum viable report:

1. commit, chain, corpus commit, scope counts
2. summary table (severity + status + blocked_by)
3. findings, each with a proof line that names a log file and three numbers
4. leads, unproven, with `why_unproven`
5. coverage: files read / total, every skip reason
6. rescue feasibility: can the protocol stop it, in how many blocks
7. disclosure: channel, UTC timestamp, deadline, what was not done

Do not write section 3 from memory. Copy it from `05-traces.md`.
