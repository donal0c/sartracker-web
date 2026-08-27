# Breadcrumb PR5 Mission Evidence And Replay Evidence

This record binds BCP-11, BCP-12a, BCP-12b and BCP-13 to one pull request.
It is pre-merge qualification evidence, not production, field, live-Traccar or
release proof. PR opened/review-ready is an intermediate state. The task is not
complete until the accepted four-review baseline and required rechecks are clean
on the current exact head; those external attestations are bound in the PR and
final coordinator handoff without changing the reviewed tree.

## Authority and requirement trace

| Authority | Locked meaning | Proving tests and surfaces |
| --- | --- | --- |
| `SAR-QA-004`, `SAR-QA-019` | Outside evidence can be GPX; undated GPX timestamps are never invented | `gpx-parser.test.ts`, `electron-mission-evidence-versioning.test.ts`, `gpx-import.spec.ts`, static-GPX replay limitation UI |
| `SAR-QA-007` | Retain exact fixes, named tracks, timestamps, elevation, audit history and saved timeline | mission-evidence versioning and replay-query integration tests; exact-byte/SHA GPX revisions and retained rejection tests |
| `SAR-QA-009` | Multi-outing missions include changing searchers, revisited areas and outside teams | nine-outing replay oracle, explicit area/outing/assignment browser selectors, repeated-pass E2E and visual tests |
| `SAR-QA-010`, `SAR-QA-014` | Outing identity is coordinator-controlled and mission-wide, not inferred from a calendar day | outing-linked GPX/search assignment persistence and replay tests |
| `SAR-QA-015` | Participant membership is explicit and may change later | two-clock participant/group replay tests using effective and recorded times |
| `SAR-QA-017` | Replay reconstructs data known at T, not historical screen state | `electron-mission-replay-query.test.ts`, runtime cancellation/stale-result tests, critical replay visual test |
| `SAR-QA-018` | Only coordinators declare full/partial/aborted; coverage is advisory | search-pass versioning tests plus coordinator-entry and repeated-pass Chromium/visual tests |
| `SAR-QA-020` | Finalized missions are read-only; history and revisions remain visible | finalized-fence transaction/race tests, retired-parent tests and replay revision tests; archive/custody remains PR6 |
| `SAR-QA-021` | Traccar `fixTime` is the sole breadcrumb evidence clock | replay query eligibility/limitation tests and 960k/2m qualification fixtures |

## Exact-head independent review and accepted-finding disposition

The initial review work inspected the accumulated PR range from exact base
`80309c995a18eeb190cce4310c9a46b0f46d5263`. A second four-review exact-head
wave on `044a73887eef791b18c30df0838b7f1bd021fc56` used the accepted broad,
persistence/completeness, concurrency/finalization and renderer/input-
containment charters. None returned clean. Every report was centrally
source-retraced. A later complete four-review wave on
`aaeaeb769b181f9fd9da1d07b2fa6ae9d4e81e19` also returned not clean and is
the source of the next seven dispositions below. Broad, persistence and
renderer rechecks on `afc4880ab104ea0cbe75a3f139575c6f3b8c52f2` then found
the remaining scalar, workplan and finalized-UI findings; the concurrency slot
was not spent on an already-invalid head. Broad review on
`7325e4736b954b9a622f0344d1aee9ed43d38723` then found the last fixed-form
nonzero decimal underflow path; persistence returned clean on that head, but
its affected scalar recheck is required again. Concurrency review on the same
head found that independent replay SELECTs and later page workers could observe
different WAL states. Fresh broad, persistence and concurrency reviews on
`f87d75873f11d12d249e3afbc482703b25f99ff4` then found a chunked-GPX
knowledge-time leak, a published-evidence receipt crash gap, a stale admin
unlock authorization race and an impossible Search Operations correction
instruction. That head was rejected. Persistence recheck on
`1b35786c5de35355724928354789d779a52d186c` then proved that restart
reconciliation could mistake a matching legacy baseline without exact bytes
for a completed re-import and clear the receipt's only retained source. That
head was also rejected. Broad and persistence reviews were clean on
`77be02aec37da6e0e032e3921d4bd333b7e20d3f`, but renderer/input-containment
review proved that browser validation accepted future replay times rejected by
packaged Electron and filtered historical GPX evidence using its current outing
instead of the outing assigned to the revision known at T. That head was
rejected too. Accepted findings and dispositions are:

