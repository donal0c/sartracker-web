# HANDOFF.md — Current state

Updated 2026-09-25. Detailed review and release history stays in the workplan
and assurance records.

## Current state

Beta 13 remains **HOLD**. No candidate is frozen or qualified; no tag,
publication, or distribution has occurred. `master` is `30cb7d45` after PR #49.

PR #47 (`codex/c01-startup-store-fault-response`) remains draft. Exact-head
review at `49918966` found no issue. Run `36064148886` passed correctness,
rendered regressions, and Linux packaging, then failed the C01 held-gate
observer. Its receipts show query `SIGKILL`, `SIGPIPE`, or exit 0 with empty
output; none confirms dialog dismissal or product exit, and each ends with
harness cleanup. This does not establish product behavior.

Native Ubuntu run `36072072977` repeated the invalid result with Openbox active.
Run `36072959447` captured screenshots and bounded X11 probes: the old click
point was about 8 px above the bottom acknowledgement row, and post-failure
queries still found the dialog mapped. The local fix targets the row center
(`width / 2`, `height - 17`). The geometry regression and startup tests pass;
full correctness passes (572 files, 5,878 passed, 25 skipped), and lint passes.
The fix is not yet pushed or verified on native Ubuntu.

Local Linux/Xvfb confirmed xdotool's normal absent/matching-window results and
the bounded `SIGKILL` timeout shape. The retained x86_64 package fails GPU
startup under the local ARM64 Docker emulation, so that is not product
evidence. Run the corrected observer on native Ubuntu against the retained
artifact before another full pipeline.
Previous run `36025809540` passed the packaged C19 gate on an older head but
skipped strict responsiveness. The historical 261.161 ms Linux C19 failure
(`35984100420`) remains unresolved; master’s 50.836 ms pass does not explain or
clear it.

DON-179 remains **In Review**; its current CI/observer status is recorded, and
the opt-in diagnostic upload remains outside this repair.

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
- Full correctness passes locally (572 files; 5,878 passed, 25 skipped),
  and `npm run lint` passes. The full run exposed a renderer-crash test teardown
  race with real log writes; those behavioral tests now use in-memory log
  adapters. Held-gate timing stays
  monotonic while evidence elapsed milliseconds are rounded to receipt-safe
  integers.
  The packaged macOS legacy-recovery smoke passed (60.11 ms first-main,
  55.90 ms restart main-loop maxima; phase gaps 1.59/0.14/1.40 ms). The smoke
  used a dirty tree before commit; macOS scheduler counters are unavailable,
  so it is diagnostic rather than Linux evidence.
- The C19 200 ms main-loop gate and failed receipts are preserved. Linux now
  reports scheduler attribution as explicitly unavailable if kernel accounting
  is disabled; the independent main-loop limit remains authoritative.
- Held-gate observer keeps the strict 2-second dismissal deadline and only
  measures product exit after confirmed dismissal. Run `36064148886` did not
  complete that observation; query errors and harness cleanup are not product
  absence/exit. Packaged behavior remains unverified on native x86_64 Linux.
- C01 receipts distinguish matrix validity from full contract coverage; they
  remain `coverageComplete:false` and `qualificationEligible:false` while the
  pre-readiness and synchronous-store axes remain open. The stronger held-gate
  observations use receipt schema v3; preserve older v2 evidence unchanged.

## Next actions

1. Push the corrected dialog click and run focused Ubuntu isolation against
   the retained Linux artifact. Do not increase timeouts or count forced
   cleanup as product exit.
2. If the focused observer confirms dismissal and product exit, require
   exact-head Linux CI including the
   held-gate observer and unchanged packaged C19 200 ms gate. Preserve the old
   C19 failure; strict full-candidate responsiveness qualification is not a PR
   merge check and must not be claimed from this work.
3. Keep DON-179 In Review. Mark PR #47 ready only if exact-head checks pass and
   no in-scope review finding remains. Do not merge, tag, publish, or release.

The release hold and C17 scope remain governed by the
[two-track execution workplan](../docs/two-track-execution-workplan.md) and
[assurance records](../docs/assurance/).
