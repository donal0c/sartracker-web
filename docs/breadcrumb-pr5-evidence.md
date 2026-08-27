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
the source of the final seven dispositions below. Accepted findings and
dispositions are:

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
  new stores maintain a transactional two-clock daily read model keyed by
  `max(fixTime, recorded_at)`, with compact partial-day/device indexes and
  explicit legacy fallback limitations.
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

The corresponding focused regression tests were observed red before the
production corrections and are retained in the unit, integration, forced-kill,
Chromium and critical-visual suites. The current exact-head independent verdicts
are recorded externally after the final four-review wave; opening the PR never
substitutes for that wave.

## Local deterministic, browser and packaged evidence

The latest local remediation tree passed:

- full unit: 287 files / 2,371 tests;
- backend: 51 passed / 1 ignored;
- Chromium: 162/162;
- visual Playwright: 58/58;
- independent visual gate: fresh uncached full review passed 68/68 with zero
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
| 960k normal envelope | `a3237ce4ca959a188fbfd3ffe80e9037d3c2b4230f70bee600ca65e08bf85099` | 61.42 / 51.94 ms | 2.22 ms | 0.52 / 1.00 ms | 60.13 ms | exact first page |
| 2m headroom | `46a6f9980c184a856832c0c596cbae18c13e963e13707d10ceedbfee0e527afe` | 73.25 / 67.91 ms | 6.07 ms | 13.60 / 1.00 ms | 47.44 ms | exact first page |

Both presets imported 50,000 GPX points while continuously writing current
positions. The 960k run recorded 1,102 current writes (57.53 ms maximum,
1.97 ms p95) and an exact 914,001 near-tail page in 47.76 ms. The 2m headroom
run recorded 1,122 writes (42.01 ms maximum, 2.08 ms p95) and exact 1,850,001
near-tail paging in 75.89 ms. Both passed restart equality. The ordinary seek
stayed below one second and every measured main dispatch/current-read/open/event-
loop path stayed below the 200 ms hard block. The 2m row remains deliberate
headroom/renderer-rejection evidence, not a normal mission-size claim.

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

Exact pushed-head macOS/Linux package/soak/960k evidence and the clean four-
review wave are completion gates reported externally against the immutable final head.
PR6 and BCP-17 retain archive encryption/custody, restore-and-replay qualification,
broad multi-machine/live-server/archive qualification, release and field
acceptance. No merge or release is authorized here.
