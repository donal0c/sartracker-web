# PR6 external review remediation

Source: [Claude Code review ledger](https://claude.ai/code/artifact/a1d8e3ac-aa7d-4dc1-be67-8eba66443e38), reviewed head `c69b0c23086fb5c703efe860a92befeb1f61dd2b`.

Donal requested correction of the findings with proportionate regression and smoke
coverage. The previous qualification remains historical evidence, not proof of
subsequent changes. No merge or release is authorized by this remediation.

The source counters and visible list disagree: T1/T2 plus A1–A12 are 14 entries,
and the selected Medium section lists 16 of 21. The omitted findings have been
requested. Medium identifiers below follow their visible order.

## Findings and disposition

Pending means not yet resolved or verified, not an acceptance of the proposed fix.

| ID | Finding | Disposition / verification |
| --- | --- | --- |
| T-1 | Current evidence queue loses newest fixes under writer contention | Implemented; real queue/poller saturation regression preserves all displayed observations; capacity is checked before and after polling, including mission changes. |
| T-2 | Evidence pump discards original persistence failure | Implemented; every original failure reaches the logger and a sanitized failure-code diagnostic, even when loss markers coalesce. |
| A-1 | Finalized coverage publication invalidates cleanup membership | Implemented; finalized/finalizing coverage publication is refused before work and inside the write transaction. Existing invalidated epochs require correction unlock and re-finalization; no immutable baseline is rewritten. |
| A-2 | Cleanup operation registration races across awaits | Implemented; cleanup ownership is registered synchronously before lookup, with cancellation and identity-owned release. |
| A-3 | Verifier omits independent archive scope enforcement | Implemented; streamed verification independently checks row scope. Re-encrypted, internally consistent metadata and operational-state attacks are rejected. |
| A-4 | Unexpected Review directory entries prevent application startup | Implemented; the exact regular single-link Finder .DS_Store file is removed safely. Unknown files and hostile links still fail closed. |
| A-5 | Verification progress carries an empty mission ID | Implemented; empty mission identity is accepted only for matching verification operation, kind and sequence; progress subscription is tested. |
| A-6 | Review attachment handles/copies accumulate until session close | Implemented; eight retained attachment leases per Review session, released on close; ninth admission is rejected explicitly. |
| A-7 | Legacy archive identity does not bind file content | Implemented; first-observed legacy content is pinned durably; reconciliation and Review reject replacement bytes. Concurrent identical baseline observations coalesce. This is not historical authenticity. |
| A-8 | Untrusted legacy archive enumeration and worker memory are unbounded | Implemented; attachment enumeration streams with count/byte limits, application Workers have heap limits, and Review reads have bounded concurrency. Native allocations are not claimed to be bounded by V8 resourceLimits. |
| A-9 | Correction rewrites attachment audit details | Implemented with explicit provenance; relocated live attachment paths retain their previous/new fields in the atomic mission_unlocked amendment. Earlier sealed archive bytes remain unchanged; live historical rows are still rebound. |
| A-10 | Correction silently accepts missing attachment reference rows | Implemented; every declared attachment reference must resolve to exactly one matching mission/type row or the transaction rolls back. |
| A-11 | Correction IPC exposes raw internal errors | Implemented; correction IPC exposes only closed archive failure codes/messages. |
| A-12 | Normal writer shutdown cancels already admitted edits | Implemented; normal shutdown drains admitted writes through the bounded retry policy; explicit requester cancellation remains distinct. |
| B-1 | Cleanup confirmation omits live-row counts and credential dependency | Implemented; worker-backed exact deletion-predicate counts precede confirmation, with archive/credential recovery warning. Preview count matches actual removal in a genuine database regression. |
| B-2 | Cancellation can strand dialogs indefinitely | Implemented; cancellation-pending dialogs permit returning to the mission without claiming cancellation or releasing main-process ownership; status refresh/restart guidance is explicit. |
| B-3 | External path opener permits protected user-data files | Implemented; canonical external-open paths reject private app state and symlink escapes; mission attachments and explicitly selected external paths remain allowed. |
| B-4 | Custody transaction helpers omit transaction ownership assertions | Implemented; custody helpers open an immediate transaction when needed and assert terminalization ownership; induced failure rolls back both journal changes. |
| B-5 | Attachment proof conflates historical digest and path-only custody | Implemented; new proofs distinguish digest custody and legacy path-only counts. Historical proofs retain their original unknown tier rather than being upgraded. |
| M-1 | Key unwrap conflates authentication and provider failures | Implemented; provider/setup errors remain distinct from authentication failure; authentication failure uses neutral credential-or-damage wording. |
| M-2 | Credential strings outlive their necessary use | Implemented for archive creation; long-lived runner/result validation retains only non-secret identity after transfer. Managed JavaScript strings cannot be guaranteed zeroed. |
| M-3 | Temporary key/random buffers are not cleared | Implemented; random-provider and temporary plaintext key buffers are cleared. |
| M-4 | Remaining poll delay may bypass the minimum interval | Reassessed: the minimum belongs to the whole cadence, not an additional cooldown after elapsed work. The normalized interval remains clamped; elapsed capacity waiting counts toward it. A deterministic 40 ms wait / 50 ms cadence regression prevents double-charging that wait. |
| M-5 | Restart trail decimation is undocumented | Documented; restart trail caps are display limits and do not delete mission fixes. |
| M-6 | Cleanup traverses unrelated global rowid pages | Retained deliberately; global rowid pages cap each transaction even on legacy stores without an index. Mission-scoped sorting/index construction could reintroduce long native work. Existing cursor/zero-delete regressions cover this trade-off; optimization is not required for correctness. |
| M-7 | Completed cleanup is reprojected from mutable eligibility blockers | Implemented; completed cleanup projects from its durable proof and residue rather than current availability/credential eligibility. |
| M-8 | Failed rollback strands the writer connection | Implemented; an owned leftover transaction gets a rollback attempt. Failed recovery faults the writer explicitly and rejects later admissions. |
| M-9 | Correction rehydration holds a large uncancellable write transaction | Retained atomic restore; it prevents partial evidence publication. Correction is deferred while another mission is operational and runs in a killable utility process, not an uninterruptible main-thread operation. Existing atomicity and cancellation regressions apply. |
| M-10 | Restore hashing/native SQLite work lacks cancellation boundaries | Implemented chunk cancellation in restored-database hashing. Native SQLite sections retain physical-exit ownership and workload deadlines; pending cancellation is dismissible without a false completion claim. No native interruption guarantee is made. |
| M-11 | Correction attachment custody can leave unreclaimed copies | Implemented; unpublished pair/peer files are revalidated and reclaimed before clearing custody, in restart-safe pair-to-peer-to-absent order. Committed pairs are two names for one inode, not duplicate payload bytes. |
| M-12 | Administrator roster changes lack audit history | Implemented; serialized settings saves atomically retain previous/new administrator rosters and time. Local settings remain a trusted-machine workflow control, not authenticated user authority. |
| M-13 | Unsupported Windows Review fails after credential entry | Implemented; platform capability hides credentials on unsupported platforms and preload/main reject before restore. Windows remains unshipped. |
| M-14 | Rejected descriptor close can be reported as success | Implemented; close failure checks the original descriptor and bounded retries; unresolved ownership rejects physical-exit completion and retains quarantine instead of sweeping. |
| M-15 | Review scrubbing silently discards over-budget or malformed content | Implemented; malformed or excessive Review content fails explicitly instead of becoming silent null data; legitimate privacy redaction remains. |
| M-16 | Review queries and denial audit writes have unbounded concurrency | Implemented; two running Review reads, sixteen admitted requests, cancellation-aware queue; mutation-denial audit admission capped at thirty-two per session with explicit refusal beyond that. |
| P-1 | Paused polling republishes old fixes as new evidence | Implemented; paused republish carries no fresh mission evidence identity. |
| G-1 | Direct result-budget tests absent | Added direct result-budget boundary tests. |
| G-2 | Direct Review projection-query tests absent | Added direct projection scope, request and result-page boundary tests. |
| G-3 | Direct transferred-handle cleanup tests absent | Added direct transferred-handle tests and runner/session ownership regressions; see M-14. |
| G-4 | Direct workload watchdog tests absent | Added direct workload watchdog tests. |
| G-5 | Verification dialog progress subscription untested | Added verification progress subscription regression; see A-5. |

## Verification approach

Use failing regressions for confirmed defects, then the affected suites. Run a
final combined source/build/lint check and targeted operator/package smokes once
the changes settle. Repeat scale or interruption qualification only where a
changed invariant requires it; record the reason and result here.

### Current remediation verification

- Production build, TypeScript and bundle budgets pass. Archive Review controls
  now load on demand, using the same boundary as the existing archive dialogs;
  the main application chunk is 467.55 kB, below the unchanged 500 kB limit.
- ESLint and `git diff --check` pass.
- Four Chromium operator flows and three visual flows pass (27.6 s). All four
  captured screenshots pass the independent visual review. The empty-credential
  screenshot prompt no longer asks an image to prove password masking; Playwright
  independently checks both password input types. The manual cleanup image is updated.
- Two added correction recovery cases cover peer-only and already-absent residue,
  alongside exact-pair recovery, through the actual utility-process boundary.
- Parallel source runs exposed wall-clock contention in the unchanged legacy
  provenance responsiveness test. The two affected suites pass in isolation
  (115 tests); the final complete run uses CI's existing `--no-file-parallelism`
  setting, preserving the 200 ms assertion. **All 4,105 tests / 394 files pass**
  in 443.06 s; the previously failing provenance heartbeat is 90.793 ms.
- Exact clean source `8839da776bf72fa8197c40e33b570518f92ade9c`, tree
  `d88124ded3cb7acf4099cc8431676be1868106f2`, passes the packaged macOS arm64
  lifecycle validator: two launches, 4,096 fixes, 202 replay objects, 101 outing
  choices, matching Review content before/after 5,516 live-row removals, forced
  restore interruption and clean restart recovery. Main heartbeat max 53.051 ms,
  current-fix gap max 60 ms, renderer frame max 15.201 ms; all below 200 ms.
  No secret matches or final plaintext residue. Receipt:
  `docs/evidence/pr6/review-remediation-8839da77-20260908.json`.
- The previous large-fixture/whole interruption-matrix qualification remains
  historical; this remediation does not claim fresh full-scale qualification.
  All visible findings are addressed or explicitly dispositioned. The five
  omitted Medium entries remain unassessed; remote CI must also finish on the
  pushed candidate before author-side verification is called complete.

### Linux continuity follow-up

CI `34284048832` on `cb6e28a2` passed the full source suite, production build,
Linux packaging, normal 960k Replay and packaged tracking. Its archive smoke
failed during pre-cleanup Review restore on a 207 ms external current-fix gap
(limit 200 ms). Main/frame maxima in that phase were 63.560/126.1 ms; profile
and process cleanup completed. Preserve the rejection:
`docs/evidence/pr6/review-remediation-cb6e28a2-linux-failure.json`.

Investigation found a deterministic scheduling defect in the initial M-4 remedy:
after a 40 ms capacity wait in a 50 ms cadence it scheduled another full 50 ms,
delaying the next request until 90 ms. The minimum was already applied when
normalizing the whole interval. The correction retains that minimum and counts
elapsed waiting toward the deadline. It resumes an overdue poll without overlap
and then returns to the normal cadence. The regression failed before correction.
Earlier cadence tests did not exercise elapsed post-publication capacity waits.
This is a plausible contributor to the CI gap; a new exact-candidate Linux smoke
must pass before the CI failure is considered cleared. No gate has been relaxed.

The correction is commit `4b9d2ceb36c1c4d9d490baea2f0f49a8c985f527`, tree
`9370603032faa1b4cadd317cc70c9ce08688b036`. All 197 affected tests, build and lint
pass. Its exact clean macOS package passes the same two-launch lifecycle smoke
in 10.373 s, including forced interruption/restart and matching archived Review.
Main/current/frame maxima are 52.315/112/18.101 ms. Receipt:
`docs/evidence/pr6/review-remediation-4b9d2ceb-20260908.json`.
Check the current PR's Linux CI for the final remote outcome.

CI `34286926496` on `d60cbc2a` again passed source/build, Linux packaging,
960k Replay and tracking, but rejected a 200 ms archive current-fix gap. Its
receipt is `docs/evidence/pr6/review-remediation-d60cbc2a-linux-failure.json`.
Further full CI retries were paused for a focused four-logical-CPU reference
diagnostic using a disposable small fixture, without opening the original
large mission store.

The bounded timing probe on diagnostic-only `e0ec1ecc` reproduced a 222 ms
gap without render tracing: all eight evidence slots were occupied and polling
waited for persistence. The main/frame probes remained responsive. A second
stage probe (`78943bad`) measured median device/position database work of
11.61/11.55 ms and diagnostic I/O of 5.23/4.29 ms. Diagnostics alone were not
the cause. It also exposed repeated complete snapshot persistence between
current evidence acknowledgments. The intervening `bd4fbd3` probe conflicted
with frozen IPC properties and is invalid; none of these probes constitutes
qualification or a production change.

Source inspection and a red regression confirmed that already-acknowledged
initial history, canonical history and restart seeds were being republished
without an explicit non-evidence scope. The runtime therefore persisted their
current device/fix snapshot again. Those render-only publications now carry
`missionEvidenceId: null`, as do inactive history publications. Unpersisted
history still retains its observation scope, and the bounded live queue still
waits for durable acknowledgment. The two affected suites pass (165 tests).
Focused packaged verification is pending; no responsiveness gate was relaxed.

The render-only correction reduced the early-phase maxima, but the second
launch exposed a separate cleanup writer wait: one position write took
1,074.4 ms awaiting/performing its database work, versus 1.44 ms for diagnostics;
main/frame gaps remained 59.9/57.7 ms. The background cleanup worker could
reacquire SQLite between pages while the live writer was waiting to retry.
The foreground writer now shares its admitted-write count with the trusted
cleanup worker. Cleanup waits outside a transaction before initialization,
each page and retries whenever that count is nonzero. Cancellation does not
depend on the foreground queue emptying. This changes scheduling only: the
verify/delete/commit order, page bounds and live evidence queue are unchanged.
Unit tests cover count release on success/failure and cancellation; a real
worker test proves the count is shared, and the genuine cleanup coordinator
checks every boundary is offered outside a transaction. Packaged proof remains
pending. No best-effort diagnostic durability change was needed.

The same four-logical-CPU diagnostic with both corrections (`53c2946c`)
completed both launches and the entire lifecycle without a liveness rejection.
Maximum position-write database duration fell from 1,074.4 to 48.35 ms;
maximum device-write database duration was 38.61 ms. The driver intentionally
rejects diagnostic builds before generating qualification evidence. This is
causal before/after support, not a replacement for the clean packaged smoke.
The affected polling/runtime suites pass 165 tests; cleanup/priority/writer
and store/runner suites pass 152 distinct tests. Build and lint pass.
