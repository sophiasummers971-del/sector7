# Local verification — 2026-10-18

Owner-reported verification (2026-10-18): Jade reports that approval controls and restart behaviour were exercised successfully on both the Honor Magic 6 Lite and Surface. This is owner-reported device verification, not independently observed by Codex.


## Local text input, transform and approval

Recorded Jade's successful phone/Surface approval and restart checks as owner-reported verification, not independent device observation. Created local source/documentation checkpoint `600911111a4809368565e7f570ddcceff4da3527` before text changes, using an explicit file allowlist; no data/logs/secrets/caches or push.

Changed workflow.js; public/app.js, public/evidence.js, public/index.html, public/styles.css; test/prototype.test.js, test/ui-evidence.test.js, test/browser-check.js; README.md and CHECKS.md. Server API/storage/approval implementation unchanged. Added exact settings schemas for text.input/text.transform; validates upstream text and transformation expansion before save. Actual predecessor output flows through transforms and approvals to Result. Existing id/type graph normalization/revisions are unchanged. Text Input maximum 500 UTF-16 units, transformed output maximum 2000, existing whole request limit 4096 bytes. No external services, code evaluation, AI dependencies or installs.

Preset loads the complete five-node chain into a draft and opens message settings; Apply settings then Save are explicit. It never silently overwrites the saved graph or old runs. Waiting preview and copyable Result use recorded text through textContent/value. Copy reports failure and selects text if clipboard/fallback is unavailable. One saved graph remains a limitation; saving another definition replaces that slot, with historical snapshots preserved.

Commands and actual outcomes:

- `node --check public/app.js`: exit 0.
- `npm.cmd test`: final exit 0; 29 passed, 0 failed/skipped. New isolated checks cover all three transforms including whitespace/HTML-like text/Unicode case expansion, node inputs/results, settings save/reload, edits while waiting, real restart without auto-approval, unchanged retries before/after approval, duplicate decisions, conflicting key reuse, rejection/cancellation without Result, invalid/oversize settings, unsupported operations and missing text input. Evidence tests reject fabricated predecessor/result data.
- `npm.cmd run test:browser`: final exit 0. Existing editor/run/approval/restart/responsive checks passed; added preset loading, message/operation settings, literal HTML-like preview with no inserted image/script execution, exact approved Result, and Copy feedback. Explicitly simulated an unavailable copy fallback and verified manual selection of the exact text. This does not independently verify the OS clipboard on Jade's phone. Emulated 390/320/1024px layouts have no page-wide overflow. Visually reviewed artifacts/sector7-text-phone.png; result/copy panel follows selected-run summary. Profiles/data are isolated and cleaned by tests.
- `git diff --check`: run after this documentation update; see command outcome in session.

LAN server was stopped on inspection. Started with `$env:SECTOR7_HOST='192.168.0.86'`, `$env:PORT='3000'`, `node server.js`; left running for Jade, PID 4564, at http://192.168.0.86:3000/. Verified listener and HTTP 200 for /, /app.js, /api/status, /api/tasks, /api/workflow. No live POST/PUT/decision used for checks. All 46 existing records and the saved workflow were byte-identical before/after startup: tasks SHA-256 `9dea1e689e483774575e55a0683ef15cf3c17ab381a122c7bf6eb69ad05b37ed`; workflow `b6b17a011bfdd929d89ae42f11a9043e0a709019293ee29cf83d2c60978c190b`.

Unverified boundaries: new text flow/clipboard on physical Honor or Surface browser still needs owner review; prior device success refers to approval/restart controls. Approval is unauthenticated workflow control, not identity verification. Text is stored unencrypted and readable by reachable LAN clients. No production security/durability or hardware performance claim; no firewall changes, public exposure or external calls.

## Velvet cyberpunk interface and evidence-led guided tests

Checkpointed working approval source/documentation before edits: `4b1a9f1c0f8e8987ffac2ee987def39df93c0e54` (Checkpoint approval workflow before interface redesign). Explicit source allowlist only; no runtime data, credentials, logs, profiles or caches; no push.

Changed public/index.html; added public/styles.css, public/app.js and public/evidence.js; updated server.js, package.json, test/prototype.test.js, test/browser-check.js; added test/ui-evidence.test.js; updated README.md and this file. workflow.js and the task/approval execution implementation remain unchanged. Server additions are an explicit static-asset allowlist, same-origin module serving, and read-only /api/status with a per-process UUID/start time for real restart checks. The UUID is not an authority or identity credential.

