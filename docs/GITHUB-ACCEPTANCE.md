# Public GitHub and recovery acceptance — 2 November 2026

This increment includes the owner's previously unfinished encrypted-backup and
Windows credential-protection work, plus the explicitly selected GitHub public
repository connection. Source contract: GITHUB-READONLY.md and SECURITY.md.

## Verified

- Full Node 24 functional/security/PostgreSQL suite: 133 passed, zero failed,
  skipped or cancelled in the final source-bound preflight.
- Foundry, Studio, GitHub-readonly and accessibility browser suites all passed.
  GitHub UI checks cover literal hostile README text, pinned source links,
  keyboard activation, four viewport widths, failure/history labels and anonymous
  denial. The accessibility suite now remains executable in the repository.
- Final opt-in live test clicked the actual owner-authorized read control in an
  isolated loopback instance. It fetched this repository's public README at
  00ffd531e490a285b7a55ae87e13fb2f20b33f0c and verified its recorded SHA-256.
  No owner credential was sent to GitHub and no GitHub secret was configured.
- Request scope, private-address refusal, TLS settings, redirects/compression,
  response sizes, cancellation, single-flight, reset races, durable budgets,
  provider cooldown, circuit recovery and corrupt-state refusal passed targeted
  tests. General repo/network/shell/secret actions remain denied.
- Encrypted backup/restore preserves workflow/scout records and GitHub receipt,
  request budget, cooldown and circuit state while excluding owner credentials.
  Traversal, links, stale/active locks, wrong passwords, tampering, unexpected
  files and overwrite attempts are rejected. No actual user store was restored.
- Source inventory, policy/resource ceilings, pinned dependency baseline and
  source stability passed. No new runtime dependency was added.
- Standalone historical preview was regenerated without the GitHub runtime panel;
  existing no-API preview regressions passed.

The initial inherited test setup changed SystemRoot before Node/OpenSSL could
initialize and crashed before exercising credential protection. That test now
changes the helper lookup after Node initialization and verifies recovery without
writing a secret during failed protection.

One later recheck encountered a transient native Windows permission-protection
failure during a much slower run. Restore failed closed. A direct protection
probe and focused restore rerun passed, followed by the final full passing gate.
The exact Windows cause was not established; no security setting or timeout was
weakened to obtain a pass. This is retained as a host-availability limitation.

## Evidence and boundaries

github-preflight.json binds the checked source hashes. github-live-read.json is
the public immutable receipt, and github-accessibility.json records finite browser
sampling. Raw test logs remain ignored under artifacts/desktop-acceptance.

Full screen-reader listening, exhaustive accessibility states/non-text diagrams,
physical touchscreen/dual-display operation and sustained performance/power
measurements are not certified by these tests. Physical power-loss durability,
backup scheduling and off-device custody remain unverified/operator-managed.

Private repositories, arbitrary files/repos/branches, GitHub writes, remote code
execution, models, hosted identity/database/TLS access and production deployment
are outside this increment. The broader release gate stays BLOCKED; that does
not contradict the successful fixed public README read. Only a normal operator
restart after review loads changed static assets into a running server.

No existing user data, owner key, Windows Defender/firewall configuration,
Supabase project or external-agent permission was changed during verification.
