# Breadcrumb PR5 Mission Evidence And Replay Evidence

This record binds BCP-11, BCP-12a, BCP-12b and BCP-13 to one pull request.
It is pre-merge qualification evidence, not production, field, live-Traccar or
release proof. Exact final-head review results are bound in the final handoff
after the independent reviewers finish.

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

## Initial exact-head independent review and accepted-finding disposition

The four complementary reviewers inspected exact accumulated range
`80309c995a18eeb190cce4310c9a46b0f46d5263..e26c2c756997a057b4e151bf6ef58a8014c3328c`
from a clean worktree. None returned clean. Every report was centrally retraced;
the accepted findings and their dispositions are:

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
  per-file batches, staging state and 100-point short transactions; the 50,000
  point contention regression keeps current writes below the 200 ms hard gate;
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

The corresponding focused regression tests were observed red before the
production corrections and are retained in the unit, integration, Chromium and
critical-visual suites. The final independent recheck verdicts remain pending;
PR opened/review-ready is only an intermediate state.

## Local deterministic, browser and packaged evidence

The remediation candidate passed:

- full unit: 282 files / 2,331 tests;
- backend: 51 passed / 1 ignored;
- Chromium: 161/161;
- visual Playwright: 58/58;
- independent visual gate: 67 pass, one non-blocking high framing failure and
  zero critical failures; all three PR5 critical entries passed;
- TypeScript/Vite production build and bundle budgets, ESLint, changed CommonJS
  syntax checks and `git diff --check`;
- unsigned packaged macOS arm64 build;
- packaged macOS tracking/restart soak: 8,664/8,664 exact positions over two
  launches, integrity `ok`, zero redundant slope, four healthy operator samples,
  15.52 ms main-process maximum and zero renderer crashes;
- packaged macOS forced kill/restart against the 607,412,224-byte 960k fixture:
  kill occurred only after the backup-start marker was durable, restart retained
  the interrupted-operation marker, support-bundle privacy checks passed and the
  fail-closed verdict was PASS.

Fresh local synthetic scale qualification used fixture generator v5 on Darwin
arm64/Node v22.22.3 with timezone `Europe/Dublin`:

| Preset | Fixture SHA-256 | Seek / restart | Import dispatch | Current read during import / replay | Event-loop max | Equality |
| --- | --- | --- | --- | --- | --- | --- |
| 960k normal envelope | `3918e2c67ec1ec9d7fc9477b290572c78082cdca2b84ed5dbf83ce4daa99f1c7` | 242.38 / 234.64 ms | 2.08 ms | 0.59 / 1.22 ms | 11.63 ms | exact first page |
| 2m headroom | `f0fc079fa750d92c603cf92bff2e360fd32178a6111adc2251be1e609d803340` | 441.00 / 430.54 ms | 1.42 ms | 0.65 / 1.04 ms | 11.14 ms | exact first page |

Both presets passed their fail-closed gates. The 960k ordinary seek stayed
below one second and every measured main-isolate dispatch/current-read/open/event-
loop path stayed below the 200 ms hard block. The 2m row is headroom evidence.

## Proof limits

Exact pushed-head Linux package/soak/960k evidence and the clean four-review
recheck are still required before this record can support task completion. PR6
and BCP-17 retain archive encryption/custody, restore-and-replay qualification,
broad multi-machine/live-server/archive qualification, release and field
acceptance. No merge or release is authorized here.