Implemented near-black plum/charcoal, violet/cyan accents and amber/coral state treatment, sticky compact header and Build/Run modes, a grid canvas with tap ports and valid targets, selected/removable connections, node-local errors, thumb toolbar, native bottom-sheet inspector, collapsed history/raw records/session request log, explicit selected-run context and plain-language evidence. No visual library, external font/image, dependency install, continuous animation or blur. Node text remains readable while zoom changes spacing; Fit fits width and keeps intentional canvas panning. Brief wire highlights only use newly confirmed completions belonging to the displayed run; reduced motion disables animation.

Guided verdict rules: normal checks snapshot order/final pong; repeat requires duplicate=true, original ID/key/snapshot and unchanged record plus one task for the key; approval requires observed pauses and matching decision receipts; reject/cancel require no downstream results after the observed gate. Missing/uncertain evidence stays NOT VERIFIED. Restart requires a captured baseline, a different server process UUID stable during the read, and matching selected-run plus saved-definition data. A browser refresh cannot pass; no UI endpoint restarts the server. These are local record checks, not formal security or durability guarantees.

Commands and final outcomes:

```powershell
node --check public/app.js
npm.cmd test
npm.cmd run test:browser
git diff --check
```

API/evidence suite: 26 passed, 0 failed, 0 skipped; final run duration 4439.1937 ms (test timing, not a performance benchmark). Existing idempotency, graph validation/execution, approval deduplication and restart tests passed. New checks cover stable/new server instance identities, explicit static routes, false completion/repeat/pause/stop verdicts, matching approval receipts and refusal to mark same-instance refresh or changed data as persistence PASS. Test-file concurrency is one; all data is disposable and isolated from live records.

Final Chrome browser run exited 0. Emulated 390x844, 320x740 and 1024x900: no page-wide horizontal overflow; visible controls measured at least 44px high; node text unchanged after zoom; Build/Run, node library/removal, native sheet close/Escape, ports/valid-target highlighting, self/occupied connection errors, connection selection/removal, server validation, offline-save draft retention, refresh recovery, selected-run retention and visibility, normal/repeat PASS, observed approval/approve PASS, reject/cancel PASS, duplicate-click protection and reduced motion all checked. Captured and visually inspected phone views including the amber waiting card with exact pending action and separate decisions. Browser refresh stayed NOT VERIFIED; the test then actually stopped/restarted its isolated server on the same port/data and obtained persistence PASS. No result was inferred from decorative motion or refresh alone.

During verification, corrected a browser Escape dispatch/close path, an assertion string affected by shell encoding, and a readiness probe that read the DOM before it existed. Screenshot review also caught outcomes remaining off-screen after lower-page edits; deliberate run/decision/history actions now reveal the selected outcome with sticky header/modes, and fresh viewport assertions passed afterward. These earlier failures were not counted as final passing evidence.

Screenshots (ignored runtime artifacts): sector7-run-phone.png, sector7-build-phone.png, sector7-approval-phone.png and sector7-desktop.png under artifacts/. They are desktop Chromium emulations, not actual Honor device evidence.

Live preservation: initial checkpoint saw 13 records; live activity brought the existing store to 22 before the old server was stopped. Both stores were hashed after stopping and after starting the redesign. All 22 task records were unchanged: tasks SHA-256 `9ac16ae96b730e0b6e94e4db580596ed44913e1dd1acb6471fa465fab41fc636`; saved workflow SHA-256 `b6b17a011bfdd929d89ae42f11a9043e0a709019293ee29cf83d2c60978c190b`. No live POST, graph save or decision was used for testing. Listener 192.168.0.86:3000, PID 3500; /, /app.js, /styles.css, /evidence.js, /api/status and /api/tasks each returned HTTP 200. Server left running for Jade. No verification browser/test processes remained in the final process check.

Boundaries: actual Honor Magic 6 Lite interaction, RTL/localisation and a full accessibility audit are not verified. Connection status is last observed with manual Refresh, not a continuous heartbeat. One saved graph, generated display names, spacing zoom/width-fit, no drag positioning. Approval remains unauthenticated; private-LAN/TLS, single-process JSON storage and crash limitations are unchanged. No firewall modification, public exposure, external integration or deployment. Final documentation checks follow this entry.

## Approval pauses and interrupted-session recovery

Before extending the editable canvas, fresh baseline checks passed: 13 API tests, rendered Chrome editing checks at 390px/1024px, and git diff --check. Created source/documentation-only checkpoint `6d446d7fe6bb7fab8274f6f268df0d82536aaa2a` (Checkpoint verified editable linear canvas). No runtime data, profiles, screenshots, credentials or logs were committed; no push.

