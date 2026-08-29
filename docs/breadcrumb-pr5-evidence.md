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

## `60bf8907` four-review rejection and cross-boundary replacement

Pushed code-and-documentation head
`60bf8907cbf128a5ddb98e9a8ef76ab428cecfec`, tree
`9c62d8aedd706f743404c88b38d19694f580958a`, passed exact-head Linux run
`33187744020` through the serial unit, build/budget, x64 AppImage/`.deb`,
indexed-960k, llvmpipe and packaged-soak jobs. That green workflow did not
override the code verdict. All four independent reviewers rejected the exact
head:

| Reviewer/task | Charter | Exact-head verdict and accepted findings |
|---|---|---|
| `/root/pr5_broad_60bf` | Broad life-safety/end-to-end | REJECTED: synchronous unbounded legacy mutable-object baseline creation; Replay displayed lifecycle transition verbs rather than reconstructed state; terminal coordinator outcomes could retain no end time. |
| `/root/pr5_persistence_60bf` | Persistence/completeness | REJECTED: duplicate object-baseline finding; direct archive could copy one mission state and report success after a concurrent write changed the live mission. |
| `/root/pr5_concurrency_60bf` | Concurrency/finalization | REJECTED: each GPX migration turn read size metadata for up to 10,000 unsettled over-envelope geometries before migrating one, producing a 355.71 ms callback and 496.43 ms heartbeat gap. |
| `/root/pr5_renderer_60bf` | Renderer/input containment | REJECTED: GPX pages were drained into one renderer array; later Replay object pages lost their summarized-state count; Replay worker request IDs were cross-renderer and abandoned workers survived renderer teardown. |

Central source retrace accepted every finding. The lifecycle-state and explicit
pass-end rules follow the locked ADR and Q&A contract; they did not require a
new team decision. Because remediation changes persistence, finalization, IPC,
renderer ownership and operator state together, it is a cross-boundary change:
all four exact-head reviews restart on the final code-and-documentation head.

Executable replacement `1f69c7907e79739914b49955b1d391bb02c315e0`
addresses the findings as follows:

- legacy markers, drawings, outings, search areas, assignments and passes use
  durable captured targets and bounded 100-row/1 MiB background pages. One
  over-envelope object becomes an explicit bounded summary while the original
  row remains retained. Replay, mutable evidence writes, Finish, Finalize and
  archive fail closed until baseline custody settles; current positions remain
  available. The deterministic 50,000-object regression keeps open/current/
  heartbeat below 200 ms and settles every baseline before evidence writes;
- legacy GPX metadata inspection is capped at 100 unsettled candidates per
  turn. The unchanged 10,000 settled-key cap and sub-200 ms gates are retained;
  a 4 ms cooperative inter-turn yield meets the unchanged 500,000-row/1.2 s
  liveness gate even under the complete serial unit workload;
- direct archive now owns a durable mission fence from request through snapshot
  validation, archive-event commit and fence release. Concurrent writes fail
  closed; restart records an interrupted direct archive explicitly without
  weakening a true finalization fence;
- Replay returns lifecycle state (`active`, `paused`, `finished`, `finalized`
  or explicit `unknown`) while retaining the transition event as provenance.
  Every coordinator-declared `full`, `partial` or `aborted` pass requires an
  explicit end and remains bounded by its mission, assignment outing and the
  current evidence time;
- Replay IPC scopes request ownership to the sending `webContents`, prevents
  cross-renderer cancellation and cancels workers on both renderer destruction
  signals. Object continuation pages carry and reconcile their own summarized-
  state count;
- GPX operational and Mission Review surfaces retain one 25-entry projection
  page, replace rather than accumulate pages, strip retained source bytes, and
  state `more available`, final-page and return-to-first status explicitly. The
  browser harness mirrors the bounded stable-keyset projection contract.

Replacement verification before documentation binding:

- serial unit: 294 files / 2,460 tests;
- Rust backend: 55 executable tests passed / one intentional real-keychain
  ignore;
- CommonJS syntax, ESLint, TypeScript production build and bundle budgets;
- Chromium: 166/166, including an actual 26-import first/next/return bounded
  GPX flow and the required-end repeated-pass flow;
- visual Playwright: 58/58 with 69 registered screenshots. The uncached review
  initially passed 68/69 and rejected one breadcrumb screenshot because a
  raster tile was blurred; that exact visual test was recaptured and its fresh
  uncached review passed, giving 69/69 effective clean visual verdicts. Reports:
  `visual-review-2026-08-28T16-49-16Z.json` and the replacement-frame
  `visual-review-2026-08-28T16-49-38Z.json`;
- indexed 960k digest
  `58314b12de1f43f51c513e929f51d9f254ad7ea919286057118a5b3389276b36`
  (765,734,912 bytes): 64.70 ms first seek, 55.06 ms late page,
  98.07 ms maximum across 1,017 concurrent current writes, 101.48 ms maximum
  event-loop gap, 53.15 ms exact restart seek and exact equality;
- authentic-v11 960k: 12.13 ms open, 11.92 ms bounded legacy-object baseline
  settlement, 1.75 ms current write while preparation was pending, 610.31 ms
  replay, 1.77 ms restart open and 521.08 ms restart replay, with
  `legacy_replay_scan_fallback` explicit;
- unsigned macOS arm64 packaging and packaged CI-profile soak: 6/6 batches,
  8,664/8,664 positions, one restart, four healthy interactions, SQLite
  integrity `ok`, 5.1 ms maximum main round trip and zero redundant-event
  slope.

