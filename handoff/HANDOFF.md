# HANDOFF.md — Current state

Updated 2026-09-24. Detailed review and release history stays in the workplan
and assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 (`codex/c01-startup-store-fault-response`) remains draft. Run
`36053525791` failed in the candidate producer's C01 held-gate observation;
unusable `xwininfo` reads and a still-visible dialog meant it produced no
product-exit measurement. The follow-up `xdotool` observer is at
`8a6de198`; exact-head run `36058474722` is still in progress. Independent
review found that exit-0 with empty or malformed window IDs could be mistaken
for dismissal. The local correction now rejects that evidence; 44 focused
tests and lint pass, but this correction is not yet pushed or validated by CI.
Keep the PR draft until fresh exact-head Linux validation and review complete.
Previous run `36025809540` passed the packaged C19 gate on an older head but
skipped strict responsiveness. The historical 261.161 ms Linux C19 failure
(`35984100420`) remains unresolved; master’s 50.836 ms pass does not explain or
clear it.

DON-179 remains **In Review**; opt-in diagnostic upload is outside this repair.

## Active work and evidence

- PR patch uses a hard 10-second total deadline after Electron readiness
  through the hidden-window renderer safety fence. A healthy but slower startup
  also closes at the deadline; late success is ignored. Held-gate observation
  is 20 seconds; product exit after dialog
  dismissal is separately bounded at 12 seconds. The lock-holder readiness
  bound is 5 seconds; its producer budget is 120 seconds.
- **Explicit C01 limit:** `app.whenReady()` is outside the deadline. Synchronous
  store creation/open/migration is wrapped to identify a late return, but a
  blocked native call also blocks the main event loop and cannot be interrupted.
  Do not claim full C01 coverage.
  Follow-on acceptance is a packaged Linux held-open/held-migration probe that
  proves visible bounded failure, main-loop responsiveness, late-success
  fencing, unchanged original-profile digests, and safe interruption/WAL
  recovery. Smallest architectural fix: utility-process store ownership behind
  an async main-process facade with explicit caller, attachment, coverage, and
  orderly-close bridges. DON-250 stays separate.
- Before the monotonic held-gate follow-up, local verification passed seven
  focused files / 102 tests and full correctness (5,863 passed / 25 skipped);
  lint and `npm run electron:pack` passed. After that follow-up, the targeted
  probe/receipt suites passed (37 tests) and lint passed. Held-gate timing stays
  monotonic while evidence elapsed milliseconds are rounded to receipt-safe
  integers.
  The packaged macOS legacy-recovery smoke passed (60.11 ms first-main,
  55.90 ms restart main-loop maxima; phase gaps 1.59/0.14/1.40 ms). The smoke
  used a dirty tree before commit; macOS scheduler counters are unavailable,
  so it is diagnostic rather than Linux evidence.
- The C19 200 ms main-loop gate and failed receipts are preserved. Linux now
  reports scheduler attribution as explicitly unavailable if kernel accounting
  is disabled; the independent main-loop limit remains authoritative.
- Held-gate observer confirms dismissal within a strict 2-second deadline and
  measures product exit from that monotonic observation. The current working
  version uses `xdotool` visible-window search after the prior `xwininfo` path
  failed on Linux. Local probe/receipt/source tests pass (43 tests) and lint
  passes; the replacement still needs exact-head Linux validation.
- C01 receipts distinguish matrix validity from full contract coverage; they
  remain `coverageComplete:false` and `qualificationEligible:false` while the
  pre-readiness and synchronous-store axes remain open. The stronger held-gate
  observations use receipt schema v3; preserve older v2 evidence unchanged.

## Next actions

1. Commit/push the fail-closed `xdotool` result parser; finish exact-head review
   and Linux pull-request package CI, including the unchanged packaged C19
   200 ms gate. Preserve the old failure; the separate full-candidate strict
   responsiveness qualification is not a PR merge check and must not be
   claimed from this run.
2. Update DON-179 with exact commands and evidence. Mark PR #47 ready only if
   the exact-head checks pass and no in-scope review finding remains. Do not
   merge, tag, publish, or release from this work.

The release hold and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
