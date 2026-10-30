# Sector 7 security preflight

Result: **PASS_LOCAL_ONLY**

Completed: 2026-10-30T23:26:54.860Z

Source SHA-256: `e6b4a173a1b8bf8cca034d8e0043fb1c2b264c817c5892864f93a884028bc33c`

| Check | Result | Evidence |
| --- | --- | --- |
| source-inventory | PASS | {"sha256":"e6b4a173a1b8bf8cca034d8e0043fb1c2b264c817c5892864f93a884028bc33c","files":37} |
| policy-and-budget-gate | PASS | {"denied":["repo.read","repo.write","network.fetch","shell.exec","secrets.read","policy.update"],"limits":{"jobMs":2000,"batchMs":15000,"outputBytes":8192,"failures":3,"runs":100,"diskBytes":20971520,"requestsPerMinute":120,"startsPerMinute":6,"concurrentRequests":8,"readBytes":262144}} |
| dependency-baseline | PASS | {"runtimeDependencies":0,"postgresTestEngine":"pglite 0.5.13","vulnerabilityAudit":"NOT_RUN_OFFLINE"} |
| functional-security-and-postgresql | PASS | {"exitCode":0,"timedOut":false,"outputLimit":false,"durationMs":13262,"tests":98,"pass":98,"fail":0,"skipped":0,"cancelled":0} |
| browser-regressions | NOT_RUN | {"reason":"Use --browser with explicit host-provided tooling"} |
| source-stability | PASS | {"sha256":"e6b4a173a1b8bf8cca034d8e0043fb1c2b264c817c5892864f93a884028bc33c"} |

Repository release: **BLOCKED**. No repository job or live database was contacted.

Unverified:

- Live connector authorization, HTTPS/SSRF/redirect and response limits
- Hosted JWT verification, deployed RLS and actual DB role grants
- Production deployment, physical phone, OS isolation and power-loss recovery
- Current dependency vulnerability advisory audit
