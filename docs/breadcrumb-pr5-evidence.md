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

## Earlier exact-head review history and accepted-finding disposition

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
rejected too. Broad and renderer reviews on
`d57084b95dd208f68690d367533238bbe42a734e` then found that the corrected
harness still replayed GPX evidence at and after its recorded retirement time,
unlike the packaged as-of predicate. That head was rejected too. Broad,
persistence/completeness and renderer/input-containment reviews were clean on
`dfde1d8f17eff3fdd9205634494255f3ce43395c`, but the concurrency/finalization
review reproduced a chunked replacement revision overwriting an operator
retirement that committed while the writer yielded between slices. That head
was rejected too. Persistence/completeness and renderer/input-containment then
returned clean on `dace08e2c2da5867cf463a0e262bcbf7ad6ee764`, but broad and
concurrency/finalization reviews rejected it: retirement could audit a stale
revision when publication won immediately before the retirement transaction,
and a declared search pass could sit outside its assignment outing. That head
was rejected too. Broad life-safety and persistence/completeness review then
returned clean on `355c495cb65e26a85e1adbf6d850fa500a9b286b`, while
concurrency/finalization and renderer/input-containment rejected that head.
Chromium rejected noncanonical `datetime-local` fractions ending in zero;
Search Operations accepted calendar-invalid or offset-free pass timestamps;
and its renderer-to-main write envelope was unbounded. Those findings were
reproduced against the real control/store path. The formatter now emits
Chromium-canonical fractions, pass instants require calendar-valid ISO 8601
date-times with explicit offsets in both Electron and the browser harness, and
IDs, link counts, short text, notes and large geometry/coverage fields are
bounded before sorting, SQLite work or version serialization. A 32 MiB note is
rejected inside the 200 ms current-position priority gate. That head was
rejected too; the replacement descendant requires the fresh broad review and
all three affected focused rechecks. Accepted findings and dispositions are:

Broad and concurrency/finalization rechecks on
`4761405b340eece7bebea9eb8ae37147962bc188` confirmed the formatter and race
corrections, with concurrency returning clean. Broad and renderer/input-
containment nevertheless rejected that head because the first bounds were not
a complete preflight contract: a huge fractional timestamp, legacy drawing
identity and UI-owned search-area geometry could still consume main-isolate
time; wrong-typed optional text could silently become absence; and advisory
coverage diverged in the browser harness. The repeated seam was source-retraced
as a boundary-design problem. One complete Electron/browser preflight now
normalizes every area, assignment, pass and retirement field before any lookup,
sort, state copy, transaction, projection or version serialization. It rejects
oversized raw text before trimming or `Date.parse`, validates bounded JSON,
retains advisory coverage consistently, and mirrors operator `maxLength`
guards. The 64 MiB geometry and 32 MiB timestamp/legacy-ID reproductions are
durable sub-200 ms rejection gates. This head was rejected too.

An earlier four-review wave inspected exact head
`72b095089ee028a1a6e9ca7571d967adf46e44d4`, tree
`c549fb0092f6501ebe2791b2fd4dd84e9381f213`, from the exact PR4 base. All four
reviewers returned **CLEAN** with no actionable P1/P2 finding on that head. The
later pasted-review invalidation documented below superseded this as completion
evidence:

| Independent reviewer | Risk charter | Exact recheck evidence |
| --- | --- | --- |
| Banach, `/root/pr5_final_broad_dace` | Broad life-safety/end-to-end | 115/115 focused unit, 23/23 browser, direct 64 MiB geometry and 32 MiB legacy-ID attacks, malformed optional-text attack, syntax and diff checks |
| Anscombe, `/root/pr5_final_persistence` | Persistence/completeness | 154/154 focused tests; zero projection/link/audit/version writes for rejected envelopes; GPX lineage, receipts, restart, migration, replay and finalization invariants retained |
| Maxwell, `/root/pr5_final_concurrency_exact` | Concurrency/finalization | 209/209 core plus 157/157 adjacent tests, 27/27 time/harness tests, six focused race/priority selections, 22/22 drawing/layer Chromium and isolated 5/5 Search Operations; both GPX race directions independently reproduced clean |
| Hypatia, `/root/pr5_final_renderer` | Renderer/input containment | 232/232 focused tests, 1/1 Search Operations, 1/1 drawing, 1/1 layer, 3/3 replay/as-of Chromium, 2/2 targeted visual; all four earlier large/malformed bypasses rejected before mutation |

