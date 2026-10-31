# 5. Traces

```
TRACE-<n> | HYP-<n> | class: <kebab>
file: <path:line>     <what it does there>
file: <path:line>     <what it does there>
steps:
 1. ...
 2. ...
sink: <token> leaves <account> by <amount> because <mechanism>
precondition: <the one state that must hold>
counter-check: <the guard you looked for and did not find, or found and how it is bypassed>
result: PAYS <number> / BLOCKED <why>
```
