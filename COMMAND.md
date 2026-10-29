# Mission control — 29 October 2026

Sector 7 now opens on a graphite/lime mission command centre. It connects the
offline coordinator to a responsive worker map, a persisted carrier feed, result
cards and a node/result inspector. The existing linear editor is at `/studio`.

## Use it

Run `npm start` (`npm.cmd start` on Windows), then open the default loopback URL
http://127.0.0.1:3000/. Select one or more of workflow/local/queue and choose
Run rehearsal. Four fictional repository samples are processed by at most two
asynchronous local slots. Scores count literal README matches only.

The runtime is not publicly hosted. Existing private-LAN binding and authentication
limitations still apply. There is no general natural-language mission planner,
live GitHub adapter, external AI, model billing or independent worker identity yet.

The home page reads actual saved jobs and events. Fast local work can finish before
the first refresh; the UI does not insert fake work delays. Replay messages is an
explicit replay of recorded packets, labelled NOT LIVE throughout. The run status
remains the saved outcome; reconstructed worker states use the displayed prefix.
Inspecting a node/result opens a native dialog with relevant execution evidence.

The browser retains the last operation key and terms when localStorage is available.
A reload retrieves the saved run. If a response is lost, Retry same request uses
the original key rather than generating another task. This browser record is not
an authentication token. Storage-disabled browsers cannot retain it across reload.
Polls are bounded to a submission window; the connection badge is last observed,
not continuous monitoring. Refresh reconciles the selected run.

## API

- `POST /api/scout`: exactly `{operationKey, terms}`; acknowledges with 202.
  Only the bundled fictional samples can be dispatched. Shared JSON content-type,
  origin and 4096-byte checks apply. One batch is active per server process.
- `GET /api/scout/:operationKey`: returns `{run, active}`. Dispatch acknowledgements
  do not claim completion. A request can be accepted and then fail in storage;
  GET reports that failure. Changed same-key inputs surface as 409 on reconciliation.
- Raw input assets are not served. Only the run record is returned. File paths are
  derived from a validated operation key hash inside the configured data directory.
- An old unfinished record without a current in-process coordinator is displayed
  as interrupted. Reading it does not replay work or remove stale locks.
- Shutdown waits for the active local batch. Runtime data remains excluded from Git.

## Verification

47 Node tests passed: 40 existing coordinator/workflow tests, six new HTTP subtests
and their parent. New checks cover explicit home/studio routes, bounded/cross-origin
requests, real dispatch/result provenance, duplicate retrieval, conflicting input
and results across an actual server process restart.

New rendered Chromium checks passed at 1440px, 390px and 320px with no page-wide
horizontal overflow. Exercised launch/results, all 12 persisted carrier events,
inspectors and Escape, explicit replay and stop, saved-run reload, offline failure
with same-key retry after reconnection, and navigation to the existing studio.
No browser JavaScript exceptions were observed. Reduced motion was enabled.

The existing full studio browser suite also passed: editing, text settings,
literal text rendering, approval/reject/cancel, duplicate protection, copy fallback,
offline errors, restart evidence and 390/320/1024px layouts. This is desktop browser
emulation, not independent physical Honor-device or full accessibility verification.

Optional browser commands use host-provided tools without adding app dependencies:

```sh
SECTOR7_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs SECTOR7_BROWSER=/absolute/path/to/chromium npm run test:command-browser
SECTOR7_BROWSER=/absolute/path/to/chrome npm run test:browser
```

Screenshots from the real browser run: [desktop](docs/command-desktop.png),
[phone](docs/command-phone.png), [small phone](docs/command-small-phone.png).
The standalone HTML preview embeds an actual recorded fictional-sample run;
its start control is disabled, while inspection and recorded replay work offline.

The 12ui hosted draft could not run without a separate sign-in. Automatic approval
review blocked the Superdesign CLI's unapproved telemetry endpoint. No hosted
design was generated or claimed; the interface was authored and reviewed locally.