Those reviewers independently reconfirmed the then-known finding dispositions:
raw-length-first preflight covers every Search Operations entry point before
lookup or state/database work; malformed optional values fail rather than
silently clearing evidence; Electron and browser advisory data agree; current
positions stay responsive after rejected 32/64 MiB inputs; both GPX
publication/retirement interleavings retain the transaction-current revision
and explicit failure evidence; pass/assignment/outing and finalized-mission
fences remain fail-closed. Two larger browser invocations experienced discarded
local web-server contention while overlapping other Playwright processes; the
affected flows were rerun alone and passed. No code or product finding remained.

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
- Search Operations accepted ambiguous timestamps and unbounded renderer
  payloads: require explicit-offset calendar-valid instants and validate the
  complete bounded envelope before persistence work, with Electron/browser/UI
  parity and a 32 MiB fast-rejection regression;
- fixed-width millisecond formatting produced values Chromium rejects when the
  fraction ended in zero: emit the canonical shortest fractional component and
  repeat the operator workflow across timing variations;
- field-by-field bounds left alternate Search Operations paths permissive:
  replace them with one complete preflight contract for area drawings, stable
  areas, assignments, passes, retirement and list scope in Electron and the
  browser harness, including strict optional types, bounded timestamps/IDs,
  validated geometry/metadata/advisory JSON and UI limits;
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
  rather than current import state. It also applies the production retirement
  boundary: evidence remains eligible before `retired_at` and is excluded at or
  after that instant. Focused harness and operator-level Chromium regressions
  were observed red, then green.
- chunked GPX publication trusted the projection snapshot captured before its
  short writer slices, so an operator retirement during those slices could be
  silently reset to active: the final immediate transaction now revalidates
  mission identity, import state, revision, retirement and current projection
  before publication. A losing staged revision is removed with its points,
  retained source bytes/hash become one explicit durable import failure, the
  worker catch is idempotent, and the retirement plus earlier complete revision
  remain authoritative. The controlled exact-head race was observed red, then
  green, including zero `gpx_import_updated` audit events after retirement.
- GPX retirement read the current revision before acquiring its immediate
  transaction, so a publication that won that gap could leave revision 2
  retired while the deletion audit named revision 1: retirement now reads,
  decides, mutates and audits the transaction-current revision together. The
  complementary publication-wins interleaving was observed red, then green.
- Search-pass entry accepted times before the mission/outing and after the
  outing or wall clock: backend and browser validation now require the declared
  interval to fit its assignment outing, require an explicit end for a completed
  outing, prevent ending or shrinking an outing around retained passes, and
  prevent moving an assignment scope after a pass exists. The broad review's
  direct reproduction and the controlled interval matrix were red, then green.

The corresponding focused regression tests were observed red before the
production corrections and are retained in the unit, integration, forced-kill,
Chromium and critical-visual suites. The clean exact-head independent verdicts
are bound above; opening the PR did not substitute for that wave.

## Local deterministic, browser and packaged evidence

The latest local remediation tree passed:

- full unit: 288 files / 2,403 tests with eight workers; all timing-gate tests
  that exceeded thresholds in oversubscribed default-worker runs passed again
  in their focused 178-test set;
- Search Operations remediation: focused Electron/browser/time tests 70/70,
  including strict calendar/offset rejection and a 32 MiB note refused before
  persistence inside 200 ms; the full operator flow passed 10/10 sequential
  Chromium repetitions across fractional-second variations;
- backend: 51 passed / 1 ignored;
- Chromium: 164/164;
- visual Playwright: 58/58;
- independent visual gate: fresh uncached full review passed 69/69 with zero
  failures or reviewer errors at the original critical/high severities; report
  `visual-review-2026-08-28T01-38-13Z.json`;
- TypeScript/Vite production build and bundle budgets, ESLint, changed CommonJS
  syntax checks and `git diff --check`;
- actual child-process `SIGKILL` at both the pending source-receipt boundary and
  retained-source/pre-publish boundary, followed by restart recovery to explicit
  failed receipts with bytes/hash present only where they had become durable.

The first post-preflight full Chromium run correctly rejected one historical
layer-panel fixture that represented a search-area polygon as `{}`. The fixture
was corrected to valid Polygon JSON, its full layer suite passed 8/8, and the
complete Chromium suite was then rerun from the start and passed 164/164.

Fresh local synthetic scale qualification used fixture generator v5 on Darwin
arm64/Node v22.22.3 with timezone `Europe/Dublin`:

| Preset | Fixture SHA-256 | Seek / restart | Import dispatch | Current read during import / replay | Event-loop max | Equality |
| --- | --- | --- | --- | --- | --- | --- |
| 960k normal envelope | `5b6529728a8c9d0c0ced4aa11cd5a7f366b98a0540d935f08cb005397e47abd6` | 69.78 / 52.81 ms | 2.28 ms | 0.52 / 1.22 ms | 71.25 ms | exact first page |
| 2m headroom | `4be522adf9742e12e558bcdd0c243e6afb99c660ffd8e666a8100575c224860c` | 60.84 / 51.47 ms | 1.59 ms | 3.18 / 0.89 ms | 71.15 ms | exact first page |

