# Sector7 // The Living Foundry

Status: **implemented draft vertical slice; rendered acceptance outstanding**.
Updated: 31 October 2026. Motto: THE FACTORY NEVER FAKES A SIGNAL.

## Source audit and integration choice

- Inspected remote main `9e9963b` and open PR #1, head `4e9cf37`, branch
  `feat/bounded-scout-carriers`. These were the only fetched remote branches.
- The recovered local checkout's `main` at `e4824bc` had the same tracked file
  contents as the PR head, with different local commit history. The redesign
  starts from the actual remote PR head, not that local branch name.
- Main has the existing local linear workflow editor; PR #1 adds Mission Control,
  the bounded fictional-sample coordinator, owner authentication and local
  security preflight. PR #1 is a suitable integration base, not merge-ready proof.
  Reuse that one PR, now draft; do not merge or deploy automatically.
- Read AGENTS.md, README.md, SECURITY.md, COMMAND.md, tests, preview generator and
  `.github/workflows/verify.yml`. Read the current saved command-preview HTML.
  Its lime visual direction is superseded by the owner's cyan/turquoise override.
- Node >=24, plain browser modules/CSS/SVG, built-in HTTP server. `npm start`;
  Windows `npm.cmd start`. Development-only pinned PGlite supports SQL tests.
  Loopback only. Every API needs the owner bearer key from the private startup
  link. No network/repository/shell capability exists inside the application.

## Architecture and completed slice

The home page has three stable zones: control frame, signal field, execution
trace. Results and an explicitly unavailable external-swarm section sit below.
The desktop grid uses the available width, including a 3840px breakpoint; mobile
places controls, field, trace and results in sequence. These are implemented CSS
rules, not verified rendered measurements.

`public/tokens.css` supplies cyan/turquoise, violet, amber and coral tokens to
both home and the existing `/studio` editor. Success has a checkmark and text;
it never depends on green. A regression test checks all shipped styles for acid
or lime tokens and fluorescent green values. Historical before screenshots are
not the finished interface.

`public/foundry-state.js` is a pure presentation layer for outcome labels,
worker projection, route selection and workflow inventory. It grants no authority.
`public/command.js` reads the existing APIs and renders saved receipts through
textContent, with native inspect dialogs. Inventory is explicitly **workflow**
inventory, not an invented global scout-history count. No scout-history listing,
continuous heartbeat monitor, stall detector or general job scheduler is claimed.

The signal field uses bounded SVG/CSS: one finite pulse for a newly observed
saved event, never a perpetual worker flicker. Fast jobs can finish before polling;
only recorded transitions are shown. Replay reconstructs an event prefix, remains
labelled NOT LIVE and submits no work. Inspection exposes saved event sequence,
timestamp, job/source references and hashes. Completed README matches are not
verified repository/security claims.

The camera changes presentation only. Zoom, fit, native scroll/touch pan, blank
space mouse drag and keyboard shortcuts are implemented. Reduced-motion CSS
and low-power mode disable animation; low-power also removes expensive shadows.
Themes (Industrial Factory, Neon Command Deck, Minimal Operations), event
intensity and low-power preferences have their own localStorage key, independent
of workflow data, request keys and tab-only owner credentials.

The existing workflow editor retains its validated linear transitions, typed
text transforms, configurable nodes, input/output inspection, history and bound
approval controls. It gets shared tokens, persisted appearance and a home link.
This increment does not introduce a new branching graph engine or rewrite its
approval semantics.

## Starting desk addition — 31 October 2026

The home page now opens with “What’s on your mind, Jade?”, an optional idea box
and up to three read-only starting suggestions. Confirmed saved records provide
waiting-approval counts, the current workflow, workflow history and an unresolved
scout request. Without a confirmed connection only reconnection is offered; the
standalone preview only offers inspection of its historical receipts.

The idea box keeps up to 500 characters on the current page, rendered literally.
It neither persists nor transmits them, generates a plan, modifies a workflow,
submits a job or grants approval. The UI explicitly says that no AI chat is
connected. Suggestions open existing foundry tools, inspect receipts or refresh
read-only state. A text-review suggestion opens the existing preset; it does not
automatically load/save the preset or start it. No execution backend changed.

Two new executable tests cover confirmed/stale suggestion selection and literal
idea handling with zero API requests and unchanged request persistence. The final
suite has 100 passing tests. A browser interaction check was added but remains
unexecuted under the same environment limitations below.

## Safety repairs included

1. Restored request keys become unresolved before connectivity is checked. Initial
   disconnects and early clicks cannot silently replace a pending key. Actions
   are disabled while owner connectivity is unconfirmed; handler guards remain
   even if a button is manipulated. The server independently authenticates all APIs.
2. A terminal batch outcome cannot leave a previously accepted worker displayed
   as running. Interrupted/cancelled/failed/unknown projections are explicit.
3. An existing invalid run JSON value (null, false, zero, array) is rejected without
   replacing either saved input or run history.
4. Same-value object-property order changes no longer break idempotent retries.
   Existing fingerprints and per-source hashes remain valid without migration;
   tests construct and reload a valid older ordering. Array order still matters.
