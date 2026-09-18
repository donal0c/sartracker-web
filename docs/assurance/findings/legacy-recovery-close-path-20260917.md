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

This is a repair and evidence disposition, not release qualification. Review,
CI and merge readiness close only this repair boundary. The release,
BCP-17/WAR-12 and field-acceptance holds remain in force after merge; candidate
freeze follows the separate blocker reconciliation in the locked release plan.

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
and records a non-busy, complete checkpoint when SQLite permits it. The worker
connection has `busy_timeout=0`; a bounded retry window with brief event-loop
yields absorbs a concurrent main write without blocking it, while persistent
reader/busy contention is returned as non-fatal telemetry. Only reconstruction
failures remain on the fail-closed worker path. The main store's `WAL` and
`synchronous=FULL` settings are unchanged. Completion now carries the
validated checkpoint receipt plus a parent-process observation of the live
`-wal` sidecar, so the runner cannot settle a fabricated complete receipt. The
smoke/terminal validator
binds the helper as the seventh implicated production file.

## Post-merge disposition — 2026-09-18

PR36 is merged at
[`f7798a19`](https://github.com/donal0c/sartracker-web/commit/f7798a19589b5d907408080dc65e2d2739767130)
from exact head `ed3c69f342a9a9f3bc60d7fb1390743f59210ad0`. Required Linux
workflow
[`35332400799`](https://github.com/donal0c/sartracker-web/actions/runs/35332400799)
passed at that head. The repair boundary is therefore **fixed**: checkpoint
contention is best-effort non-fatal telemetry, genuine reconstruction failures
remain fail-closed, and the parent runner validates a complete receipt against
the live `-wal` sidecar. The valid zero receipt remains conditional on an empty
sidecar.

The failed PR35 receipt
[`35221533225`](https://github.com/donal0c/sartracker-web/actions/runs/35221533225)
and the later passing PR35 receipt
[`35242591823`](https://github.com/donal0c/sartracker-web/actions/runs/35242591823)
remain retained evidence; neither is rewritten as a release result. The
merged PR36 workflow is scoped repair/merge proof only. It did not execute the
complete candidate matrix, so release, BCP-17/WAR-12, field, original-machine
and human-acceptance holds remain unchanged.

The earlier exact-head workflow
[`35267063564`](https://github.com/donal0c/sartracker-web/actions/runs/35267063564)
passed before the final adversarial review and remains historical evidence, not
acceptance for the merged release candidate.

## Verification completed on this branch

- Checkpoint, runner, completion-contract and terminal-report tests — 55
  passed, including real SQLite success, live-reader contention returning a
  bounded non-fatal warning, transient busy-lock retry, non-WAL handling,
  strict malformed-receipt rejection and parent-sidecar spoof rejection.
- Real-worker mission evidence integration cases — 4 passed, including the
  operator-access regression after checkpoint contention and three production
  recovery receipts before worker settlement.
- Full source suite — 5,122 tests across 483 files passed; TypeScript build,
  lint and bundle budgets passed.
- Rebuilt packaged macOS diagnostic smoke passed with 50,000 rows, complete
  custody/digest checks, restart mutation and cleanup; first-launch main-loop
  maximum was `55.238292 ms`, restart open maximum was `54.829083 ms`, and the
  complete receipt was `busy=0, log=402, checkpointed=402` with a parent-observed
  `walSidecarBytes=4494952`. This is local packaged diagnostic evidence only;
  the working tree was intentionally changed, so it is not Linux CI or
  production qualification.

## Independent review remediation

The first independent Astra high review requested changes for a potential
blocking `TRUNCATE` checkpoint and mocked-only production-call coverage. Those
were repaired by the PASSIVE, zero-busy-timeout checkpoint and the real worker
completion receipt tests. The exact-head follow-up review then identified two
additional P2 validation gaps: SQLite's legitimate busy-lock sentinel
`busy=1, log=-1, checkpointed=-1` must retry, and the terminal report validator
must validate the completion receipt rather than only the worker identity.
Both are now covered by failing-first tests and repaired in the current head.

## Remaining proof and limits

The prior exact-head Linux workflow [35267063564](https://github.com/donal0c/sartracker-web/actions/runs/35267063564)
passed at `71b83660801f3744fc69afaedfa65dc5217e508e`: the packaged report was
source-clean, the legacy recovery proof was green, and the worker checkpoint
receipt was complete. The independent Astra follow-up reported no actionable
findings on the then-current code, but the later adversarial review identified
the blocker recorded above. This evidence is not release qualification and
does not authorize merge, release, deployment, candidate mode, BCP-17/WAR-12
or SAR-team contact.
