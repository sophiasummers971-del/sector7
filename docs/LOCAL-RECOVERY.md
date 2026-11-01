# Local recovery

This is a single-owner, plaintext JSON prototype. Keep important source text
elsewhere. Local copy recovery is tested; encrypted scheduled backups and
power-loss durability are not commissioned.

## Safe stopped-store copy

1. In the owner UI, Pause & stop and refresh until active Scout work has a terminal
   saved outcome. Preserve approval pauses; do not approve anything for a backup.
2. Stop the exact Sector7 server normally using its terminal. Confirm its process
   and listener have exited and its locks were removed. Never copy an active
   store as if it were a consistent backup. A forced stop requires inspection of
   stale locks and the recovery marker under SECURITY.md before continuing.
3. Copy the configured data directory to a new owner-controlled backup location.
   Include tasks.json, workflow.json and the complete scouts directory, including
   safety-state.json and any .safety-dirty marker. Exclude .owner-key, .server.lock,
   .coordinator.lock, run.lock and unfinished .tmp files. Keep the original store.
   Do not discard a dirty marker to make recovery appear clean.
4. Record SHA-256 hashes for copied regular files and compare the original/copy
   before accepting the backup. Protect the backup as sensitive plaintext; use
   independently verified encrypted storage for real personal data. Never put
   the backup, key or user records into Git.

## Restore rehearsal

1. Restore only into a new empty directory inside the checkout, with no server
   using it. Compare its regular-file hashes with the backup manifest. Retain the
   original and the backup; do not overwrite either during a rehearsal.
2. Start a separate loopback instance with that directory and a different local
   port. Use a fresh owner bootstrap credential or the explicitly supplied trusted
   host credential. Credentials are not restored from the archive. No firewall,
   LAN listener, connector or external permission is required.
3. Compare saved workflow revision, run IDs, results, approval pause IDs, operation
   keys, Scout receipts and safety state. Waiting approvals must remain waiting;
   interrupted work must not replay. A dirty marker must keep admission blocked.
4. Use only disposable fixtures to test continuation: retry the same operation
   key, approve its exact saved pause, and repeat that decision. Confirm one task
   and no second execution. Stop the rehearsal server normally afterward.
5. Corruption or a startup refusal is a recovery failure to investigate. Preserve
   evidence and restore a verified copy; never reset to empty history or delete
   locks without confirming their owning process is gone.

## Automated evidence

`node --test test/storage.test.js` creates its own two disposable directories,
records a text workflow at approval, finishes a fictional Scout rehearsal, pauses
admission, stops the server, copies the stopped store and starts the copy. It
checks byte equality of tasks/workflow, a different server instance, retained
workflow/Scout records and pause state, no retry replay, exactly one approval
continuation and an unchanged original store. It removes only its own fixtures.

The same drill runs in `npm test` and `npm run security:check`. It never reads or
writes live user records and does not prove an off-device/encrypted backup,
crash-consistent hot snapshot or actual power-cut recovery.
