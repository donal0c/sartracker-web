# DON-254 legacy recovery close-path disposition — 2026-09-17

## Verdict

The first PR35 Linux receipt exposed a real responsiveness risk in the
legacy-object recovery shutdown path. The strict independent main-loop
predicate remains `<200 ms` and is unchanged. The bounded repair moves the
final durable WAL checkpoint into the backfill worker before it reports
completion, so the Electron main process does not first encounter the large
WAL during synchronous store close. The checkpoint is deliberately
non-blocking: it does not take a truncation lock that could stall an operator
write behind a live reader.

This is a repair and evidence disposition, not release qualification. The
release, candidate freeze, BCP-17/WAR-12 and field-acceptance holds remain in
force until the exact draft head has passed its required review and CI gates.

## Retained CI receipts

- The first PR35 Linux run [35221533225](https://github.com/donal0c/sartracker-web/actions/runs/35221533225)
  ran exact head `d76bd61f7c3cfc43f102007ea7de7ef579495184` and failed only at
  the packaged legacy-object recovery observer proof. Its terminal report is
  retained in the workflow artifact. The first-launch store close took
  `509.950024 ms`; the independent main-loop maximum was
  `512.449076 ms`, violating the unchanged strict threshold.
- The later exact-head/rebased PR35 run [35242591823](https://github.com/donal0c/sartracker-web/actions/runs/35242591823)
  ran `990a7f16885984e40b53c3261f9de23e17a104ab` and passed. It used the same
  packaged executable hash and the same six close-path production file hashes
  as the failed run; first-launch close was `5.935666 ms` and the independent
  main-loop maximum was `49.966256 ms`.

The failed and passing reports both reconstructed exactly 50,000 legacy marker
rows with no missing custody records or duplicate objects. The source and
package identity checks were clean in both CI receipts. The source delta
between the two heads was unrelated settings/privacy documentation and secret
repair work; it did not touch the close path, worker or smoke timing inputs.

## Cause and repair

The legacy backfill worker intentionally uses `synchronous=NORMAL` for bounded
turn writes; an interrupted turn remains replayable. Before this repair, the
worker deleted the failure marker, posted `complete`, and closed its own
connection. The WAL therefore remained for the main mission-store connection
to checkpoint while `store.close()` ran with the main connection configured as
`synchronous=FULL`. A local direct-store probe showed a roughly 4.5 MB WAL
remaining immediately before main close on the unchanged path. That explains
the app-owned shutdown work; the exact 510 ms amplification is
runner/filesystem-specific and was not separately instrumented by the retained
receipt.

The repair adds `electron/legacy-evidence-backfill-checkpoint.cjs`. After the
worker's final metadata update and before its completion message, it disables
the worker connection's busy wait, sets that connection to `synchronous=FULL`
and requires `wal_checkpoint(PASSIVE)` to report a non-busy, complete
checkpoint. The worker connection has `busy_timeout=0`; a bounded retry window
with brief event-loop yields absorbs a concurrent main write without blocking
it, while persistent reader/busy contention still throws. The existing worker
failure path surfaces that failure instead of claiming settlement. The main
store's `WAL` and `synchronous=FULL` settings are unchanged. Completion now
also carries the validated checkpoint receipt, so the runner cannot settle a
worker that omits the production checkpoint call. The smoke/terminal validator
binds the helper as the seventh implicated production file.

## Verification completed on this branch

- Checkpoint, runner and completion-contract tests — 15 passed, including a
  real SQLite live-reader contention case that fails closed in under 200 ms
  and a transient concurrent-writer retry.
- Real-worker mission evidence integration suite — 93 passed, including the
  production checkpoint receipt before worker settlement.
- Focused source regression set — 205 tests passed across the checkpoint,
  backfill runner, evidence versioning and mission-store suites before the
  review remediation; the updated slices above are the authoritative rerun.
- Terminal-report validation set — 33 tests passed, including rejection when
  the checkpoint helper is absent from packaged identity custody.
- `npm run lint -- --no-warn-ignored` passed.
- Rebuilt packaged macOS diagnostic smoke passed with 50,000 rows, complete
  custody/digest checks, restart mutation and cleanup; first-launch close was
  `1.423542 ms` and the main-loop maximum was `52.460332 ms`. This is local
  packaged diagnostic evidence only, not Linux CI or production qualification.

## Remaining proof and limits

The draft PR must still receive an independent native Codex review and exact-
head Linux CI. Linux packaged evidence is the decisive next check because the
original failure was platform/filesystem-sensitive. No release, deployment,
merge, candidate mode, BCP-17/WAR-12 run or SAR-team contact is authorized by
this finding.
