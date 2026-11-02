# Sector 7 safety baseline

Status: implemented and exercised locally, with the bounded public GitHub README
broker described below. No database is connected and no production security claim is made.
This document supersedes the earlier unauthenticated private-Wi-Fi prototype notes.

## What is enforced now

| Boundary | Enforced behavior |
| --- | --- |
| Owner access | Every API requires a server-validated owner bearer key, including reads, approvals and safety controls. Owner identity is constructed by the server; body-supplied role/owner fields cannot grant access. |
| Default-deny policy | Only listed owner actions in security.js are allowed. The separate fixed public GitHub snapshot is owner-only. General repository reads/writes, arbitrary network calls, shell execution, secret access and unknown actions are denied. No HTTP policy-edit interface exists. |
| Listener | 127.0.0.1 only. Private-LAN/public bindings are refused pending an authenticated TLS access design. Host and Origin are checked; cross-site browser requests are rejected. No firewall/tunnel changes. |
| Worker code | Fixed built-in README inspector only. No input-supplied script, module path, tool, executable or URL. Input text is data, never authority. |
| Worker supervision | At most two worker threads. Two-second job deadline; cancellation or deadline terminates the worker and awaits its exit before freeing the slot. Workers receive an empty environment and their streams are discarded. |
| Batch budget | 15 seconds of dispatch/execution time; no automatic job retry, replay or escalation of authority. Persistence and OS stalls are separate limitations below. |
| Circuit breaker | Three failed/timed-out jobs stop further per-batch dispatch. The service accumulates failures and persists an open breaker. Storage/validation faults also latch it. Reset is an owner action and leaves dispatch paused; Resume is separate. |
| Emergency stop | Pause & stop aborts active workers and prevents new jobs. A cancel request targets only its exact active operation key. Success is determined from the final saved record, not the request acknowledgement. |
| Storage recovery | Exclusive server/store/run lock files, serialized atomic rename writes, bounded JSON reads, schema/fingerprint checks, restrictive new-file modes and no-follow file opens where supported. Stale locks require local inspection; never auto-delete them. |
| Dirty recovery | An unfinished safety checkpoint survives as a recovery marker. Restart latches paused/open rather than treating an unacknowledged write as a clean run. A failed safety write cannot silently resume work. |
| Browser | Key bootstraps from the private startup-link fragment, then is removed from the visible URL and held in tab sessionStorage. It is not placed in run history, request URLs or localStorage. Native inspection uses textContent. CSP, no-referrer and same-origin resource headers apply. |
| Logging | Errors return bounded categories; worker errors and request bodies/credentials are not echoed. The private bootstrap link appears only in the owner's local startup terminal. |

## Hard limits

| Resource | Limit |
| --- | --- |
| Repositories per rehearsal | 12 supplied samples; HTTP currently exposes only the four bundled fictional samples |
| README | 16,384 bytes each |
| Search terms | 1–5, 32 characters each |
| Whole scout input | 200,000 bytes |
| Worker result | 8,192 serialized bytes, exact expected result schema |
| Worker V8 budgets | 32 MiB old generation, 8 MiB young generation, 2 MiB stack, per worker |
| Stored scout JSON read | 256 KiB per file |
| Scout history | 100 directories; 20 MiB with admission reservation; no automatic deletion |
| Legacy workflow history | 1,000 tasks and 5 MiB; cap fails closed |
| HTTP body | 4,096 bytes |
| Request rate | 120 requests/minute per local server, fixed window |
| Scout admission rate | Six submissions/minute; repeated requests still count |
| Active HTTP handlers / sockets | Eight handlers / 16 sockets |
| Slow body / socket / header budget | Five-second body inactivity, ten-second socket inactivity, ten-second header/request settings |

These are application controls, not OS cgroup limits. V8 limits do not cap total
process RSS or all external allocations. Worker threads share an OS process and
are **not** an arbitrary-code or hostile-plugin security sandbox. No untrusted
repository code may be executed in them. Native/OS/filesystem stalls and abrupt
power loss cannot be made safe merely by Promise timeouts or rename. Data is local
plaintext. Offline encrypted backup is available via the local operator commands;
this implementation does not establish scheduled/off-device backup, fsync-level
power-loss durability, hostile-OS isolation, MFA or independent human attribution.

## Owner operation and recovery

1. Start Node normally and open the private owner URL from the local terminal.
   A random 256-bit key is generated in the ignored data directory, mode 0600 on
   POSIX systems. On Windows, creation/reopening replaces the credential file's
   DACL with protected access for the current Windows account, SYSTEM and local
   Administrators, then reads it back to verify the allowed identities. Failure
   refuses startup; no execution-policy change or credential rotation is used.
   Existing keys retain their bytes. This protects the key file, not every local
   plaintext record or a compromised owner/administrator account.
   Optional SECTOR7_ACCESS_TOKEN must be a strong random
   40–128-character URL-safe value. Never put it into Git or a shared URL/query.
