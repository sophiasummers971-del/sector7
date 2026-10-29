# Sector 7

**Security baseline:** see [SECURITY.md](SECURITY.md). All API calls now require an owner key. The server is loopback-only; the earlier plain-HTTP LAN setup is disabled. Repository access remains denied.

## Mission control

The new home screen is a responsive command centre: mission template, worker map,
recorded carrier feed, result inspection and clearly labelled message replay.
Start with `npm start` (`npm.cmd start` on Windows), then open http://127.0.0.1:3000/.
The existing linear workflow editor is preserved at http://127.0.0.1:3000/studio.

The first mission is a **local rehearsal using four fictional repository samples**.
It runs the real saved coordinator, not a live GitHub crawler or AI model. See
[COMMAND.md](COMMAND.md) for behavior and verification and [SCOUT.md](SCOUT.md)
for the coordinator contract. A [standalone recorded preview](docs/sector7-command-preview.html)
can be downloaded and opened without a server; its run button is disabled.

Owner-reported verification (2026-10-18): Jade reports that approval controls and restart behaviour were exercised successfully on both the Honor Magic 6 Lite and Surface. This is owner-reported device verification, not independently observed by Codex.

Jade's phone-first workflow coordinator. This local prototype edits and executes one linear chain: one Start → local Ping or text-processing nodes, with optional Approval pauses → one Result. Plain HTML/CSS/JavaScript, one Node built-in HTTP server, no dependencies or external integrations.

Sector 9 and Velvet Vault are separate projects. Independent systems must enforce their own permissions; outages never expand authority. Carrier bots may be deterministic handoffs. Broader architecture proposals are background ideas, not implemented guarantees.

## Start and stop

```powershell
Set-Location E:\Sector7
npm.cmd start
```

Open the **private owner link printed in your terminal**. Its fragment bootstraps a
session credential and is immediately removed from the visible URL. Do not share
that link. The regular localhost URL serves the interface but cannot access any
API without the key. The studio is at `/studio` in the same browser tab/session.
Stop with Ctrl+C. The default address is 127.0.0.1:3000.

The owner key is generated into the ignored data directory with restrictive file
permissions, or supplied through SECTOR7_ACCESS_TOKEN (40–128 URL-safe characters).
There is no anonymous API fallback. LAN binding is refused until an authenticated
TLS access path is separately commissioned; no firewall or tunnel is configured.

The app uses Node built-ins. For the PostgreSQL RLS development tests, run
`npm ci --ignore-scripts` once; PGlite is a pinned development-only dependency.
Use `npm.cmd` on Windows and do not change PowerShell execution policy.

## Local text review preset

1. Choose Load text review preset. It replaces the browser draft only, opening Text Input settings. Your saved graph and existing runs remain unchanged until you explicitly save.
2. Enter your message and tap Apply settings to draft. Close the sheet, tap Text Transform, choose uppercase, lowercase or trim, then Apply settings. Close and Save workflow.
3. Choose Run and Start new run. The server executes Start -> Text Input -> Text Transform -> Approval, then persists WAITING_APPROVAL. The amber card shows the exact transformed text from this run, including whitespace.
4. Approve continues this snapshot to Result. Result output appears below the selected-run summary with Copy approved text. Reject or Cancel prevents Result from executing. Retry same run retrieves the original run with its saved settings; edits require a new run/key.

Text Input settings are `{text: string}` (empty is permitted; maximum 500 UTF-16 code units). Text Transform settings are `{operation: "uppercase" | "lowercase" | "trim"}`. Transform requires upstream text output; Ping replaces its predecessor output with pong, so placing a Transform after Ping without another Text Input is rejected. Multiple transforms are allowed in the same linear chain. Each consumes actual predecessor text. JavaScript's locale-independent case conversion and trim are used; trim removes leading/trailing whitespace, not internal whitespace. Transformed output is bounded to 2000 UTF-16 code units, checked during graph validation, including case-expansion chains. The existing whole-request 4096-byte limit also applies, so graphs with many long or multibyte text settings can hit that smaller byte budget (413).

