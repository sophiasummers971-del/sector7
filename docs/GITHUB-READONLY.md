# GitHub public README connection

Scope: one owner-authorized public read broker for
`sophiasummers971-del/sector7`, main, README.md. It is separate from local workflow
execution and fictional scout rehearsals. No GitHub secret is needed or accepted.

## Observable contract

1. Opening the page and inspecting status do not contact GitHub.
2. The owner explicitly chooses Read current GitHub snapshot.
3. The server reads the fixed main ref and then README.md pinned to that commit,
   using GET against api.github.com only. No provider-supplied URL is followed.
4. Commit, blob identity, bytes, SHA-256 and observation time accompany literal
   untrusted README text. This proves a fetched snapshot, not code quality,
   instructions to execute, a live worker or a verified repository claim.
5. A failed refresh keeps prior evidence marked as saved history. No automatic
   polling, external write, shell command, clone, model call or agent launch exists.

## Trust-boundary map

| Source | Boundary/check | Sensitive sink |
| --- | --- | --- |
| Browser request | Owner bearer, Host/origin, JSON/size checks, exact empty refresh body | Fixed GitHub broker action |
| GitHub/ref/README JSON | Response/deadline bounds, exact ref/file/type, immutable commit and blob/hash checks | Local evidence record |
| DNS/address/redirect/encoding | Fixed HTTPS host/port/SNI, public IPv4, TLS validation, redirects/compression refused | Outbound request |
| README instructions/markup | UTF-8/size bounds; textContent; never executable or authoritative | Browser text display only |
| Saved state or archive | Exact schema, record hashes, no linked directory, encrypted archive verification | Restored public evidence and safety limits |
| Owner key | Existing local private credential and API authentication; never upstream | Local authorization only |

The worker policy continues to deny general repo/network/shell capabilities.
The broker has three named owner-only actions, not a new worker principal.
There is no database crossing in this feature; it does not commission Supabase,
hosted JWT/RLS, TLS access to this local server or private GitHub authorization.

Limits and failure behaviour are specified in SECURITY.md. Encrypted stopped-store
backup includes the public receipt and its circuit/cooldown/budget, but never the
owner key. An existing file/directory is never overwritten by restore.

## Evidence commands

`npm.cmd test` covers state, transport, authorization and backup failures offline.
`npm.cmd run security:check -- --browser` includes the rendered public GitHub panel
without network access. Browser/Playwright paths must be supplied as for the
existing browser suites. Standalone recorded previews remove this runtime panel.

To explicitly verify live public connectivity in an isolated test store, set
`SECTOR7_GITHUB_LIVE=1` and run `npm.cmd run test:github-browser`. The script uses
test owner authentication, clicks the real read control, validates the returned
receipt, saves public metadata under artifacts/github-connector, then destroys
the isolated store and browser. Do not put tokens into that environment variable.

This increment does not support private repositories, other branches/files/repos,
issue/PR operations or remote code execution. IPv6-only networks fail closed.
Actual physical-device and full screen-reader conformance remain separate claims.