Changed workflow.js, server.js, public/index.html, test/prototype.test.js, test/browser-check.js, README.md and CHECKS.md. Approval is a fourth validated linear node type. Execution persists its waiting prefix and WAITING_APPROVAL state; decisions are serialised and saved before continuation. Each pause has a unique request identifier and an immutable graph snapshot. The waiting UI displays run ID, key, Approval node, next action and bounded continuation. Approve, Reject and Cancel are native inline controls with no default approval or standing grant. No authentication or identity verification was added.

Trust boundary: untrusted LAN JSON enters the existing exact-schema, content-type, origin and 4096-byte checks. Decision requests identify an existing run and its current pause. The server verifies state and pause ID against persisted execution records, deduplicates recorded decisions and refuses conflicting or stale ones. Only snapshot-defined local Ping/Start/Result operations can continue; graph edits do not grant new actions to a waiting run. A pause identifier is not an identity or permission credential. Reachable LAN clients can decide; no credentials were read and no external integrations were added.

Regression evidence: adding Approval tests before implementation failed at graph save (400 instead of 200), while the 12 existing subchecks passed. After implementation, 19 tests passed. Following Jade's terminal interruption, confirmed source changes and checkpoint intact, no port-3000 listener, and no live verification processes; resumed without rewriting completed source. Fresh checks:

```powershell
node --check workflow.js
node --check server.js
npm.cmd test
npm.cmd run test:browser
```

Syntax checks passed. Latest API result: 19 passed, 0 failed, 0 skipped; 5268.8817 ms for that run (not a hardware benchmark). Approval assertions include: WAITING_APPROVAL present in the on-disk task; no downstream Ping/Result before decision; snapshot unchanged after graph edit; same-key retry still waiting; real process restart without auto-approval; invalid/stale/cross-origin decisions rejected; two concurrent identical approvals produce one receipt and one continuation; reject/cancel terminal records survive restart without downstream execution; a replay for Approval 1 cannot release Approval 2; completed decision replay after restart does not execute again. All task/graph writes for verification used isolated test stores.

Latest rendered Chrome result: exit 0, PASS at 390px and 1024px. Covered prior canvas editing/validation/execution, duplicates and offline errors, adding an Approval node by tap connections, visible waiting run/next action, page reload retaining the waiting run, approve continuing, and reject/cancel blocking downstream. Inspected artifacts/workflow-approval-phone.png visually. An interrupted attempt had no final result and was not counted. A fresh attempt then failed before UI assertions because the browser debugging port was unavailable within the original startup window; stopped only the identified test-profile Chrome processes, expanded the bounded startup wait and selected an explicit test-page target, and the next run passed. The harness now uses a browser-level close connection as well as page cleanup.

Runtime preservation and final live check: existing 13 records loaded unchanged. Tasks SHA-256 before/after start: `388E3FC16A3574E5A8CF9DAEC0D58E929DA06F25F1546237F8777AAFEDE8BBAD`. Saved workflow SHA-256 before/after: `B6B17A011BFDD929D89AE42F11A9043E0A709019293EE29CF83D2C60978C190B`. Listener 192.168.0.86:3000, PID 3200; page and task history returned 200, page contains Approval controls. No live POST/decision/save was submitted for testing. Server left running for the authorised phone test; firewall/configuration unchanged.

No verification browser processes remained. The interrupted run left ignored .browser-check-sivPFm; automatic approval review rejected its cleanup command as blocked by policy, so it was left in place. The completed fresh run removed its own disposable profile/data.

Limits: approval is a workflow feature, not a secure identity check. Decisions are deduplicated within the single-process file-backed model; first recorded decision wins. Cancellation is for waiting pauses and cannot undo upstream work. Crash during approved continuation becomes interrupted, never automatic replay. No claim of general exactly-once external effects, power-loss durability, full accessibility, physical-phone testing of this version or measured resource performance. No deployment, firewall rule, external tool or AI worker was added. Final documentation checks follow this edit.

## Editable linear canvas

Checkpointed the completed fixed workflow before editing: `56282cf3722fa3e172761bdc5113b09923262146` (message: Checkpoint completed fixed visual workflow). Used an explicit source/documentation allowlist; runtime data, screenshots/profiles, logs, credentials and caches were excluded. No push or remote configuration.

Changed files: workflow.js (new validator/revision builder/executor), server.js (saved workflow API and snapshotted runs), public/index.html (node editor, tap connections and snapshot inspection), test/prototype.test.js, test/browser-check.js, README.md and this file.