- authentic v11 migration failed because a v12 index preceded the added GPX
  columns: reordered migration, added a true v11 fixture, and kept large index
  construction off synchronous migration/open;
- migrated GPX and unproved legacy positions could disappear without an
  explicit replay limitation: added static GPX baselines and machine-readable
  legacy-position limitations without inventing time;
- GPX hash identity trusted caller input and same-path/cross-content lineage
  could be bypassed: hash retained bytes in the backend and preserve immutable
  same-path revision lineage;
- retired search parents stayed writable: reject assignment/pass writes against
  retired areas or assignments at the backend fence;
- replay lacked the required recorded/effective two-clock semantics for
  lifecycle and participant/group membership: persist and fold both clocks;
- replay and GPX results could publish after a mission switch: mission-scoped
  generation tokens cancel and discard stale seeks, chunks and imports;
- GPX worker writes could race Finish/finalization: the writable fence now runs
  inside the same immediate transaction as every projection/version/audit write,
  with a controlled race regression;
- a large GPX transaction could block live-current writes: imports use durable
  per-file batches, staging state and 25-point short transactions with an
  explicit inter-slice writer turn; the 50,000-point contention regression
  keeps current writes below the 200 ms hard gate;
- import workers were not owned by shutdown and interrupted batches could be
  silent: the store aborts and joins workers before database close, and startup
  converts interrupted staging into retained failure provenance;
- partial file failures and invalid UTF-8 could be reported as total success or
  silently discarded: parsing is strict, each file settles durably, successful
  siblings remain explicit, and failures are surfaced;
- replay object/track IPC and queries were not bounded early enough: object and
  track pages are bounded in the worker, results have a 512 KiB message ceiling,
  and large summaries never cross the main-isolate boundary unbounded;
- track replay used a mission-wide sort: indexed per-device source pages are
  deterministically merged in the worker, with bounded cursors and restart
  equality;
- the renderer sliced evidence after paging: object and track Earlier/Later
  controls expose the returned exact pages without hidden truncation;
- Dublin local-time input could silently shift DST gaps/overlaps: the explicit
  parser rejects nonexistent and ambiguous wall times;
- the search-pass UI selected first records and invented zero-duration times:
  operators explicitly choose area, outing and assignment and enter real start
  and end times; links, revisions and declared times remain visible;
- browser-harness deduplication crossed mission identity and omitted production
  links/static evidence: dedupe is mission-scoped and the harness now exercises
  the same links, selectors, timing and static-GPX honesty contracts;
- the qualification heartbeat began after open and did not gate every recorded
  latency: it now starts before initial/restart open and fail-closes on open,
  event-loop, dispatch, live-current read and replay-seek budgets.
- an explicit GPX identity could rebind another import's canonical/alias path:
  canonical and alias collisions now reject atomically, with both direction
  regressions;
- a selected GPX could be killed before any durable receipt existed: one batch
  and every selected-file receipt are committed before worker launch, exact
  bytes/hash are retained before parsing, and actual child-process `SIGKILL`
  tests cover both pending/pre-read and retained/pre-publish recovery;
- recovered GPX failures disappeared after restart: bounded persisted issue
  pages now reach the runtime and GPX panel without absolute paths or bytes;
- future legacy lifecycle and membership baselines could look like known empty
  history: replay now emits explicit pre-baseline limitations;
- replay exposed neither device nor outing filters, and a nine-outing test
  reused production shaping: display-only filters are explicit and a separate
  mixed-evidence oracle now checks sampled two-clock states;
- assignments and passes accepted invented or cross-mission participant, clue
  and track links: every link is validated in the same mission transaction;
- file selection failed the whole GPX batch before durable per-file handling:
  readable siblings now import while missing/malformed siblings settle as
  explicit independent failures;
