# HANDOFF.md — Current state

Updated 2026-09-12. Read after `CLAUDE.md`.

## Where we are

- **WAR-02B review remediation is implemented locally on branch
  `codex/war-02b-property-mutation`, based on exact `origin/master`
  `d20bae5fd8156a61e92a9b8fd68c87b2ca614a37`.** The slice now has independent
  coordinate anchors and rejection cases, an independent ingest identity
  oracle, exact cursor/recent-window arithmetic, and a public client-boundary
  DON-228 fault injection with separate current-green and rebroken-red legs.
  The runner shrinks failures, validates seeds, preserves cause/stack evidence,
  bounds async predicates, and fails closed on interruption. WAR-02B is excluded
  from generic correctness so CI does not execute it twice. Focused local
  evidence is 4 files / 19 tests, full correctness 438 files / 4,539 passed /
  6 skips, full source 442 files / 4,564 passed, lint, WAR-02B type-check,
  root app/node type-check, build/bundle budgets, and green-current/red-
  rebroken proof. Both independent TM65 anchors, all coordinate rejection
  cases, and all four inclusive Irish envelope corners are deterministic
  coverage. Four current semantic mutants are killed across three seams; the
  nonexistent `legacy:` survivor is removed. The final exact-head assurance
  subset in CI run `34720826064` bound `961992f9` and passed; it was stopped at
  the separate 960k release replay before later package inspection/soak/archive
  stages. Fresh Luna xhigh review on the exact head found no executable
  correctness or proof blocker. No browser, package, provider, soak, release,
  or field claim is made; DON-254 is Done in Linear and release HOLD is
  unchanged. PR [#24](https://github.com/donal0c/sartracker-web/pull/24) remains
  open and unmerged; GitHub mergeability/owner approval is still outstanding.

- **PR19 Claude follow-up is merged at `d20bae5f`; prior pending wording is superseded.**
  Malformed geometry now refuses the whole source explicitly; batch continuation,
  admission/watch/rescan outcomes and page/delete/error races are repaired. See the
  [follow-up disposition](../docs/assurance/findings/repair-train-b-claude-followup.md).
  `codex/repair-train-b` remains based on master `f4d1f321` after PRs #22/#20/#21;
  exact custody, immutable revisions and foreground-write priority are preserved.
  Ordinary correctness passes 438 files / 4,539 tests (six qualification-only
  skips), lint/build/budgets, seven browser flows and three rendered reviews.
  Native macOS package proof passes 75,004 points, malformed-source retention,
  undated late names, End Outing during import, restart equality and clean close.
  The named GPX smoke now runs in ordinary Linux CI; the standard visual project
  includes all seven GPX flows and their three reviewed captures. Four affected independent
  source charters are clear. Linux runs `34691543650` and `34693020365` remain
  retained diagnostic failures: the former stopped before GPX import and the
  latter confirms WebGL blocklisting after mission start. The corrected GPX
  smoke passed with the established Linux AppImage Mesa/ANGLE flags. PR19 is
  merged; its exact final-head bindings and terminal CI receipt live on
  [PR19](https://github.com/donal0c/sartracker-web/pull/19). [Current record](../docs/assurance/findings/repair-train-b.md).
  DON-274 remains In Review; DON-270 retains its original completed history;
  DON-254 was In Progress in this historical receipt and is now Done in Linear.
  Historical timing failures remain release blockers.
  PR19 merge is complete; no release or performance work is claimed here.

- **DON-254 responsiveness attribution — PR21 merged** at `bac211dc`.
  It remains diagnostic-only. CI `34683600517` passed correctness, three
  Electron controls, package/native inspection and AppImage launch/close;
  independent Astra review cleared the source. Local control repeat passed
  after an unexplained lost target; that failure remains retained. Strict
  timing/replay/soak qualification skipped in ordinary CI, not passed.
  **Release HOLD: unchanged `<200 ms`**, including retained 205 ms and
  544.164511 ms failures. [Record](../docs/assurance/findings/responsiveness-attribution.md)
  and [review receipts](../docs/evidence/responsiveness-attribution/current-head-reviews.md).

- **WAR-06 PR #20 investigation-only evidence is merged and remains evidence-only.** Current routes,
  fidelity limits, negative-control proof and exact-head status live in the
  [WAR-06 report](../docs/assurance/findings/war-06/WAR-06.md), [receipts](../docs/assurance/findings/war-06/review-receipts.md)
  and [PR checks](https://github.com/donal0c/sartracker-web/pull/20/checks).
  No production repair or release claim is included. Current local refresh on docs head
  `b388df0d` passed the serial full source suite (435/4,468) but the default-
  parallel suite still failed unchanged DON-277 (275.58 ms) and DON-278
  (228.95 ms) against `<200 ms`; the timing gate remains a DON-254
  qualification blocker, not a WAR-06 documentation issue.

- **Repair Train A merged**, [PR #17](https://github.com/donal0c/sartracker-web/pull/17),
  at `302bdd040976bd370271cf5866549fa2a7e05ff5` on 2026-09-10. Its final
  application head is `713461bf`. A-R10–A-R21 are disposed: lifecycle/custody retry, autosave,
  reservations, stationary elapsed truth, per-device replacement freshness and
  replacement request diagnostics. All four exact-head reviews clear; local and
  Linux CI pass 427 files / 4,377 tests, lint/build. Actual macOS reconnect,
  omission and SQLite custody proof passes; unchanged stationary inputs reuse
  three browser flows and the 78.5 ms incremental 100×5,000 renderer proof.
  CI `34496976736` attempt 2 passes all package/replay/soak/archive/AppImage steps;
  inspected archive maximum is 193 ms. Attempt 1's 224 ms breach is retained and
  unexplained: the one unchanged-head repeat proves no causal fix. Soak renderer
  499.9 ms / external action 374.58 ms also remain DON-254 qualification evidence.
  This is scoped review readiness, not reliable strict-200 or release acceptance.
  [Disposition](../docs/assurance/findings/repair-train-a-remediation.md) and
  [latest receipt](../docs/evidence/repair-train-a/github-followup/linux-ci-receipt.md)
  bind the proof. DON-267/DON-269 are Done in Linear; DON-254 is now Done in
  Linear.
  Merge does not establish release or field acceptance.

- **WAR-02A test foundation merged in PR #16 at `4076975d`** from fetched master `083f5047`
  (merged PR #15). Additive helpers/tests are isolated under
  `tests/unit/assurance/war-02a/`; production and Repair Train A are untouched.
  Source at `de7d15bf`: 422 files / 4,325 tests, lint/build. Final affected 65
  tests and helper types pass; both red controls remain proven. [PR #16](https://github.com/donal0c/sartracker-web/pull/16)
  records live CI/merge readiness. Claude's four follow-up findings are now
  addressed: automatic strict build gate, literal mutation, open faults, and
  child infrastructure diagnostics. Final local source: 424 files / 4,346 tests;
  lint/build pass. PR #16 CI `34483190305` passed at `47ed9cce`; this integration
  checks that reported status without re-qualifying the separate WAR lane.
  Earlier independent reviews clear executable
  `18bd374f`, including the corrected mixed-failure red gate and final cumulative
  review. [Evidence](../docs/assurance/war-02a-test-infrastructure.md).
  DON-254 remains qualification owner; no package/provider/soak acceptance.

- [PR #15](https://github.com/donal0c/sartracker-web/pull/15), Team Feedback
  Batch 2 (DON-215), merged at `083f5047`, including PRs #13/#14. Its retained
  [batch evidence](../docs/ui-feedback-batch-2-evidence.md) covers application
  `42f9f305`, source 415 files / 4,271 tests, affected browser/visual and packaged
  restart/pause/tracking checks. Linux CI `34462624720` passed on `e60dc43e`;
  downloaded receipts bind native SQLite, custody, teardown and privacy.
  Current-fix/frame maxima 188/110.3 ms remain below unchanged 200 ms limits.
  Prior 242/210/206 ms hosted failures remain unexplained; the bounded Mesa
  configuration pass is not a causal fix or field acceptance. The
  [investigation](../docs/archive-ci-rendering-investigation.md) retains evidence.
  New geometry/E2E gate wiring remains deferred. No release acceptance is claimed.

- WAR-11A merged as [PR #14](https://github.com/donal0c/sartracker-web/pull/14)
  at `35cff87d`; final Linux CI `34413097593` passed. Builder 26.16.1 adds
  installer/ASAR inventory, AppRun policy, native SQLite and clean-source checks.
  Electron/application runtime and the 200 ms gates remain unchanged.
  [WAR-11A](../docs/assurance/findings/WAR-11A.md) retains its evidence ledger.
  DON-254/DON-255 still own final qualification/publication.

- **Three-stream coordination is locked (2026-09-10):** SAR-team feedback,
  confirmed deep-audit defects, and WAR hardening share the
  [coordinated work ledger](../docs/assurance/coordinated-work-ledger.md).
  Team Feedback Batch 2 repaired `AUD-07` and `AUD-14`; Repair Train A repaired
  `AUD-13`, `AUD-02`, and `AUD-03`. Nine confirmed audit findings remain across
  Repair Trains B–D. BCP-17/final
  qualification waits for release-blocking repairs and applicable WAR-04
  remediation, then runs against one frozen exact candidate.

- [PR #12](https://github.com/donal0c/sartracker-web/pull/12), WAR-04B, merged
  at `c51e4b35`. Final executable evidence is CI `34386382652` on `03b09a7e`:
  400 files / 4,158 tests and all packaged gates; downloaded receipt validates.
  Cold-Mesa/source corrections remain. Historical 203/226 ms current-fix and
  219.5 ms frame failures remain in the [report](../docs/assurance/findings/WAR-04B.md)
  and [investigation](../docs/archive-ci-rendering-investigation.md).


- DON-256's first twelve-item Sar_4 UI batch merged as
  [PR #11](https://github.com/donal0c/sartracker-web/pull/11) at `9c73c62d`.
  Tested upstream head `e384ea8a` has green CI `34345038450`; source
  400 files/4,155 tests, 89 affected browser/visual tests plus roster retry,
  and 27 screenshot reviews are retained in its
  [evidence](../docs/ui-feedback-batch-1-evidence.md). Persistent tracking,
  compact/collapsible controls and contrast changes are upstream UI work;
  their prior timing rejections are not claimed fixed by this integration.

- [PR #10](https://github.com/donal0c/sartracker-web/pull/10), programme PR6
  archive lifecycle, merged to `master` at `e0ead68852b10606551302b5104e409634c962e1`.
  DON-248, DON-252 and DON-253 are Done. All 95 external-review findings have
  fixes or explicit dispositions in the [complete ledger](../docs/breadcrumb-pr6-complete-review-ledger.md).
- Documentation cleanup records the final testing approach below. Start new work
  from current `master`; the archive PR does not need another review cycle.
- Repair Train B owns `AUD-01`/`AUD-10`/`AUD-05`. Merged WAR-06 remains
  evidence-only; its open hazards are not repaired or closed by PR19.
- Remaining Sar_4/team requests are still explicit rather than absorbed into
  these tasks: official/private map distribution and provider/grid work
  (`DON-144`/`DON-7`/`DON-76`), search-area label positioning (`DON-214`), map
  export/print (`DON-216`), external-team/drone resource modelling (`DON-217`),
  evacuation/gear workflow ownership (`DON-218`), privileged settings and
  unlock/recovery (`DON-219`–`DON-221`), and operator-facing multi-outing layer
  organization (`DON-100`). Marker Details simplification remains a later
  coordinator-confirmation item. Mission Preview/per-device visibility landed
  in PR #15; Linear `DON-215` is reconciled to Done.
- Locked next steps after PR19 merged: bounded large breadcrumb IPC/query
  transfer repair (316–550 ms), separate legacy-recovery repair (~239 ms), then
  unchanged strict `<200 ms` qualification. Other repair trains and WAR hazards
  remain tracked separately before BCP-17/DON-255. Use the
  [workplan](../docs/two-track-execution-workplan.md#next-task-order) and live Linear
  issues for scope. PR19 merge is complete; release/field acceptance is not established.
  DON-247 and DON-264 remain separate reliability work.

## Testing approach to carry forward

Donal reaffirmed on 2026-09-10: documentation-only pre-merge conflict resolution
does **not** trigger repeat tests, builds, browser/package smoke or CI dispatch.
Verify the diff and reuse prior evidence; a new merge SHA alone invalidates none
of it. Before repeating expensive validation, name the executable change or
separate failure that warrants that specific check. See the cadence below.

Follow [Testing and review cadence](../docs/testing-and-review-cadence.md):
reproduce narrowly, fix and run affected tests, complete one stable source cycle,
exercise relevant UI/native boundaries, then normal CI. Reuse unaffected evidence
with explicit source identity. Broaden only for changed risks, failed evidence,
or release requirements; do not automatically restart the entire qualification.

## Verification and remaining limits

- Tested PR head `1b1f86ee`: [Linux CI](https://github.com/donal0c/sartracker-web/actions/runs/34324371898)
  passed 4,137 tests / 396 files, lint/build, 960k replay, packaged tracking,
  archive lifecycle and AppImage launch. Downloaded receipt independently passed
  exact-head/tree, teardown and privacy validation.
- Local source/build, four Chromium + three visual flows, four screenshot reviews
  and clean macOS packaged lifecycle passed. Detailed receipts and measurements
  live in the complete ledger; this is pre-merge engineering evidence.
- Prior GPX timing rejection remains unexplained but did not recur in focused
  local/Linux checks or final CI. Limits were unchanged; Linux frame maximum
  198.1 ms has narrow headroom below 200 ms. Temporary plaintext can remain after
  a crash until restart recovery; no forensic-erasure guarantee.
- Historical scale/interruption proof and the protected original fixture identity
  are in the [PR6 evidence](../docs/breadcrumb-pr6-evidence.md) and
  [archived handover](archive/pr6-closeout-history-20260909.md).
  Never open the original closed fixture with SQLite; copy it first.