Both replacement-tree presets imported 50,000 GPX points while continuously
writing current positions. The 960k run recorded 1,054 current writes (64.10
ms maximum, 2.94 ms p95) and an exact 914,001 near-tail page in 50.40 ms. The
2m headroom run recorded 1,000 writes (71.09 ms maximum, 4.06 ms p95) and exact
1,850,001 near-tail paging in 47.19 ms. Both passed restart equality. The ordinary seek
stayed below one second and every measured main dispatch/current-read/open/event-
loop path stayed below the 200 ms hard block. The 2m row remains deliberate
headroom/renderer-rejection evidence, not a normal mission-size claim.

The unsigned macOS arm64 package built from the replacement code tree passed the CI
tracking-soak profile with 6/6 batches, 8,664/8,664 exact positions, zero
redundant telemetry slope, a 2.40 ms main-process maximum and four healthy
operator-interaction samples across restart. A separate forced-kill probe copied
the authentic 960k fixture, killed the process at `backup:started`, recovered
that exact interruption after restart, passed SQLite recovery and preserved the
support-bundle privacy exclusions. These are local packaged proofs, not signed,
Linux, production or field evidence.

The earlier exact-head Linux workflow
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

That Linux run remains valid evidence for the earlier byte tree but does not
qualify the replacement GPX publication fence.

