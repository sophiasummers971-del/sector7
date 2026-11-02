# Owner GitHub account workflows

Sector7 Studio offers an explicit Windows GitHub connection. The local owner key authenticates every account API request; it is never sent to GitHub. Connect uses the fixed installed Git Credential Manager executable, with prompting and tracing disabled. Its credential stays in server memory, never in browser storage, run records, backups or reports. Disconnect clears Sector7's in-memory connection; it does not revoke the Windows GitHub sign-in.

The owner authorised all repositories available to their GitHub account. Listing is paginated (30 per page). Private/public README reads are bounded to 64 KiB and checked against Git blob SHA-1, then rendered with textContent. No provider URL, HTML, shell command or repository code is executed.

## Supported writes

- Create an issue from the bug-report or feature-request form.
- Open a draft PR between existing branches in the same repository.

The PR workflow currently does not create branches or edit files. Push, merge, deletion, workflow dispatch, arbitrary API URLs and arbitrary file access are unsupported. GitHub retains its own repository, organisation, SSO and token permission boundaries. A draft PR can trigger that repository's configured automation.

Prepare saves the exact repository, kind, title, body and (for PRs) head/base branch names and observed commit IDs. Approval supplies only that saved action ID, SHA-256 fingerprint and decision. The broker checks repository push permission at preparation and approval, refuses changed branch IDs, and expires previews after ten minutes. Branch checks are observations, not a lock against later pushes to a PR branch. Opening a draft does not approve or merge its code.

Before sending a write, Sector7 persists dispatching. Only a confirmed numbered response becomes completed. Any uncertain response becomes unknown and never automatically retries. Repeated decisions return the existing result. A restart discards credentials, rejects old waiting previews and treats interrupted dispatches as unknown. Inspect GitHub before preparing another action after an unknown result; it could create a duplicate.

The native-ACL-protected github-actions.json holds at most 40 actions and a rolling 60 upstream attempts/hour. Attempts are persisted before dispatch. Any upstream failure imposes a persisted minimum 60-second cooldown. No retry is automatic. Corrupt evidence or storage failure fails closed. The encrypted stopped-store backup includes this validated journal and its rate state; credentials remain excluded. Restore cancels pending approvals on next startup.

## Trust boundaries and failure paths

Untrusted browser fields -> owner authentication, Host/origin checks and 4096-byte body limit -> exact operation/intent validation -> saved preview -> exact approval -> GitHub permission/branch recheck -> durable dispatch record -> fixed api.github.com HTTPS request.

Untrusted repository responses -> bounded JSON/UTF-8 validation and fixed projection -> text-only UI. Tokens are attached only by the server to fixed GitHub TLS requests. DNS rejects private/local addresses; redirects, encoded responses, oversized data and other destinations fail closed.

The trusted credential-manager subprocess receives only selected Windows environment fields, not Sector7's owner key or inherited API secrets. It may perform its own GitHub authentication refresh. A local attacker already running as the Windows owner is outside this single-user boundary.

## Checks

Run npm.cmd test for isolated backend/approval regressions. The browser account test uses intercepted GitHub fixtures and creates no remote issues or PRs. An explicit authenticated read-only check is:

    node scripts/github-account-check.js --read-only-live

Its output reports only account identity, counts and private README byte/integrity results, never private repository names/content or credentials. Live remote writes require a separate concrete owner-approved action and are not implied by unit-test passes.