Trust boundary: LAN JSON requests are untrusted. Exact field/type/id limits and the existing 4096-byte bound apply before persistence; graph structure is validated before saving. Revision checks bind new task requests to the saved graph; retries compare the original action/revision before looking at the current graph. The only execution handlers are deterministic Start/Ping/Result operations, with no code evaluation, executable launch or external URL sink. JSON writes stay in project-local data. This does not add authentication: reachable LAN clients can save/run permitted graphs. No credential files were read for this work.

Focused commands:

```powershell
node --check workflow.js
node --check server.js
node --check test/browser-check.js
npm.cmd test
npm.cmd run test:browser
```

Syntax checks passed. Final API suite: 13 passed, 0 failed, 0 skipped, duration 2043.963 ms. Tests include saved reload; cycles/self-loops; unsupported types (including object values); disconnected nodes; missing endpoints; branching; reversed endpoint directions; duplicate nodes/edges; unsupported fields; excessive node count; cross-origin save denial; edge-driven execution with shuffled node arrays; predecessor input/output flow; old-snapshot equality after editing; same-key duplicate; changed-revision conflict; stale new-run conflict; and task/definition/snapshot persistence across restart. Tests used isolated data and never called the live LAN server.

Final rendered Chrome check exited 0 at 390px and 1024px with no horizontal overflow. Exercised selecting and inspecting nodes; add/remove Start and Result; add Ping; disconnected save error with draft retained; disconnect and tap-to-connect; valid save/reload; executing the edited four-node chain with nodeResults matching its actual edges; unchanged duplicate; fresh run key; and offline failure without success. Final phone screenshot was visually inspected. In this iteration an initial test still expected the old ping-* key prefix and failed; it was corrected to run-*. A later Chrome startup failed on Emulation.setDeviceMetricsOverride; a bounded startup readiness/timeout adjustment was followed by successful runs. Final UI adjustment collapses editing controls in snapshot mode; the rendered check was rerun afterward and passed.

Live restart: stopped only the identified existing Node listener, retaining the latest 12 task records. Before/after task-store SHA-256: `B9108304AEE4DE0708C6B05805245994F2B9FFAC4FA3C798780747B839C083A2` (unchanged). The store had received additional live activity during development; no runtime record was reset. Startup created data/workflow.json with the initial validated three-node definition. Final listener: 192.168.0.86:3000, PID 12432. LAN editor, tasks GET and workflow GET all returned 200. No live task POST or workflow PUT was used for verification. Left this server running for Jade's phone test. No temporary test folders or verification browser processes remained at the final check.

Not verified: physical-phone editing with this version, multi-editor conflict safety, full accessibility/RTL/localisation, abrupt power-loss durability or hardware performance. Single chain only, 3–12 nodes, one saved definition, last valid save wins. No external integrations, workers, firewall changes or deployment. Final documentation mutations are followed by git diff --check and explicit Markdown whitespace checks.

## First visual workflow

Before editing the workflow, committed the eight existing source/documentation files as local checkpoint `7dbc38d3738aaba6e2fcd83bd28da6ab54700190` using an explicit file allowlist. Runtime data, logs, credentials and caches were excluded. No remote or push was used. Commit command:

```powershell
git add -- .gitignore AGENTS.md CHECKS.md README.md package.json server.js public/index.html test/prototype.test.js
git -c user.name='Sector 7 Local' -c user.email='sector7@localhost' commit -m "Checkpoint local ping prototype before visual workflow"
```

Workflow changes: public/index.html adds connected Start/Ping/Result nodes, inspectors, separate request status, fresh draft keys, same-key retries and history selection. The existing server/API/storage are reused unchanged. package.json adds an optional browser check; test/prototype.test.js extends deterministic interaction coverage; test/browser-check.js adds real Chromium checks; .gitignore excludes browser profiles/screenshots/cache; README.md records behavior and limitations.

Final functional commands:

```powershell
node --check server.js
node --check test/browser-check.js
npm.cmd test
npm.cmd run test:browser
```

Both syntax checks passed. Default suite: 10 tests passed, 0 failed, 0 skipped, duration 1366.0218 ms. Assertions cover actual ping, duplicate equality, concurrent duplicates, conflicts, invalid requests, same-origin POST, inspectors, new keys, same-key retry after a failed request, honest pending states, history selection and restart persistence. All tests use isolated project-local stores; no test submits to the live LAN server.

Rendered Chrome check passed at 390px and 1024px, with no horizontal overflow: three nodes; each inspector's inputs/status/result; real ping; duplicate preserving the entire task; fresh operation key; offline request showing failure with Result unavailable. Screenshots in ignored artifacts/workflow-phone.png and workflow-desktop.png were visually inspected. The initial Edge attempt failed on `CDP timeout: Emulation.setDeviceMetricsOverride`; test-owned browser processes were identified and stopped. The final default Chrome run passed and removed its temporary profile/data. No verification browser processes or disposable test directories remained at the final process/directory check.

