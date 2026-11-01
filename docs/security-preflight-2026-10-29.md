# Sector 7 security check — 29 October 2026

**Local checks: PASS. Repository release: BLOCKED by design.**

90 tests passed with no failures/skips; both browser suites passed. The strict release command intentionally exited 1 because live connector and hosted identity/database commissioning have not been verified. This is not a production security certification.

Result: **BLOCKED**

Completed: 2026-10-29T09:45:28.246Z

Source SHA-256: `6d7e4911a2e65189a2dce826118933bd0bbfec4b931b61c942f78096700edb91`

| Check | Result | Evidence |
| --- | --- | --- |
| source-inventory | PASS | {"sha256":"6d7e4911a2e65189a2dce826118933bd0bbfec4b931b61c942f78096700edb91","files":33} |
| policy-and-budget-gate | PASS | {"denied":["repo.read","repo.write","network.fetch","shell.exec","secrets.read","policy.update"],"limits":{"jobMs":2000,"batchMs":15000,"outputBytes":8192,"failures":3,"runs":100,"diskBytes":20971520,"requestsPerMinute":120,"startsPerMinute":6,"concurrentRequests":8,"readBytes":262144}} |
| dependency-baseline | PASS | {"runtimeDependencies":0,"postgresTestEngine":"pglite 0.5.13","vulnerabilityAudit":"NOT_RUN_OFFLINE"} |
| functional-security-and-postgresql | PASS | {"exitCode":0,"timedOut":false,"outputLimit":false,"durationMs":10732,"tests":90,"pass":90,"fail":0,"skipped":0,"cancelled":0} |
| command-centre-browser | PASS | {"exitCode":0,"timedOut":false,"outputLimit":false,"durationMs":2510} |
| workflow-studio-browser | PASS | {"exitCode":0,"timedOut":false,"outputLimit":false,"durationMs":4279} |
| source-stability | PASS | {"sha256":"6d7e4911a2e65189a2dce826118933bd0bbfec4b931b61c942f78096700edb91"} |

Repository release: **BLOCKED**. No repository job or live database was contacted.

Unverified:

- Live connector authorization, HTTPS/SSRF/redirect and response limits
- Hosted JWT verification, deployed RLS and actual DB role grants
- Production deployment, physical phone, OS isolation and power-loss recovery
- Current dependency vulnerability advisory audit