Settings persist with the saved definition and are copied into each run snapshot. Existing id/type-only graphs retain their revisions. Text is displayed through DOM textContent/value, never evaluated as HTML. Text is stored unencrypted in local graph/task JSON, and protected by the local owner key over the API; do not enter secrets into fixture rehearsals. Copy tries the browser Clipboard API, then a user-triggered legacy copy fallback for plain LAN HTTP. If unavailable it reports that and selects the output for manual copying; it never claims copy success on a reported failure. Clipboard access varies by browser. The preset includes Approval, but custom text graphs may omit it; a completed Result alone is not an identity check or proof of human approval.

There is still one saved-workflow slot: saving a preset replaces that definition, not historical run snapshots. No graph library or automatic backup/version history is implemented. Draft edits live only in the current browser page until saved; applying settings alone is not server persistence. No external services or AI dependencies are used.

## Edit, save and run

1. Choose Build. Add Start, Ping, Text Input, Text Transform, Approval or Result from the bottom Add node toolbar. Tap a node to inspect it in a bottom sheet; Close or Escape dismisses the sheet.
2. Tap an output port, then a highlighted input. Invalid connections show a message beside the relevant node. Select a connecting line (or use Review connections), then remove it in the sheet. Removing a node also removes its connections. No dragging required.
3. Save workflow validates the whole draft on the server. Validation/network errors preserve the draft. Reload saved deliberately discards local edits. Connection and saved/unsaved/saving states are shown separately; disabled actions have contextual explanations.
4. Choose Run. Start new run creates a fresh key and executes the saved definition. Retry same run retains the original request/key, including after edits to the saved workflow. Keys and raw records live under collapsed Technical details, not the primary controls.
5. The selected run remains visible after actions. Its canvas is a read-only snapshot with server-confirmed per-node states. Build still holds your separate draft. Run history is collapsed by default; selecting a history entry restores its run and original request. Workflow display names (Ping relay / Approval relay / Text review) are generated from the selected graph, not persisted editable names.

States come from server records, not animated guesses. Awaiting a response is separate from execution. Failed requests and ten-second browser timeouts do not prove execution stopped; retry the same key to reconcile. Completed ping chains are fast, so no intermediate progress is promised. Legacy direct ping tasks remain inspectable and retryable, but have no graph snapshot; none is invented for them.

### Interface and guided testing

The interface uses near-black plum, charcoal, violet/cyan accents, amber pauses and coral errors, with native controls and local SVG icons. No external fonts, visual libraries, full-screen blur, continuous animation or background polling. The header connection badge reflects the last response; Refresh checks again. Static frontend assets are cached in server memory until restart; there is no development watcher.

The canvas intentionally pans inside its own viewport. Fit workflow fits width; longer chains still require panning. Zoom controls change spacing/canvas width while keeping node text at its readable size; this is not a miniature whole-graph overview. Ports and visible controls have at least 44px touch targets. Brief connection highlights are tied to newly confirmed node completions on the displayed run, never to decorative timers; reduced-motion disables them. Node details use plain-language inputs/status/results, with raw data collapsed. History and the bounded, page-session request log are also collapsed by default.

Test this workflow only offers scenarios supported by the selected graph: normal execution without approvals, observed approval continuation, rejection/cancellation at Approval, and retry when a request/run exists. Each has a purpose, expected behavior, observed evidence and a next-action button. PASS requires record checks; execution is never inferred from animation. A failed HTTP request leaves the execution outcome NOT VERIFIED, with a coral error, rather than fabricating a failed/completed task. A mismatch in returned records can produce FAIL. Test verdicts for observed approval/retry sequences are page-session evidence and can become NOT VERIFIED after reload; stored task results remain available in history.

Restart persistence has its own collapsed instructions and starts NOT VERIFIED. Capture a selected completed/waiting/stopped run and saved definition, restart Node on the Surface, then Check after real restart. GET /api/status returns a fresh non-secret instance identifier for each server process. The check requires a different instance, stable during the reads, and exact equality of the selected run and saved definition. Same-instance browser refresh cannot pass. A baseline is retained in browser sessionStorage when available; no server restart is triggered by the UI. This checks the selected record/definition, not the entire store, formal durability or identity.