5. A pending same-key changed-payload submission cannot expose the old terminal
   result as a new success while conflict validation is still in progress.

No OSIRIS or Pegasus policy, database migration, real user record, live service,
network binding or deployment configuration was changed. JSON remains local
single-process custody. Prospective SQL RLS tests do not establish hosted RLS.
Pause & stop remains available during submission; it requests cancellation, not
instant verified termination. Refresh confirms the saved terminal record. A
circuit reset still requires review and leaves dispatch paused. Home Approve and
Reject explain why unavailable and link to the exact workflow approval surface.
There is no authorised external swarm backend and its launch control is disabled.

## Reproducible evidence

| Check | Actual result |
| --- | --- |
| Remote PR-head baseline, before changes | 90 tests passed, none failed/skipped |
| Final functional/security/PostgreSQL/controller suite | 100 passed, 0 failed/skipped/cancelled |
| Full local security preflight | PASS_LOCAL_ONLY; external repository readiness BLOCKED |
| Changed-source syntax and diff whitespace | Checked locally |
| Replay and receipt inspection | Shipped controller exercised in a minimal DOM harness; no API requests |
| Offline reload / manipulated launch | Original key retained; no POST in controller harness |
| Standalone preview / manipulated controls | All API activity denied, including replay/inspection |
| Old saved fingerprints / corrupt state / conflict race | Executed regression tests passed |
| Unauthorised API mutation / approval / restart recovery | Existing executable security and persistence tests retained |
| 320 / 390 / 1440 / 3840px rendered layout | **NOT RUN for redesign** |
| Rendered keyboard / touch / reduced motion / contrast audit | **NOT RUN for redesign** |
| Browser replay, preference reload and forged-credential scenario | Added to rendered suite; **NOT RUN here** |
| Physical low-powered hardware CPU, memory and frame pacing | **NOT MEASURED** |
| Current dependency advisory audit | NOT_RUN_OFFLINE |

The controller harness uses the actual shipped JavaScript and fake DOM/fetch
objects. It tests behaviour, not browser layout, accessibility or rendering.
The full preflight uses isolated data and loopback servers, and verifies policy,
resource ceilings and unchanged source hashes. Machine-readable evidence is in
`security-preflight.json` and its companion Markdown report in this folder.

The six home assets total 59,458 bytes uncompressed (19,068 bytes separately
compressed with gzip). This is payload size, not proof of low CPU usage. There
are no added runtime dependencies, WebGL engine, watchers, background polling
loop or decorative animation loop. Submission polling and explicit historical
replay are bounded; replay stops when hidden.

## Blockers and screenshots

The container has Playwright but no browser executable. An optional 12ui install
was rejected by automatic approval review because downloading/executing that
package conflicted with the local-only repository restriction. No hosted design
output was produced. A separate cloud browser rejected the local file URL under
its browser URL policy. No alternate protocol, network exposure, public preview,
browser installation or policy bypass was used.

`before-desktop.png` and `before-phone.png` are copies of the repository's
**historical original command-centre captures**, not fresh baseline captures.
There are **no after screenshots yet**. Do not use those old screenshots to
accept the new layout. The downloadable `../sector7-command-preview.html` is
an explicitly recorded, standalone preview, not current worker activity.

Minimum remaining acceptance: run the two browser suites on an authorised host
with Chrome, inspect the generated 320/390/1440/3840 screenshots, exercise native
keyboard/touch and contrast, measure idle and replay CPU on the actual desktop
or Surface, and repair any findings. Keep this PR draft until then. No claim of
visual polish accepted by the owner or full mission completion is made.

## Desktop integration handover

Preserve local changes and data before integration. Use an existing clean
checkout; do not reset, clean, remove stale locks or overwrite user records.
The PR branch is `feat/bounded-scout-carriers`. Fetch and inspect its diff before
fast-forwarding a clean local tracking branch. The original Surface path was
E:\Sector7; the current desktop checkout path has not been verified.

From the project directory on Windows:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd start
```

Open the private owner link printed in the local terminal. Do not share it or
capture it in screenshots. The root page is the Foundry; `/studio` preserves the
editor in the same session. Loopback-only access is deliberate; do not enable a
phone/LAN binding to test this design.

Stop with Ctrl+C. For rendered acceptance, configure the already installed
Chrome executable and Playwright module paths (do not copy the examples literally):

```powershell
$env:SECTOR7_BROWSER = 'C:\path\to\chrome.exe'
$env:SECTOR7_PLAYWRIGHT = 'C:\path\to\playwright\index.mjs'
npm.cmd run test:command-browser
npm.cmd run test:browser
npm.cmd run security:check -- --browser
```

The command browser suite writes after screenshots under `docs/living-foundry/`.
It now includes 3840px, preference reload, camera keyboard controls, event receipts,
reduced motion and an unauthenticated mutation denial. Inspect the screenshots
and actual physical hardware before calling the redesign accepted. A single
3840px viewport does not prove multi-window or physical dual-display behaviour.