Fresh exact-head Linux workflow
[`33133524836`](https://github.com/donal0c/sartracker-web/actions/runs/33133524836)
then passed in 12m56s. GitHub checked out PR merge commit
`f474221ee06b8a39699417c5cd6c11f0215e5a5b`, whose parents are exact base
`80309c995a18eeb190cce4310c9a46b0f46d5263` and reviewed code head
`72b095089ee028a1a6e9ca7571d967adf46e44d4`; its tree is byte-identical to the
reviewed tree `c549fb0092f6501ebe2791b2fd4dd84e9381f213`. Ubuntu x64 passed lint,
288 files / 2,403 tests, production build and bundle budgets, AppImage/`.deb`
packaging, x86-64 native SQLite inspection and Mesa llvmpipe attestation.

The 765,710,336-byte / 960,000-position normal fixture
`5b6529728a8c9d0c0ced4aa11cd5a7f366b98a0540d935f08cb005397e47abd6`
passed with 50,000-point GPX import dispatch 4.70 ms, 1,165 concurrent current
writes with 80.18 ms maximum and 2.38 ms p95, replay dispatch 0.23 ms, seek
227.03 ms, 914,001-offset late page 156.78 ms, live reads 1.67/1.94 ms,
event-loop maximum 90.12 ms and restart seek 213.32 ms with exact first-page
equality. The packaged soak passed 6/6 batches, 8,664/8,664 exact positions,
one restart, four healthy operator samples, 30.98 ms main-process maximum,
zero renderer crashes, integrity `ok` and zero redundant telemetry slope. The
AppImage opened a non-black 0.484819-mean content frame and closed gracefully.
Artifact SHA-256 values are
`d2b0bc3e1e3269247716f42ef3144e4362f0ec3fddf550c984cbc42014bb1b80`
(AppImage) and
`70422504a7ee5dd9c709f6f1aef5ae6bd7a4e6afc8fc2200238186b46067d51e`
(`.deb`). This is packaged runner qualification, not release or field proof.

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
The replacement exact-tree Linux qualification is the successful run above.

## 2026-08-28 pasted-review invalidation and remediation

A later five-review deep-review packet invalidated the preceding completion
candidate. Central source retrace accepted the concrete mechanisms rather than
the packet's verdicts wholesale: destructive legacy-GPX baseline compaction,
same-hash projection/revision divergence, post-T device-filter leakage,
unbounded GPX-worker shutdown join, migrated `MultiPolygon` retirement failure,
superseded page errors replacing newer results, Dublin overlap ambiguity,
cross-mission GPX identity movement, unsanitized replay-bound errors, browser
cursor/capability divergence and operator-state wording that conflated
unavailable, filtered-empty and truly empty evidence. The proposed bitemporal
object re-ranking was rejected because it contradicted the locked
data-known-at-T contract and existing oracle. The authentic-v11 replay scan is
retained by the ADR, now identified explicitly as
`legacy_replay_scan_fallback`; it is a qualification boundary, not an indexed
performance claim.

The replacement preserves original legacy geometry unchanged in the immutable
revision, keeps the bounded display projection separate, retains explicit
rejection evidence for malformed or over-budget legacy geometry, and avoids
unbounded point expansion during startup. Exact-hash retries are strict:
evidence-bearing divergence is rejected and presentation changes use the
dedicated presentation operation. Device filters are time-fenced, Dublin's
repeated hour exposes its exact IST/GMT occurrence, page ownership is
latest-wins with cancellation and stale-error fencing, and the browser harness
uses the production opaque v3 cursor envelope and request bounds. GPX identity
is mission-fenced in Electron, the harness and the historical Tauri adapter;
Mission Replay itself refuses non-Electron operational execution. Search-area
retirement has a dedicated mutation that preserves retained legacy geometry.
Shutdown now has a distinct physical-worker join deadline and fails visibly
without closing the database or recording a clean exit while the worker remains
live.

Red-green regressions cover each accepted seam, including >128 KiB and malformed
legacy geometry, exact-hash mutation, post-T filters, Dublin overlap selection,
stale page failure/cancellation, cross-mission GPX IDs, explicit query bounds,
migrated `MultiPolygon` retirement, bounded shutdown failure/retry and renderer
same-path revision replacement. Full local proof on the uncommitted replacement
tree is 289 files / 2,416 unit tests, backend 52 passed / 1 intentional real-
keychain ignore, lint/build/bundle budgets, Chromium 164/164, visual Playwright
58/58, and uncached independent visual review 69/69
(`visual-review-2026-08-28T06-40-08Z.json`).

Fresh indexed 960k qualification generated
`tmp/breadcrumb-pr5-evidence/bcp-960k.json`: seek 62.28 ms, late page 49.96 ms,
maximum concurrent current write 39.74 ms (p95 4.18 ms), event-loop maximum
47.84 ms and restart seek 55.91 ms with exact equality. A separate authentic-
v11 960k fallback retained all 960,001 positions without replay indexes or
daily counts: 13.43 ms open, 601.72 ms first seek, 3.59 ms concurrent current
write and 584.00 ms restart seek, with the fallback limitation visible. It
passed the retained contract but does not establish indexed replay performance
for upgraded stores.

Replacement code and documentation were committed as
`9850af14bf8d612e1791be6b0642906247a921e1` (tree
`25cb059a4d78e29735ba2d34ba4717fbeb095feb`). Committed-tree package/Linux
evidence and all four clean independent
exact-head reviews remain required before this remediation can be called task
complete. PR opened/review-ready remains an intermediate state.

The unsigned macOS arm64 Electron package built from committed head
`e888e6ee02fc57673d0cedb1aa536d408160a717`. Its packaged CI tracking soak
passed 6/6 batches, 8,664/8,664 exact positions, one restart checkpoint, four
healthy operator interactions, 9.74 ms maximum main-process responsiveness,
zero renderer crashes and zero redundant telemetry slope. The report is
`tmp/beta-artifacts/tracking-soak-ci/electron-tracking-soak-report.json`. This is
local unsigned packaged proof, not Linux, signed, release or field evidence.

Exact-head Linux workflow
[`33149715590`](https://github.com/donal0c/sartracker-web/actions/runs/33149715590)
passed in 12m29s. GitHub checked out merge commit
`aaa29a68382c4c048f39a3e05be7815785b12a1b`, whose parents are exact base
`80309c995a18eeb190cce4310c9a46b0f46d5263` and pushed replacement head
`03a6ece3660599e3bc089c875245ca50a0ddfa0c`; its tree
`b2154e62c36b3c5656d4aee88612f34bfcf748ac` is byte-identical to the pushed
head tree. Ubuntu x64 passed lint, the complete serial 2,416-test unit gate,
production build and bundle budgets, AppImage/`.deb` packaging, x86-64 native
SQLite inspection and Mesa llvmpipe attestation.

The 765,710,336-byte / 960,000-position fixture passed with 50,000-point GPX
import dispatch 4.48 ms, 1,177 concurrent current writes with 80.27 ms maximum
and 2.51 ms p95, replay dispatch 0.30 ms, seek 234.30 ms, exact 914,001-offset
late page 164.64 ms, live reads 1.64/1.87 ms, event-loop maximum 81.45 ms and
restart seek 229.37 ms with exact first-page equality. The packaged soak passed
6/6 batches, 8,664/8,664 exact positions, one restart, four healthy operator
samples, 21.80 ms main-process maximum, zero renderer crashes, integrity `ok`
and zero redundant telemetry slope. The AppImage opened a non-black
0.484819-mean content frame and closed gracefully. SHA-256 values are
`3d973adf782ff9ddab805656f13a0666ff4597e00056a03ae7a260c57155c4d9`
(AppImage) and
`c09f71dffdc903813530f0738724d4253b9c6b8b846c53b658f875b0750e04d5`
(`.deb`). This is packaged runner qualification, not release or field proof.

## Exact-head review invalidation after Linux qualification

Exact head `96c2047b18f0dd44a659fb5086e81911d341838b`, tree
`1e389b995624a7decd3d1694d477078b7dbd4219`, was reviewed independently and
rejected despite the preceding local, visual and Linux proof. Banach's broad
life-safety review found three accepted findings: legacy migration omitted
invalid/out-of-range/structural coordinates without per-item rejections and
hid zero-point rejected artifacts; chunked same-hash retries compared empty
arrays and could mutate a late parsed point or rejection silently; and the
25-row page loop still drained every legacy import synchronously at startup.
Maxwell's concurrency/finalization review reproduced Tauri GPX identity and
finished-mission checks outside the owning write transaction. Hypatia's
renderer/input-containment review reproduced browser Replay returning the
current page again for `Earlier exact page` and found its limits had drifted
from Electron. The persistence/completeness slot was deliberately not spent on
an already-invalid head.

The replacement uses one bounded legacy validation pass. It retains the
original artifact in the immutable revision, writes every safe exact point,
builds the display projection only from safe segments, and records bounded
point/segment rejections for invalid coordinates, elevation, structure,
insufficient geometry, malformed input and over-budget input. Zero-point
rejected artifacts remain visible in static evidence. Launch migrates at most
three bounded imports, then resumes one atomic import per background turn;
pending count remains explicit and mission lifecycle changes fail closed.
Close/reopen resumes from the durable missing-revision predicate without
rewriting a completed baseline.

Same-hash and same-content-alias paths now compare the complete canonical
point and rejection sets even when the input arrays are empty or exceed the
chunk size. Tauri acquires `BEGIN IMMEDIATE` before checking mission status,
explicit identity or source-path ownership, and keeps the projection plus
audit event inside that transaction. Browser validation now shares Electron's
1,000-row limit and 10,000,000 cursor bound, preserves cursor direction/key,
and computes the page before a `before` cursor rather than replaying its current
offset. Red-green coverage includes a changed 30th chunked point/rejection,
invalid legacy geometry and zero-point visibility, bounded crash-resumable
multi-import migration, deterministic two-connection identity and finish-wins
races, Electron after/before cursor envelopes, boundary vectors, and a 502-fix
operator flow that proves Later then Earlier restores rows 1-500.

Fresh replacement-tree proof is green: 289 unit files / 2,420 tests; backend
54 passed / 1 intentional real-keychain ignore; lint; TypeScript/Vite build and
bundle budgets; Chromium 165/165; visual Playwright 58/58; and a fresh uncached
independent visual review 69/69 with report
`visual-review-2026-08-28T07-48-03Z.json`. The indexed 960k qualification passed
with 65.32 ms seek, 52.58 ms late page, 60.38 ms maximum current write, 65.49
ms event-loop maximum and 58.44 ms restart seek with exact equality. The
authentic-v11 960k fallback passed with 12.86 ms open, 616.49 ms seek, 3.50 ms
current write and 594.03 ms restart seek, retaining the explicit fallback
limitation and no large startup indexes. These results still invalidate the
prior package/Linux and clean-review claims for completion: fresh committed-
head packaged/Linux proof and the accepted four independent exact-head reviews
remain mandatory on the replacement code-and-documentation head.

The unsigned macOS arm64 package was rebuilt with build identity
`sha.2f55813fc61a`. Its packaged CI tracking soak passed 6/6 batches and exact
8,664/8,664 retained positions, one restart checkpoint, four healthy operator
interactions, 29.66 ms maximum main-process responsiveness, zero renderer
crashes, SQLite integrity and zero redundant telemetry slope. This is local
unsigned package evidence only; exact pushed-head Linux proof remains required.

Exact head `299c0b722ff3925f160133bfcb31cab8af0f0048`, tree
`2021ebf3584db8035ba3bed44a1b7f772581a47e`, was also rejected during the
allocated concurrency/finalization review. The completed-call Tauri races were
fixed, but the raw `BEGIN IMMEDIATE` transaction was not owned by SQLx. Task
cancellation after the projection and audit writes could return the only pooled
connection with the transaction still open: later reads on that connection saw
the uncommitted evidence even though the caller received failure, and a later
restart rolled it back. The candidate Linux workflow was cancelled because the
head was already invalid.

The regression test pauses deterministically after both writes and before
commit, aborts the upsert task, then requires zero GPX projection rows, zero GPX
audit rows and a fresh immediate transaction on the reused pool connection. It
failed red with the projection count equal to one. The implementation now uses
SQLx 0.8 `begin_with("BEGIN IMMEDIATE")` and executes mission, identity, path,
projection, audit and readback operations through the owned transaction, whose
drop path rolls back cancellation and commit-error exits. The regression is
green; the full backend passed 55/55 executable tests with one intentional
real-keychain ignore, and the six focused GPX tests passed 30/30 across five
repetitions. Fresh exact-head reviews, package/Linux proof and documentation
binding remain required.

The same rejected head also received its allocated persistence/completeness
review. It found two accepted P2s. First, the launch slice still selected and
copied complete legacy GPX text on the Electron main thread: a 64 MiB artifact
took 427.61 ms to open, an isolated SQL copy took 183.66 ms, and a deferred
32 MiB fourth artifact caused a 161.49 ms event-loop gap. Revisionless rows
also remained renderer-visible. Second, direct archive creation omitted the
unsettled-GPX fence and accepted a finished store with 197 pending legacy
backfills; the validated archive still contained 196 imports without immutable
revisions.

Both persistence findings are red-green. Launch now selects only SQLite-side
byte lengths and a bounded identity preview, performs zero normal legacy
parsing or copying, and uses an `EXISTS` probe rather than a full pending count.
Background work remains one bounded row per event-loop turn. A row whose
geometry, source bytes, metadata or identity exceeds the declared envelope is
left byte-for-byte in its original table and receives a durable quarantine
record; it is excluded from map and Replay projections, appears in the
sanitized GPX issue surface, exposes the explicit
`legacy_gpx_backfill_quarantined` limitation, cannot be replaced, reassigned or
retired, and blocks Finish, Finalize and direct archive custody until a bounded
repair exists. Direct archive creation now applies the same complete unsettled-
GPX fence as lifecycle transitions.

Fresh replacement-tree proof is 289 unit files / 2,422 tests in the serial
gate, backend 55 executable tests with one intentional real-keychain ignore,
lint, build and bundle budgets, Chromium 165/165, visual Playwright 58/58, and
uncached independent visual review 69/69 with report
`visual-review-2026-08-28T08-35-11Z.json`. The indexed 960k qualification used
fixture digest `e96f822b1e48adbf85b9428def57f2ce547e1490ae7f123899ad57e24aaf45f1`:
64.69 ms seek, 60.41 ms late page, 91.79 ms maximum concurrent current write,
92.02 ms event-loop maximum and 79.60 ms restart seek with exact equality. The
authentic-v11 960k fallback retained all 960,001 positions without replay
indexes: 5.73 ms open, 672.89 ms seek, 3.73 ms concurrent current write and
642.67 ms restart seek, with the fallback limitation explicit. These are local
uncommitted-tree results; committed package/Linux proof and clean exact-head
reviews remain mandatory.

Exact pushed head `6642e383b15e41ef3182a4d3fbac7e7345c9a8ad`, tree
`cad281c96d74b3d7a3fdfd1c44ef02e5189c5c53`, was rejected by its allocated
persistence/completeness and concurrency/finalization reviews despite a clean
broad review and green package proof. Persistence reproduced a residual full-
table settled-row scan: reopen grew from 1.79 ms at 1,000 imports to 53.09 ms at
100,000 and 291.82 ms at 500,000, while each background turn rescanned an
increasing settled prefix. Concurrency then reproduced a pre-classification
overwrite: after three bounded legacy rows, an oversized fourth row could be
reimported by the same ID/path before its timer turn, replacing 262,201 original
bytes with a 43-byte projection and retaining only the replacement revision.

The replacement is red-green. `legacy_gpx_backfill_state` durably records a
rowid scan target and cursor. Launch examines at most three bounded metadata
rows; background turns use an indexed rowid seek to skip at most 1,000 already-
settled rows while reconstructing or quarantining at most one artifact. Replay
and lifecycle fences read the checkpoint rather than a correlated full-table
absence scan. The 500,000-settled-row regression failed red at 361.78 ms and now
opens below the 200 ms hard gate. A separate pre-timer regression failed red by
successfully overwriting the target as revision sequence 2; it now rejects
same-ID and same-path replacement, presentation edits, outing assignment and
retirement while preserving exact byte length/prefix and zero invented
revisions. Content-hash alias lookup requires an immutable revision, so an
unresolved legacy row cannot become an alias target. Focused persistence,
Replay, renderer and deterministic-fixture verification is 84/84.

Fresh replacement-tree proof is green: 289 unit files / 2,424 tests in the
serial gate, backend 55 executable tests with one intentional real-keychain
ignore, lint, build and bundle budgets, Chromium 165/165, visual Playwright
58/58, and uncached independent visual review 69/69 with report
`visual-review-2026-08-28T09-06-57Z.json`. Indexed 960k qualification used the
765,718,528-byte fixture digest
`d13f452517e83af3a76f7d44284fbdbab795e2e07aab4bc3d5af291a41e750b0`:
69.32 ms seek, 52.81 ms late page, 39.49 ms maximum concurrent current write,
39.60 ms event-loop maximum and 53.98 ms restart seek with exact equality. The
authentic-v11 960k fallback retained all 960,001 positions without replay
indexes: 6.27 ms open, 755.43 ms seek, 4.61 ms concurrent current write and
651.55 ms restart seek, with the fallback limitation explicit. Committed
package/Linux proof and all four clean independent exact-head reviews remain
mandatory.

Exact pushed binding head `74d0335e1d8549eb4ed7c4fdad5c7247513e3ff3`,
tree `700518d6d43f3921c523246c402f6ecc7b9b4b0c`, was rejected by its
persistence/completeness, broad life-safety and concurrency/finalization
reviews. Persistence measured a 1,052.48 ms main-thread heartbeat gap because
one background turn autocommitted a cursor write for each of up to 1,000
settled rows; the new deterministic 500,000-row regression failed red at
1,049.55 ms. Broad proved a revisionless row at rowid -1 could be skipped into
false-complete Finish/archive custody and rowid 9007199254740993 rounded through
JavaScript `Number` into permanent generic pending. Concurrency independently
measured a fully revisioned 20,000-row inventory falsely fencing Finish for
1,728.743 ms.

The replacement keeps signed-int64 inventory boundaries entirely in SQLite. A
separate durable low/high cursor scans rowids outside the declared safe
JavaScript range 1..2^53-1 and records explicit retained quarantine evidence;
those values never cross the JavaScript integer boundary. Safe-key background
turns examine one cheap 10,000-row page, locate only unresolved entries inside
that page, reconstruct at most one artifact and persist one contiguous cursor
advance. Exact SQL-literal regressions cover -1, 0, 2^53-1, 2^53 and 2^53+1;
every row gains an immutable revision or explicit quarantine, Finish/archive
remain fail-closed, and no value becomes false-complete or permanently generic
pending. The 500,000-settled-row regression now requires cursor equality and a
successful Finish within 1.2 seconds while retaining the 200 ms heartbeat gate.

Fresh replacement-tree proof is green: 289 unit files / 2,425 tests in the
serial gate, backend 55 executable tests with one intentional real-keychain
ignore, syntax, lint, production build and bundle budgets, Chromium 165/165,
visual Playwright 58/58, and uncached independent visual review 69/69 with
report `visual-review-2026-08-28T09-39-22Z.json`. Indexed 960k qualification
used the 765,726,720-byte fixture digest
`bb4d23fbf3d63ab60e64b547cd5f0567bb612be8ff055fbdb6326be00f899166`:
84.15 ms seek, 69.60 ms late page, 64.68 ms maximum concurrent current write,
68.82 ms event-loop maximum and 57.69 ms restart seek with exact equality. The
authentic-v11 960k fallback retained all 960,001 positions without replay
indexes: 6.29 ms open, 738.03 ms seek, 3.78 ms concurrent current write and
624.51 ms restart seek, with the fallback limitation explicit. Committed
package/Linux proof and all four clean independent exact-head reviews remain
mandatory.

## `1e9b6acc` rejection and replacement containment proof

Pushed binding head `1e9b6accf8c8c4aef48a9cd3be0eb3209bd4d067` is rejected.
Linux run `33160578384` failed the deterministic 500,000-settled-row gate at
300.63 ms startup. Source retrace found repeated full-table extrema aggregates
in schema-v12 migration initialization. The replacement uses indexed signed
rowid seeks for the safe maximum and both unsafe envelopes; the 500,000-row
startup/cursor/heartbeat regression and exact -1, 0, 2^53-1, 2^53 and 2^53+1
quarantine vectors are green.

The renderer/input-containment review also rejected `1e9b6acc`. Replay accepted
arbitrary timezones and parsed or cloned oversized time fields. GPX store and
filesystem IPC allowed oversized identities, actors, paths or selection
results to reach database/filesystem work, while the retained-issue page had a
row limit but no complete scalar/byte boundary. Red-first replacement coverage
now requires a plain request envelope, a raw selected-time maximum of 64
characters before strict calendar validation, the sole `Europe/Dublin`
timezone contract, GPX mission/import identities of at most 1,000 characters,
outing identities of at most 200, assignment actors of at most 120, and at most
100 paths of at most 4,096 raw characters. File-dialog admission is atomic and
folder enumeration stops explicitly on the 101st GPX file. Main IPC, runner and
worker validate independently.

Persisted GPX issue queries now preflight their mission/cursor inputs, select
only bounded scalars, carry signed rowids as exact decimal strings, pack the
response below the renderer byte budget and expose every shortened field in
`projection_warnings`. The operator panel states that safe-display shortening
occurred and that the persisted record remains authoritative; no exact retained
source bytes or absolute paths cross the renderer boundary.

Fresh replacement-tree verification is green:

- serialized unit: 289 files / 2,438 tests;
- Rust backend: 55 passed / one intentional real-keychain ignore;
- Node syntax, ESLint, TypeScript production build and bundle budgets;
- Chromium operator flows: 165/165;
- visual Playwright: 58/58 with 69 registered screenshots;
- uncached independent visual review: 69/69, report
  `visual-review-2026-08-28T15-24-05Z.json`;
- indexed 960k fixture digest
  `bb4d23fbf3d63ab60e64b547cd5f0567bb612be8ff055fbdb6326be00f899166`:
  60.77 ms seek, 46.33 ms late page, 45.58 ms maximum current write,
  48.15 ms event-loop maximum and 51.34 ms exact restart seek;
- authentic-v11 960k fallback: 5.59 ms open, 610.87 ms seek, 3.86 ms
  concurrent current write and 577.44 ms restart seek, with
  `legacy_replay_scan_fallback` explicit.

The replacement is committed as executable code `4c2d9d405338` with bound
candidate `428ded12424a`. Unsigned macOS arm64 packaging passed. The packaged
CI-profile soak passed 6/6 batches, 8,664/8,664 exact positions, one restart,
four healthy operator interactions, SQLite integrity `ok`, 10.53 ms maximum
main-process round trip, zero crashes and zero redundant-event slope. This is
local packaged proof, not Linux, release or field proof. Push/Linux proof and
all four clean independent exact-head reviews remain mandatory before task
completion.

## `011a8051` Linux liveness rejection and replacement

Pushed proof-document head `011a80517e20a656665909e1f4c1bd1b705d9ba9` is
rejected. Exact-head Linux run `33185543280` confirmed that indexed migration
startup was below 200 ms, but the deterministic 500,000-settled-row check
advanced the durable cursor only to `450003` rather than `500000` within the
unchanged 1.2-second liveness deadline. This was a background progression
failure, not permission to weaken the startup, heartbeat or current-position
priority gates.

Executable fix `123116e49d70` with bound candidate `2a2c5ba4bd6b` retains the
10,000-candidate work cap for every migration turn and the sub-200 ms startup
and heartbeat requirements. It changes only the cooperative inter-turn yield
from 10 ms to 5 ms. The red Linux regression and the complete 54-test evidence-
versioning file are green locally.

Fresh candidate-tree verification is green:

- serialized unit: 289 files / 2,438 tests;
- Rust backend: 55 passed / one intentional real-keychain ignore;
- ESLint, TypeScript production build and bundle budgets;
- Chromium operator flows: 165/165;
- visual Playwright: 58/58 with 69 registered screenshots;
- uncached independent visual review: 69/69, report
  `visual-review-2026-08-28T15-55-22Z.json`;
- indexed 960k fixture digest
  `bb4d23fbf3d63ab60e64b547cd5f0567bb612be8ff055fbdb6326be00f899166`:
  65.54 ms seek, 50.10 ms late page, 51.44 ms maximum current write,
  61.09 ms event-loop maximum and 53.93 ms restart seek with exact equality;
- authentic-v11 960k fallback: 5.53 ms open, 604.17 ms seek, 3.35 ms
  concurrent current write and 589.61 ms restart seek, with
  `legacy_replay_scan_fallback` explicit.

Unsigned macOS arm64 packaging passed. The bound packaged CI-profile soak at
`tmp/breadcrumb-pr5-evidence/tracking-soak-123116e4` passed 6/6 batches,
8,664/8,664 exact positions, one restart, four healthy operator interactions,
SQLite integrity `ok`, 9.04 ms maximum main-process round trip, zero crashes
and zero redundant-event slope. This remains local packaged evidence, not
Linux, release or field proof. A fresh exact-head Linux run and all four clean
independent exact-head reviews remain mandatory before task completion.

## Proof limits

The clean four-review wave remains the task-completion gate. The final
documentation-only binding descendant must receive exact-diff/tree attestation;
it does not convert the package evidence into release or field proof.
PR6 and BCP-17 retain archive encryption/custody, restore-and-replay qualification,
broad multi-machine/live-server/archive qualification, release and field
acceptance. No merge or release is authorized here.