Runtime preservation: original store had 3 tasks and hash `480B7B6F2A853381DCFE8AF1B7885ADE29F81CB397F2949B211EF5A99251587E`. A fourth completed task appeared on the live server during work. The restart guard detected that change; a premature second launch then failed with EADDRINUSE while the original listener was still running. After inspecting the current disk/API records, stopped only the identified original Node server and restarted against the latest store. All 4 records remained and hash `5B3393E0F5AF2B2B9DD4639D9A8D39142C376AC2A183E7DD0D27A0ED74651D27` was unchanged across the successful restart.

Final live checks: listener 192.168.0.86:3000, PID 12308; page HTTP 200 with all three node IDs; task history HTTP 200 with 4 records. Left running for Jade's phone test. No firewall changes, public exposure, deployment or external integrations.

Boundaries: physical-phone interactions for this new canvas and post-restart phone resubmission remain unconfirmed. Headless Chrome is not the Honor phone. No full accessibility audit, RTL/localisation test, hardware benchmark or general workflow engine is claimed. Final documentation edits are checked separately with `git diff --check` and explicit Markdown whitespace checks.

## Private Wi-Fi follow-up

Changed server.js to accept an explicit private IPv4 SECTOR7_HOST while keeping loopback default; public/index.html now uses HTTP-compatible random key generation and displays the connection mode. Updated test/prototype.test.js, README.md and AGENTS.md.

Fresh `node --check server.js` passed. `npm.cmd test` reported 10 passed, 0 failed (1638.6933 ms); additions cover same-origin submission and page-script initialisation/submission without randomUUID in a simulated DOM. This is not rendered-browser evidence. `git diff --check` returned no output (files remain untracked, so this does not validate their whitespace).

Read-only network checks used Get-NetIPConfiguration, Get-NetConnectionProfile, Get-NetIPAddress and Get-NetTCPConnection. Wi-Fi profile: Private; address: 192.168.0.86/24. The existing loopback Node server was identified by PID/command and stopped before replacement. Launched with:

```powershell
$env:SECTOR7_HOST = '192.168.0.86'
node server.js
```

Replacement listener verified at 192.168.0.86:3000, PID 10676. Invoke-WebRequest from the Surface to that LAN address returned: page 200; same-origin ping POST 201/pong; duplicate POST 200/same task ID; history GET 200. One lan-check-* record was intentionally retained in data/tasks.json. The server was left running for the requested phone test.

Private Windows Firewall profile remained enabled. No firewall changes were made. Local LAN-address requests do not prove cross-device connectivity; actual phone rendering, accessibility and Wi-Fi routing/firewall acceptance remain unverified.

## Initial loopback verification

Commands executed from E:\Sector7 (PowerShell, no profile):

```powershell
git init
node --check server.js
npm.cmd test
```

Actual results: Git initialised E:/Sector7/.git/; syntax check exited successfully without output. Node test runner reported 8 tests passed, 0 failed, 0 cancelled, 0 skipped; total duration 1965.1193 ms for this run. This timing describes the test run only, not a hardware benchmark.

Seven subchecks plus their parent passed:

1. Successful execution with pong and created/running/completed history.
2. Duplicate submission returns the identical original record.
3. Concurrent duplicate submissions return 201 and 200 with one task ID.
4. Different valid payload using the original key returns 409.
5. Malformed JSON, null, arrays, missing fields, invalid keys, unsupported action and extra fields return 400; wrong content type returns 415; 4097-byte body returns 413.
6. HTML page returns 200; cross-origin POST returns 403.
7. Restart preserves original record, task count and conflict semantics.

Test harness spawned two servers sequentially on ephemeral loopback ports. Each child exit was awaited, and project-local temporary test storage was removed in finally. No persistent development server was launched. Browser rendering, phone access, abrupt power loss and disk-error recovery were not tested.

Final read-only inspection commands:

```powershell
git status --short
git diff --check
rg --files --hidden -g '!.git'
```

The required design skill was read with:

```powershell
Get-Content -LiteralPath 'C:\Users\sophi\.codex\plugins\cache\openai-curated-remote\12ui-design\0.2.65\skills\12ui-design\SKILL.md'
```

Its installation/hosted generation workflow was not run because the owner's local-only scope takes precedence. Project files were created through apply_patch; no package installation, network service call, firewall edit or deployment was performed. Git was initialised without staging, committing or configuring a remote.
