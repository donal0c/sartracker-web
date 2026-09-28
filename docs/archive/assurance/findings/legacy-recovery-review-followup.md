# PR25 review follow-up

Review input and empirically verified implementation: `c93b692544e9a0e13e099b46f1bc59a63ae45bb4`.
This follow-up supersedes its READY verdict until the terminal PR receipt verifies
the new commit. No Electron/renderer/domain production code is changed.

## Blocking findings

1. **Evidence provenance:** the old manifest omitted the newer subtree. The
   replacement enumerates every descendant file except the manifest itself;
   missing, extra or changed entries fail an explicit ordinary-CI check. Historical
   bindings now name their implementation commits and are marked historical.
   Every `c93b6925` and `09710eba` input hash was checked with `git show` against
   its actual commit. `baseHead` remains the development parent, separately labelled.
   The original raw measurements retain their original source identity. The evidence
   README identifies current versus historical records. The latest follow-up binds
   content hashes; CI and the terminal receipt provide its owning commit, avoiding
   an impossible self-referential commit hash in a file inside that commit.
2. **Audit payload drift:** keep the oracle independent of the production builder,
   but execute it against a real `createElectronMissionStore`/`upsertMarker` and
   actual SQLite projection/version/audit rows in the ordinary unit suite. A changed
   production payload now fails that named contract test before packaged CI. Sharing
   the builder would let a common production/oracle bug pass both sides.

## Other findings

- Added direct rejection controls for version `completeness: legacy_baseline` and
  audit `recording_completeness: legacy_baseline` after settlement.
- The 204.046 ms concurrent COUNT remains a **real unresolved read-latency
  observation**. Moving the test reader does not fix that latency or prove an
  operator read stays below 200 ms during backfill. I/O/locking versus scheduling
  is not resolved by the 1 ms CPU sample. DON-254 retains this limitation and
  operator-read qualification; no speculative production fix or new budget is claimed.
- The 500k DON-274 GPX cursor test now captures real worker completion/exit and
  checks the exact durable cursor afterward, outside its heartbeat window. Its
  30-second outer deadline and strict 200 ms predicates remain; the former poll
  loop is replaced by a named 10-second observation deadline.
- Native restart now has separate open and mutation/close timer intervals.
  The controller's 50k-row inspection runs between them, with both stopped.
  The report explicitly names a second disposable store and injected production
  runner: it does **not** verify the normal app's default worker wiring or
  operator-load behavior. Worker ID assertions retain provenance, not that broader claim.
- CI runs on relevant `master` pushes as well as PRs. Existing path filters remain
  intentional; an unmatched-path change is not a verified run. An additional
  report-validation step rejects missing/failed/stale/incomplete reports and checks
  source/tree, oracle/probe hashes, custody/digests, exits and timing. The smoke
  step has a five-minute process deadline; the whole job keeps its 60-minute limit.
  The previous exact-head run finished in about 25 minutes, not near the job limit.
- Added `electron:smoke:legacy-recovery`, matching sibling command discoverability.
- `nextNodeTurn` is **not dead**: the queued-parser-turn test still awaits it.
  It is retained. `workerThreadId !== parentThreadId` is redundant with a positive
  worker ID when main is 0; it stays readable provenance, not an independent
  default-wiring oracle. `Promise.race` subscribes to both inputs, so the claimed
  fatal unhandled late rejection is rejected and `bounded()` is unchanged.

The source review's other speculative cases do not justify broader production
changes here. The single disposable mission intentionally has exactly 50k baseline
objects and still waits for actual worker exit before declaring success; full
independent row checks follow. Current marker timestamps are canonical by contract,
and the real-store test pins that contract. Native diagnostic scope, retained fixture
size, isolated provider/UI coverage and release HOLD remain explicit limitations.
The seed digest proves preservation of the generated fixture through recovery
and restart; it is not an independent golden oracle for every seeded name,
coordinate or timestamp. The exact fixture claim is the 50,000-row population.

The independent follow-up review also found two validator improvements: its
synthetic test fixture now refreshes production hashes from the checkout (with
a separate deliberate mismatch control), and the validator rejects missing or
overstated proof tiers. Both new scope controls failed before the fix and passed
afterward. Manifest schema and the sole self-exclusion are checked explicitly.

## Verification

Focused GPX full-size test: pass, 11.688 ms heartbeat. Real-store custody plus
eight rejection/fixture controls: nine pass. Native probe with separated restart
intervals passes. The report validator has 30 controls, including the two retained
proof-tier red failures; together with custody, 39 focused tests pass.
The final stable correctness run passes 447 files / 4,731 tests with the same six
qualification-only skips. This is ordinary correctness evidence, not full strict
responsiveness qualification.
The final strict affected run passes all three selected object/event/GPX cases
at 11.347 / 11.668 / 11.084 ms maximum heartbeat gaps; 90 unrelated cases are
filtered out by the named selection. The local native report records recovery,
close, restart-open and mutation/close gaps of 60.212 / 65.247 / 58.553 / 53.919 ms.
It is a dirty-controller run against a reused macOS ASAR with six matching
production inputs; the clean combined Linux package remains a separate CI claim.
The final receipt on PR25 binds full source, final native report,
independent review, and exact-head Linux CI; no earlier run is relabelled as this
changed candidate. DON-254 remains In Progress; merge belongs to Donal and release
qualification remains HOLD.
