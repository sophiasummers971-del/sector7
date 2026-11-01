# Windows desktop acceptance — 1 November 2026

The repaired local implementation passed acceptance on DESKTOP-49J0FAD. This is
local-only integration evidence, not hosted-service or deployment commissioning.

## Changes and architecture

- Bounded Windows EPERM/EACCES/EBUSY retries preserve atomic replacement and the
  existing fail-closed storage/circuit behaviour. Persistent denial retains the
  previous record and pending replacement. No target deletion or lock bypass.
- Parent-process IPC permits clean test-server shutdown on Windows, where forced
  child termination bypasses signal cleanup. No HTTP shutdown API was added.
- Existing rendered tests now exercise the genuine saved workflow trace through
  an approval pause and completion. Inspection/refresh issue no write requests;
  private workflow text is not displayed in trace projections.
- Inspector title/description are exposed to assistive technology. The idea box
  uses the existing brighter border token; measured boundary contrast is 7.35:1
  or better across the three themes. Product layout and authority are unchanged.
- Windows junction rejection replaces a skipped link-security check. Storage
  regression tests run in both npm test and security preflight.

## Verified results

- Final Node 24.22.1 preflight: 108 tests passed, zero failed/skipped/cancelled;
  Foundry and Studio rendered browser suites passed; source inventory,
  policy/budget, dependency baseline and source stability passed.
- System Node 26.13.0 passed all 108 tests on the Windows-repair implementation.
  The final incremental HTML/CSS accessibility changes were rechecked on Node 24.
- Real isolated server restart retained saved runs; browser reload alone was
  correctly reported as not proving a restart.
- 320/390/1024/1440/3840px layouts across the browser suites; keyboard camera,
  inspector/Escape/focus return, preferences, reduced motion, replay and offline
  same-key recovery passed. Generated AFTER captures accompany this report.
- Additional contrast sampling: 1,748 visible text rectangles in 26 page/theme/
  state views, zero failures. Includes sampled gradients, placeholder text,
  primary-button hover/focus and both inspectors. Zero unnamed controls in the
  inspected Chrome accessibility-tree roles. Reflow at 640 CSS px passed.
- Direct emulated touch events scrolled 435px. Inspected Foundry buttons,
  summaries and selects were at least 44x44 CSS px. Touch taps and preference
  reload passed without mutation requests.
- Short headless-Chrome samples with graphics enabled: idle 10.6% of one logical
  core, recorded replay 32.0%; approximately 1.3%/4.0% of this eight-thread PC's
  logical CPU capacity. Browser working-set sums were 532.5/541.1 MiB, potentially
  double-counting shared pages. These are observations, not a sustained budget.
  120 animation-frame callbacks: median 16.7ms, p95 17.1ms, none above 50ms.
- Owner confirmed normal rehearsal, workflow execution, replay notice and TV
  display behaviour. Physical TV zoom is not inferred from CSS viewport checks.

The source-bound final preflight is in desktop-preflight.json. Supporting finite
sampling is in desktop-accessibility.json and desktop-extended.json. Raw local
diagnostic logs and test data are deliberately excluded from Git.

## Limits and integration boundary

Full screen-reader listening, exhaustive non-text diagram/control contrast and
every interaction/error state, physical touchscreen/dual-display behaviour,
long-running performance/power and actual power-loss recovery remain unverified.
This is not complete WCAG certification. A current online dependency advisory
audit and hosted connector/JWT/RLS/TLS commissioning are not established here.

All tests used isolated loopback data and test credentials. No private owner key,
production/user record, Supabase project, external agent backend, Defender,
firewall, graphics driver, PowerShell policy or system Node installation changed.
Local workflow integration does not grant repository/network/shell capability.

PR #2 is stacked on PR #1. Keep merge order and base changes explicit. Passing
local checks does not replace GitHub CI on the published commit. No production
deployment or external execution is authorized by this acceptance report.
