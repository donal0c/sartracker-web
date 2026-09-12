# Bounded canonical breadcrumb transport — DON-254 follow-up A

Base: freshly fetched `origin/master`
`d20bae5fd8156a61e92a9b8fd68c87b2ca614a37` (merged PR19).
Branch: `codex/don-254-bounded-history-transport`.
This is a production transport repair, not BCP-17/WAR-12 qualification or release acceptance.

## Authority and regression

The owning record is DON-254 comment
`46c986c3-a16e-48f0-b069-a1b36eeb2d62`, indexed in the
[Reliability & Regression Ledger](https://linear.app/donal-oc/document/reliability-and-regression-ledger-4f86841816ee).
The [original causal record](responsiveness-causal-repair.md) retains the
103,626-row query's measured main gaps of 316.293135, 349.030945 and
351.317084 ms, native IPC replies of 161–170 ms, and restart maxima up to
550.359 ms. These were reference Ubuntu/source-overlay observations, not
exact-head CI or field evidence. Introducing commit and last known good remain unknown.

Whole-result structured cloning through worker/main/IPC/contextBridge is a
confirmed contributor; it does not explain every historical responsiveness
failure. Earlier tests verified selector correctness and isolate execution,
but allowed the selected result to cross all boundaries as one object graph.
The new regression rejects that actual old worker reply and exercises the
production protocol at 103,626 rows.

[SAR-QA-002 and SAR-QA-008](../../breadcrumb-team-question-and-answer-ledger.md)
retain the team's current-position and historical-loading authority. This
change preserves existing query/selection meaning. It adds a database-backed
selected-row transfer count and progress bar, explicitly incomplete until
the existing history workflow can use the complete result. No new team
question, coordinate rule, timestamp policy or persistence interpretation is introduced.

## Design and invariants

- The existing `breadcrumb-query.cjs` selector is unchanged. Counts, metadata,
  selected rows and order come from its single SQLite read transaction. The
  read transaction closes before transport; later writes cannot alter that result.
- One canonical worker and at most eight queued canonical requests are owned
  by the registry. Canonical and exact-dot workers retain their shared serial
  admission boundary. Current-position polling and foreground writes do not
  wait on that boundary.
- Each pull returns at most 32,768 UTF-16 code units. Only one read may be
  outstanding. Main retains session controls and one frame, never the result.
- JSON parse records are at most 16,384 code units. Oversized strings use
  1,024-unit fragments with exact offsets and lengths, plus final field counts.
  The renderer builds final values directly without a full encoded-row buffer.
  Its final canonical result necessarily scales with the unchanged selector's
  result; transport queues and parse overhead do not scale with the full reply.
- Non-finite optional SQLite numbers and signed zero use explicit wire tags.
  Strings resembling tags stay strings. No optional value is silently changed
  to null, omitted or normalized by the transport.
- Sender-scoped request IDs plus per-session snapshot tokens fence reads,
  finish and cancellation. The renderer checks sequence, snapshot, mission,
  frame/record bounds, record order, counts and terminal completeness.
- Renderer rows remain private until finish acknowledgement and clean worker
  exit. Cancellation fences late results immediately and joins actual worker
  termination. Sender destruction, timeout, failed startup, queued cancellation,
  restart and store shutdown all retain explicit settlement ownership.
- The obsolete whole-result worker runner and native store/preload entry are
  removed. Existing tests migrate to bounded sessions without dropping their
  selector, cancellation, shared-worker or shutdown assertions. The memory
  attribution probe uses the same production client rather than a second decoder.

## Preserved WIP and red/green custody

The original source at
`/Users/donalocallaghan/.codex/worktrees/c98f/sartracker-web/tmp/pr22-scope-freeze-20260911/`
was not modified. All 20 entries in `sha256.json` matched. The transport patch
hash is `9f393450e0bb40e1c9bc80d7deafad132d7b4bd47a13ee579a7973cf25eaa685`.
Only its five transport files were copied after context inspection. It was
incomplete evidence, not accepted production code.

Retained local logs live under `tmp/don254-transport/`; selected durable
receipts are linked from the PR's terminal evidence:

- Preserved protocol/client/native red replay: 21 failures and 10 passing
  protocol controls. Missing registry and obsolete whole-result boundary were explicit.
- The added large-string parse-bound test failed before field fragmentation.
  It now preserves escaped strings, non-finite values and split surrogate pairs;
  missing/duplicated/reordered fragments and missing fields fail visibly.
- The source cycle interrupted for the SAR-QA-008 progress-bar correction is
  retained as interrupted, not green. Browser red confirmed the missing bar;
  the corrected rendered flow and independent five-item screenshot review pass.
- Native SQLite/worker plus production IPC/preload harness: exact 103,626-row
  snapshot equality, old-reply rejection, bounded frames, one outstanding call,
  concurrent write isolation and fresh restart query pass. IPC/contextBridge
  copying in this unit test is simulated; it is not packaged evidence.
- Focused integration passed 267 tests before the final additional shared-tail
  controls; the later dot cancellation/shutdown controls pass 3/3. The final
  source cycle and packaged receipts govern final totals and readiness.

## Required terminal proof and residual limits

The PR terminal receipt records the stable serial correctness/lint/build cycle,
the exact tested package/source identities, the targeted native smoke, Linux
CI and four independent accumulated-diff reviews. No pending row is a pass.

`scripts/electron-breadcrumb-transport-smoke.mjs` uses the actual packaged
worker/main/preload/contextBridge and the production mainworld client loaded
for a direct probe. It binds packaged files and renderer build hashes, compares
every selected field/order against the same query oracle, interleaves a current
write, checks progress/cancellation/stale reads, restarts and requires graceful
code-zero closes. It retains the independent main timer and strict `<200 ms`
main/current-write/renderer checks. Fixture preparation and post-transfer digest
generation are labelled separately from the measured transfer work.

This direct-call synthetic proof is not automatic tracking hydration, live
Traccar, installed `.deb`, original-field-machine or the preserved full 36-hour
reference profile. The browser flow covers the real runtime/client progress
decoration with controlled transport. Whole-candidate scale/soak/replay/export,
archive and field acceptance remain with DON-254 qualification. Follow-up B's
separate ~239 ms legacy-recovery defect remains open. Every historical 200 ms
rejection and release HOLD is retained; merge is not release acceptance.