- Finish/Finalize could race an unsettled receipt, and worker-constructor
  failures could poison shutdown queues: lifecycle gates include batches,
  receipts and staging in one transaction, while every synchronous constructor
  failure settles worker ownership;
- offset-style late replay pages and page-local totals obscured whole state:
  opaque bidirectional keyset cursors, whole-state totals and an independently
  calculated near-tail ordinal now prove bounded late pages;
- unbounded GPX geometry, retained bytes and revision lists could cross IPC:
  the preload now exposes only bounded keyset pages and dedicated presentation
  updates; exact source bytes remain backend-only and display geometry is
  explicitly compacted;
- watched-directory enumeration could publish into a newly selected mission:
  the initiating mission identity and generation token are captured before the
  asynchronous directory read and stale results are discarded;
- exact whole-state replay totals still performed a cold full-position scan:
  new stores maintain a transactional three-clock daily read model keyed by
  `max(fixTime, received_at, provenance-known-at)`, with compact partial-day/device indexes and
  explicit legacy fallback limitations.
- replay could tear a page from its total inside one worker and could admit a
  newly queryable staged GPX, same-millisecond fix, promoted fixTime provenance
  or versioned object between later workers: every replay response now pins one
  WAL read transaction. Exact track cursors bind both the mission replay
  generation and the exact eligible-position count captured in that snapshot;
  object continuations must return the captured generation. GPX publication,
  retained fixTime-provenance promotion, versioned objects, lifecycle changes
  and participant/group evidence advance the generation in their owning
  transaction. Append-only accepted fixes are fenced by the snapshot count,
  without coupling replay to derived coverage work or unrelated missions. Stale
  chains fail closed with an explicit re-seek while a fresh historical seek
  still includes GPX by its original recorded knowledge time. A nullable
  `timestamp_provenance_recorded_at` distinguishes when retained fixTime
  authority was learned without overwriting the original receipt clock. The
  authentic-v11 path adds metadata only and explicitly retains its full-mission
  legacy scan fallback rather than rebuilding 960k/2m indexes during open;
- the first mission-scoped cursor fence scanned `MAX(rowid)` across every
  mission position and the replacement coverage sequence also changed for
  derived coverage work: track cursors now bind the exact eligible-position
  count already computed in their WAL snapshot. A reordered new-store partial
  provenance index makes missing-recorded evidence checks selective without
  adding any index build to authentic-v11 startup;
- finalization could snapshot a finished mission, admit an outing correction,
  and then seal the stale archive: a durable per-mission finalization fence is
  created with the request event before backup. Finished-mission bookkeeping,
  manual archives and evidence-loss acknowledgements recheck that fence and
  mission status at their owning transaction. The fence survives an archive-
  succeeded interruption for safe retry, clears after a pre-success archive
  failure, and is removed atomically only when finalization commits;
- a valid 67 MB GPX could retain one size-proportional Base64 value in an
  immediate transaction and stall a current write for 281.04 ms: exact source
  reads now use a fixed 8 MiB ceiling, fail the next byte durably before
  retention, and retain five-repeat exact-limit current-write regressions;
- concurrent identical imports could race the complete-only digest lookup and
  create two canonical identities: one owned queue now serializes GPX workers
  through exit, yielding one canonical import plus both path aliases;
- empty coordinates/elevation and permissive partial/calendar-invalid dates
  could become exact `0` values or invented times: both worker and browser
  parsers use one strict shared decimal/calendar validator and retain explicit
  rejections instead;
- raw GPX file and directory byte reads remained callable through preload:
  those channels and bridge methods are removed; Electron renderer imports are
  path-only and exact bytes remain behind the worker/store boundary;
- the first 100 persisted issues hid a continuation and current failures did
  not refresh the sanitized issue page: runtime state and operator UI now make
  truncation explicit and refresh that bounded page after each import;
- marker, drawing, GPX and mission-review copy described retirement as physical
  deletion: operator surfaces now say Retire and state that revisions/evidence
  remain in mission history;
- canonical programme policy and baton text still described five PRs and PR1:
  policy, branch exception, grouping, workplan and current baton now agree on
  six PRs with PR5 evidence/replay and PR6 archive lifecycle.