### Approval workflow feature

Place an Approval node before a Ping you want to pause. For example: Start → Ping → Approval → Ping → Result. Run it and the server persists `WAITING_APPROVAL`, a pause identifier, the snapshot, and completed upstream results. The downstream Ping and Result have not executed. A prominent amber card identifies the run, pending action and exact continuation through the next Approval or Result. Raw keys remain under Technical details. Use Refresh to check current state; there is no background polling. Actions on an amber card are bound to that specific run and pause, and busy controls prevent accidental repeated submissions.

- Approve this step continues that same snapshot from its completed prefix, until the next Approval or the Result. It does not approve later Approval nodes.
- Reject run and Cancel run are terminal for a waiting run. Neither executes downstream nodes, and neither undoes already-completed upstream work.
- Decisions leave receipts in the run's approvals array and task history. The first recorded decision for that pause wins. Repeating the same decision returns the run's current state without re-executing; a conflicting decision returns 409. A stale decision for an earlier pause cannot release a later pause.
- Reloading the page or restarting the server retains a waiting pause. There is no automatic approval, timeout approval or replay. Editing/saving the current graph does not change a waiting run's snapshot. A task-key retry only retrieves the run; it is not an approval.

Approval routes now require the local owner key. This authenticates possession of that key, not a named human or independent approver. Pause identifiers only distinguish requests; they do not confer authority. No external system is given permissions by this prototype.

## API and execution

- GET `/api/workflow` returns `{revision, definition}`. PUT `/api/workflow` accepts exactly `{nodes, edges}`. A legacy node is `{id, type}`; text nodes also require `settings`; an edge is `{from, to}`. Types: `start`, `system.ping`, `text.input`, `text.transform`, `approval`, `result`. Node IDs use 1–40 letters, digits, underscores or hyphens.
- GET `/api/status` returns `{instanceId, startedAt}` for the current process. This read-only endpoint supports connection/restart checks, not authorisation. Only the explicit index/app/evidence/CSS assets are served; the task and execution APIs are unchanged by the redesign.
- The server rejects cycles (including isolated cycles), unsupported types/fields, missing or duplicate IDs, missing endpoints, duplicate edges, disconnected nodes, branching, merging and wrong endpoint directions. Exactly one Start, one Result, at least one Ping or Text Input and optional Transforms/Approvals are allowed (3–12 total). Only valid definitions are saved.
- POST `/api/tasks` for a graph run accepts exactly `{operationKey, action: "workflow.run", workflowRevision}`. The revision must match the saved graph for a new task. The server copies and persists that definition into the run before executing it.
- Execution traverses validated connections in dependency order, independently of node-array order. Start produces the operation key; each Ping receives its predecessor's output and returns its own pong, timestamp and node ID; Result forwards its predecessor's actual output. Each executed node records its inputs and result in nodeResults. No user-supplied code, executable, URL or tool name is evaluated.
- Repeating the same key/action/revision returns the original run in its current state (200), even if the saved graph has since changed. Decisions can change that run's state but not its snapshot. Changing that key's payload conflicts (409). A new key with a stale revision also returns 409. New runs return 201. Keys use 1–80 letters, digits, underscores or hyphens.
- POST `/api/tasks/:id/approval` accepts exactly `{approvalId, decision}`, with decision `approve`, `reject` or `cancel`. The pause ID comes from the persisted waitingApproval object. Valid decisions return 200 with the current task and a duplicate flag. Unknown runs return 404; invalid input 400; stale/non-waiting pauses or conflicting decisions 409. Origin and body-size checks also apply. Decisions share the server's serial write queue with submissions and graph saves.
- The legacy direct action `{operationKey, action: "system.ping"}` remains compatible; it runs one local ping, separately from graph execution. Old records are preserved without migration. GET `/api/tasks` returns newest first.
- All request bodies are limited to 4096 bytes. Invalid JSON/schema/graphs return 400; wrong media type 415; oversize 413. Browser origin checks reject cross-origin requests; API calls remain same-origin.

