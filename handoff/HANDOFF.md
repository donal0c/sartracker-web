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
- Diagnose the renderer breach before qualification/scale. Reference-host
  stress on one physical core produced pre-operation frame starvation with a
  `368.29 ms` graphics task. Four distinct cores passed create/verify at
  `90.8 ms`. CI had four CPUs and a different OS/Mesa stack; its cause remains
  unattributed. Receipt details and diagnostic limits are in the evidence doc.
- Participant readiness checks sidebar/database state, not actual map content.
  A diagnostic map-render prerequisite did not demonstrate a fix: setup CDP
  timed out on the constrained host. No product or gate change is justified yet.
- Opt-in CI trace diagnostics are prepared, not a performance fix. Sidecars
  retain only bounded numeric timings/closed names, preserve failure-window
  overlap and markers, and report loss/truncation. Failure freezes capture
  before cleanup; healthy measurement is not interrupted by trace draining.
  Optional setup failures remain diagnostic-only, including late CDP cleanup.
  Nine tests pass and real-CDP injected-failure capture/teardown passes; bounded
  independent re-review is clean. Full source gate now passes: 382 files /
  3,974 tests, lint/build/budgets, backend 58/1 existing ignore, syntax/diff.
  Commit/push this diagnostic candidate to obtain actual-CI timing evidence.
- Fresh read-only Ubuntu probe passed: `Linux 7.0.0-28-generic x86_64`, about
  29 GB available RAM and 127 GB free disk. Recheck immediately before scale
  work; no scale run has started in this task.

## Verification Limit

Full serial local source gate passes: 381 files / 3,965 tests in 376.36 seconds,
full ESLint, production build/bundle budgets, affected Node syntax, diff check,
and backend 58 passed / 1 existing ignore. Linux also passes 3,965 tests; the
legacy-event maximum is `21.358 ms`, SQL poll `3.350 ms`, overlapping GC none.
Mac packaged lifecycle passes (main max `76.219 ms`), browser `235/235`, Opus
visual review `74/74`, Ubuntu physical SIGKILL matrix `32/32`. Linux Replay,
native SQLite/graphics and tracking pass; lifecycle fails as above. >2 GiB
remains unstarted. PR #10 is not ready to merge or release. The old stop-after-package instruction is superseded
by Donal's fresh-task authorization to carry through merge readiness.
