# HANDOFF.md — Live Baton

> Read after `CLAUDE.md`. Prior evidence is retained in
> `docs/breadcrumb-pr6-evidence.md`; older history is in `handoff/archive/`.

## Current State

- Existing PR #10 (`codex/breadcrumb-pr6-archive-lifecycle`, programme PR6)
  remains open and unqualified. Fresh Astra task owns diagnosis, bounded
  corrections, existing-PR push, and merge-readiness evidence. Donal retains
  approval, merge, beta publication, and team-contact authority.
- Starting head `b3fb01fac43f7e3dff0a2ea8edd171ac11e4491f`, tree
  `66b6db82fee6929e73ca2ad49d8fe7a23bacf35f`, is rejected: macOS lifecycle
  missed terminal verification progress; Linux CI `34148723233` failed the
  legacy-event heartbeat at `200.669968 ms` (3,959/3,960 passed).
- Pushed successor `c2c04dca1457c8aa9c1904125829ae646679270c`, tree
  `0d0caa8de7331fdd172bad634507eb190ad12a10`, passed macOS packaged lifecycle,
  browser/visual and physical-kill gates, but Linux CI `34153646204` rejected
  it on a `213.5 ms` renderer-frame gap during create. No scale run started.
- Earlier head `f49a16218e983994104cdbc3801ce766f653720e`, tree
  `858483dca3498acdaca2a4f4304b891d6e3905b2`, is also rejected: Linux run
  `34157502958` passed create/verify but timed out collecting a renderer
  snapshot during restore / `review_before_cleanup`. Cleanup completed.
- Latest pushed head `c14529e884b635e1115daded4229bdac726b0220`, tree
  `b86074081221e7f32b7ba18305c582316bac17d8`, is rejected. Mac packaged
  lifecycle passes; reference Ubuntu times out during second-launch cleanup.
  Linux CI `34160547847` separately fails the canonical publisher race test.
- Work is in `/Users/donalocallaghan/.codex/worktrees/a27a/sartracker-web`.
  The old `44b1` checkout is evidence only and its task remains retired.

## Active Work

- c2c04dca fixes a reproduced terminal-progress collector race: subscription
  survives a verified invoke result until exact terminal progress arrives,
  with a fail-closed 5-second deadline. Five tests, delayed real-package
  reproduction and focused independent review pass. Product code is unchanged.
- The historical legacy-event heartbeat breach remains unattributed. The same
  500,000-event workload/cadence/gate now retains SQL, CPU and overlapping GC
  diagnostics. Source probes and new CI pass; details live in the evidence doc.

## Locked Boundaries

- Preserve the existing PR implementation and accepted correction/custody,
  transaction-contention, bounded-history, and lifecycle-ownership repairs.
- Finalized evidence and archive revisions remain immutable and retained.
  Cleanup remains logical deletion; no operational VACUUM or erasure.
- Every liveness dimension remains strictly `<200 ms`. A qualification
  timeout does not change that requirement. A diagnostic pass is not release
  or field proof; an unexplained historical failure is not harmless noise.
- Do not retry expensive qualification blindly. Diagnostic repeats must test
  an explicit hypothesis; the >2 GiB gate remains last after cheaper proof.

## Issues And Next Actions

- `DON-248`, `DON-252`, `DON-253`: PR6 implementation/qualification, In Progress.
- `DON-278`: prior Replay completion does not qualify PR6's failed
  legacy-provenance responsiveness observation.
- Historical frame/snapshot failures remain unattributed. Reference graphics
  stress and actual CI trace details are in the evidence doc. CI has two
  physical cores/four SMT threads; a four-distinct-core pass is not equivalent.
  No product readiness or graphics change is justified by those comparisons.
- Opt-in trace diagnostics are pushed and reviewed, with nine tests and a
  real-CDP injected-failure check. Bounded sanitized timings report loss and
  truncation; failure capture freezes before cleanup. They do not alter the
  lifecycle verdict or healthy measurement/intentional-kill timing.
- Actual-CI failure trace retains ~679 ms: one renderer task took 116.929 ms
  (108.314 ms CPU); no completed task exceeds 200 ms. This does not explain
  the full snapshot delay. Matched CPU topology diagnostics isolate harness
  object-export overhead: watchdog 184.18 ms and export 160.6 ms. Full JSON
  page transfer with strict invalid-value rejection reduces these to 96.24 ms
  and 43.9 ms, preserving product calls, rows and semantic checks. The bounded
  harness repair is committed in c145 with source gates and mac lifecycle
  passing. It does not resolve the later reference cleanup timeout.
- Canonical publication repair is local: one finite settlement loop, original
  inode/size/mode anchor, strict reads, final alias checks, and immediate
  rejection of observed substitutions. Fifteen controlled interleavings and
  the original race pass; the focused independent review and serial source
  gates are clean. Commit/push this bounded repair, then continue diagnosis.
- Trace-only cleanup diagnosis catches a 943.993 ms main-thread task using
  only 3.302 ms CPU; driver heartbeat remains below 14 ms. Main synchronous
  SQLite tracking writes are a source-backed suspect, not yet the proven
  wait. Native-operation/syscall probes did not reproduce the stall (SQL
  max 16.275 ms, fsync max 15.169 ms, no SQLite busy sleep in that sample).
  No product persistence changes or >2 GiB run have started.
- Fresh read-only Ubuntu probe passed: `Linux 7.0.0-28-generic x86_64`, about
  29 GB available RAM and 127 GB free disk. Recheck immediately before scale
  work; no scale run has started in this task.

## Verification Limit

c145 full serial local source gate passes: 382 files / 3,981 tests in 394.72 seconds,
full ESLint, production build/bundle budgets, affected Node syntax, diff check,
and backend 58 passed / 1 existing ignore. Local legacy-event max is 66.581 ms.
The prior f49 Linux run passes 3,974 tests; its
legacy-event maximum is `134.374 ms`, SQL poll `3.184 ms`, overlapping GC none.
Exact f49 mac packaged lifecycle passes (main max `81.284 ms`) and Ubuntu
physical SIGKILL matrix passes `32/32`. Browser `235/235` and Opus visual
review `74/74` carry from byte-identical application/tests at c2. Linux Replay,
native SQLite/graphics and tracking pass; lifecycle fails as above. >2 GiB
remains unstarted. PR #10 is not ready to merge or release. The old stop-after-package instruction is superseded
by Donal's fresh-task authorization to carry through merge readiness.

Local ownership repair: affected 122 tests and all 3,996 serial tests across
382 files pass (399.97s), TypeScript/ESLint/build/budgets/syntax/diff pass,
backend 58 pass/1 existing ignore. An accidental parallel full run fails three
tests (startup teardown/next handler and a 259.876 ms legacy inventory gap);
both affected files pass all 111 tests in isolation and the full serial gate
passes without threshold changes. Application/manual/browser-test blobs
remain unchanged; current ownership repair has no packaged qualification yet.