2. Use Pause & stop to stop admission and request active cancellation. Refresh
   the record to confirm all workers have reached terminal states.
3. For an open circuit, inspect the local failure category and saved run first.
   Reset after review clears the breaker but keeps dispatch paused. Choose Resume
   separately. Reset cannot proceed while workers are active.
4. If a process was killed, verify it is actually gone before preserving the store
   and removing only its stale .server.lock/.coordinator.lock/run.lock files. Do
   not remove data files, operation keys or the .safety-dirty recovery marker to
   bypass a refusal. On restart the marker latches paused/open; reviewed Reset
   clears it. Repair corrupt storage from a verified copy, never by silently
   replacing it with empty history.
5. If the owner key is disclosed, stop the server, establish a new strong local
   credential and restart. This is a local key-rotation procedure, not a remotely
   verified identity recovery service.

See `docs/LOCAL-RECOVERY.md` for the encrypted stopped-store backup/restore commands
and automated disposable restore drill. Archives use AES-256-GCM with a fixed
scrypt cost, independent random salt/nonce, authenticated headers, bounded strict
inventory and per-file SHA-256 checks. Owner credentials are never included.
Passwords are prompted locally without echo, not accepted in command arguments or
environment variables. Restore authenticates and validates the full archive before
creating a new private destination. It never overwrites an existing directory.
Store locks block backup while a server is running, and the backup holds the same
exclusive server lock until completion. Stale locks/unfinished writes/corruption
are refused rather than silently omitted. Dirty safety markers survive recovery.
No HTTP backup/restore endpoint, cloud storage, schedule or password recovery is
provided. A successful local drill does not establish media redundancy or actual
power-loss durability; retain an independently verified off-device archive.

Authenticated API controls: GET /api/scout/control for the actual limits/state;
POST /api/scout/control with exactly {action: pause|reset|resume};
POST /api/scout/:operationKey/cancel with exactly an empty JSON object.

## RLS: implemented migration, local verification, not deployed

The current runtime uses JSON files. Those files have **no PostgreSQL RLS**.
Owner authentication, the action gate and local filesystem boundaries protect
them. Do not describe a database policy as active on this runtime.

db/0001_owner_isolation.sql is a transactional prospective Supabase migration:

| Table | Owner rule | Ordinary authenticated privileges |
| --- | --- | --- |
| sector7.runs | auth.uid() on old/new rows; operation keys unique within owner | SELECT, INSERT, UPDATE |
| sector7.jobs | Same owner, with owner-scoped parent FK | SELECT, INSERT, UPDATE |
| sector7.events | Same owner, with owner-scoped parent FK | SELECT, INSERT only |
| sector7.artifacts | Same owner, with owner-scoped parent FK | SELECT, INSERT only |

All four tables have ENABLE and FORCE ROW LEVEL SECURITY. Ten explicit,
command-specific policies cover reads/inserts and allowed updates. There is no
delete policy and no update policy for events/artifacts. Anonymous/PUBLIC grants
are revoked. A changed grant alone cannot enable those missing mutation policies.
No views or SECURITY DEFINER bypass API is added.

The migration requires existing trusted auth.uid(), authenticated and anon roles;
it must never install a mocked identity function into production. Local tests use
real PostgreSQL via pinned development-only PGlite and a clearly identified test
identity stub. They exercise two ordinary owners, anonymous/missing identities,
forged owner IDs, parent ownership, key uniqueness, grant drift, policy flags and a
non-superuser table owner under FORCE. This proves the SQL policies locally, not
gateway JWT verification or hosted Supabase authorization.

Before database use: inspect actual role ownership/memberships and grants, apply
the migration to the intended isolated environment, use verified signed identities,
exclude superuser/BYPASSRLS/service-role credentials from ordinary requests, run
the same negative cases through the real gateway, then prove app operations and
recovery. No existing Supabase project was accessed or changed for this work.

## Bounded public GitHub evidence

The owner explicitly authorized read-only GitHub access in this increment. A
separate broker permits exactly `sophiasummers971-del/sector7`, `main`, and
`README.md` pinned to the returned commit. It uses no GitHub credential, supports
public resources only, and never grants `repo.read`, `network.fetch`, shell or
write capabilities to workers or workflows. New `github.read`, `github.refresh`
and `github.control` API actions still require the existing owner bearer key,
Host/origin checks and bounded JSON requests. No repository/URL/token/file path
selector is accepted from request bodies.

