# Local recovery

This is a single-owner, plaintext JSON prototype. Keep important source text
elsewhere. Local encrypted backup/recovery is implemented and tested; schedules,
off-device storage and power-loss durability are not commissioned.

When the bounded GitHub connector has been used, its validated public README
receipt, request budget, cooldown and circuit state (`github/state.json`) are
included and checked during encrypted backup/restore. Restoring does not clear
those safety limits or perform an automatic network read. GitHub credentials are
not configured by this public-only connection; the local owner key remains excluded.

## Encrypted operator commands

Stop Sector7 normally first and confirm its process is gone. From the checkout,
run these in an interactive terminal (use npm.cmd on Windows):

```powershell
npm.cmd run backup -- --archive artifacts/backups/my-backup.s7backup
npm.cmd run backup:verify -- --archive artifacts/backups/my-backup.s7backup
npm.cmd run restore -- --archive artifacts/backups/my-backup.s7backup --to data-restores/rehearsal
```

The backup command defaults to the data directory. For another stopped store add
`--data path`. Every command prompts for the passphrase without echo; creation
asks for it twice. Use a long unique phrase of at least 12 characters. Do not put
it in a command, environment variable, screenshot or archive filename. No reset
service exists: a lost passphrase means the archive cannot be recovered.

Paths must remain inside this checkout and may not traverse links. The encrypted
archive must be outside the data directory and have a new filename. Restore
authenticates/decrypts and checks the complete bounded inventory before creating
a new private directory. Existing destinations and archive files are refused.
Owner keys are excluded; restored stores require a fresh bootstrap key or an
explicit trusted-host credential. Safety markers and exact record bytes survive.

After verification, copy the encrypted archive to independently controlled
off-device storage and verify it again after copying it back into this checkout.
Keep the passphrase separately. The archive and data-restores directory are
ignored by Git, but ignoring files is not a substitute for encryption or backup.
No cloud account, network request or automatic schedule is created.

To inspect a restored rehearsal, start a separate loopback instance from the same
terminal; this does not replace your normal data directory:

```powershell
$env:SECTOR7_DATA_DIR='data-restores/rehearsal'
$env:PORT='3001'
npm.cmd start
```

Stop it normally and clear these two variables before starting your usual store.
Use only disposable fixtures for approval/retry tests. Never start two servers
on the same store, delete recovery markers or discard stale locks to force a pass.

## Safe stopped-store copy

1. In the owner UI, Pause & stop and refresh until active Scout work has a terminal
   saved outcome. Preserve approval pauses; do not approve anything for a backup.
2. Stop the exact Sector7 server normally using its terminal. Confirm its process
   and listener have exited and its locks were removed. Never copy an active
   store as if it were a consistent backup. A forced stop requires inspection of
   stale locks and the recovery marker under SECURITY.md before continuing.
3. Copy the configured data directory to a new owner-controlled backup location.
   For a manually inspected legacy copy, include tasks.json, workflow.json and the complete scouts directory, including
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

`node --test test/backup.test.js test/storage.test.js` creates disposable directories,
records a text workflow at approval, finishes a fictional Scout rehearsal, pauses
admission, stops the server, encrypts/verifies/restores the stopped store and starts the copy. It
checks byte equality of tasks/workflow, a different server instance, retained
workflow/Scout records and pause state, no retry replay, exactly one approval
continuation and an unchanged original store. It removes only its own fixtures.

Wrong passwords, ciphertext tampering, authenticated path traversal/duplicate
entries, credential inclusion, linked stores, locks, unfinished writes, missing
Scout data, existing destinations and corrupt workflows are tested negatively.
The same drill runs in `npm test` and `npm run security:check`. It never reads or
writes live user records and does not prove an actual off-device backup,
crash-consistent hot snapshot or actual power-cut recovery.