- exponent-form and fixed-form subnormal GPX decimals could underflow nonzero
  values into exact zero,
  while timezone offsets beyond XML Schema's `±14:00` boundary and year zero
  could become precise UTC evidence: shared parsing now accepts only the GPX
  decimal lexical form and calendar-valid explicit timestamps within the
  source schema boundary, with browser and production-worker regressions;
- the Search Operations entry form stayed enabled for finished/finalized
  missions until the backend rejected the write: retained assignments and
  passes remain visible, but the form is explicitly and permanently read-only;
  truthful copy says that new records require an active mission and does not
  claim that unlocking makes finished evidence writable;
- one canonical workplan row still placed BCP-17 after five PRs: the row now
  agrees with the six-PR programme sequence;
- chunked GPX revisions used their staging timestamp as `recorded_at`, so a
  fresh historical re-seek could include evidence published after T: revision,
  canonical-import, alias and audit publication clocks are now assigned in the
  final immediate transaction, with a real staged-import regression proving a
  T between stage and publish remains unchanged;
- GPX publication and retained-source receipt settlement were separate
  transactions, so a crash between them produced a false unpublished-evidence
  failure on restart: worker publication now settles the exact receipt and
  batch count in the same transaction. Startup closes fully accounted running
  batches and reconciles older unsettled receipts only against the active
  canonical import's current complete revision, exact hash and canonical or
  active alias path. Reconciliation additionally requires `complete`
  provenance, retained source bytes, and a fresh backend SHA-256 verification;
  legacy baselines, retired imports and superseded revisions remain explicit
  failures with the receipt bytes retained in failure provenance;
- admin unlock authorization could outlive another unlock and re-finalization,
  reopening a newer finalized snapshot: authorized and denied paths now bind
  the roster decision to the exact `mission_finalized` audit epoch and recheck
  it inside the committing transaction;
- the browser harness independently drifted from packaged replay: it now
  rejects invalid and future T, scopes GPX revisions to the selected mission,
  captures outing assignment on each GPX revision, and derives historical
  filters, available outings and static evidence from the eligible revision
  rather than current import state. Focused harness and Chromium regressions
  were observed red, then green.

The corresponding focused regression tests were observed red before the
production corrections and are retained in the unit, integration, forced-kill,
Chromium and critical-visual suites. The current exact-head independent verdicts
are recorded externally after the final four-review wave; opening the PR never
substitutes for that wave.

## Local deterministic, browser and packaged evidence

The latest local remediation tree passed:

- full unit: 288 files / 2,396 tests with eight workers; all timing-gate tests
  that exceeded thresholds in oversubscribed default-worker runs passed again
  in their focused 178-test set;
- backend: 51 passed / 1 ignored;
- Chromium: 163/163;
- visual Playwright: 58/58;
- independent visual gate: fresh uncached full review passed 69/69 with zero
  failures or reviewer errors at the original critical/high severities;
- TypeScript/Vite production build and bundle budgets, ESLint, changed CommonJS
  syntax checks and `git diff --check`;
- actual child-process `SIGKILL` at both the pending source-receipt boundary and
  retained-source/pre-publish boundary, followed by restart recovery to explicit
  failed receipts with bytes/hash present only where they had become durable.

Fresh local synthetic scale qualification used fixture generator v5 on Darwin
arm64/Node v22.22.3 with timezone `Europe/Dublin`:

| Preset | Fixture SHA-256 | Seek / restart | Import dispatch | Current read during import / replay | Event-loop max | Equality |
| --- | --- | --- | --- | --- | --- | --- |
| 960k normal envelope | `5b6529728a8c9d0c0ced4aa11cd5a7f366b98a0540d935f08cb005397e47abd6` | 64.96 / 48.97 ms | 2.62 ms | 0.55 / 0.99 ms | 66.55 ms | exact first page |
| 2m headroom | `4be522adf9742e12e558bcdd0c243e6afb99c660ffd8e666a8100575c224860c` | 62.27 / 53.94 ms | 1.47 ms | 1.85 / 0.95 ms | 53.24 ms | exact first page |

