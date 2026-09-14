# PR30 Claude review remediation

Reviewed ancestor: `01fb1c24dd1e402509b236c36bf34fe957d85322`.
The earlier PR-ready verdict is superseded by this review. PR30 was returned
to draft while these corrections were implemented. Scope remains DON-264 /
AUD-04 and DON-6 / AUD-06; no merge, release or deployment authority is added.

## Findings and disposition

| Finding | Disposition and proof |
| --- | --- |
| Missing-layer getters throw and abort later overlay visibility writes | Accepted. Guard layer presence before reading; suppress a getter race only if that layer has since disappeared. Unexpected failures still propagate. Throwing MapLibre-like fakes cover tracking plus marker/GPX/helicopter continuation. Red retained; affected style/overlay suites pass 61 tests. |
| Cancelling restoration discards the latest destination | Accepted. A live navigation destination now owns camera restoration, rather than deleting a restoration token. Rendered test injects a camera reset before delayed completion and verifies the latest target afterward. |
| Basemap switch during flyTo restores an arbitrary midpoint | Accepted. Restoration consults the current navigation destination, preserving centre, zoom, bearing and pitch. Real Chromium test switches style during a four-second flight and checks rendered geometry and centre. |
| Requests can survive forever without a style or across unmount | Accepted. Store owns a 30-second acceptance deadline; confirmed attachment shortens it to eight seconds, capped by the original deadline. Reattachment/remount cannot extend it. Every reuse checks the absolute deadline. Unit tests cover absent style, unmount/remount, map recreation and suspended timers. |
| Style callback registered too late / wrong event | Accepted. Register before setStyle and complete at style.load. MapLibre 5.22's inline diff emits this event synchronously. Overlay styledata cannot consume completion. Packaged smoke observation follows the same boundary with premature-event countercontrols. |
| Failure and listener cleanup missing | Accepted. Non-tile style errors, synchronous throws and a 30-second timeout restore the current intended view, report a sanitized failure and dispose listeners/timer. Removal, supersession and effect teardown also dispose. Existing tile health remains separate. Visible failure survives idle and offers retry or another basemap. |
| JSON.stringify equality / null unset churn | Accepted. Structural comparison mirrors MapLibre values; object key order is irrelevant, nested null/undefined and NaN retain engine semantics, top-level unset null/undefined is equivalent. |
| Dead pendingTarget state | Accepted. Removed; the request and its deadline are the single target lifetime. |
| Missing tests / forgiving getter fakes | Accepted. Missing layers now throw in regression fakes; later layer visibility is explicitly checked. Existing passing characterization controls remain labelled as controls, not red regressions. |
| Baseline substitution only matches single-line calls | Not a defect. It operates on Vite's transformed response, with explicit nonzero-match assertions. Added a comment explaining that dependency. |
| Two screenshot hashes match | Not independent causal evidence. The two original workflows used the same synthetic background and target and can produce identical final pixels. Causality comes from assertions/traces, not different filenames. New reverse-order evidence uses a distinct background/coordinate; screenshots establish visible ring/dot placement only. |
| Focused 32/19/5 breakdown not traceable | Accepted evidence correction. Removed the unsupported sub-breakdown; retained the independently readable 11-file/77-test aggregate as historical evidence. |
| CI retries conceal idle churn | Not applicable to the Train C gate. playwright.train-c.config.ts already specifies retries: 0, overriding the general config; the workflow explicitly uses it. No retries were added or used. |

The detailed review's optional mapReadyVersion concern is also resolved: the
hook now requires it and tests map replacement. Its layer-order and sampled-zoom
comments do not establish new regressions in this diff. Existing transparent-ring
placement and minimum zoom policy are retained; no operational occlusion was
reproduced. Removing pendingTarget also removes the obsolete acknowledgement
write. Deadline checks cover late timers and remounts; they are absolute-time
checks, not a responsiveness or sleep-duration qualification claim.

## Additional corrections found during remediation

- An identical already-applied style emits no completion event. It now returns
  without starting a false failure timer, and notifies the health owner so a
  no-op retry cannot leave loading stuck; red/green regressions retained.
- Selecting the same failed basemap previously cleared the warning without
  applying it again. A rendered regression failed, then passed after explicit
  retry versioning. It verifies the actual selected source, not just text.
- A silently rejected target layer could prematurely start the visible timer.
  Source and both layers are now verified before attachment acknowledgement;
  incomplete attachment logs and retries through the existing synchronizer.
- Operator gestures release navigation camera ownership. Style changes then
  preserve the operator's newer view. Expired requests cannot supply a camera.

## Verification and boundaries

Raw working receipts are under `tmp/train-c-review/`; selected normalized logs
and screenshots are [retained here](../../evidence/pr30-review/).
Initial camera boundary regressions failed 5/9 before
repair; the store agent recorded 5/6 target-store regressions failing (that
receipt is explicitly a summary, not raw tool output). The first six-case browser run had
one harness assertion failure: recovery removed the warning element, while the
test incorrectly required it to remain present with different text. The corrected
six-case run passed. The later same-basemap retry regression failed against real
unchanged source identity, then passed after the retry repair.

Final affected source checks pass 50 camera/hook/smoke tests; the final six-case
Chromium run passes with retries disabled (36.3 seconds). Lint and TypeScript /
Vite build / bundle budgets pass. The first full source run was interrupted for
the independent review's no-op health correction and is not counted as green.
Its final stable replacement passed **473 files / 4,997 tests / six existing
qualification skips**, 480.62 seconds, exit 0. Independent read-only camera/navigation
review found no remaining material defect after that correction; the reviewer
also reran the eight camera-completion tests. A separate review confirmed the
MapLibre completion-event behavior and the 27 smoke fixture tests.

No native coverage IPC, service-worker registration, mission enumeration or
diagnostic-custody code changed. The packaged smoke observation adjustment is
verification code for the changed renderer completion event. Full source/lint/
build and final rendered recheck passed; new-head CI remains required before readiness.
Strict <200 ms, 960k replay, soak, field acceptance and release qualification
remain separate; release HOLD is unchanged. AUD-12 / Clear Alias is deferred.