## Storage and limits

`data/tasks.json` retains up to 1,000 tasks. `data/workflow.json` stores one validated workflow and a SHA-256 content revision. First start creates the default definition if none exists. Both use project-local temporary-file writes and rename. Submissions, decisions and graph saves share one serial queue in one process. Waiting runs remain WAITING_APPROVAL across restart. A decision is persisted before any approved downstream work executes. If the process stops during continuation, a running task becomes interrupted and is not replayed; retrying the recorded decision does not execute it again. Deduplication also applies to interrupted records. This is a single-process safeguard, not a general exactly-once guarantee for external effects.

Run only one server per data directory. Whole-file JSON storage is not a database isolation guarantee, multi-process coordination or guaranteed power-loss durability. A crash during a segment can leave an interrupted run without that segment's per-node progress; there is no crash-resume, rollback or compensation. SD failure can lose data. Storage errors stop further writes until restart; corrupt JSON or an invalid stored workflow prevents startup rather than silently resetting it. Do not delete data to resolve a key conflict.

One workflow, one editor is the intended use: the last valid save wins; there is no compare-and-swap protection for concurrent editors, undo stack or revision history beyond run snapshots. Unsaved drafts and unsubmitted operation keys are not retained across page reloads. History restores submitted runs.

Every API route requires the owner key and enforces the local action allowlist. The listener is loopback-only with Host/origin checks; no LAN or public access is enabled. Shared keys do not provide per-person attribution, MFA or a hostile-OS boundary. Cancellation is supported at waiting pauses, not as an interrupt for synchronous running Pings. No branching, drag positioning, external tools, AI workers, schedules or general plugins exist. No full accessibility audit, RTL/localisation support, production-readiness claim or hardware benchmark. Native buttons, focus outlines, selection states and live error/status regions are provided. Approval prompts are inline groups and do not steal focus or preselect approval.

Phone/LAN access is deliberately unavailable pending protected remote access. See SECURITY.md.

## Verification and checkpoints

```powershell
npm.cmd test
npm.cmd run test:browser
git diff --check
```

The default Node suite uses disposable project-local data and short-lived loopback servers, with test-file concurrency set to one. It checks legacy history/deduplication, saved graph reload, invalid graph rejection, edge-driven execution, immutable snapshots and revision conflicts. Approval checks cover persisted waiting state with no downstream Ping, editing while waiting, restart without auto-approval, validation, concurrent duplicate decisions, terminal rejection/cancellation, and stale requests across multiple Approval nodes. Additional evidence tests reject false PASS results, require observed pauses and receipts, and distinguish a browser refresh from a different server instance. It does not submit to the live LAN server.

The optional rendered test uses already installed Chrome (SECTOR7_BROWSER can override its executable), with disposable project-local profile/data. It checks emulated 390px, 320px and 1024px widths, touch sizes, Build/Run, bottom-sheet/Escape behavior, ports and connection errors/removal, draft retention after offline save, readable zoom, guided verdicts, bound approval actions, duplicate suppression and reduced motion. It performs a real isolated-server restart and verifies that browser refresh alone does not pass persistence. Normally profile/data are removed afterward; an interrupted run can leave an ignored disposable directory. Screenshots under artifacts/ are diagnostic evidence, not physical Honor Magic 6 Lite testing. RTL and a full accessibility audit remain unverified. See CHECKS.md for actual results.

Local checkpoints, with runtime data/logs/secrets/caches excluded and no push:

- Before the fixed visual workflow: `7dbc38d3738aaba6e2fcd83bd28da6ab54700190`.
- Completed fixed visual workflow, before editable canvas: `56282cf3722fa3e172761bdc5113b09923262146`.
- Verified editable canvas before Approval support: `6d446d7fe6bb7fab8274f6f268df0d82536aaa2a` (fresh 13-test API suite and rendered editor check passed before this checkpoint).
- Approval implementation before the interface redesign: `4b1a9f1c0f8e8987ffac2ee987def39df93c0e54`.

- Redesigned interface and owner-reported phone/Surface approval/restart checks before text support: `6009111`.
