# Sector 7: first worker coordination rehearsal

The intended product is a universal visual task coordinator. A user gives it a goal;
the coordinator divides work into bounded jobs, workers exchange small carrier
messages, and results return with evidence. GitHub scouting is one demonstration
workload, not a restriction on the eventual product.

The uploaded Threads page describes 128 crawlers and a nine-repository shortlist.
It supplies no implementation or verification evidence. This milestone adopts the
dispatch, parallel work and aggregation pattern without reproducing that claim.

## Run the implemented milestone

Requires Node 24 or newer, no package installation:

```sh
npm test
npm run scout:demo
```

On Windows use `npm.cmd`. The demo reads four explicitly fictional README samples
from `examples/scout-samples.json`. It uses two asynchronous local worker slots,
not two models, two operating-system processes, or two CPU-parallel threads.
There is no crawling, GitHub API call, model call, code execution or external write.
The existing canvas and HTTP API are unchanged; this milestone runs from the CLI.

Each sample produces a job. Its messages record dispatched, accepted, completed
or failed. Packets carry version, sequence, correlation ID, job ID, sender,
timestamp, input reference/hash, and a result reference or bounded error.
Large content remains in the separate input asset. These fields provide correlation
and integrity checks, not authentication, permissions or cryptographic signatures.

Results include the literal matched terms and their count. Terms are deduplicated
case-insensitively; matching is substring-based. Successful samples with zero matches
are absent from the shortlist, but remain completed jobs in the full record.
README text is untrusted data and is never interpreted as commands. A match is not
an assessment of code quality, maintenance, licensing, safety or suitability.

## Persistence and recovery

The trusted host supplies an absolute data directory. The demo uses `data/scouts/`.
Each operation key maps to a hashed directory containing:

- `input.json`: bounded source assets and search terms.
- `run.json`: job states, carrier events and shortlist.
- `run.lock`: exclusive per-run coordinator lock, present during execution.

Runtime files are excluded from Git. A repeated key with identical input returns
the saved run and `duplicate: true`. Changed input with the same key returns a
409-style error. Use a new operation key for a deliberate new run. No automatic
retry or deletion of history is performed. Cancellation is cooperative at dispatch
boundaries through a trusted host AbortSignal, with no CLI cancellation control yet.

Writes use temporary-file rename and serialize within the coordinator. Storage
errors stop dispatching new work; already active callbacks are joined before the
error returns. This is not fsync-based power-loss durability or a distributed queue.
The JSON event list is capped indirectly by 12 jobs; it is not a tamper-proof audit log.

An unfinished saved run becomes interrupted on reopening and is never replayed.
After a hard process crash, the lock may remain. The runner refuses to remove it.
Recovery requires an operator to establish that the owning process has stopped,
preserve the run files, then remove only that stale run lock. A subsequent retry
records interruption. Corrupt JSON or a changed source fingerprint fails closed.
Do not use a shared/network filesystem as a distributed coordination service.

## Verification

29 existing tests and 11 new tests pass locally on Node v24.22.1: 40 total.
New evidence covers schema/size bounds, at most two active callbacks, joining
active work after a fatal callback error, literal untrusted-text handling,
ordered carrier events, deterministic aggregation, fresh-process deduplication,
payload conflicts, partial failure, pre-dispatch cancellation, seeded unfinished
run recovery, lock collision and corrupt/modified storage. The seeded recovery
test is not an abrupt power-loss or actual process-kill test.

The demo was run in two separate CLI processes: first run completed, second returned
the identical persisted run as a duplicate. No browser rerun or physical device
verification was performed because the frontend is unchanged.

## Next milestones

1. Connect this run/event model to the phone-first canvas. Show real queued,
   accepted, completed, failed and interrupted states; clearly distinguish fixture
   data, completed historical runs and active work.
2. Add a read-only GitHub adapter for user-selected repositories, with response
   limits, authentication handling, deadlines and rate-limit/cancellation behavior.
   Keep source provenance and treat remote README instructions as untrusted text.
3. Add model-assisted analysis as an optional worker, with explicit cost budgets,
   timeouts and evidence links. Keep model opinions separate from verified facts.
4. Add independently enforced connector permissions, approval gates and a circuit
   breaker before allowing workers to modify repositories or other services.

Still absent: live discovery, meaningful code analysis, secure worker identity,
network isolation, model budgets, external-worker deadlines, automatic retry,
checkpoint resume, configurable parallel graphs, workflow library and redesigned UI.