Both presets imported 50,000 GPX points while continuously writing current
positions. The exact `f2f5330b9f124dff4cacbe66aa9b06e408030d4b` 960k run
recorded 1,043 current writes (60.33 ms maximum, 2.11 ms p95) and an exact
914,001 near-tail page in 46.08 ms. The 2m headroom run recorded 1,124 writes
(44.87 ms maximum, 2.16 ms p95) and exact 1,850,001 near-tail paging in
80.09 ms. Both passed restart equality. The ordinary seek
stayed below one second and every measured main dispatch/current-read/open/event-
loop path stayed below the 200 ms hard block. The 2m row remains deliberate
headroom/renderer-rejection evidence, not a normal mission-size claim.

The unsigned macOS arm64 package built from the same exact head passed the CI
tracking-soak profile with 6/6 batches, 8,664/8,664 exact positions, zero
redundant telemetry slope, a 3.96 ms main-process maximum and four healthy
operator-interaction samples across restart. A separate forced-kill probe copied
the authentic 960k fixture, killed the process at `backup:started`, recovered
that exact interruption after restart, passed SQLite recovery and preserved the
support-bundle privacy exclusions. These are local packaged proofs, not signed,
Linux, production or field evidence.

Exact-head Linux workflow
[`33124584731`](https://github.com/donal0c/sartracker-web/actions/runs/33124584731)
passed on PR merge commit `e6cee4401a0b54a56c27a15d3830fcd04d14dc83`.
That merge commit has parents exact base `80309c995a18eeb190cce4310c9a46b0f46d5263`
and candidate `f2f5330b9f124dff4cacbe66aa9b06e408030d4b`, and its tree is byte-identical
to the candidate tree `8fc61d5577596d53ae5993f410855662832e600b`.
The Ubuntu x64 run passed 288 files / 2,396 tests, build/bundle budgets,
AppImage and `.deb` packaging, ELF x86-64 native SQLite inspection, Mesa
llvmpipe attestation, the 960k qualification (222.80 ms seek, 160.71 ms late
page, 219.97 ms restart seek, 79.77 ms maximum concurrent current write,
81.91 ms event-loop maximum, exact restart equality), and the packaged CI soak
(6/6 batches, 8,664/8,664 exact positions, 37.53 ms main maximum, zero
redundant telemetry slope, four healthy interactions). The AppImage opened a
non-black 0.484819-mean content frame and exited cleanly through its window
control. Artifact SHA-256 values are
`bda86fafd9d279af67a7c4d35aa40b2e233b9f243683005fe9838f53bca22a16`
(AppImage) and
`1569d844987dec05076d3ddfd51b32078f759d1d36272d3821f1a1902876cdad`
(`.deb`).

A derived 960,000-position authentic-v11 migration profile removed the PR5
provenance/generation/read-model structures before candidate open. Exact v12
open completed in 13.02 ms with a 13.32 ms maximum heartbeat gap, retained all
960,000 positions, added the nullable provenance column and generation table,
added the durable finalization-fence table, and deliberately left both large
replay indexes and the daily count table absent so the documented full-mission
legacy fallback remains explicit.

An earlier pushed remediation candidate was correctly rejected by Linux run
`33096222238`: its 50,000-point GPX/current-write contention regression measured
330.65 ms against the 200 ms hard block. The source retrace found that short
transactions alone did not prevent the GPX worker immediately reacquiring WAL
writer ownership. The worker now yields an explicit writer turn after staging
and every 25-point slice. The same focused regression was red locally at
355.27 ms before that yield, then passed five serial repetitions; the focused
GPX/current/shutdown set passed 24/24 and the full unit suite passed 2,331/2,331.
Replacement exact-head Linux qualification is required on the final pushed
head and is reported in the PR/final handoff.

## Proof limits

The clean four-review wave remains the task-completion gate. The final
documentation-only binding descendant must receive exact-diff/tree attestation;
it does not convert the package evidence into release or field proof.
PR6 and BCP-17 retain archive encryption/custody, restore-and-replay qualification,
broad multi-machine/live-server/archive qualification, release and field
acceptance. No merge or release is authorized here.