This is local candidate proof. The version/evidence binding descendant, push,
fresh exact-head Linux run, four restarted exact-head reviews, centrally
source-retraced finding dispositions and clean current-head verdicts remain mandatory.
PR opened/review-ready remains intermediate; no merge or release is authorized.

## `582fd79e` four-review rejection and final replacement

Code-and-documentation head
`582fd79edf91cf3f3821cb2ad1da46eb919c8745`, tree
`772df8da979d345c4571470ad5325eda1c8f9ced`, passed exact-head Linux run
`33192661456`. Green CI did not override the code verdict. The accepted review
baseline rejected that exact head:

| Reviewer/task | Charter | Verdict and centrally accepted finding |
|---|---|---|
| `/root/pr5_broad_582fd` | Broad life-safety/end-to-end | REJECTED: an over-1 MiB legacy mutable object could advance its summarized baseline cursor and then overwrite the only retained exact state. |
| `/root/pr5_persistence_582fd` | Persistence/completeness | REJECTED: the same sole-copy loss; direct archive did not fence authorized or denied unlock writes; Replay continuation cursors were not bound to mission/time/filter context. |
| `/root/pr5_concurrency_582fd` | Concurrency/finalization | REJECTED: recoverable finalization trusted file existence instead of archive/SQLite validity; startup synchronously reconciled every interrupted GPX receipt. |
| `/root/pr5_renderer_582fd` | Renderer/input containment | REJECTED: browser Replay bypassed packaged input bounds; Replay cursor context was reusable; GPX page cursors crossed missions/imports; an open Review workspace remained editable after Finish. |

Central source retrace accepted every finding. The duplicate Replay-cursor and
oversized-object reports were one defect each, leaving eight distinct defects.
They are engineering consequences of the locked no-silent-loss, data-known-at-T,
current-position-priority and finalized-write-fence rules; no new team question
or product answer was required.

Executable replacement `c3d25973ae48af56a4e058219a4949456e352f25`
addresses them together:

- any mutable object whose immutable legacy baseline explicitly omitted an
  oversized state is write- and retirement-fenced across all six object types;
  its exact current projection remains retained for the bounded repair path;
- recoverable archives are fully read, CRC/manifest/mission checked and their
  embedded SQLite snapshot validated before finalization resumes. Archive files
  use durable atomic file-and-directory synchronization, and direct archive
  holds the finalization fence across both authorized and denied unlock paths;
- interrupted GPX receipts recover in 100-row, 1 MiB cooperative turns instead
  of launch-time bulk work. Current-position writes remain admitted; Replay and
  further GPX imports for the affected mission fail closed until exact receipt
  settlement. Admission is capped at four active/queued batches before durable
  receipts are created;
- Replay track and object cursors are bounded version-4 envelopes bound to
  mission, canonical selected time, timezone, sorted filters, generation and
  eligible snapshot counts. The Review runtime keeps the opaque object-token
  history needed for safe Earlier navigation;
- GPX import page cursors are bound to their mission and revision cursors to
  their import. Browser validation mirrors the production keyset and context
  rules for its available import-page surface;
- browser Replay now applies the packaged mission-ID, 64-character strict
  timestamp and sole `Europe/Dublin` timezone preflight before data work; and
- an open Review reloads when mission phase changes, so successful Finish makes
  Search Operations visibly read-only without closing the workspace.

Replacement verification before documentation binding is green:

- serialized unit: 294 files / 2,473 tests, including exact `SIGKILL` receipt
  recovery updated for bounded background settlement;
- Rust backend: 55 executable tests passed / one intentional real-keychain
  ignore;
- CommonJS syntax, ESLint, TypeScript production build and bundle budgets;
- Chromium: 167/167, including live Finish-with-Review-open read-only proof;
- visual Playwright: 58/58 with 69 registered screenshots; fresh uncached
  independent review: 69/69, report
  `visual-review-2026-08-28T17-53-15Z.json`;
- indexed 960k digest
  `58314b12de1f43f51c513e929f51d9f254ad7ea919286057118a5b3389276b36`
  (765,734,912 bytes): 67.41 ms first seek, 49.88 ms late page,
  44.89 ms maximum across 1,055 concurrent current writes, 54.37 ms maximum
  event-loop gap, 52.09 ms exact restart seek and exact equality; and
- unsigned macOS arm64 package plus packaged CI-profile soak: 6/6 batches,
  8,664/8,664 positions, one restart, four healthy interactions, SQLite
  integrity `ok`, 4.3 ms maximum main round trip and zero redundant-event
  slope.

This is local candidate proof. The version/documentation binding descendant,
push, fresh exact-head Linux run and four fresh exact-head reviews remain
mandatory. PR opened/review-ready remains intermediate; no merge or release is
authorized.

### Exact-head Linux liveness rejection and bounded-turn correction

The documentation-bound candidate `3e166b555566052d7f564068a1e75bd9ae64e729`
was correctly rejected by exact-head Linux run `33197229099`. Its deterministic
gate passed 2,472 tests and failed the 50,000-object legacy-reconstruction
heartbeat gate: the measured maximum event-loop gap was 217.40 ms against the
unchanged hard limit of less than 200 ms. Later build, package and qualification
steps were therefore skipped, and no independent code review began on that
invalid head.

Executable correction `4eaaeb01a5f8` halves each durable mutable-object
reconstruction turn from 100 rows to 50. It does not relax the 200 ms gate or
change evidence semantics. The exact failing 50,000-object test then passed five
consecutive focused runs, the complete evidence-versioning file passed 58/58,
and the full local unit gate passed 294 files / 2,473 tests. A fresh exact-head
Linux run and all four independent exact-head reviews remain mandatory.