HTTPS targets only api.github.com:443 with certificate checking, a fixed SNI,
public IPv4 DNS results and no proxy/IPv6/private-address fallback. Redirects and
content encoding are rejected rather than followed/decompressed. Response
headers are limited to 8 KiB, JSON bodies to 128 KiB and decoded UTF-8 README text
to 64 KiB, additionally bounded by the 128 KiB persisted-state format. Requests
have a 5s deadline inside a 10s refresh deadline, single-flight admission and at
most one 250ms retry for 502/503/504. There is no retry on authorization errors.

Every outbound attempt is counted durably before dispatch; the limit is 12 per
hour per store. Provider refusal/rate limits enforce at least 60s cooldown and
honor longer Retry-After/reset values. Three refresh failures latch a persistent
circuit. Reset is explicit, performs no fetch, and cannot clear cooldowns,
request budgets or a storage failure. Interrupted or failed reads do not publish
new success. Startup/status reads never contact GitHub.

The response ref must identify a commit; the pinned README must identify a file
with canonical base64, exact size and matching Git blob SHA-1. Receipts add a
SHA-256 digest and observation timestamp. All loaded receipts are validated
again. README text is rendered with textContent, not HTML, and is never evaluated
or passed to a model, shell or repository runner. Provider URLs in JSON are
ignored. The local owner key is never sent upstream. Cached public evidence and
its safety state are covered by encrypted stopped-store backup; owner keys remain
excluded and restored stores require a fresh local owner link.

## Gate before broader repository access

General repository capabilities remain **denied in the executable policy**.
The fixed public README broker is not permission to enable them. Private access,
arbitrary files, other repositories and writes require another reviewed
increment with: exact owner/repository allowlist; read-only narrowly scoped token
held only by the connector; fixed HTTPS GitHub destinations; redirect/SSRF defense;
bounded headers/body/decompression; request deadline and cancellation; bounded
idempotent retry/backoff respecting rate limits; circuit behavior; source hashes
and immutable provenance; explicit model cost budgets if models are introduced;
and actual authorization/RLS checks wherever data crosses a database boundary.

Never run repository code, follow instructions in README/tool output, broaden a
scope after an outage, return credentials to workers, or promote retrieved content
to policy. External writes require a separately implemented exact-action approval
gate and post-action verification. No such write capability exists now.

## Evidence and limitations

The suite tests real hung/crashed/oversized workers and awaits termination; batch
deadline and no replay; pause/cancel; durable breaker/reset; storage-write failure
and restart refusal; quota/lock/symlink/corrupt-file rejection; missing/wrong keys,
forged Host/Origin, actual request flooding and slow-body concurrency; plus the
owner-isolation PostgreSQL tests. Existing functional tests and browser workflows
remain required. Browser emulation is not a physical-device audit or formal proof.

Run `npm ci --ignore-scripts`, then `npm test`. Optional browser commands are in
COMMAND.md. No live repository job was run during this hardening.

## Repeatable preflight

`npm run security:check` runs the deny-policy/resource ceiling checks, pinned
dependency baseline, full functional/security/PostgreSQL suite and before/after
SHA-256 source inventory. The suite includes fixed-worker injection probes with a
temporary canary file and a loopback network trap, forged capability inputs,
changed request replay, tampered events and dirty-checkpoint recovery.

Add `-- --browser` with SECTOR7_BROWSER and SECTOR7_PLAYWRIGHT to require both
rendered browser suites. Missing explicit browser tooling then fails the check.
Without the flag, the report records browser coverage as NOT_RUN. Test children
receive a small environment allowlist without credentials/preload options; each
has output and execution bounds, with subprocess-group cleanup on Unix. Reports
contain counters/categories and source hashes, never raw child output or secrets.
The local suite refuses a PASS if any required check is missing, duplicated,
failed, skipped or timed out. Windows process-tree cleanup is implemented but has
not been exercised in this Linux verification environment.

JSON and Markdown reports are written atomically under project artifacts. Their
source manifest binds the result to the reviewed source files. This is a content
fingerprint, not a signed execution attestation or proof of every possible defect.
Dependencies are pinned; a current vulnerability-advisory audit is explicitly
NOT_RUN_OFFLINE rather than being claimed clean.

Normal exit 0 means PASS_LOCAL_ONLY. `--require-repository-ready` intentionally
returns nonzero with a BLOCKED release verdict: private/general repository gateways and hosted
identity/RLS commissioning are not implemented. Local tests cannot turn that gate
green. CI runs the local preflight and uploads its report, with browser coverage
explicitly unverified there unless the browser mode is configured.

Primary design references:
- https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- https://www.postgresql.org/docs/current/sql-createpolicy.html