## `356a9e03` exact-head review rejection and `9a1a54f8` remediation

Exact pushed code-and-documentation head
`356a9e031cda0d76c860c17390dc79c95afcdcf8`, tree
`407d83417147454d10ee0d5d77d6ad16da1bcd67`, passed exact-head Linux
workflow [`33198210110`](https://github.com/donal0c/sartracker-web/actions/runs/33198210110).
Ubuntu x64 passed lint, 294 files / 2,473 tests, production build/budgets,
AppImage and `.deb`, x86-64 native SQLite, Mesa llvmpipe, the indexed 960k
qualification and packaged tracking soak. The fixture digest was
`58314b12de1f43f51c513e929f51d9f254ad7ea919286057118a5b3389276b36`;
Replay seek was 230.40 ms, late page 164.47 ms, event-loop maximum 84.16 ms,
restart seek 227.93 ms with exact equality, and 1,182 concurrent current writes
had 79.75 ms maximum / 2.51 ms p95. The packaged soak passed 6/6 batches and
8,664/8,664 exact positions with a 41.5 ms main maximum and zero redundant
telemetry slope. Green package evidence did not override the code verdict.

All four allocated exact-head reviewers rejected that head:

| Reviewer task | Charter | Centrally accepted finding |
|---|---|---|
| `/root/pr5_broad_356a` | Broad life-safety/end-to-end | Filtered Replay object pages omitted device/outing filters and failed their bound continuation context; an all-invalid GPX source retained exact bytes but lost its already-observed point/segment rejection records. |
| `/root/pr5_persistence_356a` | Persistence/completeness | Renderer-exposed GPX outing assignment copied a 5.2 MB source plus 200,000 point rows and blocked Electron main beyond the 200 ms current-position-priority gate. |
| `/root/pr5_concurrency_356a` | Concurrency/finalization | Idempotent Finalize validated an archive asynchronously, then could return stale finalized success after an authorized Unlock had changed the live mission to finished. |
| `/root/pr5_renderer_356a` | Renderer/input containment | The filtered object-page defect was independently confirmed; Replay accepted and worker-cloned unknown renderer fields, including a reproduced 64 MiB field, after discarding the normalized projection. |

Central source retrace accepted five distinct defects; the object-page finding
was one defect reported by two reviewers. No team/domain question was needed:
the corrections follow the locked current-position-priority, explicit-missing-
evidence, data-known-at-T and fail-closed finalization rules. Remediation spans
schema/persistence, finalization, IPC/worker ownership and renderer behavior, so
the accepted topology requires all four reviews to restart on the final bound
head.

Executable remediation
`9a1a54f8f8dc816c04a7c873afad75a485d8647d` closes the findings:

- object continuation reads retain the exact sorted device and outing filter
  context from the selected Replay state;
- all-invalid GPX failures retain exact bytes plus structured point/segment
  rejection JSON and count. The bounded issue projection and operator panel
  state that count explicitly instead of implying the evidence disappeared;
- GPX outing assignment records a lightweight immutable
  `source_revision_sequence`. Assignment no longer duplicates retained bytes,
  points or rejections and does not materialize retained source bytes in main;
  Replay resolves both dated and static evidence through that immutable source
  revision while presenting the assignment revision known at T;
- the already-finalized Finalize path captures the finalized epoch and rechecks
  it inside an immediate transaction after archive validation, so an Unlock
  winner makes the stale Finalize fail visibly; and
- preload, main IPC and the worker runner each project Replay input through the
  same closed bounded query contract. Unknown renderer fields never enter the
  worker structured clone, while opaque cursor/generation fields remain
  validated and preserved.

Red-green coverage includes filtered object page 2/3 continuation, a 64 MiB
unknown Replay field, the deterministic Finalize/archive-read versus authorized
Unlock race, exact all-invalid GPX point/segment provenance, and a retained
5.2 MB / 200,000-point GPX assignment that leaves only the source revision's
point rows and stays below the unchanged 200 ms gate. The deterministic
fixture digest changed to
`3d5075babff4ff6b04da66048c0bb753ad6a08572dc3753a02fae5115fa5a10a`
solely because the mission-store schema gained the source-reference and failure-
rejection columns.

Fresh local executable-tree proof is green:

- serial unit: 294 files / 2,478 tests;
- focused changed-boundary set: 214/214;
- CommonJS/TypeScript, ESLint, production build and bundle budgets;
- Chromium: 167/167, including explicit retained GPX rejection count and
  Replay Live/data-known-at-T behavior;
- visual Playwright: 58/58 with 69 registered screenshots; fresh uncached
  independent review 69/69, report
  `visual-review-2026-08-28T19-18-29Z.json`;
- Rust backend: 55 passed / one intentional real-keychain ignore;
- indexed 960k fixture digest
  `e6afc8d7252385f3bd2cc9612af0d8c519983c75aab7bfd711e00169978a7038`
  (765,734,912 bytes): 50,000-point GPX dispatch 2.49 ms, 1,003 concurrent
  current writes with 37.85 ms maximum / 4.17 ms p95, 64.50 ms Replay seek,
  51.55 ms exact late page, 43.23 ms event-loop maximum, 3.87 ms restart open
  and 55.93 ms restart seek with exact first-page equality; and
- unsigned macOS arm64 packaging completed with no signing identity available.

This remains pre-merge local/package evidence, not release or field proof. The
documentation-bound descendant must be pushed, pass exact-head Linux and then
receive clean broad, persistence/completeness, concurrency/finalization and
renderer/input-containment verdicts on that same head before task completion.
PR opened/review-ready remains intermediate; no merge or release is authorized.

## `52465dfc` packaged-startup rejection and sandbox-safe correction

Documentation-bound candidate
`52465dfc2edd7e0a24f359ec4136b0bccdb08e4f` was invalidated by exact-head
Linux workflow [`33203567089`](https://github.com/donal0c/sartracker-web/actions/runs/33203567089).
Lint, 294 files / 2,478 tests, build/budgets, Linux artifacts, the indexed 960k
qualification, native SQLite inspection and llvmpipe attestation passed. The
packaged soak then timed out waiting for the operational app shell and correctly
blocked AppImage smoke and review dispatch.

Central source retrace found that the Replay containment change had added a
local CommonJS import to `electron/preload.cjs`. Electron runs this preload with
`sandbox: true`, where its restricted `require` surface cannot load local
modules. The preload therefore failed before exposing the desktop bridge and
the renderer remained in the fail-closed startup shell. The same exact package
failure was reproduced locally before changing code; the second obsolete Linux
attempt was cancelled rather than spending another qualification cycle on the
known-invalid head.

Executable correction `09845b8bb8ebe400a0edc40d375a503c5cd3a0f8` removes the local preload import. The
sandboxed preload now projects only the closed, bounded Replay fields into IPC;
the main process still performs the authoritative timestamp, filter, cursor,
generation and request validation before starting a worker. The regression
test executes the real preload in a VM whose `require` accepts only `electron`,
then proves a 64 MiB unknown renderer field is not cloned into main. It failed
red with `Sandboxed preload cannot require ./mission-replay-query.cjs` and
passes with the correction.

Affected proof is green:

- Replay/preload/query focused suite: 40/40;
- full serial unit gate: 294 files / 2,480 tests;
- Electron preload/Replay CommonJS syntax, ESLint, production build and bundle
  budgets;
- rebuilt unsigned macOS arm64 package; and
- the same packaged CI-profile soak now launches twice and passes 6/6 batches,
  8,664/8,664 exact positions, 5.7 ms maximum main-process stall and zero
  redundant telemetry slope.

This correction is inside the renderer/input-containment boundary, so the final
documentation-bound descendant must pass a fresh exact-head Linux run and all
four independent review charters. PR opened/review-ready remains intermediate;
no merge or release is authorized.

## `b59c54e1` Linux liveness rejection and margin correction

Documentation-bound sandbox correction
`b59c54e1aadb8b5b8d4e66c6670e93fcef5370e9` was correctly rejected by
exact-head Linux workflow
[`33205517532`](https://github.com/donal0c/sartracker-web/actions/runs/33205517532)
before packaging. Lint passed and 2,479 other tests were green, but the
50,000-object legacy baseline test measured a 239.90 ms maximum event-loop gap
against the unchanged hard limit of less than 200 ms.

The earlier reduction from 100 to 50 objects per durable turn had passed the
previous exact-head runner, but it did not retain enough margin on this slower
run. Executable correction
`fcf55f88d6105045bb4d19bca017a4e795344396` reduces the maximum turn to 25
objects without changing evidence semantics, the one-MiB page/object caps, or
the fail-closed preparation fence. The exact 50,000-object regression then
passed five consecutive focused runs, the complete evidence-versioning file
passed 60/60, and the full serial suite passed 294 files / 2,480 tests. The
fresh documentation-bound descendant still requires exact-head Linux and all
four independent reviews; no merge or release is authorized.

The first documentation-bound descendant,
`394facdb97acf6d1dac455b11a7e6af803695ddc`, retained the corrected hard
liveness gate but Linux workflow
[`33206596556`](https://github.com/donal0c/sartracker-web/actions/runs/33206596556)
exposed a test-harness consequence of the smaller turns: the former 15-second
settlement loop ended with 42,500 of 50,000 rows complete. The cursor was still
advancing and there was no missing or skipped evidence. Test correction
`84eb2245` keeps the full 50,000-row equality and unchanged less-than-200 ms
event-loop assertion, but permits up to 30 seconds for the deliberately smaller
durable turns to finish on slower runners. The focused regression passed three
consecutive runs and the complete evidence-versioning file remained 60/60.

## `a584b2aa` exact-head review rejection and `12532025` remediation

Exact pushed code-and-documentation head
`a584b2aaa5b9f29055c0dca1d7e43e50dace7f4d`, tree
`dceca0969155937a5cf7efce5931026964327002`, passed exact-head Linux
workflow [`33207406645`](https://github.com/donal0c/sartracker-web/actions/runs/33207406645).
Ubuntu x64 passed lint, 294 files / 2,480 tests, production build/budgets,
AppImage and `.deb` construction, x86-64 native SQLite, Mesa llvmpipe, the
indexed 960k qualification and the packaged tracking soak. The fixture digest
was `e6afc8d7252385f3bd2cc9612af0d8c519983c75aab7bfd711e00169978a7038`;
initial open was 49.89 ms, Replay seek 242.54 ms, late page 169.19 ms,
restart seek 236 ms with exact equality, and the event-loop maximum was
85.35 ms. The packaged soak passed 6/6 batches and 8,664/8,664 exact
positions across two launches. Green package evidence did not override the
code verdict.

All four allocated independent reviews rejected that exact head:

| Reviewer task | Charter | Centrally accepted finding |
| --- | --- | --- |
| `/root/pr5_broad_a584` | Broad life-safety/end-to-end | A 64 MiB marker description or non-search drawing geometry reached synchronous projection, audit and version writes, breaching the current-position-priority budget. |
| `/root/pr5_persistence_a584` | Persistence/completeness | Schema-v12 startup synchronously rewrote 500,000 legacy event rows and prepared a global index; restart GPX receipt settlement was not atomic with batch accounting. |
| `/root/pr5_concurrency_356a` | Concurrency/finalization | The retained Tauri fallback checked mission status before its deferred GPX delete transaction, so a concurrent committed Finish could still lose the GPX row. |
| `/root/pr5_renderer_a584` | Renderer/input containment | Default all-mission Replay object paging changed omitted filters to empty arrays, invalidating the bound continuation context. |

Central source retrace accepted five P2 defects. No team/domain question was
needed: the fixes follow the locked current-position-priority, explicit
evidence, data-known-at-T and finalized-write-fence rules. Because remediation
crosses migration, receipt accounting, finalization, renderer and IPC
boundaries, all four reviews must restart on the final exact head.

Executable remediation
`12532025f20ee558b910eb3831f063e5c1a27265` closes the five findings:

- preload and main now enforce closed marker/drawing projections with bounded
  UTF-8 text, JSON, coordinate-count and nesting envelopes before lookup,
  audit or version serialization. Rejection produces no projection, version or
  audit row;
- legacy event and membership provenance is reconstructed in durable
  1,000-row background turns with restartable cursors. Current-position writes
  remain admitted while Replay and Finish fail closed until the captured
  legacy target is complete;
- restart GPX receipt settlement, failure publication and batch accounting now
  share one immediate transaction, with an injected post-settlement failure
  proving complete rollback and clean restart recovery;
- the Tauri fallback performs GPX lookup and transaction-current mission-status
  validation inside `BEGIN IMMEDIATE`, so a committed Finish wins and leaves
  the evidence plus audit state intact; and
- unfiltered Replay object continuation requests preserve omitted filters,
  while filtered requests retain their exact sorted context.

Red-green coverage includes 64 MiB marker and drawing payloads under the
unchanged 200 ms gate, a 50,001-coordinate drawing below the byte cap, no-row
rejection, 500,000 legacy events with bounded open/write/heartbeat and durable
restart progress, receipt rollback after settlement, Finish-versus-delete, and
default all-mission object page continuation. The deterministic small fixture
digest changed to
`22a5e80b51767770098cc6fdab505b9b88c177829f5c4a08e34afdf10465df24`
because the durable event-provenance state table was added.

Fresh executable-tree proof is green:

- serial unit: 294 files / 2,484 tests;
- CommonJS syntax, ESLint, production TypeScript/Vite build, bundle budgets,
  Rust formatting, and Rust backend 57 passed / one intentional real-keychain
  ignore;
- Chromium: 167/167;
- visual Playwright: 58/58 with 69 registered screenshots; fresh uncached
  independent review 69/69, report
  `visual-review-2026-08-28T21-34-18Z.json`;
- indexed 960k fixture digest
  `b7f89681afb111108341a080fb248c93cb1d3765cdd98c2f7eb9e4c2fd9fdcfc`
  (765,739,008 bytes): initial open 1.75 ms, 50,000-point GPX dispatch
  2.34 ms / total 3,505.21 ms, 1,108 concurrent current writes with 44.02 ms
  maximum / 1.91 ms p95, Replay seek 61.27 ms, late page 49.42 ms,
  event-loop maximum 44.16 ms, restart open 3.31 ms and restart seek 52.78 ms
  with exact first-page equality; and
- unsigned macOS arm64 package plus packaged CI-profile soak across two
  launches: 6/6 batches, 8,664/8,664 positions, 6.3 ms maximum main round
  trip and zero redundant-event slope.

This is deterministic browser/local/package proof, not release or field proof.
The documentation-bound descendant still requires push, a fresh exact-head
Linux run and clean broad, persistence/completeness, concurrency/finalization
and renderer/input-containment reviews on that same head. PR opened/review-ready
remains intermediate; no merge or release is authorized.

## `d051e4c9` conflicting Linux evidence and `7f14d518` margin correction

Documentation-bound head
`d051e4c9ad47ab687018078c74ee98eab207889b` produced conflicting exact-head
Linux evidence and was therefore rejected before review. The automatic
pull-request workflow
[`33213448567`](https://github.com/donal0c/sartracker-web/actions/runs/33213448567)
passed every gate, but a redundant manual workflow dispatched at the same time,
[`33213464281`](https://github.com/donal0c/sartracker-web/actions/runs/33213464281),
failed on a slower runner. The second run measured a 201.49 ms current write
during event-provenance reconstruction, 463.46 ms and 234.69 ms current writes
during GPX import, a 50,000-object settlement timeout, and incomplete 500,000-row
GPX cursor settlement within the former fixed wait. One green runner does not
override those slower-runner results.

Executable correction
`7f14d518b458aa617cb26f3f604df59c9c6e6c45` restores margin without relaxing
the 200 ms gate or weakening exact-evidence completion:

- legacy event provenance turns are reduced from 1,000 to 250 rows;
- GPX writer slices yield five milliseconds between durable transactions so
  current-position writers can acquire WAL ownership;
- a large GPX source remains exact in its immutable revision but is no longer
  synchronously duplicated into the active projection. The projection keeps
  identity, digest and presentation state; small sources retain the compatible
  inline path; and
- slow-runner harnesses poll durable 50,000/500,000 completion for longer while
  preserving the same exact counts and less-than-200 ms heartbeat/write gates.

The 8 MiB regression failed red because both projection and revision retained
11,184,812 base64 bytes, then passed with zero projection bytes and the exact
11,184,812-byte immutable revision. The five affected scale/liveness tests
passed three consecutive focused runs, the complete evidence file passed 63/63,
and the full serial gate passed 294 files / 2,484 tests. ESLint, CommonJS syntax,
production build and bundle budgets are green. Fresh indexed 960k qualification
retained digest
`b7f89681afb111108341a080fb248c93cb1d3765cdd98c2f7eb9e4c2fd9fdcfc`:
4,188 concurrent current writes had 24.68 ms maximum / 1.95 ms p95, the
event-loop maximum was 25.27 ms, Replay seek 62.48 ms, late page 49.82 ms,
restart seek 53.93 ms with exact equality, and the deliberately more cooperative
50,000-point import completed in 12,930.32 ms. The rebuilt unsigned macOS
package passed two launches, 6/6 batches, 8,664/8,664 exact positions, a
19.2 ms maximum main round trip and zero redundant-event slope.

The documentation-bound descendant still requires isolated exact-head Linux
qualification and all four independent exact-head reviews. No merge or release
is authorized.

## `84702866` isolated-Linux rejection and `e9466e54` worker isolation

Documentation-bound head
`847028665206f8769e937355aab35f4015b27f04`, tree
`789540cc34fae9d27e5a62626d27230793229579`, was correctly rejected before
review by isolated exact-head Linux workflow
[`33215754562`](https://github.com/donal0c/sartracker-web/actions/runs/33215754562).
The 50,000-object regression measured a 346.538 ms event-loop gap against the
unchanged less-than-200 ms hard gate, and the 500,000-event provenance case did
not settle inside its 60-second test. Smaller synchronous turns could not
provide reliable slow-storage margin because the transformation and SQLite
commit still ran on Electron main.

Executable correction
`e9466e54e341bbb255249552d821ec04bd0d42b8` moves all pending legacy event,
mutable-object and GPX reconstruction to one round-robin worker isolate:

- Electron main retains `synchronous=FULL`; current-position operations no
  longer share the JavaScript isolate with legacy selection, transformation or
  serialization;
- the worker uses `synchronous=NORMAL` only for reconstructible migration
  turns. Each turn derives from retained immutable legacy rows and advances its
  durable cursor in the same transaction, so loss of the final transaction
  replays that turn rather than losing or falsely completing evidence;
- event turns return to 1,000 rows now that they are off-main, while object and
  GPX byte/row caps remain unchanged. Replay, mutable evidence writes, Finish,
  Finalize and archive continue to fail closed until every captured target is
  explicit;
- startup and runtime worker failures are bounded, recorded through the main
  FULL-synchronous connection, and leave current positions available. A clean
  retry clears the failure only after durable reconstruction is complete; and
- clean application shutdown joins the worker before closing SQLite. The store
  refuses an unprepared close while reconstruction is active, preventing an
  overlapping replacement worker during orderly restart.

Red-green worker-runner tests prove the closed worker envelope, completion only
after physical exit, malformed/error containment and joined cancellation. A
store-level regression proves construction failure is persisted without
blocking a current fix, then a clean restart reconstructs the retained baseline
and removes the stale failure. Existing exact 50,000-object, 500,000-event and
500,000-GPX cursor cases exercise the real worker while retaining the same
less-than-200 ms open, write and heartbeat gates.

Fresh committed-code proof is green:

- the five affected scale/liveness tests passed three consecutive runs at
  43.66, 43.95 and 43.50 seconds; the complete serial unit gate passed 295
  files / 2,488 tests;
- CommonJS syntax, ESLint, production build/bundle budgets and Rust formatting
  are green; the retained Tauri backend passed 57 tests with one intentional
  real-keychain ignore;
- indexed 960k retained fixture digest
  `b7f89681afb111108341a080fb248c93cb1d3765cdd98c2f7eb9e4c2fd9fdcfc`
  and 765,739,008 bytes. The 50,000-point import dispatched in 2.49 ms and
  completed in 13,033.20 ms; 4,069 concurrent current writes had 24.27 ms
  maximum / 2.07 ms p95; the event-loop maximum was 42.49 ms; Replay seek was
  62.75 ms, late-page seek 47.12 ms, restart open 2.95 ms and restart seek
  49.12 ms with exact first-page equality; and
- the rebuilt unsigned macOS arm64 package passed the packaged CI tracking
  soak across two launches: 6/6 batches, 8,664/8,664 exact positions, SQLite
  integrity, one restart checkpoint, zero redundant-event slope, zero renderer
  crashes and a 3.87 ms maximum main-process round trip. Report SHA-256 is
  `857faf5c8ad0f644bf684039227eddab6d4d6b01749c57ac99e01ed81f0e4801`.

The prior 167/167 Chromium, 58/58 visual Playwright and fresh uncached 69/69
screenshot review remain standing evidence because this correction changes
only the Electron migration execution boundary. The documentation-bound
descendant still requires push, one isolated exact-head Linux run and clean
broad, persistence/completeness, concurrency/finalization and
renderer/input-containment reviews on the same head. PR opened/review-ready is
intermediate; no merge or release is authorized.

## `782167e8` four-review rejection and `d98d7907` remediation

Documentation-bound head
`782167e8d4817944a367ec1e0644a10d7ef651e2`, tree
`f3396836b04f6a00f51a3e3d8a525ec0d9271cb6`, passed isolated exact-head Linux
workflow [`33218426707`](https://github.com/donal0c/sartracker-web/actions/runs/33218426707),
including 295 files / 2,488 tests, indexed 960k replay, Linux x64 package
construction and the packaged soak. All four allocated independent reviews
nevertheless rejected that head:

| Reviewer task | Charter | Centrally accepted finding |
| --- | --- | --- |
| `/root/pr5_broad_a584` | Broad life-safety/end-to-end | Direct archive, archive construction and both Finalize phases omitted legacy-event provenance readiness, allowing an already-finished upgraded mission to seal explicitly incomplete events. |
| `/root/pr5_persistence_a584` | Persistence/completeness | Authentic-v11 upgrade still built `idx_mission_events_replay` synchronously over 500,000 populated rows; worker event turns bounded rows but not retained bytes and could hold SQLite's writer beyond 200 ms. It independently confirmed the archive/finalize omission. |
| `/root/pr5_concurrency_7821` | Concurrency/finalization | Independently reproduced the archive/finalize custody failure while confirming the earlier Tauri GPX delete-versus-Finish race was fixed. |
| `/root/pr5_renderer_a584` | Renderer/input containment | Marker retirement crossed preload unbounded and reached a main SQLite lookup before validation; browser marker/non-search-drawing mutations and operator input limits diverged from packaged Electron. |

Central source retrace accepted four unique P2 defects. No new team/domain
question was needed: remediation follows the locked current-position-priority,
explicit missing-evidence, finalized-write-fence and renderer-containment
requirements. Because the fixes span migration, worker/WAL, custody and
renderer boundaries, all four reviews restart on the final exact head.

Executable remediation
`d98d79078633e4eba58973b401ae4a1ff3969c37` closes them:

- new stores retain the replay event index, while populated legacy upgrades do
  not build it synchronously. Replay exposes
  `legacy_event_replay_scan_fallback` rather than claiming indexed legacy
  performance;
- legacy event reconstruction remains capped at 1,000 rows but is additionally
  capped at 512 KiB of retained row data per immediate transaction. A source
  row above 256 KiB remains byte-for-byte in `mission_events`, receives a
  bounded explicit quarantine record, and leaves Replay/archive/finalization
  fail-closed until bounded repair;
- direct archive request/build, initial/resumed/idempotent Finalize and final
  sealing all apply the same event-provenance readiness fence used by Replay
  and Finish, covering pending, failed and quarantined reconstruction; and
- marker/drawing upsert and retirement identities are UTF-8 bounded before
  renderer cloning and before main lookup. Browser validation mirrors marker
  and non-search drawing scalar/JSON/coordinate bounds; visible operator text
  inputs expose the same limits.

The focused regressions were red against `782167e8`: authentic-v11 open was
346.77 ms, pending-event direct archive succeeded, marker retirement crossed
preload with a 64 MiB identity, and the harness accepted oversized marker and
drawing evidence. On the corrected executable tree:

- full serial unit passed 295 files / 2,492 tests; the complete evidence and
  versioning file passed 67/67;
- the 1,000 x 64 KiB event workload settled with every continuously attempted
  current-position write below the unchanged 200 ms hard gate; a 256 KiB-plus
  event remained retained and produced explicit quarantine/custody refusal;
- CommonJS syntax, ESLint, TypeScript/Vite build and bundle budgets, Rust
  formatting and Rust backend 57 passed / one intentional keychain ignore;
- Chromium passed 167/167, including visible marker/drawing input limits and
  the production-aligned browser harness; and
- fresh indexed 960k qualification generated digest
  `d4e48eb48d962781475f6864f6190a23f8da163f4d698b03c8365e51b96840db`
  (765,747,200 bytes): import dispatch 2.08 ms / total 13,021.33 ms;
  4,201 concurrent current writes at 25.23 ms maximum / 1.97 ms p95;
  event-loop maximum 26.56 ms; Replay seek 61.35 ms; late page 47.34 ms;
  restart open 2.78 ms and restart seek 50.13 ms with exact equality.

Fresh packaged proof is now complete for this executable tree. The rebuilt
unsigned macOS arm64 package passed the two-launch CI tracking soak: 6/6
batches, exact 8,664/8,664 positions, SQLite integrity `ok`, one restart
checkpoint, zero redundant-event slope, zero renderer crashes and four healthy
operator interactions; maximum main-process round trip was 4.64 ms. The report
SHA-256 is
`1cf087628f34dbe96ff20e21d65a33b759b1128bb20316e8c9ce457321ff6310`.

Branch-dispatch Linux workflow
[`33222361222`](https://github.com/donal0c/sartracker-web/actions/runs/33222361222)
then checked exact head
`1909eac0203f71084aefcc1bdbc84728e3fe8d6a` rather than a synthetic pull-request
merge ref and passed every step: lint, 295 files / 2,492 deterministic tests,
production build and bundle budgets, Linux x64 AppImage and `.deb`, native ELF
x86-64 `better_sqlite3.node`, llvmpipe, packaged soak and a real AppImage
launch/graceful-close smoke. Its 960,000-position/765,747,200-byte fixture kept
the deterministic digest
`d4e48eb48d962781475f6864f6190a23f8da163f4d698b03c8365e51b96840db`:
50,000-point import dispatched in 4.93 ms and completed in 12,317.49 ms;
3,894 concurrent current writes had 38.29 ms maximum / 1.99 ms p95; event-loop
maximum was 44.44 ms; Replay seek was 254.69 ms, late-page seek 193.18 ms,
restart open 7.23 ms and restart seek 244.04 ms with exact first-page equality.
The Linux package soak used two launches and retained exact 8,664/8,664
positions, SQLite integrity `ok`, one restart checkpoint, zero redundant-event
slope, zero renderer crashes and four healthy interactions; maximum
main-process round trip was 26.87 ms. AppImage SHA-256 was
`6a25eb71617625c883cd6d08747be39ac6410a5c06419a18a7d2611aa621690f` and
`.deb` SHA-256 was
`f575983292f47fd1d203b7988acdb95361374d3d5fa431969ea4d54fa66226dc`.
Qualification and soak report SHA-256 values were
`007add94b9d1365e561877651581eeb54ac3efae6919d2254239e5de2c2b42b6` and
`761a8889843203e338bff8eba4488f40f302ee62e9ab8ada4149bccc320aa911`.

Existing 58/58 visual Playwright and fresh uncached 69/69 screenshot-review
evidence remains standing because the only visible UI correction is
non-rendered input-length enforcement. The final code-and-documentation head
now enters the restarted broad, persistence/completeness,
concurrency/finalization and renderer/input-containment reviews. PR
opened/review-ready is intermediate; no merge or release is authorized.

## `75a4ee05` review rejection and `f5f0438e` remediation

The first review wave examined exact pushed head
`75a4ee050dadfa94d87f45923ab570aa2a4ccb7a`, tree
`0138e6a91b0698eda0058d966cfa717865691820`, against exact base
`80309c995a18eeb190cce4310c9a46b0f46d5263`:

| Reviewer task | Charter | Verdict and disposition |
| --- | --- | --- |
| `/root/pr5_broad_a584` | Broad life-safety/end-to-end | **Rejected.** A resumed Finalize could reuse a ZIP- and SQLite-integrity-valid archive without checking event-provenance readiness inside its embedded snapshot. Accepted P2. |
| `/root/pr5_persistence_a584` | Persistence/completeness | **Rejected.** A legacy event identity remained an unbounded migration target/main-process read, and a quarantined row in Mission A blocked clean Mission B. Both accepted P2s. |
| `/root/pr5_concurrency_7821` | Concurrency/finalization | **Clean.** It confirmed the earlier archive/finalize readiness and Tauri race corrections on that head. |
| renderer task | Renderer/input containment | Not started after the exact head was already invalid; it remains mandatory in the restarted four-review wave. |

Central source retrace accepted all three findings without a new product or
team question. The broad reproduction reused a structurally valid current
archive whose embedded snapshot had three incomplete mission-event rows. The
persistence probes showed a 96 MiB event identity delaying open and failing
the worker without quarantine, and one affected mission's quarantine blocking
clean-mission Replay/archive/finalization.

Executable remediation
`f5f0438eea7509a9c2b4eeb6bf3f551f2d0bf265` is red-green:

- event migration targets and durable cursors use bounded SQLite row IDs rather
  than source identities; worker pages return only a 200-character identity
  preview and explicit byte counts, and an oversized identity remains
  byte-for-byte in the source table behind explicit quarantine;
- quarantine readiness joins retained source row IDs back to the requested
  mission, so Mission A remains fail-closed without withholding clean Mission
  B's Replay, archive, Finalize or a clean active mission's Finish; and
- recoverable Finalize archives are reused only after their embedded read-only
  SQLite snapshot passes legacy object readiness, mission-scoped event
  readiness and GPX import-settlement checks. An incomplete snapshot is
  rejected and rebuilt before the mission can finalize.

Strict red evidence reproduced missing quarantine/worker failure, clean-mission
global blocking, and reuse of an archive with three incomplete embedded event
rows. Green evidence on the executable tree is:

- focused evidence/versioning 69/69 and mission-store 93/93; full serialized
  unit 295 files / 2,495 tests;
- ESLint, changed CommonJS syntax, production TypeScript/Vite build and bundle
  budgets; Rust backend 57 passed / one intentional real-keychain ignore;
- Chromium 167/167. Existing visual Playwright 58/58 and fresh uncached
  screenshot review 69/69 remain standing because the remediation changes no
  rendered UI or operator workflow;
- indexed 960k digest
  `d4e48eb48d962781475f6864f6190a23f8da163f4d698b03c8365e51b96840db`
  (765,747,200 bytes): 50,000-point import 2.50 ms dispatch / 12,705.53 ms
  total, 4,243 concurrent current writes 27.55 ms maximum / 1.84 ms p95,
  event-loop maximum 38.88 ms, Replay seek 69.35 ms, late page 47.05 ms,
  restart open 3.52 ms and restart Replay 50.16 ms with exact equality. Report
  SHA-256 is
  `480aef0c03fd80f99a0db5aed68bf9ae2fa9ffe29e14033e3b9cb530594c4587`;
  and
- the rebuilt unsigned macOS arm64 package passed two launches, 6/6 batches,
  exact 8,664/8,664 positions, SQLite integrity `ok`, one restart checkpoint,
  zero redundant-event slope, zero renderer crashes and four healthy operator
  interactions; maximum main-process round trip was 3.30 ms. Report SHA-256 is
  `35d267794e23ef011b673fb747b31fabae31dd2a86b759fcb18ddd77ae7d5e70`.

Because this remediation crosses worker/persistence and Finalize-recovery
contracts, all four independent reviews restart on the same final
code-and-documentation head after exact branch-head Linux proof. PR
opened/review-ready remains intermediate; no merge or release is authorized.

## Proof limits

The clean four-review wave remains the task-completion gate. The final
documentation-only binding descendant must receive exact-diff/tree attestation;
it does not convert the package evidence into release or field proof.
PR6 and BCP-17 retain archive encryption/custody, restore-and-replay qualification,
broad multi-machine/live-server/archive qualification, release and field
acceptance. No merge or release is authorized here.
