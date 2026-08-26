# Breadcrumb PR-3 T1 Evidence

## Binding

- Tested code head: `d1e884ba2c881551fe49c72f0716e4e6032341e6`
- Exact PR-2 base: `7021fc1ef33e6da5c91c96cd86e836fc3754f48f`
- Ubuntu package source checkout: clean `codex/breadcrumb-pr3-complete-coverage` at the tested code head
- Linux x64 packaged `app.asar` SHA-256: `ed399ddcb2f71cbf84b6ce2ab2018daa65d2ee3dd79442b8fc5bf0fa0357a319`
- Linux x64 packaged executable SHA-256: `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
- Ubuntu host: `donal-Precision-5570`, Linux `7.0.0-28-generic`, x64

This record binds the pre-G3 T1 qualification to the code tree above. Later
documentation-only commits do not invalidate it. A later migration or ingest
write-path change must repeat the affected heavy row under the accepted plan.

Post-T1 commit `f4b1e3575fbbf6ad7ef1c1f2e55349707f79ca47` made the
mission-model release default explicit as `false` without changing resolution
behavior. Its red test observed the missing export as `undefined`; the focused
mission-model/coverage flag set then passed 4/4 with TypeScript and lint. This
posture-only extraction does not touch a heavy-proof invalidation surface and
allows the G3 commit to change only the two default booleans.

## Deterministic software and browser gates

- Unit: `npm run test` — 257 files / 1,983 tests passed.
- Static: `npm run lint`, `npx tsc -b --pretty false`, and Node syntax checks for
  both changed coverage CommonJS modules passed.
- Contract/build: exact Dots contract 10/10, production build, and bundle budgets passed.
- Chromium: `npm run test:e2e:chromium` — 157/157 passed. The only console noise
  was the deliberate HTTP 503 recovery scenario.
- Coverage visuals: four Playwright workflows produced six critical entries;
  all six passed `visual:review --fail-on critical`. Aggregate report:
  `visual-review-2026-08-24T22-04-02Z.json`.
- Packaging: one unsigned macOS arm64 package and the exact-head Linux x64
  package completed, including the native `better-sqlite3` rebuild and bundle gates.

## 3.704 GB v9 to v10 migration

The retained PR-2 schema-v9 derivative of the immutable field fixture was
copied into a new isolated user-data directory. The cached source was not opened
for write. Before migration the copy was 3,704,819,712 bytes, SHA-256
`a3e4d1938e64e52af5e82856d189f983a581ddba48a77f4f026470583765e5bb`,
with integrity `ok`, 2,040,000 positions, and 32 participants.

The exact packaged Electron runtime opened the exact packaged mission-store
module with `ELECTRON_RUN_AS_NODE=1`. Schema v9 to v10 migration plus store open
took 16.557 ms. After close:

- schema version was 10 and integrity was `ok`;
- all 2,040,000 positions and all 32 participants remained;
- `coverage_chunks`, `coverage_missions`, and `coverage_invalidations` were empty;
- rejected index `idx_positions_mission_timestamp` was absent;
- the database was 3,704,868,864 bytes, SHA-256
  `ea18699a9f4b7112acac586b816b1adea352c6fcfdf0db14a14c40550f28d40a`.

This proves the migration is bounded and additive on the field-size input; it
does not claim a field-size coverage build or renderer run.

## Packaged CI tracking soak

The single permitted packaged CI-scale soak ran on the active Ubuntu desktop
session with Mesa llvmpipe via ANGLE/OpenGL. The wrapper's first invocation
exited before launching the app because `xvfb-run` is not installed; the actual
run used the already-active `:0` session and passed.

- 6/6 accelerated batches and 8,664/8,664 source-exact positions passed;
- exact position digest:
  `449c9e14f5dee0b202df48cffbb24e1a7d5d3439c3d52121f7c6127bba7d1fde`;
- one restart passed; both launches exited 0; renderer crashes: 0;
- SQLite integrity `ok`; WAL busy/log/checkpoint frames: 0/0/0;
- main-process maximum 5.586 ms and renderer maximum 66.9 ms against 250 ms gates;
- all four real operator interactions were classified healthy; internal action
  maximum 28.2 ms and external action maximum 81.315 ms;
- peak process-tree RSS was 1,004,056,576 bytes;
- redundant telemetry growth slope was zero;
- coverage ledger line item after the soak: one mission row, change sequence 9,
  32 chunk rows, zero invalidations, and 20,480 bytes across coverage tables/indexes.

Report SHA-256:
`1b724e3a95776b2bacbc3a7f796df840f75715112657216a1d56e13b516409fd`.
The host copy is at
`~/sartracker-pr3-d1e884b/tmp/beta-artifacts/tracking-soak-ci/electron-tracking-soak-report.json`.

## Standing evidence and proof limits

G2 remains bound to measured SHA `8eff87b724ae6b4ffa9123479a8982d1d08f47ef`:
the later CommonJS/browser interop correction changed module exposure, not the
measured Candidate-B query, segmentation, source, or tile strategy. No G2 row
needed repetition.

By design, T1 did not run a packaged 960k or 2M coverage workload, a packaged
forced-kill matrix, Windows, field hardware, GPX, replay, search passes,
archives, or custody. The coordinator-owned unpublished post-merge 960k Ubuntu
checkpoint remains T3 and is outside this implementation task.

## G3 ratification

Donal approved the recommended combined posture on 2026-08-25 at exact pushed
pre-flip head `d05c7876963a9104755615018151d1fc281f5e5b`: mission model
and complete coverage default on together, no budget amendment, explicit build
overrides retained, and rollback by reverting the single final flip commit.

## Exact-production-path review remediation

The first exact-head review wave at `20ee295b8b0e914e7939768880c93641a17e2df4`
found blocking gaps between the G2 Candidate-B harness and the production path:
initial catalog delivery was not progressive, renderer activation was not part
of delivery attestation, worker generations were not fully fenced, steady
manifest/claim reads could rescan mission evidence, coverage writes used
per-chunk autocommits, and several evidence/scope/runtime failures did not
immediately revoke Complete. Red tests reproduced each condition before the
production changes in `a687746`, `29a1e14`, and `d39732e`; the focused coverage
set then passed 150 tests and the full unit suite passed 257 files / 1,997 tests.

A targeted Ubuntu production-path qualification then used the real
`createElectronMissionStore`, the production read-only coverage worker, the
production Candidate-B tile worker, and the immutable PR-2 fixtures. It was not
a packaged GUI run and did not repeat the G2 A/B/C matrix. The first 2M run at
`20ee295` failed the ratified five-second first-useful gate at 6,438.024 ms.
Red test `enumerates each participant device with one indexed positions
traversal` recorded that enumeration prepared one positions scan per
device-period rather than per device. Commit `d39732e` changed lazy initial
enumeration to one indexed chronological traversal per participant device,
preserving the canonical half-open outing resolver and exact per-period source
digests.

Exact corrective code head `d39732ee22e8d981c5e51a7fd008fca4dafc6657`
passed both scales on the Ubuntu reference host:

| Fixture | Delivered | Manifest ready | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,164.608 ms | 2,295.381 ms | 5,819.168 ms | 21.807 ms | Correctly blocked only by fixture `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,203.931 ms | 4,390.900 ms | 11,679.395 ms | 23.055 ms | Correctly blocked only by fixture `backfill_incomplete` |

The 1.5 GiB/2.5 GiB G2 memory budgets were not remeasured by this targeted
Node qualification; the standing G2 renderer/package measurements remain the
memory proof. Machine-readable failure and corrective reports, with a checksum
manifest, are committed under `output/pr3-production-qualification/`. A later
history-only reorder that restores the approved two-boolean flip as the final
commit must retain an identical production-code tree; final exact-head gates
and five independent reviews still apply.

## Final pushed-code gates

The approved two-boolean flip was restored as isolated commit `b9bad64`, whose
diff contains only the mission-model and complete-coverage release defaults.
On exact pushed code head `b9bad6446faf055ccd603afa60272ac3de46fbb3`:

- serial unit: 257 files / 1,998 tests;
- lint, TypeScript, every changed CommonJS syntax check, exact Dots 10/10,
  production build, and bundle budgets passed;
- Chromium: 157/157;
- coverage visual Playwright: 4/4; fresh independent Opus critical review: 6/6,
  report `visual-review-2026-08-25T07-27-22Z.json`;
- unsigned macOS arm64 and Ubuntu x64 packaging passed, including native
  `better-sqlite3` rebuilds;
- exact production path on Ubuntu: 959,988/959,988 delivered, 2,233.531 ms
  first useful, 5,677.181 ms complete, 24.426 ms main gap at 960k; and
  1,999,988/1,999,988 delivered, 4,472.030 ms first useful, 11,774.783 ms
  complete, 30.982 ms main gap at 2M. Both claims were correctly blocked only
  by the fixture's intentional `backfill_incomplete` marker.

Final production report SHA-256 values on the Ubuntu host are
`dd85cb1a4cc6c32c35dde8c6f4eabab11b87a5cc8dc1e0533dfe02e8262d5c83`
(960k) and
`9c5c3d09a773f101c9644a65d7fe3dd769ddd70919ce473612bb5b9554043cfd`
(2M). Normalized committed copies live under the matching `b9bad64...`
directory in `output/pr3-production-qualification/`; the checksum manifest
binds their repository bytes. The subsequent closeout commit changes only
this evidence record, handoff/workplan status, and those normalized reports;
it does not change the qualified production tree.

## Second exact-head review remediation

The fresh review wave on documentation-complete head `29f26f9` found six
renderer-attestation P1 classes that prior browser and Node qualification had
not exercised: a moved device could evict unchanged same-period siblings;
current empty spatial tiles were conflated with stale revisions; worker loss
could be forgotten on refresh; worker `error` and zero-code unexpected exits
could miss the failure boundary; an older in-flight claim could overwrite a
newer sequence revocation; and catalog/source replacement could remove the last
consistent geometry before the replacement was accepted.

The red run contained seven focused failures plus two mission-store staging
failures. Commit `7ec7a81` now:

- rebuilds a moved period from every current descriptor in that period;
- returns a valid empty PBF only for current empty tiles while retaining `null`
  exclusively for stale catalog identity;
- clears renderer delivery attestation on worker loss and requires full
  redelivery before Complete can return;
- reports all unexpected worker errors/exits once, fenced to their generation;
- compares a claim with the live observed sequence and pending-refresh state;
- stages worker catalogs until main-side build metadata commits, discarding a
  stale stage without changing the active catalog;
- installs digest replacements alongside the prior MapLibre source, verifies
  them, and only then removes the predecessor; intermediate recovery catalogs
  retain prior periods until the final cumulative catalog is active.

Focused remediation verification passed 5 files / 35 tests, the broader
coverage/persistence set passed 31 files / 222 tests, lint, TypeScript, changed
CommonJS syntax checks, and focused Chromium coverage 3/3.

The real production path at exact pushed code head
`7ec7a811ca8ad36870106845fc2045c278688ec2` then passed:

| Fixture | Delivered | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,228.222 ms | 5,726.375 ms | 21.849 ms | Correctly blocked only by `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,490.273 ms | 11,930.724 ms | 21.796 ms | Correctly blocked only by `backfill_incomplete` |

Host-report SHA-256 values are
`dfeeccb6776063167ce0d9dba4d48ca6260000faa0a2a4d1295e104cffbffbfb`
(960k) and
`c057cf9de1871cb42851d0e1f29cbbb946fd1ed9a54f3224f289a7bf9b45266c`
(2M). Normalized repository copies and their own checksums are under
`output/pr3-production-qualification/7ec7a811ca8ad36870106845fc2045c278688ec2/`.
Full final-head software, browser, visual, and package gates were repeated on
the documentation-complete branch after this evidence was bound: 257 unit-test
files / 2,007 tests, lint, TypeScript, every changed CommonJS file, exact Dots
10/10, production build, Chromium 157/157, coverage visual 4/4, fresh uncached
Opus critical review 6/6, and macOS arm64 plus Ubuntu X11 x64 Electron package
builds all passed. The five newly restarted exact-head reviews are the only
remaining pre-PR gate; any production-code remediation invalidates this posture
and restarts the relevant verification and all five reviews.

## Third exact-head review remediation and rebound evidence

Review of documentation-complete head `1872e76` found three related gaps in
the renderer/worker handoff plus two independent safety-posture gaps: the
worker could retire a predecessor catalog before replacement tiles actually
loaded; the G2 prototype still used a remove/recreate source strategy rather
than production's staged unique source; a failed worker commit left its stage
poisoned; renderer-held rejection evidence did not synchronously revoke
completeness; and coverage could start while its required mission model was
explicitly disabled. Persistence review independently reproduced the same
catalog handoff window.

Every condition was red before production changes. Exact remediation code head
`5653133d5ff8429a6f3530cd05058969b2cd564c` now:

- keeps predecessor geometry and worker indexes serviceable while the unique
  replacement source loads, then crosses an opaque activation-token fence
  before retiring them;
- includes that activation token in renderer acknowledgement identity so an
  obsolete identical catalog cannot acknowledge a newer stage;
- clears a failed worker stage so retry is possible without losing the active
  catalog;
- marks renderer-held rejected-position evidence degraded in the same turn,
  without downgrading an existing stronger evidence failure;
- starts complete coverage only when both coverage and mission-model flags are
  enabled; and
- brings the G2 Candidate-B harness onto the same staged-source/generation
  contract and permits a bounded affected-row rerun.

Focused remediation passed 13 files / 89 tests before the final additions;
the complete unit suite passed 259 files / 2,019 tests. Lint, TypeScript,
changed JavaScript syntax, the benchmark renderer build, and focused Chromium
coverage/evidence flows 6/6 passed. The visible pending-evidence wording and
operator manual now say evidence is waiting to be saved rather than falsely
calling the transient state a storage-repair failure.

The invalidated Candidate-B G2 rows were rerun as six serial packaged runs plus
two kill probes on the reference Ubuntu X11 host. Both rows passed unchanged
budgets: 960k worst-warm first-useful/complete/filter/main values were
1,981/4,248/71/42 ms with 0.27 GiB settled/peak; 2M values were
3,632/7,669/121/52 ms with 0.28 GiB settled/peak. The exact decision binding
and checksums are in `docs/breadcrumb-coverage-renderer-decision.md` and
`output/g2-coverage-renderer/5653133d5ff8429a6f3530cd05058969b2cd564c/`.

The real production worker/store path then crossed the staged tile read,
activation, and active tile read for every progressive period:

| Fixture | Delivered | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,217.457 ms | 5,774.273 ms | 18.338 ms | Correctly blocked only by `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,434.501 ms | 11,888.203 ms | 24.811 ms | Correctly blocked only by `backfill_incomplete` |

Report SHA-256 values are
`f26d215bfae7d77bf9a49262b1752c3bc3f16a975a43bb24eaa7460f4a586d99`
and
`5bba6d734f7374cac83e4298e9640e83854c81a9f200991a1433b53b78cf3edc`.
The reports, auditable qualification driver, and checksum manifest are under
`output/pr3-production-qualification/5653133d5ff8429a6f3530cd05058969b2cd564c/`.
The checksum-manifest SHA-256 is
`6001557e61e0a3f0eefc93c06c993f58046fa8461109dde8bcc3d45619deef7a`.

The single rebound packaged CI-scale tracking soak passed on explicit X11 with
Mesa llvmpipe via ANGLE/OpenGL: 6/6 batches, 8,664/8,664 exact positions, one
restart, both launches exit 0, zero renderer crashes, integrity `ok`, WAL
0/0/0, main maximum 7.924 ms, renderer maximum 100.4 ms, all four operator
interactions healthy, 1,204,539,392-byte peak process-tree RSS, and zero
redundant telemetry slope. The post-run coverage ledger held one mission at
change sequence 12, 32 chunks, zero invalidations, and 28,672 bytes across all
coverage tables/indexes. Report SHA-256 is
`627a87d072bdc83d1cdb66b1c136b81df469bda590dd065fa95134a7a960c2b7`;
the full binding is under
`output/pr3-packaged-soak/5653133d5ff8429a6f3530cd05058969b2cd564c/`.
The checksum-manifest SHA-256 is
`06888eb9c3d4bbae11e99a6d78fdfa254ba6ec272143889ad62eb891b45d9a49`.

One complete workload attempt is retained there as an excluded environment
failure: forcing `XDG_SESSION_TYPE=wayland` made Electron select the Intel
backend, so the fail-closed llvmpipe attestation rejected it despite healthy
application metrics. An explicit X11 probe attested llvmpipe before the
accepted rerun. No product result is claimed from the excluded attempt.

The 3.704 GB v9 to v10 migration remains standing because this remediation
changes neither schema nor migration/open code. Final documentation-head gates
and all five independent exact-head reviews still must restart from scratch.

## Rebound documentation-head gate

The rebound evidence-binding head
`c41f1e1d8da385ca7cc12a1dad0fe1746c5473e9` passed:

- 259 unit files / 2,019 tests;
- ESLint, TypeScript build mode, and syntax checking for every changed
  JavaScript/CommonJS/ESM file;
- the source-exact paged Dots contract, 10/10 including all eight injected
  corruption falsifiers;
- the production build and bundle budgets;
- Chromium 157/157;
- the selected coverage visual workflow 4/4 and a fresh no-cache critical
  visual review 6/6, report
  `test-results/visual-verification/reports/visual-review-2026-08-25T09-26-11Z.json`;
- macOS arm64 directory packaging, with `app.asar` SHA-256
  `a4b20844f328695d75704890647fee7b4606b9fe0a5fb7638e8770337c18eecd`;
  and
- Ubuntu x64 directory packaging from the same exact commit, with `app.asar`
  SHA-256
  `78719be2758b4f3b3726b3ac1b491e877dbe65df43392d959ce23aba664a8afd`.

The closeout files containing this record are documentation-only. Their commit
must receive one final exact-head repeat of these gates before the five
independent reviews start; no further evidence-heavy rerun is prescribed.

During that repeat, a fresh visual reviewer correctly rejected one checklist
item because an element-scoped screenshot could not show surrounding current-
tracking UI. The product assertions remained green and live-marker independence
already has its own full-page critical screenshot. The visual prompt was fixed
red-first by removing only the out-of-frame request, then the same element was
recaptured and passed a fresh no-cache critical review. The resulting test and
closeout commit must receive the complete exact-head repeat before review.

## Third-review remediation and exact-head rebound

Three independent reviews of `472826d0589f00eabe1f61d2db78f1b1edc56c94`
found five additional lifecycle and evidence-completeness blockers. Each was
reproduced by a deterministic failing test before production code changed. The
bounded remediation at
`38ec709b1b59801e45d2e867ba9e3443065ab104` now:

- keeps staged tile catalogs sender-owned until activation or discard, and
  cancels/discards them if their renderer is destroyed;
- prevents obsolete mission/controller activations from committing or
  rejecting the replacement renderer;
- cancels an in-progress catalog build without terminating the long-lived tile
  worker that serves the already active catalog;
- consults renderer-held rejection evidence synchronously at the final
  Complete decision; and
- aggregates pending rejection evidence across missions so one mission's
  acknowledgement cannot clear another mission's warning.

The direct regression set passed 6 files / 48 tests; the wider coverage set
passed 29 files / 156 tests; and the complete unit suite passed 259 files /
2,026 tests. ESLint, TypeScript build mode, changed CommonJS syntax, production
build/bundle budgets, and the focused coverage/ingest Chromium flows 6/6 also
passed before this evidence rebound.

Candidate B's renderer and worker algorithms did not change, so the ratified G2
rows at `5653133d5ff8429a6f3530cd05058969b2cd564c` remain standing under the
accepted standing-result rule. Schema, migration, and database-open code also
did not change, so the single 3.704 GB v9→v10 migration proof remains standing.

The real production worker/store qualification was rerun serially on the
reference Ubuntu host against exact head `38ec709b...`:

| Fixture | Delivered | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,243.512 ms | 5,794.324 ms | 20.197 ms | Correctly blocked only by `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,496.563 ms | 12,126.203 ms | 21.616 ms | Correctly blocked only by `backfill_incomplete` |

Report SHA-256 values are
`d30c734a777f4b6574e0c47ed0a92b2061a387208b8ebdb12f4de450eefe5e73`
and
`6436891efad01f8ea4af340a4bc28335d8cbfb176e202f9c4f76a0dfd5bb6291`.
The driver, reports, and verified manifest are under
`output/pr3-production-qualification/38ec709b1b59801e45d2e867ba9e3443065ab104/`;
the manifest SHA-256 is
`6ccef85e88d8db65c1d9025f0e0ef59663b643a999bb10bce980f706e8e7e2ed`.

The one replacement packaged CI-scale tracking soak then passed with Xwayland
driven explicitly through X11 and Mesa llvmpipe via ANGLE/OpenGL: 6/6 batches,
8,664/8,664 exact positions, one restart, both launches exit 0, zero renderer
crashes, integrity `ok`, WAL 0/0/0, main maximum 15.525 ms, renderer maximum
83.6 ms, all four operator interactions healthy, 1,104,687,104-byte peak
process-tree RSS, and zero redundant telemetry slope. The post-run coverage
ledger held one mission at change sequence 12, 32 chunks, zero invalidations,
and 20,480 bytes across coverage tables/indexes. The report SHA-256 is
`d58e41cdd6d3b3f30348e150b4a2a061253355c3be04ddc7be7ab95af4bb7ca3`;
the packaged executable and `app.asar` SHA-256 values are
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and
`8d37cf1da84559a5bbcc4ba00105988bd4cb3b09c028a03e8698b3cebd8f3ca4`.
The full binding is under
`output/pr3-packaged-soak/38ec709b1b59801e45d2e867ba9e3443065ab104/`;
the manifest SHA-256 is
`844a20dcb48f950417ad3902ba47073b9c7eb049746d66f678b6bc3e95b77f24`.

The first packaged launch attempt is retained as an excluded environment
failure. The SSH process had `DISPLAY=:0` but not the active session's
`XAUTHORITY`, so X11 rejected the connection before application startup. No
product result is claimed from it. Reading the existing user-session environment
identified the current Xwayland authority file; a direct `glxinfo` probe then
attested llvmpipe, and the single justified rerun passed with that authority
propagated while `XDG_SESSION_TYPE` remained unset. The retained failure report,
launch log, and checksums are included in the packaged-soak manifest.

The evidence files added by this section are documentation-only. Their binding
commit must receive the complete deterministic, Chromium/visual, and packaging
gates on its exact head before all five independent reviews restart.

## Final two-phase handoff remediation and rebound

The next exact-head review of `33f308b6b1c8157d3567acced1884f55425a142e`
found eight remaining production/evidence gaps. Red-first tests reproduced each
one before commit `17e75f2eb6ed0b37c382d9f0e2dae1ca24b42e53`:

- a basemap style change removed coverage sources and the controller rolled the
  already-active catalog back instead of reattaching it;
- backend commit retired the predecessor before renderer finalization, so a
  superseded activation could leave no serviceable catalog;
- the production worker serialized retained tile reads behind long builds and
  reused stage numbers after restart;
- delayed startup health and a healthy acknowledgement for another mission
  could erase newer or stronger evidence health;
- renderer evidence blockers rendered as generic partial progress, including a
  possible full `N of N` bar and an irrelevant coverage Retry; and
- the prior qualification driver was a copied artifact that did not self-attest
  its checkout or cross staged-read, activation, and active-read boundaries.

The remediation adds a sender-owned commit/finalize/discard IPC lifecycle,
keeps backend and MapLibre predecessors reversible until both sides finalize,
serves retained reads outside the worker mutation queue, gives every worker
generation nonrepeating UUID stage tokens, aggregates durable health by mission,
routes startup health through that aggregate, and renders an explicit anomaly-
evidence wait without false progress. The repository now contains the exact
self-attesting production qualification driver under `scripts/`.

Before the evidence rebound, the focused unit set passed 86/86, the complete
single-worker suite passed 260 files / 2,035 tests, lint, TypeScript, changed
CommonJS syntax, exact Dots 10/10, build/budgets, focused Chromium coverage 4/4,
and the new critical visual plus fresh independent review passed. The normal
parallel unit invocation twice tripped only the pre-existing 500k breadcrumb
accumulator timing assertion under suite contention (149–199 ms against its
100 ms assertion); that test passed alone and the complete serial suite passed.

Because worker scheduling and predecessor lifetime changed, Candidate B's two
G2 rows were rerun as six serial packaged runs plus both kill/resume probes.
Both remain PASS without amendment; the exact table and manifest bindings are
in `docs/breadcrumb-coverage-renderer-decision.md` and
`output/g2-coverage-renderer/17e75f2eb6ed0b37c382d9f0e2dae1ca24b42e53/`.

The committed production driver then passed serially on the reference Ubuntu
host using the real mission store and production tile worker:

| Fixture | Delivered | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,316.874 ms | 6,077.146 ms | 15.884 ms | Correctly blocked only by `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,526.614 ms | 12,083.911 ms | 23.219 ms | Correctly blocked only by `backfill_incomplete` |

Report SHA-256 values are
`382b98c8511c3cfeb00c3e589021265525135e61259fa4a9c8a15e91feae19ca`
and
`af8bcc6d205b098d0c289473e2416f9ca5af53a778221389381600554f910acb`.
The driver, reports, and locally verified manifest are under
`output/pr3-production-qualification/17e75f2eb6ed0b37c382d9f0e2dae1ca24b42e53/`;
the manifest SHA-256 is
`003794aff393f8f7d7b7e906b530c2cd566e97f2b7f6934aa7ba6d0548c74eed`.

The single replacement packaged CI-scale soak passed on X11 with Mesa llvmpipe
via ANGLE/OpenGL: 6/6 batches, 8,664/8,664 source-exact positions, one restart,
both launches exit 0, zero renderer crashes, integrity `ok`, WAL 0/0/0, main
maximum 9.099 ms, renderer maximum 100.3 ms, four healthy operator interactions,
1,116,405,760-byte peak process-tree RSS, and zero redundant telemetry slope.
The post-run coverage ledger held one mission at change sequence 12, 32 chunks,
zero invalidations, and 32,768 bytes across coverage tables/indexes. The report
SHA-256 is
`772d64af61160e906281fc5f4b3cbfeb12123de0fcffa789f6442cc2d9f1ca02`;
the packaged executable and `app.asar` SHA-256 values are
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and
`9e1bab92dc65ba80af3987110c7b2653eee0d3a3b676f4eaf495dd7fbf0e9358`.
The full binding is under
`output/pr3-packaged-soak/17e75f2eb6ed0b37c382d9f0e2dae1ca24b42e53/`;
the manifest SHA-256 is
`ca80c2a993f84dd6000dc961d0965bdcfb52bc294f4b30131163052aff1bbfb7`.

The 3.704 GB v9→v10 migration remains standing because this remediation changes
neither schema nor migration/database-open code. The evidence-binding commit is
documentation-only; it still requires complete exact-head deterministic,
Chromium/visual, macOS/Ubuntu package gates and five independent reviews from
scratch before the PR opens.

## Mission-scoped renderer lifetime remediation and final rebound

The first exact-head review wave at `14d26009e8619448d3abf6f7e101b6c01fd9a080`
found four release-blocking lifetime gaps. A previous mission could reuse an
equal-revision MapLibre source and tile request; a cancelled staged catalog
could remain renderer-attachable; Complete could survive removal of its style
sources; and a tile timeout terminated the shared worker without a global
failure signal. Red-first remediation commit
`53e38bf3b88e44f3be677e0ac260548f63f9ff9e` adds mission-scoped source, URL,
worker-read, catalog-signature, and failure identities; tracks only finalized
catalogs as attachable; suspends Complete during style loss; and reports a
timeout as worker loss. An adjacent red-first Cancel gate also proves that
operator cancellation preserves the finalized worker/catalog and clears the
race where cancellation arrives after stage completion but before response.

Before scale work, focused coverage/worker/store tests passed 66/66; the full
single-worker suite passed 260 files / 2,045 tests; and lint, TypeScript,
changed CommonJS syntax, source diff, exact Dots 10/10, and build/budgets
passed. Focused Chromium coverage passed 4/4, including basemap-style
reattachment. Coverage visual E2E passed 5/5 and the fresh independent critical
review passed 7/7; report:
`test-results/visual-verification/reports/visual-review-2026-08-25T12-01-08Z.json`.

Because the renderer and worker lifetime changed, Candidate B's six affected
960k/2M rows and both kill/resume probes reran serially on the reference Ubuntu
host. Both fixtures remain PASS with unchanged budgets; the table and exact
manifest checksums are in `docs/breadcrumb-coverage-renderer-decision.md`. The
locally verified G2 evidence is under
`output/g2-coverage-renderer/53e38bf3b88e44f3be677e0ac260548f63f9ff9e/`;
its manifest SHA-256 is
`9989126b7010f032d6c14204206315729ac7b27fd5cc8491349a8c64fabc45fd`.

The self-attesting production driver then crossed staged read, backend
activation, active read, and finalization for both exact fixtures:

| Fixture | Delivered | First useful | Complete geometry | Main max gap | Claim posture |
| --- | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,281.899 ms | 5,944.132 ms | 21.659 ms | Correctly blocked only by `backfill_incomplete` |
| 2M | 1,999,988 / 1,999,988 | 4,540.310 ms | 12,138.821 ms | 20.170 ms | Correctly blocked only by `backfill_incomplete` |

Report SHA-256 values are
`732b2404a11ea5dfa5b220e3db9b50ff5d5126ed039aebb745723309a767a32b`
and
`50d706575f93d42dca698d56af89f71b3e5c1f917a39d4f181f64cea3afe56a5`.
The byte-identical driver, reports, and verified manifest are under
`output/pr3-production-qualification/53e38bf3b88e44f3be677e0ac260548f63f9ff9e/`;
the manifest SHA-256 is
`4fb6b6eae8af4a67a0c3b6026915279fd134546cdf97125e3810b4f704dc2fe7`.

The single allowed replacement packaged CI-scale soak passed at the same code
head using X11, Mesa llvmpipe via ANGLE/OpenGL: 6/6 batches, 8,664/8,664
source-exact positions, one restart, both launches exit 0, zero renderer
crashes, integrity `ok`, WAL 0/0/0, four healthy operator interactions, main
maximum 13.889 ms, renderer maximum 167.2 ms, 1,122,676,736-byte peak
process-tree RSS, and zero redundant telemetry slope. The post-run ledger held
one mission at change sequence 12, 32 chunks, zero invalidations, and 32,768
bytes across coverage tables/indexes. The report SHA-256 is
`4d109dbbcbed5a803d6829af2cdb21808ccc4a38a2492f7f86dfa951e5269c8c`;
the packaged executable and `app.asar` SHA-256 values are
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and
`e531751121e737428c81990cb7134227c4d06e3bfc2cc87a801a4b5d91a04658`.
The full binding is under
`output/pr3-packaged-soak/53e38bf3b88e44f3be677e0ac260548f63f9ff9e/`;
the manifest SHA-256 is
`8964b2ed537f46707b2af790097702613d94eadd6f3da10b90321bb4c2db83b5`.

The 3.704 GB v9→v10 migration remains standing because this remediation changes
neither schema nor migration/database-open code. The evidence-binding commit is
documentation-only; it receives final deterministic, full Chromium, coverage
visual, macOS/Ubuntu package, and five exact-head review gates before the PR
opens.

## Final review-wave lifetime and geometry-attestation remediation

Three fresh reviews of `8c2887126be177418f534d72fe4a1963132fd486`
found five runtime gaps and one evidence gap. Production had not forwarded the
outer abort signal to the cooperative tile runner; an obsolete catalog could
become the finalized fallback after a mission switch during backend
finalization; a surviving source with a missing layer could restore Complete;
reattachment could erase a worker-loss error; and the detached-style panel
claimed loaded coverage remained visible with a full progress bar. The
production qualification driver also read only the first period and accepted a
valid-empty tile while calling the result complete geometry.

The red pass failed seven focused assertions before production changes.
`37ea0b437e08d9fbb13be43d39a63d7a0ed7e443` forwards cancellation, fences
post-finalization ownership, rebuilds any incomplete source/layer structure,
prevents error restoration, and gives detached coverage its own no-progress,
no-Retry operator state. The manual and a new critical screenshot cover that
visible state. Focused green passed 49/49 and the new visual entry passed a
fresh critical review. The full serial suite then passed 260 files / 2,051
tests; lint, TypeScript, CommonJS syntax, exact Dots 10/10, and build/budgets
passed. Ubuntu full Chromium passed 158/158, the coverage visual suite passed
6/6, and its fresh critical review passed 8/8; report:
`test-results/visual-verification/reports/visual-review-2026-08-25T13-07-39Z.json`.

The driver's first corrected Ubuntu attempt deliberately rejected an empty
world-zoom tile; that failure is not product evidence. Tiny routes can validly
simplify out at zoom 0, so a second red-first contract required a bounded tile
address derived from each period's exact positions. Script-only commit
`df61a02b05bbfb0e90bac5add2cd2b53d33aac31` now probes every newly introduced
period, requires non-empty decodable PBF geometry at the same address before
and after activation, and binds per-period plus aggregate geometry/revision
digests. A 4,800-fix local smoke passed before the serial reference-host runs:

| Fixture | Delivered | First useful | Complete geometry | Main max gap | Decoded period evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| 960k | 959,988 / 959,988 | 2,245.260 ms | 6,212.296 ms | 21.026 ms | 13/13 periods, 1,420 decoded features |
| 2M | 1,999,988 / 1,999,988 | 4,534.087 ms | 12,338.402 ms | 21.825 ms | 13/13 periods, 1,382 decoded features |

Both claims were correctly blocked only by `backfill_incomplete`. The 960k
geometry/revision SHA-256 values are
`d8133bc9ba7b2858020dc0f1b980893ffb71b78d51901707ac0d4e5e72377372` /
`6736d423aa7eaae916c6da281babc9360d4344bd42fe3279ec989ee9be579f04`;
the 2M values are
`a789fb3e4cc3293d30019c4f21165d90d77f193e8c1069a9d35a920325db2b89` /
the same revision digest. Report SHA-256 values are
`f09886dbe2d378f317b975a3f9afe31d144f2099c629624a7132ece5439d1b25`
and
`849925cc0416434af95214490533fc9d6f46d3883c8dd5acd4a9a3a577bfaa60`.
The byte-identical driver, reports, and verified manifest are under
`output/pr3-production-qualification/df61a02b05bbfb0e90bac5add2cd2b53d33aac31/`;
the manifest SHA-256 is
`59dca7faad10d6283b74ad37b9d7c060225b2f6731a048cb494ced3f5e11702b`.

The ratified G2 matrix at `53e38bf...` remains standing under the accepted
invalidation rule: these changes do not alter Candidate B's measured query,
segmentation, normal tile/source strategy, or geometry pipeline. The single
packaged soak also remains standing because no ingest/write path changed. The
3.704 GB migration remains standing because schema and database-open code are
unchanged. The evidence-binding commit still requires exact-head deterministic,
Chromium/visual, macOS/Ubuntu package, and five independent review gates.

## Final exact-head gate after filter and renderer attestation remediation

The final review wave found that destroyed renderer senders could leave tile
reads alive, tile files were published without an atomic temporary-file
boundary, and controller completion did not attest that the requested history
filter was actually applied to the map. Adjacent red-first regressions also
found repeated settled acknowledgements publishing an unbounded sync loop and
mission clearing attempting an obsolete filter mutation before removing old
geometry. Commits `a75db73` through `e72e188` remediate those production paths;
commits `1a93bef` and `4b740f2` make the deliberate two-by-four-second manifest
delay deterministic without weakening any behavior assertion.

Exact production/test head
`4b740f269a6ecfde2f3a35f760b7c42908403162` passed on the Ubuntu X11 reference
host:

- full serial unit: 262 files / 2,095 tests;
- ESLint with zero warnings, TypeScript, and changed Electron CommonJS syntax;
- exact paged Dots contract: 10/10;
- production build and bundle budgets;
- full Chromium: 158/158, including the delayed-manifest honesty regression;
- coverage visual: 7/7 operator workflows and nine screenshots; and
- fresh no-cache independent critical visual review: 9/9, zero failures or
  reviewer errors. The rebound report is
  `tmp/exact-head-visual-4b740f2/reports/visual-review-2026-08-25T19-16-33Z.json`.

Operator-visible/package head
`fea89db9399d0e5ec79e44c7655d590cca175687` adds only the tested manual wording
and exact `coverage-filter-application-pending` screenshot. Its manual contract
passed, then both unsigned packages completed:

| Platform | Executable SHA-256 | `app.asar` SHA-256 |
| --- | --- | --- |
| Ubuntu x64 | `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8` | `a04e7eea07965e23a808a4bf6a5e2d1617b01c0f5319b077211f4552d3dcbc7d` |
| macOS arm64 | `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf` | `9528d3d527b93ea3f878864a5c43146a7fa533dfe311c2790e7457e9e245e168` |

Two evidence-infrastructure attempts were rejected and not counted as product
passes: the first copied visual manifests still named Ubuntu screenshot paths,
and the first Ubuntu package attempt used a symlinked `node_modules` tree that
Electron's dependency collector could not parse. Rebinding the copied
manifests produced the 9/9 no-cache review above; a fresh locked Ubuntu
dependency install produced the successful package above.

The corrected `df61a02` 960k/2M production qualification remains standing
because the final fixes do not change its measured query, segmentation, or
geometry pipeline. The `53e38bf` G2 rows and kill probes remain standing under
the same explicit rule. The single packaged CI soak remains standing because
no ingest/write path changed, and the 3.704 GB v9→v10 migration remains standing
because schema and database-open code are unchanged. No packaged 960k/2M
coverage run, packaged forced-kill matrix, Windows run, field-hardware run, or
coordinator-owned post-merge Ubuntu 960k checkpoint was performed. Five fresh
independent exact-head reviews still gate PR creation.

## Accepted-write outing lookup remediation

Exact-head safety review #1 at `ec0f339` found one remaining breach of the
accepted no-mission-sized-main-isolate boundary: every accepted position
transaction synchronously read and sorted every outing for the mission. The
red regression observed that full-list SQL instead of the required point
lookup. Commit `add5639ce688caa671109aa5593cb2e789e900f6` replaced the list
read with an indexed query, but all three restarted reviewers rejected it: the
residual `ended_at` predicate still made a late Outside-outings fix walk every
closed predecessor. That attempt and its soak are retained as rejected
evidence, not final proof. Commit
`40a713cdee9e8f1efe0f33f81ba48d478aeabfda` now fetches only the latest
`mission_id + started_at` predecessor through `idx_outings_mission_started`,
then applies that single row's half-open end boundary in memory. Non-overlap
guarantees no earlier outing can contain the fix. The durable test asserts the
bounded SQL shape, exact Outing/Outside-outings identities, and SQLite query
plan.

Exact `40a713c` gates passed on the Ubuntu reference host:

- focused ledger/store integration: 4 files / 98 tests;
- full serial unit: 262 files / 2,096 tests;
- ESLint with zero warnings, TypeScript, changed CommonJS syntax, exact Dots
  10/10, production build, and bundle budgets;
- unsigned Ubuntu x64 and macOS arm64 packaging.

Full Chromium passed 158/158 at parent `add5639`; `40a713c` changes only the
Electron ledger query and its exact unit assertion, so no browser production
byte changed after that gate.

Because this remediation changes the ingest hot path, the previous packaged
soak was not carried forward. The single replacement CI-scale soak ran on the
active Ubuntu desktop through Xwayland with Mesa llvmpipe attested via
ANGLE/OpenGL and passed: 6/6 batches, 8,664/8,664 source-exact positions, one
restart, both launches exit 0, zero renderer crashes, integrity `ok`, WAL
0/0/0, zero redundant telemetry slope, four healthy operator interactions,
20.482 ms main-process maximum, 83.6 ms renderer maximum, and
1,091,911,680-byte peak process-tree RSS. The post-run ledger held one mission
at change sequence 12, 32 chunks, zero pending invalidations, and 24,576 bytes
across coverage tables/indexes.

The report SHA-256 is
`3eb50979380867a8aaff15080e80ac90711d4963b27e0ea74db0457aa0181c01`;
the Ubuntu executable and `app.asar` SHA-256 values are
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and
`3bc9283722d1161189bac2fea5e222eb7a040e213a55265205f5d605a0824d40`.
The macOS arm64 executable and `app.asar` values are
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and
`913b375057387a2453a929f2fa0f3c415273fdffde8490b8fa8d08c51651185e`.
The committed Ubuntu evidence is under
`output/pr3-packaged-soak/40a713cdee9e8f1efe0f33f81ba48d478aeabfda/`;
its evidence-manifest SHA-256 is
`7eedc8a73fb1d9f9886177678980c4c1c51a9e3bcb0946d2afb1b74bfa98780c`.

No new coverage visual was billed because `40a713c` changes only the Electron
ledger SQL and its unit test; the exact UI/renderer tree and its 7/7 workflows
plus 9/9 no-cache critical review remain byte-identical to `4b740f2`. G2 and the
decoded 960k/2M production qualification remain standing because this lookup
does not change the Candidate-B renderer/query/segmentation/geometry pipeline.
The 3.704 GB migration remains standing because schema and database-open code
are unchanged. Five fresh independent reviews of the new evidence-bound exact
head still gate PR creation.

## Direct-device backfill and open-outing cooldown remediation

Independent review #4 at evidence head `9ce75c4` found two false-safety
boundaries. Initial direct-device selections did not receive the same fixed
mission-start-to-selection backfill checkpoint as initial group members, so a
backdated mission could claim database completeness and finish without that
device's history. The open-outing scheduler also appended cooling chunks after
ready work, which reordered them but did not enforce the accepted at-most-once
per-30-second automatic rebuild cadence. Review #5 separately found the
canonical workplan still described PR-2 as active.

Both behavior gaps were reproduced red-first. The direct-device regression
observed no checkpoint; the coverage claim and finish fence therefore had no
incomplete truth to see. The scheduler regression observed the just-attempted
open chunk returned immediately. Commit `6e10acf` creates the direct checkpoint
inside the initial-selection transaction and excludes cooling open chunks from
automatic work. The first full Chromium run then caught a real interaction:
operator Retry was also suppressed by the cooldown and remained at 6 of 9
fixes. That failed gate was not treated as a flake. Commit `691775a` gives only
explicit operator `resume()`/Retry a cooldown bypass; notifications and other
automatic refreshes remain throttled. Focused coverage Chromium then passed
4/4, including honest decrease, partial retention, Retry, and reload delivery
reset.

The new direct-device audit lifecycle caused the first replacement packaged
soak at `691775a` to fail closed at 40/38 operational events: two required
`participant_backfill_completed` audit events were still classified as
unexplained. Commit `69a1096bd950270686c8e200da4311a1ab1fb1f5` moves mission
event classification into a tested pure helper, explicitly declares that audit
type, and increases the event budget only by its observed count. The durable
regression passed red-to-green, the exact source-contract test follows the
classifier boundary, and no telemetry event allowance was widened.

Deterministic gates at final code/tool head `69a1096` passed:

- focused affected surface: 6 files / 147 tests;
- full serial unit: 262 files / 2,101 tests;
- ESLint with zero warnings, TypeScript, changed CommonJS/ESM syntax, exact
  Dots 10/10, production build, and bundle budgets;
- coverage Chromium 4/4 after the Retry correction;
- full Chromium 158/158 on the same final application bytes;
- coverage visual 7/7 and fresh no-cache independent critical review 9/9; and
- unsigned Ubuntu x64 and macOS arm64 packaging.

The final replacement Ubuntu CI-scale soak ran through the active Xwayland
desktop with Mesa llvmpipe attested by ANGLE/OpenGL and passed: 6/6 batches,
8,664/8,664 source-exact positions, one restart, both launches exit 0, zero
renderer crashes, integrity `ok`, WAL 0/0/0, zero redundant telemetry slope,
four healthy operator interactions, 9.558 ms main-process maximum, 83.6 ms
renderer maximum, and 1,129,574,400-byte peak process-tree RSS. Its audited
mission events include two backfill completions, with 40 declared operational
events and zero unexplained events. The post-run coverage ledger held one
mission at change sequence 76, 32 chunks, zero pending invalidations, and
28,672 bytes across coverage tables/indexes.

The report SHA-256 is
`1522109848a019ae5f6030e371d4bb480ac722d4cb36cb2ec8d6cb0fd7d31aeb`.
The Ubuntu executable and `app.asar` SHA-256 values are
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and
`924d8fa360945b127e2b587ece89d688cafa1fc1c328d98054cb4446dcbdc6e9`.
The macOS arm64 executable and `app.asar` values are
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and
`eb5bf790c15f44c424b5f131c872e9c17b417d9bf3ffc6c46ac339ecbd8ead38`.
The committed Ubuntu evidence is under
`output/pr3-packaged-soak/69a1096bd950270686c8e200da4311a1ab1fb1f5/`;
its evidence-manifest SHA-256 is
`04cd7f8d163c74d1dd1a1f66613d2c43e79d64a25a8eb8db6f2c88171bbef90a`.

G2, the corrected decoded 960k/2M production qualification, and the 3.704 GB
v9-to-v10 migration remain standing under their existing invalidation rules:
these remediations change initial participant checkpoint creation, scheduling,
and soak evidence classification, not the selected Candidate-B geometry/query
pipeline or schema/open path. There was no packaged 960k/2M coverage run,
packaged forced-kill matrix, Windows run, field-hardware run, or
coordinator-owned post-merge Ubuntu 960k checkpoint. Five fresh independent
reviews of the final evidence-bound head still gate PR creation.

## Final browser-proof and benchmark-teardown remediation

Independent reviews #3 and #5 at `e4ccd98` found that the browser validation
mirror still omitted the fixed mission-start-to-selection checkpoint for an
initial direct device, even though Electron production code was already
correct. That mismatch could let a browser coverage claim or finish-flow proof
pass without exercising the production backfill prerequisite. The red-first
unit regression observed a direct participant with no pending status, a ready
coverage claim, and a successful finish. Focused Chromium then exposed three
coverage-only scenarios that had implicitly relied on the missing checkpoint;
their fixture now completes the worker-owned prerequisite explicitly rather
than weakening the production fence.

Reviews #4 and #5 independently matched the reported packaged macOS
`TypeError: Object has been destroyed` to the G2 benchmark's renderer teardown.
Its 50 ms RSS probe could outlive the BrowserWindow, and worker-event delivery
could race the same destroyed `webContents`. The new lifecycle regression was
red because no destruction-safe boundary existed. Commit
`928158c923e970063adcd98b11ed01c41313b1d3` adds one tested lifecycle module,
stops the probe and clears the window on `closed`/`destroyed`, safely drops only
destroyed-object RSS/event races, and makes this benchmark-only app quit when
its final window closes. The bounded benchmark package rebuilt successfully on
macOS; its executable and `app.asar` SHA-256 values are
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and
`0b8d149fe0db1aa40ef57956d2961a0de90ec1318e0b07ae124a760d8e55e35f`.

Deterministic gates at exact remediation head `928158c` passed:

- focused lifecycle, benchmark-contract, and browser-mirror units: 3 files /
  20 tests;
- full serial unit: 263 files / 2,104 tests;
- ESLint with zero warnings, TypeScript, Electron/benchmark CommonJS syntax,
  exact Dots 10/10, production build, and bundle budgets;
- focused participant/coverage Chromium: 10/10, then full Chromium 158/158;
- participant plus coverage visual: 11/11 workflows producing 13 captures;
- fresh no-cache independent critical visual review: 13/13, zero failures or
  reviewer errors; and
- exact-head unsigned Ubuntu x64 and macOS arm64 packaging.

Review #1 of the first `c594213` exact-head wave then found one operator-facing
P2: the shipped manual still said mission participant and outing controls were
disabled in normal packages even though G3 approved both defaults on. The
manual contract failed red on the missing default-on posture and stale internal
qualification wording. Commits `20db810` and `133cc147d2388725c240c322c2439ebca77af751`
now explain that builds containing PR-3 enable the mission model and complete
coverage by default, that there is no operator toggle, and that an explicit
build override exists only for controlled rollback. The source comment now
matches the approved default. The manual date and operator terminology were
also refreshed. Focused manual/default tests pass 3 files / 8 tests; the
manual-specific contract passes 1/1 after the final wording pass; ESLint,
TypeScript, production build, and bundle budgets pass.

The exact-head application package bindings after the manual correction are:

| Platform | Executable SHA-256 | `app.asar` SHA-256 |
| --- | --- | --- |
| Ubuntu x64 | `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8` | `bbb62eafb2436111dd508d5c7ebcd804858795ef130f6f2f880c8e2f8273ed21` |
| macOS arm64 | `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf` | `73296b60e6d0244c2d3e62f70d5e8ba3cb1f2cc2c14c54d2160227e3fe19d956` |

The final replacement soak at `69a1096` remains standing under the accepted
invalidation rule. This remediation changes only the opt-in browser proof
mirror and the separate benchmark harness lifecycle; it does not change the
packaged operational ingest, persistence, coverage worker/query/geometry,
Electron main-isolate hot path, or soak event classifier. A second packaged
soak would exceed the accepted single-final-soak boundary without testing a
changed operational path. The ratified `53e38bf` G2 rows, corrected 960k/2M
production qualification, and 3.704 GB v9-to-v10 migration likewise remain
standing. No packaged 960k/2M coverage run, packaged forced-kill matrix,
Windows run, field-hardware run, or coordinator-owned post-merge Ubuntu 960k
checkpoint was performed. Five fresh independent reviews of the new
evidence-bound exact head still gate PR creation.

## Independent review and pull-request binding

Five independent reviewers completed fresh read-only reviews of exact pushed
head `0455f41cd1a8877141fc64752a2c179c12a42cf1` against exact PR-2 base
`7021fc1ef33e6da5c91c96cd86e836fc3754f48f`. All five returned CLEAN with no
P1/P2 findings. Their focused proof covered persistence/schema/migration,
ledger/revisions/invalidation/backfill, worker/query/tile lifecycles,
main-isolate boundaries, current-position independence, participant-only
evidence, honest completion/progress, filters, G3 defaults and rollback,
exact Dots, browser proof parity, benchmark teardown, operator manual, and
evidence checksum bindings. One reviewer saw a browser reload-recovery timeout;
the case passed three isolated repetitions and the immediate complete 10-test
rerun, so no reproducible safety failure remained.

Pull request [#3](https://github.com/donal0c/sartracker-web/pull/3) targets
`master`. It is open for review only and was not merged or released by this
task. The subsequent handoff/readiness/PR-binding commit changes documentation
only; it does not alter the reviewed application, benchmark, migration, G2,
qualification, package, or soak bytes.

## External F1/F2/F3 invalidation and remediation

A later independent review superseded the five-review conclusion above. It
verified three blockers that the prior gates did not exercise:

- missing canonical inventory was inserted with `content_rev = built_rev = 1`
  even when its zero count/digest came from the manifest fallback rather than
  an evidence build, permitting a false fresh/Complete claim;
- renderer-owned tile payload fields were spread after the runner's
  `requestId` and `type`, so they could replace the worker control envelope;
  and
- `readCoverageTile` forwarded raw renderer coordinates, while `geojson-vt`
  coerced a traversal-shaped `x` for lookup and the cache path retained the raw
  string for file output.

The red-first run failed all four new assertions: the inserted ledger row had
`built_rev = 1`, the worker received renderer-owned `type`/`requestId`, the
mission-store accepted the traversal-shaped coordinate, and the real worker
returned a PBF instead of rejecting it. Commit
`259fd7434324731b2ec356e576fad231323f17ad` changes new inventory to
`built_rev = NULL`, makes the runner own its envelope, copies a validated tile
request at the main boundary, revalidates bounded integral `z/x/y` in the
worker, builds paths from those validated numbers, and asserts that final and
temporary paths remain under the owned cache root.

Green verification at that application head:

- focused ledger/store/runner/address regressions: 4 files / 42 tests;
- the mission-store integration case creates two real fixes plus canonical
  inventory with no ledger row and proves the claim remains blocked by
  `chunk_not_fresh`;
- full unit: 264 files / 2,110 tests;
- TypeScript, ESLint, production build, and bundle budgets; and
- focused participant/coverage Chromium: 10/10.

This remediation does not change schema/open code, the selected Candidate-B
geometry/index construction, the G2 A/B/C measurements, or the migration path,
so those bindings remain standing with their original proof limits. The prior
five-review result is invalidated. The live exact-head Linux package/soak check
and five fresh independent reviews are required before review readiness. No
merge or release occurred.

## Renewed-review follow-on remediation

The first renewed review did not uphold the initial F1 correction. Its live
Candidate-B reproduction showed that a new closed-outing row became pending
and then fresh, while the previously fresh Unassigned sibling retained the
same two fixes at its old revision. The final manifest and both non-empty tiles
therefore represented four fixes from two source rows and the claim returned
ready. The strengthened regression failed red with outing 2 / Unassigned 2.

The same review wave reproduced two adjacent trust/lifecycle defects. A failed
duplicate activation deleted IPC ownership while leaving the worker's
committed stage unsettled, blocking every later catalog sync. Separately,
`readCoverageChunk` spread renderer input after its main-owned `kind`, allowing
the chunk channel to execute another coverage worker operation.

Commit `31ba509c595d6cb1365a7c678cc775037fd08ced` closes all three:

- when canonical inventory grows, every existing sibling for that device gets
  a new `content_rev` and pending `built_rev` before missing rows are inserted;
- the post-build integration proof now requires the exact partition outing 2 /
  Unassigned 0 and a blocker-free claim only after both revisions build;
- worker activation is idempotent for the current stage and IPC retains
  ownership across a failed non-terminal activation so retry/finalize remains
  possible; and
- the main process validates and copies only permitted chunk-page fields, then
  writes its own `kind` last.

Green verification at this application head is 5 focused files / 51 tests,
264 full unit files / 2,112 tests, TypeScript, ESLint, production build and
bundle budgets, plus participant/coverage Chromium 10/10. The exact pushed-
head Linux package/soak check and five fresh independent reviews must restart;
the prior renewed-review results are superseded. No merge or release occurred.

## Terminal-settlement recovery remediation

The restarted review independently reproduced one remaining recovery defect.
When `finalizeCoverageTileCatalog` or `discardCoverageTileCatalog` rejected,
the IPC `finally` block released renderer ownership even though the worker
stage had not settled. The controller's same-renderer cleanup discard then
failed ownership validation, leaving the stage able to block later sync until
process restart.

The new regression failed red because ownership listeners were removed after
the rejected finalize and the cleanup discard never reached the mission store.
Commit `397b0c165d8f79be980f382a9ee28d1ad5da2c97` records a terminal transition as
settled only after its mission-store promise resolves. Rejected terminal and
non-terminal transitions retain ownership; a successful finalize or discard
releases it.

Green verification at this application head is 5 focused files / 52 tests,
264 full unit files / 2,113 tests, TypeScript, ESLint, changed CommonJS syntax,
production build and bundle budgets, plus participant/coverage Chromium 10/10.
The live exact-head Linux package/soak check and five fresh independent reviews
must restart on the documentation-bound descendant. No merge or release
occurred.

## Destroyed-renderer abandoned-stage remediation

The next fresh review reproduced a renderer destroyed while its catalog sync
was pending. The backend returned a live staged activation after destruction;
the single cleanup discard rejected; IPC swallowed that failure without
retaining ownership. A replacement renderer then reached the worker's
unsettled-stage guard and could not recover without worker/process restart.

The IPC regression failed red with the replacement sync still seeing the
abandoned stage. A second worker-generation regression failed red because a
replacement worker rejected cleanup for the opaque token lost with its prior
generation. Commit `b2a3a86507f961695d162f0a46f391ca3c0ce396`:

- retains renderer-lost stages as explicitly abandoned until discard succeeds;
- coalesces concurrent cleanup, retries a transient failure before replacement
  sync, and preserves a persistent failure for the next explicit Retry;
- prevents an abandoned owner from invoking activation transitions; and
- accepts a lost-generation discard only when the worker has no staged or
  activated catalog, while still rejecting a token that conflicts with a
  different live stage.

Green verification at this application head is 5 focused files / 54 tests,
264 full unit files / 2,115 tests, TypeScript, ESLint, changed CommonJS syntax,
production build and bundle budgets, plus participant/coverage Chromium 10/10.
The earlier exact-head Linux run `32907962145` passed packaging, AppImage launch,
and an 8,664/8,664 soak with 32.4 ms main maximum and zero redundant slope, but
is superseded because this remediation changes the operational worker path.
New exact-head Linux CI and five fresh independent reviews must restart. No
merge or release occurred.

## Alive-renderer explicit-Retry remediation

The next review reproduced the live-renderer counterpart to abandoned-stage
recovery. After backend activation, finalize rejected and the controller's
cleanup discard also rejected. IPC correctly retained ownership, but did not
mark the stage abandoned. The controller rejected and forgot that catalog; its
explicit Retry began a new sync, which reached the worker's unsettled-stage
guard instead of retrying cleanup.

The regression failed red with `Coverage tile catalog already has an unsettled
stage.` on that same-renderer Retry. Commit
`55163cc8fcd4a3df0cd183526a26955691e5c970` defines a new catalog sync from the
same renderer as explicit supersession: it marks any earlier owned stage
abandoned and settles it through the existing coalesced cleanup path before
calling worker sync. Stages owned by a different live renderer are not
superseded.

Green verification at this application head is 5 focused files / 55 tests,
264 full unit files / 2,116 tests, TypeScript, ESLint, changed CommonJS syntax,
production build and bundle budgets, plus participant/coverage Chromium 10/10.
The exact-head Linux run at `745ab3e` was green but is superseded because this
commit changes live catalog recovery. New exact-head Linux CI and five fresh
independent reviews must restart. No merge or release occurred.

## Progress-based abandoned-stage sweep remediation

The next review showed that preferred cleanup order alone was insufficient.
Renderer A's preferred token could be stale while renderer B's already-
abandoned token was the worker's live stage. Stopping after A's second correct
wrong-token rejection meant B was never attempted, so neither A nor a
replacement renderer could recover without another restart.

The regression failed red with B's live discard never called. Commit
`9dd736c19b84778bec429b30a3ff7599180aa499` changes settlement to a bounded
progress sweep. Each pass attempts every still-owned abandoned stage; successful
settlement removes the live stage and triggers another pass for conflicts that
can now become idempotent. A transient all-failure pass is retried once. Two
complete passes with no progress return the last cleanup error and remain
fail-closed instead of looping indefinitely.

Green verification at this application head is 5 focused files / 57 tests,
264 full unit files / 2,118 tests, TypeScript, ESLint, changed CommonJS syntax,
production build and bundle budgets, plus participant/coverage Chromium 10/10.
The `2d316da` Linux package/soak result is superseded by this operational change.
New exact-head Linux CI and five fresh independent reviews must restart. No
merge or release occurred.

## Multi-renderer stale-token ordering remediation

The next review exercised two valid renderer sender IDs across a worker
generation change. Renderer A's stage token remained in IPC after the worker
lost it; renderer B then created the worker's live stage. A Retry made A's old
token abandoned, where its discard correctly conflicted with B. When B later
retried, insertion-order cleanup attempted A first again and stopped before
reaching B's settleable stage, leaving both Retry paths wedged.

The regression failed red with repeated wrong-token rejection and no discard
of B's live stage. Commit `6e53ba147d1f4295783621d04746ea1764490b6d`
orders abandoned cleanup so stages owned by the renderer initiating catalog
Retry are settled first. With B removed, A's lost-generation token is then an
idempotent no-stage cleanup. A different non-abandoned live renderer remains
protected from supersession and terminal calls.

Green verification at this application head is 5 focused files / 56 tests,
264 full unit files / 2,117 tests, TypeScript, ESLint, changed CommonJS syntax,
production build and bundle budgets, plus participant/coverage Chromium 10/10.
The exact-head Linux run at `a7cbda3` passed packaging, AppImage launch, and an
8,664/8,664 soak with integrity ok, one restart, zero redundant slope, 54.8 ms
main maximum, and four healthy operator interactions, but is superseded by this
operational cleanup-order change. New exact-head Linux CI and five fresh
independent reviews must restart. No merge or release occurred.

## Retained-source activation attestation and final application-head Linux gate

The next review showed that a same-revision catalog refresh could retain an
unchanged period's existing MapLibre source. That source still belonged to the
earlier activation, but the controller accepted failures only when they matched
the newest global catalog activation. A real retained-source failure was
therefore ignored, leaving Complete visible and preventing recovery.

The red-first controller regression retained period B from activation 1 while
period A changed in activation 2, then delivered B's activation-1 failure. It
failed because Complete was not revoked. A second regression delivered a
delayed B1 callback during recovery and failed because it was not coalesced
with the superseded source set. The overlay regression also failed because the
activation result did not report per-source ownership.

Application head `080abe8d2f9238aa150b9faa8e31e48634e7842a`:

- returns the exact activation owner for every staged or retained coverage
  source;
- stores that ownership only after renderer finalization succeeds;
- accepts a failure against the actual finalized source owner, while retaining
  the pending-current-catalog fallback for the narrow activation window;
- revokes Complete and starts one bounded recovery for an accepted retained-
  source failure;
- forces every superseded source to be recreated before Complete can return;
- coalesces delayed callbacks whose sources are all being replaced; and
- treats a failure from a genuinely new activation as a new fail-closed
  recovery rather than suppressing it.

Green verification at that application head:

- focused controller/protocol/overlay/catalog/runtime: 5 files / 82 tests;
- full serial unit: 264 files / 2,126 tests;
- TypeScript, ESLint, production build, and bundle budgets;
- participant/coverage Chromium: 10/10; and
- a two-worker, ten-repeat intermittent coverage stress: 10/10 before the
  final type-only refactor, followed by a normal exact-head Chromium rerun.

Exact application-head Linux run
[`32917584753`](https://github.com/donal0c/sartracker-web/actions/runs/32917584753)
passed at `080abe8d2f9238aa150b9faa8e31e48634e7842a`:

- Ubuntu x64 AppImage and `.deb` packaging with the native SQLite module;
- Mesa llvmpipe renderer attestation and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `770cc2e8e7ea972a651cade2487b22588bbd6e36b9f98f71a31b44a7f1016fc5`,
  integrity `ok`, one restart, zero renderer crashes, 25.323 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `cdb912166cc87bb8e06740261947914c63fc367c31de014db31e52664d26130a`;
- `.deb` SHA-256
  `7298683364ed072f53f42d9c17d41f99f4c69dba6a98932ac455af783a50f59a`;
- package artifact `9588793151`, uploaded-zip digest
  `47bc83f202af4724533d0958e2b6375d58ba717ffc0272f5a8b677f11946f669`;
  and
- validation artifact `9588793752`, uploaded-zip digest
  `57349cde91a7575ab02b7c1b297fbc16338b7885214770120ec4d65bc3742f2d`.

This remediation does not change the selected Candidate-B geometry/index
construction, schema/open path, operator controls, G2 measurements, or G3
default posture. The G2 decision memo, 3.704 GB v9-to-v10 migration proof,
960k/2M qualification, earlier selected visual review, and operator manual
therefore remain standing for their unchanged surfaces. No new manual or
screenshot change is required: the visible failure contract remains one
automatic recovery followed by explicit Retry. There was no pre-merge packaged
960k/2M coverage run outside G2 and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent reviews before
PR #3 can be called review ready. No merge or release occurred.

## Multi-period progressive recovery remediation

The first review of the evidence-bound `e1ca2ea` head invalidated it with a
deterministic P1. A two-period load schedules the newest period first. During
automatic renderer recovery, the controller cleared its recovery epoch after
that first progressive catalog activated. The cumulative second catalog was
therefore emitted with `requiresFreshRendererSources = false`; the renderer
could reuse the failed same-revision older-period source and return Complete.

The exact red-first controller regression:

1. completes normal progressive catalogs for a newer and older closed outing;
2. fails the older source owned by the second activation;
3. observes force-fresh on the first recovery catalog;
4. applies that catalog while the failed older source is still retained; and
5. expects force-fresh on the cumulative second recovery catalog.

At the invalidated head, step 5 received `false`. Application head
`6cd6e192dc07ec9be92cd5f03359a89d7a0702ec` captures the recovery epoch once
per load, uses it for every progressive catalog, and clears the epoch,
superseded-source fence, and automatic-recovery budget only after the entire
batch sequence activates successfully. Equality with the captured epoch
prevents a newer failure from being cleared by an older load.

Green verification at that application head:

- focused activation/controller/protocol/runtime/overlay: 5 files / 83 tests;
- full serial unit: 264 files / 2,127 tests;
- TypeScript, ESLint, changed CommonJS syntax, source/docs diff, production
  build, and bundle budgets; and
- participant/coverage Chromium: 10/10.

Exact application-head Linux run
[`32919016169`](https://github.com/donal0c/sartracker-web/actions/runs/32919016169)
passed at `6cd6e192dc07ec9be92cd5f03359a89d7a0702ec`:

- Ubuntu x64 AppImage and `.deb` packaging with native SQLite, Mesa llvmpipe
  attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `e7c03b93a9ea5e27dc935f1d75cdf66fd0962bb565b54d8c56cf0d2b83457e1a`,
  integrity `ok`, one restart, zero renderer crashes, 24.283 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `1b317238808c1fd41ada28504e9f47936d4753d03e69796395951168603bc29f`;
- `.deb` SHA-256
  `1d141e7e796ecc157c6a93e94fd46c43c6ae64fbba436888a3f9103c4096998d`;
- package artifact `9589260596`, uploaded-zip digest
  `88365731f6e9828e98924ead678fc17aab9b51e3442a8f255a31e63685b61e90`;
  and
- validation artifact `9589261447`, uploaded-zip digest
  `70b15d50be0cd27e0f1d687a56e5a40db031864fbe335fcb3c70902b580876a9`.

This change is confined to controller recovery correlation. Candidate-B query,
segmentation, index construction, tile geometry, schema/open code, operator
controls, G2 measurements, G3 posture, migration, and manual-visible behavior
are unchanged. No new manual screenshot is required. The earlier G2/scale,
migration, visual, and manual evidence remains standing only for those
unchanged surfaces. There was no packaged 960k/2M run outside G2 and no
packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent reviews before
PR #3 can be called review ready. No merge or release occurred.

## Progressive mission-switch remediation

The first review of evidence-bound head `4a6e475` invalidated it with a separate
deterministic P1. While the first catalog of a two-period old mission was in
irreversible finalization, a mission switch recorded the new desired mission
but waited for both finalization and the entire old progressive load. Once the
first catalog finalized, the old load published its second catalog and waited
for acknowledgement. The map was already scoped to the desired new mission and
would not acknowledge that old catalog, while the switch could not abort it
because it was waiting for that same load. Repeating the desired mission update
was coalesced; restart was the only recovery.

The red-first controller regression holds old-mission stage-one finalization,
requests a new mission, releases finalization, and deliberately withholds every
later old-mission acknowledgement. At `4a6e475` it received old-mission stage
two and timed out without publishing the new mission. Application head
`ffffe0f1b5e2205c1b10ebad3027db0d9643acdb` waits only for the irreversible
catalog finalization. The existing context-update sequence fence still selects
the latest requested context; the winning update then aborts the remaining old
load and starts the new mission. Green proves the new mission takes ownership
and the stale old-mission stage is never finalized.

Green verification at that application head:

- focused activation/controller/protocol/runtime/overlay: 5 files / 83 tests;
- full unit: 264 files / 2,127 tests;
- TypeScript, ESLint, source/docs diff, production build, and bundle budgets;
  and
- participant/coverage Chromium: 10/10.

Exact application-head Linux run
[`32920238110`](https://github.com/donal0c/sartracker-web/actions/runs/32920238110)
passed for branch head `ffffe0f1b5e2205c1b10ebad3027db0d9643acdb`:

- Ubuntu x64 AppImage and `.deb` packaging with native SQLite, Mesa llvmpipe
  attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `53166744ae8bc4943419371b49098e3e4e9349a37698e6cd7a3f8b5f94bc7bda`,
  integrity `ok`, one restart, zero renderer crashes, 32.603 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `a9bd5bf0e92e8e887e74e0196c21d879253058922eb51ec4eb3818d5a7067eaf`;
- `.deb` SHA-256
  `531dab05f1f5642a754a44acebcbaafdd8f3dbe00e3ff4fbae9a2569cf994186`;
- package artifact `9589669130`, uploaded-zip digest
  `b9778146eb871973a3fe186601466d5649048478bfec8af88098986ddda11140`;
  and
- validation artifact `9589669565`, uploaded-zip digest
  `217411c2c51bc9550864c4acd5370a926feaacc46c45d3c992f9726583d933f1`.

This change is confined to controller handoff ordering. Candidate-B query,
segmentation, index construction, tile geometry, schema/open code, operator
controls, G2 measurements, G3 posture, migration, and manual-visible behavior
are unchanged. No new manual screenshot is required. The earlier G2/scale,
migration, visual, and manual evidence remains standing only for those
unchanged surfaces. There was no packaged 960k/2M run outside G2 and no
packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent reviews before
PR #3 can be called review ready. No merge or release occurred.

## Renderer/backend lifetime and bounded worker-envelope remediation

The next exact-head review wave invalidated `5fb8e24` with two independent
release-blocking P2s.

First, backend `finalizeCatalog` retired the predecessor before the renderer
released its MapLibre sources. A queued old-source read could therefore return
`null` in the finalization handoff. The wider recovery path was unbounded:
progressive fresh-source recovery could send a partial catalog while
`retainPriorPeriods` deliberately kept an omitted predecessor source installed,
leaving that visible source with no backend serving catalog until a later batch.

Second, renderer-controlled claim keys and catalog descriptors crossed IPC
without a canonical cardinality, uniqueness, membership, or revision envelope.
The tile worker could return one build per duplicate and mission-store would
apply every build synchronously on Electron main. The reviewer reproduced the
trust-boundary defect with 20,000 copies of one valid zero-fix descriptor.

The red-first remediation at application head
`0e3cf4b536c7aa708468be13c3fbae3916a28b25` establishes these boundaries:

- automatic renderer recovery performs one full-manifest fresh-source swap, so
  no omitted predecessor period intentionally outlives backend release;
- renderer ownership finalization removes predecessor sources before backend
  release, and backend release is idempotent;
- a failed post-renderer backend release retains the predecessor and Retry
  releases that same stage before any new catalog build;
- claim/catalog arrays are rejected before worker dispatch when their length
  exceeds current canonical device x period inventory, and duplicate,
  malformed, unknown, or stale-revision descriptors fail closed;
- normalized requests are fresh exact objects, so renderer control fields do
  not cross the authoritative store/worker boundary; and
- tile-worker periods, deliveries, and builds must map one-to-one to the
  normalized request before any main-isolate coverage-ledger transaction.

The regressions prove full-manifest recovery, renderer-before-backend release
ordering, same-stage release retry, idempotent worker release, duplicate claim
and catalog rejection, unknown inventory and stale revision rejection, the
20,000-entry early bound, exact-object forwarding, and divergent worker-result
discard before ledger application.

Green verification at that application head:

- full unit: 264 files / 2,133 tests;
- TypeScript, full ESLint, changed CommonJS syntax, production build, and bundle
  budgets;
- source-exact paged Dots contract: 10/10; and
- participant/coverage Chromium: 10/10.

Exact application-head Linux run
[`32922725575`](https://github.com/donal0c/sartracker-web/actions/runs/32922725575)
checked out PR merge ref
`49510b1a1813a8fe275d758b5422112a419aae8c`, explicitly merging application
head `0e3cf4b536c7aa708468be13c3fbae3916a28b25` into exact PR-2 base
`7021fc1ef33e6da5c91c96cd86e836fc3754f48f`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `d2c0bb78160e22e4180a69bdac26243dc88c7bd98a89c3a51511a49ed7fd5d26`,
  integrity `ok`, one restart, zero renderer crashes, 33.450 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `3a8d1a1afb7a3103383bbe10fd99c2191df696330571310e4bcd4a76d25c0ebd`;
- `.deb` SHA-256
  `90718bc750c7ffb6c7cfe31f294faf3941a99c24444a026bc305afd0cdeaa30a`;
- package artifact `9590459517`, uploaded-zip digest
  `76be67fe5a0f23f5ab038afb0ae207d0277f4989e8db8100dc5a1603590cec06`;
  and
- validation artifact `9590460438`, uploaded-zip digest
  `fc1f2a1a0213a65f85b843caffb172f575ebf968029eeadbd13bd45e5c3c1ee7`.

This remediation does not change Candidate-B geometry/index construction,
schema/open code, coverage controls, G2 measurements, G3 flag posture, exact
Dots, or operator-visible wording. The accepted G2 decision/960k/2M evidence,
3.704 GB v9-to-v10 migration, earlier selected visual review, operator manual,
and screenshots remain standing only for those unchanged surfaces. No manual
or screenshot update is required for this invisible ownership/trust-boundary
remediation. There was no pre-merge packaged 960k/2M coverage run outside G2
and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent exact-head
reviews before PR #3 can be called review ready. No merge or release occurred.

## Lost worker-generation and malformed-stage recovery remediation

Fresh exact-head reviews invalidated evidence head
`48ee11869d22bfb25ef5c18c54013a9def5d270d` with two distinct P2 recovery
defects.

First, a timeout during post-renderer predecessor release terminated the tile
worker generation that owned the activation token. The controller correctly
retained that token and required Retry to settle it before any new build, but a
fresh worker rejected the old generation's token. Every Retry therefore failed
before manifest read or replacement delivery, leaving coverage unavailable
until runtime restart.

Second, the worker creates `stagedCatalog` before replying to `sync-catalog`.
When the runner's one-to-one result validator rejected a malformed reply, the
runner rejected only the request. Mission-store never received the raw result,
so its defensive discard path could not run; the same live worker retained the
unknown stage and every later sync failed with an unsettled-stage error.

Both were recorded red before production changes. The real-worker lost-
generation regression rejected predecessor finalization on a replacement
worker. The fake-worker malformed-result regression observed zero worker
terminations and no failure notification, then proved Retry reused the same
poisoned generation.

Application head `635a7b30883c3acd9852aae825dec1edacf4102d` establishes the
small recovery boundary:

- a worker with neither a staged nor activated catalog treats predecessor
  finalization as already settled because the dead generation's in-memory
  predecessor no longer exists;
- a mismatched token still fails whenever the replacement owns a live stage;
- a catalog-result normalization failure terminates the owning worker and
  emits the existing bounded failure signal; and
- the next Retry creates a clean worker, settles pending release, and can
  perform the controller's already-tested full-manifest recovery.

The regressions cover real worker generation loss, live replacement-stage
token fencing, runner timeout followed by same-token finalization on a
replacement worker, malformed result termination/failure notification, and a
successful sync on the fresh generation.

Green verification at that application head:

- focused ledger/query/store/controller/runner: 5 files / 114 tests;
- full unit: 264 files / 2,135 tests;
- TypeScript, full ESLint, changed CommonJS syntax, production build, and
  bundle budgets;
- source-exact paged Dots contract: 10/10; and
- participant/coverage Chromium: 10/10.

Exact application-head Linux run
[`32924343484`](https://github.com/donal0c/sartracker-web/actions/runs/32924343484)
checked out PR merge ref
`9927c5ce69bdca7d08f662eefebfac9cabf2aad6`, explicitly merging application
head `635a7b30883c3acd9852aae825dec1edacf4102d` into exact PR-2 base
`7021fc1ef33e6da5c91c96cd86e836fc3754f48f`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `e26da48259e7194b19c2ae64aaab935fa342f25535dc27d34171ff2d1e9bfc3b`,
  integrity `ok`, one restart, zero renderer crashes, 21.185 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `c4e8078f7450dc21ede976db39841507f52375cbe74d18cb8446a53055bee9a8`;
- `.deb` SHA-256
  `fc06dfffef17b9e27d970d5afb5a091ae1d27532c0c0262ed91b6cb89f4ffba4`;
- package artifact `9591034838`, uploaded-zip digest
  `c5c58bbdcc9b36508b298d76a39995bb5efe1e6f4d1023243622026bc4192719`;
  and
- validation artifact `9591035737`, uploaded-zip digest
  `2e044a1f7ebce9c6781658d1176b05ef30bddf989a833464f9b3a3501246deb5`.

This remediation does not change Candidate-B geometry/index construction,
schema/open code, coverage controls or wording, G2 measurements, G3 flag
posture, exact Dots, or any operator-visible surface. The accepted G2
decision/960k/2M evidence, 3.704 GB v9-to-v10 migration, earlier selected
visual review, operator manual, and screenshots remain standing only for those
unchanged surfaces. No manual or screenshot update is required for this
invisible worker-lifecycle remediation. There was no pre-merge packaged
960k/2M coverage run outside G2 and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Failed-claim false-100% remediation

Review invalidated the preceding documentation descendant with one further P2.
When renderer delivery reached all selected fixes but the final database
completeness claim rejected or timed out, the controller correctly withheld
`Complete` and entered an error state. It intentionally retained the delivered
and total counts for diagnosis. The panel nevertheless rendered those equal
counts as a full progress bar, creating the exact false-100 presentation the PR
promises never to show.

The red reason was recorded before production code. A panel regression received
`7 of 7` with a failed final claim and found `<progress value="7" max="7">`.
A controller regression then proved the complete failure path: renderer
delivery succeeded, the final database claim rejected, and the final state
retained `1 of 1` without becoming `complete`.

Application head `694644642b18405317ae38982ef14769a5f8f489` establishes the
small display boundary:

- equal delivered/total counts render no progress element unless status is
  `complete`;
- the panel says “Loaded history is shown, but completeness is not yet
  verified.” and preserves the actionable failure reason and Retry control;
- partial progress below 100% remains visible; and
- the controller continues to retain diagnostic counts without weakening the
  final database claim.

The operator manual now describes the final-claim boundary and includes
`public/manual/assets/mission-history-claim-unverified.png`. Critical visual
test `coverage-claim-unverified-honesty` asserted the absence of a progress bar
and presence of the explanation and Retry control; its uncached independent
review passed with no failed items in
`visual-review-2026-08-26T03-22-44Z.json`.

Green verification at that application head:

- focused panel/controller/manual: 5 files / 81 tests;
- full unit: 264 files / 2,137 tests;
- TypeScript, full ESLint, production build, and bundle budgets;
- source-exact paged Dots contract: 10/10;
- selected critical visual Playwright: 1/1, followed by uncached independent
  visual review: PASS; and
- participant/coverage Chromium: 10/10. The coverage suite also passed 4/4
  after the honest resumed-progress assertion was corrected, and its slow
  coverage workflow passed 3/3 serialized repetitions.

Exact application-head Linux run
[`32926442726`](https://github.com/donal0c/sartracker-web/actions/runs/32926442726)
checked out PR merge ref
`f5c230ed56392ec698af2b473f41deaaff3a2a9e`, explicitly merging application
head `694644642b18405317ae38982ef14769a5f8f489` into exact PR-2 base
`7021fc1ef33e6da5c91c96cd86e836fc3754f48f`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `ab6713554b2eefb0745bc812cebc78196a62db6f596dc99374ed2d250bf992e9`,
  integrity `ok`, one restart, zero renderer crashes, 32.024 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `4788422a16fde309cc9a1cfe55cd7e0fe2648e7728465b47eb7492f78d3cbb18`;
- `.deb` SHA-256
  `dc75661f3245b04c6e04590c8a80f95efe66a85aa47f1b8d8b9a488ef39526c0`;
- package artifact `9591784194`, uploaded-zip digest
  `8bba3bbb2888def7cc39601598b739d22dd2ac8ef5c782003ff5ee02b81f18ee`;
  and
- validation artifact `9591784673`, uploaded-zip digest
  `2e1222a8b55141200fb81ae982d63d26e3eec7e7991a674344709a23697f5f57`.

This remediation changes only the honesty of the coverage progress presentation
and its operator documentation. It does not change Candidate-B geometry/index
construction, schema/open code, worker/IPC/controller delivery semantics, G2
measurements, G3 flag posture, or exact Dots. The accepted G2 decision and
960k/2M evidence, 3.704 GB v9-to-v10 migration, and earlier package evidence
remain standing only for those unchanged surfaces. There was no pre-merge
packaged 960k/2M coverage run outside G2 and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Invalidation worker under-dirty remediation

Final review invalidated evidence head
`4b84fb0b2e1dae56d6f1a1f39d847d482370dc94` with a P1 under-dirty path. The
query runner accepted any plain-record success, mission-store trusted the
worker's `affectedKeys`, and ledger apply allowed an empty list to set
`drained_at`. A boundary edit could therefore move fixes between the subject
outing and Unassigned while both old chunks retained equal content/built
revisions and old counts. With the durable invalidation gone, the final database
claim returned ready and the controller could retain the stale delivered
catalog.

The red reason was recorded before production code. A production-composition
mission-store regression started with two fresh outing fixes, moved the outing
start between them, injected `{ affectedKeys: [] }`, and received the unchanged
fresh `2/0` ledger instead of stale current-truth `1/1` chunks. A separate real
worker-runner regression accepted a result carrying the wrong invalidation
identity. An additional incomplete-envelope regression omitted the key list.

Application head `08ce78a748480968063cf929f56f5d3bda130040` establishes two
independent boundaries:

- the query runner validates and copies the invalidation identity and a bounded,
  unique, tagged key list before accepting worker completion; and
- ledger drain independently computes a bounded position-free conservative
  floor from current canonical device×affected-period inventory, validates every
  worker key against that floor, and applies the floor before `drained_at`.

The main isolate reads only bounded invalidation, outing, participant/device,
and coverage-inventory metadata. It never scans positions. A valid empty worker
answer therefore over-dirties the subject outing, Unassigned, and intersecting
current outings for every canonical device; malformed, duplicate, oversized, or
out-of-inventory output rejects before apply and leaves the durable invalidation
pending. This follows the accepted plan's explicit rule that over-dirtying is
safe and under-dirtying is P1.

Green verification at that application head:

- focused query runner/query/ledger/store/controller: 5 files / 99 tests;
- full unit: 264 files / 2,140 tests;
- TypeScript, full ESLint, changed/all CommonJS syntax, production build, and
  bundle budgets;
- source-exact paged Dots contract: 10/10; and
- participant/coverage Chromium: 10/10.

Exact application-head Linux run
[`32928637039`](https://github.com/donal0c/sartracker-web/actions/runs/32928637039)
checked out PR merge ref
`cc7aff3b2848e93d98fa76a2eff514c548c1ccd2`, explicitly merging application
head `08ce78a748480968063cf929f56f5d3bda130040` into exact PR-2 base
`7021fc1ef33e6da5c91c96cd86e836fc3754f48f`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `e02b19b6e7b4d62cee48a51ecc41e2b24ccd1fa2a4b04eb4b0cb06162c13f4ce`,
  integrity `ok`, one restart, zero renderer crashes, 116.250 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `28dac6283a0a86c6d5d1760e2ac12d2efcfee6c1c581da7bcd6cadbebfc7ef63`;
- `.deb` SHA-256
  `73e6b66b7f1dd7ebf0e32ea603106938723d8b9916388811ff30a1717cd71189`;
- package artifact `9592483908`, uploaded-zip digest
  `4277a7833196b3beef3cebcb4bbdaafd58156564dbde8b52b47d13920c5493e8`;
  and
- validation artifact `9592484645`, uploaded-zip digest
  `94ee8b393b21ff8d32485ad2cec991a65ad5348068ac0dc4897819bd0d6b4bc8`.

This remediation changes only backend invalidation trust and conservative
revision dirtiness. It does not change Candidate-B geometry/index construction,
schema/open code, coverage controls or wording, G2 measurements, G3 flag
posture, exact Dots, or any operator-visible surface. The accepted G2
decision/960k/2M evidence, 3.704 GB v9-to-v10 migration, prior critical visual
review, operator manual, and screenshots remain standing only for those
unchanged surfaces. No manual or screenshot update is required for this
invisible backend remediation. There was no pre-merge packaged 960k/2M coverage
run outside G2 and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Complete query-result trust remediation

The first fresh review of evidence head
`862a300f9c3fefdf2bd776f6983d5708459ee4f4` invalidated it with a new P1.
`invalidation-analysis` had acquired a strict result envelope, but enumeration,
manifest, claim, chunk-page, and chunk-summary still accepted any plain-record
worker result. A plausible current-sequence manifest could omit a real stale
canonical chunk. Mission-store then accepted an empty inventory, the controller
derived an empty selection, and an empty ready claim passed its revision check
vacuously while the stale ground remained undelivered.

The red reason was recorded before production code. Three independent
regressions failed:

- a worker-envelope test accepted omitted or request-divergent results for all
  five previously unvalidated kinds;
- a production-composition mission-store test added accepted evidence to make
  a real chunk stale, injected an empty current-sequence manifest, and observed
  that the read resolved instead of failing closed; and
- a controller test accepted a ready claim with no revision for its one selected
  delivered chunk and published `complete`.

Application head `20ca76e876e0436827e1bfc2fd3ef6d03919b4d9`
establishes three independent boundaries:

- `coverage-query-result-envelope.cjs` validates and copies bounded,
  kind-specific enumeration, manifest, claim, page, summary, and invalidation
  results; keys, revisions, counts, digests, timestamps, cursors, coordinates,
  blockers, uniqueness, cardinality, and request identity are allowlisted;
- mission-store independently requires enumeration and manifest keys to cover
  the exact current canonical device×period inventory and compares the final
  claim with a bounded direct ledger snapshot before adding ingest-health
  blockers; and
- the controller requires an exact unique revision attestation for every
  selected chunk, not merely `every()` over whatever revisions were returned.

The main isolate reads only existing bounded mission/device/participant/outing
and coverage-ledger metadata. It does not scan positions. Result normalization
also exposed an adjacent exact-summary bug: a zero-count recomputation used
nullish fallback and could inherit stale old min/max timestamps. Exact summary
nulls now remain authoritative.

Green verification at that application head:

- new focused worker/store/controller red paths plus their suites: 3 files / 81
  tests;
- focused coverage/participant surface: 33 files / 251 tests;
- full unit: 264 files / 2,143 tests;
- full ESLint, TypeScript, all changed CommonJS syntax, production build, bundle
  budgets, and diff checks.

Exact application-head Linux run
[`32930525474`](https://github.com/donal0c/sartracker-web/actions/runs/32930525474)
checked out PR merge ref
`08441c4c7d6d3b2a3c9bd9fa7b98f54f4297e77e`, explicitly merging application
head `20ca76e876e0436827e1bfc2fd3ef6d03919b4d9` into exact PR-2 base
`7021fc1ef33e6da5c91c96cd86e836fc3754f48f`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256 `c074b33becfaaf02b0b2a6b93a75b9dec3671f93d87df6514c8b8c7f145bb0d9`,
  integrity `ok`, one restart, zero renderer crashes, 46.882 ms maximum main
  gap, zero redundant-event slope, and four healthy operator interactions;
- AppImage SHA-256
  `36626857a8c9a7409c35ff0597c637c7bfb6255c3af06b4c76c8c0aae268ca45`;
- `.deb` SHA-256
  `ba48c0a37817c2d608ab18c773b80d8c2220db4b7242408cd75452877ae3f136`;
- package artifact `9593126282`, uploaded-zip digest
  `f349d5015bff77c7b4cdb39bb20fcb9d9e422be7d7beaaa8bc2dd52bcb2a835e`;
  and
- validation artifact `9593127023`, uploaded-zip digest
  `262a2ecfba459a020c98ea059ca61b03548a1ad6b6bdbea5c2e7d0cf1302482c`.

This remediation changes backend/worker/controller trust only. It does not
change Candidate-B geometry/index construction, schema/open code, coverage
controls or wording, G2 measurements, G3 flag posture, exact Dots, or any
operator-visible healthy workflow. The accepted G2 decision/960k/2M evidence,
3.704 GB v9-to-v10 migration, prior selected critical visual review, operator
manual, and screenshots remain standing only for those unchanged surfaces. No
manual or screenshot update is required. There was no pre-merge packaged
960k/2M coverage run outside G2 and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Bounded result attestation and main-isolate I5 remediation

Fresh review of evidence head
`d044e71fb71608b08072ce13c73747408cf571da` found that the all-kind result
envelope was still too permissive at two adjacent boundaries. It allowed the
global 100,000-entry ceiling before checking request-derived cardinality, and
manifest outing metadata was structurally validated but not proved against
SQLite. A forged outing could therefore cross the worker boundary, while a
maximal structurally valid result could force mission-sized normalization on
Electron main. Production also normalized the same built-in worker result
twice.

The red reasons were recorded before production code. Three regressions failed:

- a direct oversized envelope reached a throwing element getter instead of
  rejecting from its shallow request-derived cardinality;
- production mission-store composition accepted an altered outing label and
  interval for a real outing; and
- the query worker had no pre-`postMessage` cardinality preflight.

Application commit `68768f74a6e3afaac9807f39c92cc3f589cb772d` closes those
paths with a dedicated attestation boundary. It proves inventory, outing
identity/label/window/order, and claim metadata against bounded SQLite reads;
derives result ceilings from the current bounded device×period inventory and
outing set; performs a shallow worker-side cardinality preflight before
structured clone; and avoids the second production deep normalization while
retaining validation for injected test/adapter runners. Green verification was
30/30 focused, 316/316 coverage/participant, and 266 files / 2,149 tests, plus
full ESLint, TypeScript, build/budgets, syntax, and diff checks.

Exact Linux run
[`32932901604`](https://github.com/donal0c/sartracker-web/actions/runs/32932901604)
was workflow-green but was rejected as safety evidence: its packaged soak
recorded a 224.9739 ms maximum Electron-main gap, above the accepted plan's
hard I5 limit of 200 ms. Green CI did not override that reproduced breach.
Tracing its 205/337/408 ms batch durations found one synchronous SQLite outing
lookup for every accepted fix during ledger resolution.

The next red test required one bounded ordered outing snapshot and zero
per-fix SQLite reads. Application commit
`e1b51d8a262556c097aed617b771ce255ec2bc63` now resolves every batch against
one ordered outing metadata read and the existing canonical binary search.
Linux run
[`32933663936`](https://github.com/donal0c/sartracker-web/actions/runs/32933663936)
proved the product correction with a 55.2 ms Electron-main maximum, but the
workflow failed because its first gate wiring incorrectly applied the 200 ms
main-isolate limit to the Mesa llvmpipe renderer as well. The accepted plan
defines I5 as a main-isolate hard limit; the tracking soak's renderer/operator
freeze limit remains the existing 1,000 ms. That run is retained as diagnostic
evidence, not accepted exact-head proof.

Commit `cfd733cfb614cc508272f54d4ddca583f9c4a95d` separates those
two gates red-first. The soak now has an explicit 200 ms main-isolate threshold
while renderer and operator responsiveness retain their existing independent
threshold. Focused gate/hot-path verification passed 56/56; full unit passed
266 files / 2,149 tests; full ESLint, TypeScript, production build/budgets, and
diff checks passed.

Exact application-head Linux run
[`32934141302`](https://github.com/donal0c/sartracker-web/actions/runs/32934141302)
checked out PR merge ref
`c5c78755139cbbe162ca97f932fb7843edaf1bf2`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`cfd733cfb614cc508272f54d4ddca583f9c4a95d`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `413b61e1ae16a1f465f4401251facdbacf284c8196766789ab6095fe29985f76`,
  integrity `ok`, one restart, zero renderer crashes, and four healthy operator
  interactions;
- Electron-main maximum 22.2073 ms and p95 10.7335 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- Mesa llvmpipe renderer maximum 550 ms and p95 299.9 ms, below the separate
  1,000 ms packaged tracking-soak freeze limit. This CPU renderer result is
  descriptive tracking-soak evidence; G2 remains the coverage-renderer budget
  authority;
- AppImage SHA-256
  `4247544df2a36f02f02520246b58cd0ad60968540746eb68ca2418417632469f`;
- `.deb` SHA-256
  `f43794cc775058d6d4ca2c0ecab610daa9c4b57389bc41d7be92eb1b32321520`;
- soak report SHA-256
  `5e3f67394b9fb7f4528175ceef8d98667211a1c5c570e94cfca6c7fd7598f7fd`;
- package artifact `9594356370`, uploaded-zip digest
  `31a51c6b2b0d9187e4488ee7de64dae614976cc864e315c772b8c4a5a98644f4`;
  and
- validation artifact `9594357021`, uploaded-zip digest
  `4f82ad5329187e921725c1ef20cf215b8082151e515e79c8de1809b88636472e`.

This remediation changes query-result trust, ledger lookup complexity, and the
validation gate only. It does not change Candidate-B geometry/index
construction, schema/open code, coverage controls or wording, G2 measurements,
G3 flag posture, exact Dots, or an operator-visible surface. The accepted G2
decision/960k/2M evidence, 3.704 GB v9-to-v10 migration, prior selected critical
visual review, operator manual, and screenshots remain standing only for those
unchanged surfaces. No manual or screenshot update is required. There was no
pre-merge packaged 960k/2M coverage run outside G2 and no packaged forced-kill
matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Cooled-down rendered-period preservation and live proof ownership

The five-review wave on exact evidence head
`61c7ed2a86ee65c155a878190245385bff4589ba` returned three clean built-in
reviews and one clean external persistence review before the independent
external renderer review invalidated the head with an I6 P1 and an adjacent
proof-quality P2. Every verdict from that wave is superseded.

The P1 was a two-load Candidate-B sequence. A first refresh could publish a
new open-outing content revision while the scheduler correctly deferred its
replacement under the 30-second open-outing cooldown. If another period became
pending before that cooldown expired, the next delivery plan retained a prior
descriptor only when its revision equalled the now-current manifest revision.
The already-rendered old open-outing revision therefore disappeared from the
catalog request. The worker invalidated its period and the renderer removed its
source/layers without a detach/failure signal, violating I6's requirement that
old geometry remains visible until its replacement is delivered.

The red reason was recorded before production code. A composed delivery-plan
test supplied a delivered open outing at revision 1, a current manifest at
revision 2, and only Unassigned revision 2 in the scheduler's ready list. The
only emitted catalog batch contained Unassigned and omitted the open outing.
A follow-on red test proved that numeric zero must not be mistaken for a real
delivered revision.

Application head `24a5e4d5d7141ad76fbb4847e7c40c92175ef72e` closes the
I6 path without bypassing the cooldown. The delivery plan now carries every
positive still-delivered identity forward using its current manifest
descriptor. When any replacement catalog is needed, a deferred stale period is
therefore rebuilt inside that same two-phase catalog; its old worker index and
MapLibre source remain serviceable through activation and are retired only
after the current replacement is ready. An identity never delivered is not
invented. If no period is ready, no catalog is submitted and the existing
finalized catalog remains attached unchanged.

The same review showed that `electron/coverage-completeness.cjs` and its named
I2 tests exercised no production import. That false proof surface was removed.
The actual controller now imports pure selected-scope progress math from
`coverage-progress.ts`, with direct built-but-not-delivered, late-fix, restart,
and zero-fix tests. Chunk and period identity construction was also extracted
to one precise shared module. Database claim and renderer-delivery gates remain
independently exercised at their shipped query/controller boundaries.

Green verification at that application head:

- focused delivery-plan/progress/controller/scheduler/overlay: 5 files / 84
  tests;
- full unit: 267 files / 2,140 tests;
- full ESLint, TypeScript, production build, bundle budgets, and diff checks;
- source-exact paged Dots contract: 10/10; and
- participant/coverage Chromium: 10/10.

Exact application-head Linux run
[`32937238855`](https://github.com/donal0c/sartracker-web/actions/runs/32937238855)
checked out PR merge ref
`8403f4e0d7e229045f35a6a0d6b7ddf88ca4059d`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`24a5e4d5d7141ad76fbb4847e7c40c92175ef72e`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `232d4365a0544ac3a82e5bac8bfda3069e0e4a6e5f491d4fd51112f0f54f7ce8`,
  integrity `ok`, one restart, zero renderer crashes, and four healthy operator
  interactions;
- Electron-main maximum 28.6847 ms and p95 9.1605 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- Mesa llvmpipe renderer maximum 500 ms and p95 316.6 ms. This is descriptive
  tracking-soak evidence below the separate 1,000 ms renderer/operator freeze
  gate; G2 remains the coverage-renderer budget authority;
- AppImage SHA-256
  `1937762c6fdaf0b1c75c9bb5fde4729e3e80ed81828bbf29b972851d1170f4e9`;
- `.deb` SHA-256
  `fcfcb58fdeb1ee5993b22886faef24152ccd726b6229c47960f69075a36d7a76`;
- soak report SHA-256
  `ffd0e939ba000e1ee4055269c246684f36830b76bc150478659abd27a22cccc8`;
- package artifact `9595361125`, uploaded-zip digest
  `4b4f672e84f82c4dc4e09e117b095457c2adc02581d54a82fa41d2a578b27d5c`;
  and
- validation artifact `9595361735`, uploaded-zip digest
  `6542a71f220df5aad1f03f1c5a3261c97f86b5ae7629016ce3de0b53d69ae8df`.

This remediation preserves an already-visible healthy surface; it does not add
or change operator controls, wording, filters, default flags, Candidate-B
geometry semantics, schema/open code, G2 measurements, or exact Dots. The
accepted G2 decision/960k/2M evidence, 3.704 GB v9-to-v10 migration, prior
critical visual review, operator manual, and screenshots remain standing only
for those unchanged surfaces. No manual or screenshot update is required.
There was no pre-merge packaged 960k/2M coverage run outside G2 and no packaged
forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head/Linux gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Filter-growth, finalized-health hydration, and real-worker remediation

The exact-head review wave on
`a47e10241d9d3e25adb8e685c79c6fad73667fef` was invalidated by two current
fail-closed defects and one verification gap. Older reports alleging a
missing-inventory fresh insert, renderer-controlled worker envelope, and raw
tile-coordinate path escape were not forwarded as current findings: exact head
already inserts missing inventory with `built_rev = NULL`, owns worker control
fields after normalized payload spread, and validates/bounds tile coordinates
before resolving a contained cache path.

The new red reasons were recorded before production changes:

- active filters transported a materialized selected-key list, so a later
  visible outing could be absent from both the filtered claim and progress
  denominator while its open-outing chunk remained stale during cooldown;
- a startup health read resolving after successful mission finalization could
  re-add that mission's critical health to the live cross-mission aggregate;
  and
- the real production tile worker was exercised in runner tests, but the full
  mission-store plus worker lifecycle lacked one direct automated integration
  binding.

Application head `6db23e087eab824cd54e1a15641a66d8db0f541a` closes those
paths. Coverage context now transports normalized device/period omission
predicates and resolves them against every fresh manifest. Renderer filter
acknowledgements are compared with that current concrete selection; mismatch
stays visibly Partial with `renderer_filter_pending`. Delayed health for a
finalized mission is retained only in the finalized bucket and is restored to
the live aggregate solely through explicit unlock. The new real-store/real-
worker integration attests non-empty staged/active tile equality, retained plus
rebuilt chunks, a ready exact claim, stale-revision rejection, and honest
follow-up recovery.

Green local verification at that application head:

- focused controller/runtime/filter/health regression set: 6 files / 96 tests;
- real mission-store/production-worker integration file: 22/22;
- full unit: 269 files / 2,156 tests;
- full ESLint, TypeScript, production build, bundle budgets, and diff checks;
- participant/coverage Chromium: 10/10;
- selected critical visual Playwright: 2/2 for default completion and pending
  history-filter application;
- uncached independent critical visual review: 2/2 PASS, report
  `visual-review-2026-08-26T08-38-44Z.json`; and
- Rust backend: 51/51, with the intentional real macOS keychain test ignored.

Exact application-head Linux run
[`32948959241`](https://github.com/donal0c/sartracker-web/actions/runs/32948959241)
checked out PR merge ref
`1ea14c6766b5e1e412152559f9afdb6c89c07998`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`6db23e087eab824cd54e1a15641a66d8db0f541a`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `053bda2dd8298e4296b95c4b5dead8f31b5c584a4a7cde32a666fbad19f7be9e`,
  integrity `ok`, clean WAL checkpoint, one restart, zero renderer crashes,
  zero redundant telemetry slope, and four healthy operator interactions;
- Electron-main maximum 20.5407 ms and p95 8.3123 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- Mesa llvmpipe renderer maximum 416.7 ms and p95 233.3 ms. This is descriptive
  tracking-soak evidence below the separate 1,000 ms renderer/operator freeze
  gate; G2 remains the coverage-renderer budget authority;
- peak packaged process-tree RSS 1,174,769,664 bytes;
- AppImage SHA-256
  `f5fe89978058663a05e2d27fa72d60238422ea67dcffb1abd5d029827d2706f7`;
- `.deb` SHA-256
  `3b593e44ec65b7f06e1d292f35bcd10a730560cf98f1f2a456933f4ff155dcb0`;
- soak report SHA-256
  `8273bf7d71c197ee3ffb1563e95963a9778c28591f78785f7a4a4264926bdb78`;
- package artifact `9599494008`, uploaded-zip digest
  `b700c2791808446daf9e04d8f6ac8a04b7d9ebbbaa684d06e9cb7c117028b7b5`;
  and
- validation artifact `9599495091`, uploaded-zip digest
  `586992d424e8092c5654555abae900e6b6128528569ae845014b0b2bd6345a8f`.

The operator manual now states that an active history filter remains in force
as later periods are discovered and that every newly visible period enters the
completion check. Controls, layout, and screenshots are unchanged. Candidate-B
geometry/index construction, schema v10, G2 measurements, G3 flag posture,
exact Dots, and the 3.704 GB migration surface are unchanged. Their accepted
evidence remains standing only for those unchanged surfaces. There was no
pre-merge packaged 960k/2M coverage run outside G2 and no packaged forced-kill
matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head/Linux gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Tile-worker content oracle remediation

The first review of documentation head
`c72fd02c29190e0f8449b287488017bb0b0902f9` invalidated that head with one
further P1. Tile-worker build descriptors were bounded and shape-checked, but
their count, source-identity digest, and time bounds were not compared with an
independent exact SQLite summary. A deterministic red integration probe put
three real fixes in a stale revision-2 chunk, returned a well-shaped zero-count
worker build with the SHA-256 of empty input, and observed `built_rev = 2`, no
claim blockers, and a current delivered revision. That was a reachable false
Complete path. A separate probe showed that delivery could omit build/content
evidence for a requested chunk entirely.

Application head `603aadf90250cc8125be5605e68c059a949e5468` closes both
paths without adding position-row work to the Electron main isolate:

- the independent coverage-query worker's exact manifest summaries are copied
  into a main-owned revision-bound oracle only after inventory and outing
  attestation;
- every tile catalog delivery must return one unique content-evidence descriptor
  for every requested chunk revision, including retained worker chunks;
- main requires exact key/revision/count/digest/min/max equality between that
  worker evidence and the independent manifest oracle before any ledger write;
- a semantic mismatch discards the staged catalog, fences the owning tile-worker
  generation, surfaces renderer failure, and leaves the ledger stale; and
- the existing `content_rev` update predicate remains the final TOCTOU fence for
  a normal accepted write after both snapshots.

Green local verification at that application head:

- focused tile-worker/mission-store/oracle: 5 files / 61 tests;
- coverage/participant/rejection-evidence sweep: 45 files / 333 tests;
- full unit: 268 files / 2,152 tests;
- full ESLint, TypeScript, production build, bundle budgets, and diff checks;
- participant/coverage Chromium: 10/10;
- selected critical visual Playwright: 2/2, followed by uncached independent
  critical visual review 2/2 PASS; and
- Rust backend: 51/51, with the intentional real macOS keychain test ignored.

Exact application-head Linux run
[`32944166541`](https://github.com/donal0c/sartracker-web/actions/runs/32944166541)
checked out PR merge ref
`c820a60fcedb9d4815af0542d2a8463acd0e5a08`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`603aadf90250cc8125be5605e68c059a949e5468`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `89c138d859d8e650c04234441d05cfb5af2fcac266927c455d48278b460d016b`,
  integrity `ok`, one restart, zero renderer crashes, and four healthy operator
  interactions;
- Electron-main maximum 27.1239 ms and p95 8.6413 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- Mesa llvmpipe renderer maximum 533.3 ms and p95 300 ms. This is descriptive
  tracking-soak evidence below the separate 1,000 ms renderer/operator freeze
  gate; G2 remains the coverage-renderer budget authority;
- AppImage SHA-256
  `e3381cce6281aaa1ac8423fd42cffc3066ad129af345035784cae7e5d512b9e9`;
- `.deb` SHA-256
  `8a88c45c233622e506089ebb6ba8c298b876a5c54ec08e4dc7a99ce9766d905b`;
- soak report SHA-256
  `c9a2489621ec25633eb01eda8f3c20122c66e151261bfb2387b42cb31a20f8bb`;
- package artifact `9597738814`, uploaded-zip digest
  `649dc0e6bbf1df19a6a553b7a8b859cc5504abc6360df9d0df9c6dec83bc2e0d`;
  and
- validation artifact `9597740140`, uploaded-zip digest
  `29d811a0a2bf2561221e67bd1822b2462f29e036af1b5db30ee25bc341989b4a`.

This remediation changes worker/main semantic trust and ledger application
only. It does not change operator controls, wording, filters, Candidate-B
geometry or period identity, schema v10, default flags, exact Dots, or the
operator manual/screenshots. G2's 960k/2M decision evidence and the 3.704 GB
v9-to-v10 migration remain standing only for those unchanged surfaces. There
was no pre-merge packaged 960k/2M coverage run outside G2 and no packaged
forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head/Linux gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Final attestation, mission-scope, and repeated-participant remediation

The first final-head review wave on `43304c83a4a1d2e9fe21f489f92ede7e3ca7fa27`
was invalidated by five confirmed current findings. Older reports alleging a
missing-inventory false-complete insert, renderer-envelope field override, and
raw tile-coordinate path escape were re-traced and not forwarded because exact
head already closed those paths in `259fd743`/`0e3cf4b`.

The five current red reasons were recorded before production changes:

- a catalog worker could return the exact current contributors with a prior
  valid period digest, allowing stale PBF bytes to be addressed as current;
- removing and later re-adding a participant with the same coordinator-authorized
  effective-from collided with the earlier fixed checkpoint primary key and
  rolled back the valid add;
- a finalized mission's durable critical health remained in the live aggregate
  and could block honest completion for a later healthy mission in the same
  renderer session;
- a normal accepted write between worker claim snapshot and main attestation
  changed `change_seq`, but the main treated that safe race as worker corruption
  rather than returning the newer bounded direct claim; and
- the approved default-on coverage flag started the coverage runtime against
  the historical Tauri store even though that store has no coverage boundary.

Application head `f842190d8815aa9112ba421565aa9b3c1ae6ba9e`
closes those paths without weakening a fail-closed boundary. The catalog result
normalizer recomputes canonical period descriptors from request-owned chunks.
Repeated participant history uses adjacent fixed checkpoints for only the
uncovered suffix; it never rewrites a completed edge. Successful finalization
retires that mission from live aggregate health while preserving the exact
durable state for administrative unlock. A sequence-changed worker claim is
replaced with the current bounded SQLite snapshot as the final non-yielding
step, while same-sequence content disagreement still throws. Coverage remains
default-on for Electron and disabled for unsupported runtimes; startup cleanup
now covers failures while the exact-dot and coverage runtimes are starting.

Green local verification at that application head:

- focused remediation boundary: 6 files / 110 tests;
- full unit: 267 files / 2,147 tests;
- full ESLint, TypeScript, production build, bundle budgets, and diff checks;
- participant/coverage Chromium: 10/10;
- selected critical visual Playwright: 2/2, covering participant backfill
  honesty and failure to prove a final claim;
- uncached independent critical visual review: 2/2 PASS; and
- Rust backend: 51/51, with the intentional real macOS keychain test ignored.

Exact application-head Linux run
[`32940999122`](https://github.com/donal0c/sartracker-web/actions/runs/32940999122)
checked out PR merge ref
`fc8764edcae4f3842d8cbc1d333f5ea458865360`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`f842190d8815aa9112ba421565aa9b3c1ae6ba9e`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `05d0957d8699067f690942689b65412fef87b9bb95609f00be9bc16645df7261`,
  integrity `ok`, one restart, zero renderer crashes, and four healthy operator
  interactions;
- Electron-main maximum 23.3174 ms and p95 8.0913 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- Mesa llvmpipe renderer maximum 400 ms and p95 266.6 ms. This is descriptive
  tracking-soak evidence below the separate 1,000 ms renderer/operator freeze
  gate; G2 remains the coverage-renderer budget authority;
- AppImage SHA-256
  `3ad03362655696a8f7aa32f6697b906fc99672b39a4936755ff64465aae94b37`;
- `.deb` SHA-256
  `d9473108e533c09319764164a065d2621a74d4f32b950f1ad5fde4459647dde6`;
- soak report SHA-256
  `c329960e84fa0d1efa8248bb82f053837bca773dea601dc08221f7f9e746d5f7`;
- package artifact `9596633429`, uploaded-zip digest
  `1b42a8ef073c845494ae45e6ad6b47de5cf0458c1453da7cf4f6e7d3ba6bf8d9`;
  and
- validation artifact `9596634465`, uploaded-zip digest
  `f54913c3a2c028537c40dc30f79397255b6dae0bb15bf71a168a5a9edfd6d829`.

The operator manual now states how a repeated effective-from preserves earlier
completed fixed windows and queues only the uncovered interval. Existing
screenshots remain accurate because no control, wording in the rendered app,
or layout changed. Candidate-B geometry/index construction, schema v10, G2
measurements, G3 flag posture for Electron, exact Dots, and the 3.704 GB
migration surface are unchanged. Their accepted evidence remains standing only
for those unchanged surfaces. There was no pre-merge packaged 960k/2M coverage
run outside G2 and no packaged forced-kill matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head/Linux gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Delayed mission-health settlement remediation

Documentation head `2d8aa8e4977ffd67e48f2bd7a7ea031f3a6385e2` was
invalidated when three independent reviewers traced the same finalized-mission
health race. A startup health read that rejected after finalization lost its
captured mission identity in a shared catch. Separately, a delayed durable
capacity-loss write settled through the global live-health publisher. Either
path could restore an old mission's critical health after it had been retired
and block an unrelated later mission from an honest Complete claim.

The red reason was recorded before production changes. The focused regression
command failed in exactly three places: delayed startup rejection after
finalization, delayed capacity-loss resolve, and delayed capacity-loss reject.
The companion active-mission startup rejection remained green, proving that the
warning must still surface while the captured mission is live.

Application head `b383ef1123263f6ca3c3bbb9748c08332ea1c96f` preserves the
captured mission id for startup success and failure and routes both late
capacity-loss outcomes through the existing finalization-aware mission-health
boundary. Health settling while a mission is finalized is retained outside the
live aggregate and restored only after a successful administrative unlock.
The already single-flight-fenced rejection flush path is unchanged.

Green local verification at that application head:

- focused mission-health regressions: 2 files / 37 tests;
- full deterministic unit gate, serial: 269 files / 2,160 tests;
- full ESLint, TypeScript, production build, bundle budgets, and diff checks;
- participant/coverage Chromium: 10/10;
- selected critical visual Playwright: 2/2, followed by fresh uncached
  independent critical visual review 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T09-11-52Z.json`;
  and
- Rust backend: 51/51, with the intentional real macOS keychain test ignored.

Exact application-head Linux run
[`32951751651`](https://github.com/donal0c/sartracker-web/actions/runs/32951751651)
checked out PR merge ref
`8b1a90ad7fa013d0d26fefa508a4ba5a0e2832a8`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`b383ef1123263f6ca3c3bbb9748c08332ea1c96f`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `5018747b7c39ee55fca5e8547029d410c9c48cde0100fbf9bf8d3d459838cf05`,
  integrity `ok`, clean WAL checkpoint, one restart, zero renderer crashes,
  zero redundant telemetry slope, and four healthy operator interactions;
- Electron-main maximum 40.9353 ms and p95 7.9759 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- Mesa llvmpipe renderer maximum 416.7 ms and p95 250.1 ms. This is descriptive
  tracking-soak evidence below the separate 1,000 ms renderer/operator freeze
  gate; G2 remains the coverage-renderer budget authority;
- peak measured process-tree RSS 1,170,530,304 bytes;
- AppImage SHA-256
  `119816fc1da06b7bf1db03f37ff7678a58bf2e0618a6b46140ab952da90c11af`;
- `.deb` SHA-256
  `903c51c3424ec285c63a175544ec7d8bed14463aa812c107590319b3e6e7515a`;
- soak report SHA-256
  `60e755d10c47eb95666161f960970cd1a26716c8b4a107280efb53eef133a014`;
- package artifact `9600560220`, uploaded-zip digest
  `f85dd9598f71864d29ff24369df2e22fca4a618b4ff4332276ba22612fb45748`;
  and
- validation artifact `9600561392`, uploaded-zip digest
  `bb6cfb87a19302179b37f7ad6c0484ce91ebfa2ebc97a6ef44e8976fff00b6bc`.

This remediation changes no operator control, visible wording, layout,
Candidate-B geometry, schema v10, flag posture, or exact-Dots behaviour. The
operator manual and screenshots therefore remain accurate without a visible
content change. G2's prescribed 960k/2M evidence and the 3.704 GB v9-to-v10
migration remain standing only for their unchanged surfaces. There was no
pre-merge packaged 960k/2M coverage run outside G2 and no packaged forced-kill
matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head/Linux gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Renderer teardown evidence-drain remediation

Documentation head `3769c5b9d7efe13a10a43293288b8fbb7fc161d1` was
invalidated when an exact-head reviewer traced renderer teardown with more than
two bounded rejection batches. `dispose()` waited an existing batch, ran at
most one additional 256-record batch, then could resolve successfully with the
remainder still held only in renderer memory. Runtime replacement was
synchronous and ignored that asynchronous cleanup. A reload after the apparent
success could therefore lose both the anomaly payload and its live blocker,
allowing an eventual false Complete/100% claim.

The red reasons were recorded before production changes. With 513 unique
rejections and a controlled first acknowledgement, disposal attempted only 512
records and resolved. A replacement controller also installed before the
previous asynchronous disposal settled. The new durable teardown-loss reason
was rejected by both outbox and mission store and rendered only as a generic
repair warning. The initial focused RED produced six expected failures while
127 companion tests passed. A separate refactor RED then proved two concurrent
replacements could overtake the first asynchronous disposal.

Application head `1d2aa19d663d6cdd311a0240f2deb83104acd409` closes the
entire teardown chain. Disposal stops new acceptance and retries, waits the
current single flight, then drains bounded batches until empty. If an
unacknowledged batch cannot make progress, every affected mission first receives
the sticky `renderer_pending_evidence_lost` marker; payload memory is released
only after all markers succeed. Missing or failed marker persistence rejects
disposal. App-runtime disposal stops the poller, awaits evidence cleanup before
releasing the remaining runtime owners, and controller replacement is awaited,
serialized, and aborted on cleanup failure. The durable marker survives restart,
is critical in mission health, and blocks finalization/archive completeness.

Green local verification at that application head:

- focused teardown, store, UI, bootstrap, and lifecycle boundary: 7 files /
  160 tests;
- full deterministic unit gate: 269 files / 2,169 tests;
- full ESLint, TypeScript, production build, bundle budgets, and diff checks;
- participant/coverage/tracking Chromium: 13/13;
- selected critical visual Playwright: 2/2, covering the new shutdown-loss
  warning and the existing no-false-complete pending-evidence state;
- fresh uncached independent critical visual review: 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T09-57-13Z.json`
  and
  `test-results/visual-verification/reports/visual-review-2026-08-26T09-57-24Z.json`;
  and
- Rust backend: 51/51, with the intentional real macOS keychain test ignored.

Exact application-head Linux run
[`32955848729`](https://github.com/donal0c/sartracker-web/actions/runs/32955848729)
checked out PR merge ref
`698fd2fa7f3a6bf14214b7565d7e2d778ca6ed88`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and application head
`1d2aa19d663d6cdd311a0240f2deb83104acd409`, and passed:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe attestation, and AppImage window/content launch;
- packaged CI soak: 6/6 batches, 8,664/8,664 source-exact positions, matching
  SHA-256
  `a70b58d3944ab7ddcde3cb17a870aef87da2efc05aa65deb46a3abca387c5d5c`,
  integrity `ok`, clean WAL checkpoint, one restart, zero renderer crashes,
  zero redundant telemetry slope, and four healthy operator interactions;
- Electron-main maximum 44.2964 ms and p95 7.7332 ms against the explicit
  200 ms I5 limit, with zero samples over the limit;
- operator action maximum 107.5 ms with zero samples over 250 ms;
- Mesa llvmpipe renderer maximum 516.7 ms and p95 316.6 ms. This is
  descriptive tracking-soak evidence below the separate 1,000 ms
  renderer/operator freeze gate; G2 remains the coverage-renderer budget
  authority;
- peak measured process-tree RSS 1,194,340,352 bytes;
- AppImage SHA-256
  `9ddf7cbc1d8ba5e6e4086b3dac891b72e9564d9ca436e50c07874324fb436db0`;
- `.deb` SHA-256
  `3b67d2c6826a68947296cd01bfe505369f614894383b6131d4f4b9d46c215593`;
- soak report SHA-256
  `dfbaf64af45503e0e35cc3bf07b16115aacee71999df2e9f96867a348cdce3a1`;
- package artifact `9602085083`, uploaded-zip digest
  `13cc348fbdc78fd2c3bd1055200a37f1ff56b847f3f3c5ed406a54d6212f6cf0`;
  and
- validation artifact `9602086153`, uploaded-zip digest
  `3ea8f58bbb39aa9c2fbe18997cb46531224846f439edd0b329ac6d298bdb4e46`.

The operator manual now explains the all-batch drain, durable shutdown-loss
marker, and replacement stop condition. New screenshot
`public/manual/assets/tracking-shutdown-evidence-loss.png` shows the exact
critical warning while live tracking remains explicitly online. Candidate-B
geometry/index construction, schema v10, G2 measurements, G3 flag posture,
exact Dots, and the 3.704 GB migration surface are unchanged. Their accepted
evidence remains standing only for those unchanged surfaces. There was no
pre-merge packaged 960k/2M coverage run outside G2 and no packaged forced-kill
matrix.

The commit containing this evidence record is documentation-only. It must pass
the deterministic exact-head/Linux gates and five fresh independent exact-head
reviews from zero before PR #3 can be called review ready. No merge or release
occurred.

## Packaged close-path qualification after teardown review

The first renewed review of documentation head `cf32b78` found that the real
Electron window/reload/quit lifecycle did not own the renderer evidence drain.
Application head `bde223b898a85575f7b805492ff522009fd533bc` added the
main-owned bounded handshake, durable fallback and fail-closed operator error.
The follow-on packaged qualification then exposed a native-close race that the
isolated unit handlers did not compose: a window close and the renderer's
`beforeunload` fence could both enter the teardown coordinator, after which the
unload path also scheduled a reload. The red integration test reproduced that
reload before production code changed. Application commit
`9276352e104b648612ca38523dbc678358cce600` makes the close handler the sole
owner while a close is in flight; the permitted second unload proceeds only
after the renderer acknowledgement. The focused close/teardown set passed
5 files / 39 tests and the complete unit gate passed 272 files / 2,190 tests.

The packaged proof harness was also made fail-closed. Both launches of the
active-mission soak now request normal Electron `app.quit()` through the main
inspector, detach the inspector before waiting, require code 0 with no signal,
and record `forced: false, graceful: true`. The standalone AppImage lane starts
a real Openbox instance, attests its EWMH window-manager ID, clicks the actual
Openbox close control, distinguishes a live process from an exited zombie, and
then requires `wait` to return code 0. Direct `xdotool windowclose` was rejected
as proof after source tracing on the available Ubuntu host showed that it
destroyed the X11 surface without emitting Electron's `close` event.

Rejected evidence remains retained:

- run `32960131897` reached a debugger-detach wait, and run `32960912154`
  used an unavailable global `require`; both failed the new graceful-quit gate;
- run `32961681579` attempt 1 failed the hard 200 ms Electron-main gate at
  444.843 ms. Attempt 2 passed the active-mission soak but proved there was no
  real window manager for the standalone close;
- run `32962763214` repeated that missing-window-manager failure;
- run `32963412113` attested Openbox and passed the active-mission soak, but
  used the invalid surface-level `windowclose` operation;
- runs `32964180121` and `32964737361` repeated that falsified close method
  while separately proving that the process was genuinely live, not a zombie;
  and
- run `32966138807` failed closed because the first close-click harness omitted
  `xwininfo -tree` and therefore could not resolve the Openbox frame.

Exact harness/application head `906beb0b91309b38ab9f21443239db059867857a`
then passed Linux run
[`32966604838`](https://github.com/donal0c/sartracker-web/actions/runs/32966604838).
The workflow checked out merge ref
`186ff0b64f2e91a6bbb22d3fca07f7c1cc37eacc`, whose parents are exact PR-2
base `7021fc1ef33e6da5c91c96cd86e836fc3754f48f` and that branch head, and proved:

- Ubuntu x64 AppImage and `.deb` packaging, native SQLite inspection, Mesa
  llvmpipe, EWMH window manager `0x20000e`, non-black app content and a real
  close-control click at `1428,10` followed by code-0 process exit;
- active-mission soak 6/6 batches, exact 8,664/8,664 positions, source digest
  `317a7368d0165cfe4a5f92da8e1c12f39b02bce314f588eb3d269e9b68682fd8`,
  integrity `ok`, clean WAL checkpoint, one restart, zero renderer crashes,
  zero redundant telemetry slope and four healthy operator interactions;
- both soak launches exited by code 0 with `forced: false` and
  `graceful: true`;
- Electron-main maximum 21.9952 ms and p95 9.2078 ms against the 200 ms hard
  I5 limit, with zero samples over the limit; operator action maximum 101.2 ms
  with zero samples over 250 ms;
- descriptive Mesa renderer maximum 366.6 ms and p95 233.4 ms, below the
  separate 1,000 ms freeze limit; G2 remains renderer-budget authority;
- peak measured process-tree RSS 1,194,463,232 bytes;
- AppImage SHA-256
  `0bc747b33539789d402a8f36b2cc9bc1530547c3bf9fa9ff449bc390d57ce845`;
- `.deb` SHA-256
  `2b8083c063e37379217818528f4d06f86ca2403ea5c6ec8f72e4020a864d452b`;
- soak-report SHA-256
  `845e820d37a085f3b9b59ae90d1d25690cd559fd0a9599076f2494045c0f28a7`;
- package artifact `9606058737`, uploaded-zip digest
  `75df79eca53a4f3f08a1a6d828a2249280b5b7122618dad99e5a42c420c48b2f`;
  and
- validation artifact `9606059949`, uploaded-zip digest
  `5ca284f3bf6df3a857cf2a93f597fcb7b6db184d51b1eddee6bcc46af6e5f4a0`.

No operator wording or layout changed after the existing teardown warning and
manual screenshot, so the operator manual remains current. Candidate-B
geometry/index construction, schema v10, G2/G3 posture, exact Dots and the
3.704 GB migration surface are unchanged. There was no pre-merge packaged
960k/2M coverage run outside G2 and no packaged forced-kill matrix. This
evidence-binding commit is documentation-only; it still requires exact-head
deterministic/browser/visual/macOS/Linux gates and five fresh independent
reviews from zero before PR #3 is review ready. No merge or release occurred.

## Finish-fence and strict loss-marker remediation

The renewed review of documentation head
`fa863dadf4b03dd390125bd9c6636a486ba8ecb5` found two independent
lost-evidence P1s. `markEvidenceLoss()` added a critical RAM failure but
swallowed atomic marker-write or directory-sync failure, so main could permit
teardown without a restart-surviving blocker. Separately, Finish changed the
mission to `finished` without draining or sealing renderer rejection evidence;
the teardown fallback then queried only active/paused missions and could return
`no_active_mission` while unsent evidence still existed.

Both findings were centrally source-retraced before editing. The initial
focused RED failed three assertions for exactly those reasons: the marker call
resolved instead of rejecting, the mission boundary called Finish directly,
and no renderer Finish fence existed. A refactor RED then proved failed marker
rename left a temporary file behind.

The remediation makes explicit evidence-loss marking resolve only after the
atomic marker rename and directory sync complete. It retains critical
in-process health on failure, propagates the error to the close/reload/quit
guard, and removes the failed temporary file. Finish now drains every bounded
mission rejection batch, seals late renderer acceptance across the durable
status transition, and leaves the mission active and acceptance retryable if
the drain or Finish operation fails. Finalization advances the already sealed
finished mission without reopening intake; a failed finalization remains sealed
for a safe retry.

Local green evidence before commit:

- focused outbox/Finish/finalization lifecycle: 3 files / 51 tests;
- composed runtime/mission/teardown boundary: 6 files / 89 tests;
- full unit: 272 files / 2,194 tests;
- ESLint, TypeScript, production build and bundle budgets;
- backend: 51 passed, with the intentional real macOS keychain test ignored;
- participant/coverage/tracking Chromium: 13/13;
- selected critical visual Playwright: 2/2; and
- fresh uncached critical visual review: 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T12-44-31Z.json`
  and
  `test-results/visual-verification/reports/visual-review-2026-08-26T12-44-44Z.json`.

The operator manual now states that Finish drains and seals rejection evidence
and is refused if the evidence cannot be made durable. Existing warning layout
and screenshot remain accurate; no new screenshot was required. The invalidated
review wave returned two clean scoped reviews, two P1 reports that independently
confirmed the finished-mission gap, and did not launch its fifth reviewer once
the head was known unsafe. Unsigned macOS packaging, the exact-head Ubuntu
package/soak, and all five fresh reviews remain required after this
code-and-documentation head is committed and pushed. No merge or release
occurred.

## Capacity-marker and in-flight observation remediation

Fresh review of application head
`b82298fa0845950cb11142b8b8bf4c634c172b87` found two further P1 evidence-loss
classes. The renderer discarded the first rejection beyond its 4,096-record
memory boundary after starting a one-shot capacity-marker write; if that write
failed, later queue drain, Finish and disposal did not retry it. Separately, a
current-position response could remain in flight while Finish, settings
replacement or renderer teardown invalidated the poll generation. A rejected
row could then hit sealed intake and be swallowed by the poller's UI-failure
guard, or the entire retrieved response could be discarded before the renderer
evidence drain.

Both findings were centrally source-retraced before editing. The focused RED
failed four exact assertions: Finish-time rejection acceptance threw, no mission
observation token existed, Finish did not retry the failed capacity marker, and
poller stop returned synchronously before the current-position response could be
staged.

The remediation gives every unresolved evidence-loss reason a retained,
retryable durability promise. Finish, finalization and renderer disposal all
await the marker before they may advance. Current-position polls now acquire a
mission evidence observation token without delaying live display. Finish keeps
that scope open across the durable status transition, closes the evidence cutoff
only after the transition succeeds, waits observations already in flight and
drains them. Later current positions still render through their unchanged live
path but carry an explicit null mission-evidence scope. Finalization waits the
closed scope before archiving. Poller stop is asynchronous, settings replacement
awaits it, and renderer disposal starts only after the final retrieved safety
observation has published and staged its accepted/rejected evidence.

Local green evidence before commit:

- focused evidence, polling, runtime lifecycle, finalization and manual set:
  7 files / 192 tests;
- full deterministic unit gate: 272 files / 2,199 tests;
- ESLint, TypeScript, production build, bundle budgets and diff checks;
- backend: 51 passed, with the intentional real macOS keychain test ignored;
- participant/coverage/tracking Chromium: 13/13;
- selected critical visual Playwright: 2/2; and
- fresh uncached critical visual review: 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T13-25-55Z.json`
  and
  `test-results/visual-verification/reports/visual-review-2026-08-26T13-26-18Z.json`.

The manual now describes the durable-marker retry, Finish observation cutoff,
continued live positions and awaited final observation. The warning layout did
not change, so the existing screenshot remains accurate. Exact `b82298f` Linux
run [`32970575273`](https://github.com/donal0c/sartracker-web/actions/runs/32970575273)
passed the unchanged package harness and packaged soak, but it is invalidated as
application-code proof by this remediation. Unsigned macOS packaging, a new
exact-head Ubuntu package/soak and all five fresh independent reviews from zero
remain required. Candidate-B geometry/index construction, schema v10, G2/G3,
exact Dots and the 3.704 GB migration surface are unchanged. No merge or release
occurred.

## Exact package binding after in-flight observation remediation

Application code head
`52455044975ad3c313a750208132be14f1dcf2c5` passed the final package gates
serially. The unsigned macOS arm64 directory package completed locally with no
signing identity, as expected for this qualification lane:

- executable SHA-256
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
  and
- `app.asar` SHA-256
  `bb4ca1b52afc22dbce374598b5f9c0f73511832e2a2539b0b261a752a51ec87c`.

Exact-head Ubuntu 22.04 X11 run
[`32974681357`](https://github.com/donal0c/sartracker-web/actions/runs/32974681357)
completed successfully on the same code SHA. It passed Linux x64 AppImage and
`.deb` construction, ELF x86-64 native SQLite inspection, Mesa llvmpipe
attestation, the packaged CI-scale tracking soak, a real AppImage window launch,
non-black rendered content (`0.484747` grayscale mean), Openbox close-control
delivery and graceful shutdown.

The packaged soak recorded:

- 6/6 accelerated batches, equivalent to 1,080 production polls;
- 8,664/8,664 exact position rows, zero missing source identities, digest
  `17b8bf41c68768ffdc6aba23bd2b0b371021f03e86c6f84cb6973037f5e9ae4b`;
- SQLite integrity `ok`, zero unexplained mission events and zero redundant
  telemetry slope;
- one restart checkpoint, zero renderer crashes and two graceful process exits;
- Electron-main maximum `16.886746 ms`, p95 `9.229005 ms`, zero samples over
  the `200 ms` main-isolate threshold;
- four interactions classified healthy, zero action or external-action samples
  over `250 ms`; and
- peak measured process-tree RSS `1,145,008,128` bytes.

Artifact bindings:

- AppImage SHA-256
  `44f782ec748a482bdc73302aa4c916a55815465f4b4abe97503e91c440d84215`;
- `.deb` SHA-256
  `0393546097ef5249f4b0f360d029e53dbf91d25b144bb9378e1f4e64881320f8`;
- soak-report SHA-256
  `166591caad00af1448b5fcc71147a05d4378f766ef943d34addf47e6080585df`;
- package artifact `9609147611`, uploaded-zip digest
  `d3f227fece76010f85131576b0ab4a7a8a1aeb26ebd8d27644f3471c6d508d34`;
  and
- validation artifact `9609148498`, uploaded-zip digest
  `1af173fd6f6aabedefa217fe628efcbddaf38cf7ce2f721bd99af91312227bc5`.

This binding change modifies documentation and handoff only; executable code,
package inputs and test trees are byte-identical to `5245504`. Candidate-B
geometry/index construction, schema v10, G2/G3, exact Dots and the 3.704 GB
migration surface remain unchanged. There was no pre-merge packaged 960k/2M
coverage run outside G2 and no packaged forced-kill matrix. Five fresh
independent PR-3 reviews from zero remain required on the final evidence-bound
head. No merge or release occurred.

## Finished-mission main-owned teardown fallback remediation

Fresh broad review of evidence-bound head
`dcc950c46cc082f49054b0cc786040188af6dd91` found one further P1. Finish could
complete durably while its final renderer evidence drain remained unsuccessful.
If renderer disposal then also failed, main's fallback queried only
`active/paused`; the now-`finished` mission produced `no_active_mission`, allowing
teardown without a rejection row or durable loss marker.

Central source retrace confirmed every hop before editing. The composed RED
failed because finished-mission cleanup resolved as `no_active_mission`, and the
mission store had no boundary for listing evidence scopes that were not yet
finalized. A separate manual RED required the new fail-closed behavior to be
operator-visible.

The remediation adds one bounded query over mission metadata only, never the
positions table or a global mission timestamp index. It returns `active`,
`paused`, and `finished` mission IDs in deterministic newest-first order and
excludes `finalized`. Whenever the renderer cannot acknowledge cleanup, main
writes a strict durable `renderer_pending_evidence_lost` marker for every such
scope before close, reload, or crash handling may proceed. Multiple writes are
retry-safe; any failed marker keeps teardown blocked.

Local green evidence before commit:

- composed renderer/main/store/Finish/manual lifecycle: 9 files / 163 tests;
- full deterministic unit gate: 272 files / 2,202 tests;
- ESLint, TypeScript, production build, bundle budgets and diff checks;
- backend: 51 passed, with the intentional real macOS keychain test ignored;
- participant/coverage/tracking Chromium: 13/13;
- selected critical visual Playwright: 2/2; and
- fresh uncached critical visual review: 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T13-55-33Z.json`
  and
  `test-results/visual-verification/reports/visual-review-2026-08-26T13-55-51Z.json`.

The operator manual now says that main fences every unfinalized scope,
including a finished mission, before unacknowledged teardown. The warning layout
did not change, so the existing screenshot remains accurate. Exact `5245504`
macOS arm64 packaging and Ubuntu run
[`32974681357`](https://github.com/donal0c/sartracker-web/actions/runs/32974681357)
are invalidated as application-code proof by this Electron-main change. G2/G3,
schema v10, Candidate-B geometry/index construction, exact Dots and the 3.704 GB
migration surface are unchanged. Commit/push, new exact macOS/Linux package
evidence and five fresh independent reviews from zero remain required. No merge
or release occurred.

## Exact package binding after finished-mission fallback remediation

Application code head
`0c674e81e97f0376bff268d181d99a1583cd1556` passed the final package gates
serially. The unsigned macOS arm64 directory package completed locally with:

- executable SHA-256
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
  and
- `app.asar` SHA-256
  `37f039d4ea9db3ee4feae96de15706ee209545e72e3a286d2cd25b4acd14e623`.

Exact-head Ubuntu 22.04 X11 run
[`32977328663`](https://github.com/donal0c/sartracker-web/actions/runs/32977328663)
completed successfully on the same code SHA. Linux x64 AppImage and `.deb`
construction, native SQLite inspection, Mesa llvmpipe attestation, packaged
CI-scale tracking soak, non-black real AppImage launch (`0.484747` grayscale
mean), Openbox close-control delivery and graceful shutdown all passed.

The packaged soak recorded:

- 6/6 accelerated batches, equivalent to 1,080 production polls;
- 8,664/8,664 exact position rows, zero missing source identities, digest
  `18abd0a96e8f0a8f3bc2a59a7cc278a9b314172e92a187d7cf24403d569e2940`;
- SQLite integrity `ok`, zero unexplained mission events and zero redundant
  telemetry slope;
- one restart checkpoint, zero renderer crashes and two graceful process exits;
- Electron-main maximum `39.243873 ms`, p95 `9.085615 ms`, zero samples over
  the `200 ms` main-isolate threshold;
- four interactions classified healthy and zero interaction errors; one
  external-action sample measured `259.025957 ms` against the descriptive
  `250 ms` sub-threshold, while the harness verdict remained valid/PASS; and
- peak measured process-tree RSS `1,160,245,248` bytes.

Artifact bindings:

- AppImage SHA-256
  `71ce4d954417dfa0b24cdb021b5dc97d9507db01afbb81826043dd8ab27524f4`;
- `.deb` SHA-256
  `f197bac906f891fba111e48a19a6353b2676480ad14e42492bda00f39d31c725`;
- soak-report SHA-256
  `2240c8fdcdcc5f898d3a9608a70dba1347b54fe1f47b2786f8083e5edbb9467c`;
- package artifact `9610173574`, uploaded-zip digest
  `98b1771b3bf2b917ed3f9fa44b49ebff6b4443ec1469ab9ae5fbf95a6f4987ab`;
  and
- validation artifact `9610174645`, uploaded-zip digest
  `013684c5e7db14aaa1bb8935b31a53705ec46006bef0ac8994aeb68ed3c928b0`.

This binding change modifies documentation and handoff only; executable code,
package inputs and test trees are byte-identical to `0c674e8`. Candidate-B
geometry/index construction, schema v10, G2/G3, exact Dots and the 3.704 GB
migration surface remain unchanged. There was no pre-merge packaged 960k/2M
coverage run outside G2 and no packaged forced-kill matrix. Five fresh
independent PR-3 reviews from zero remain required on the final evidence-bound
head. No merge or release occurred.

## Pre-cutoff accepted-fix Finish remediation

One of the two broad reviews of evidence-bound head
`1f34299442f16acdc27e5567d538e3b7240f156e` found a further P1. The renderer
Finish fence called the durable `finished` transition before waiting for an
already-started current-position observation. A valid fix arriving during that
window then queried for an active mission, found none, and could be omitted from
both the positions table and coverage ledger while Finish still resolved.

Central source retrace confirmed the ordering and the exact persistence path.
The first RED proved that the durable Finish operation was called while one
mission observation remained active. A second RED proved that a post-cutoff
snapshot was still admitted to mission persistence even though its live marker
remained visible. The operator-manual RED rejected the obsolete claim that
evidence intake stayed open across the durable status transition.

The corrected boundary now closes admission to new mission observations, waits
for every already-started observation to finish accepted and rejected evidence
persistence while the mission remains writable, drains renderer-held evidence,
and only then commits `finished`. Failure before or during the durable
transition reopens admission and leaves the mission active. A post-cutoff
snapshot continues to update current safety positions but is not inserted into
mission evidence. A real SQLite regression proves that a deferred pre-cutoff
valid fix exists in the finished mission and that its exact coverage manifest
contains one fix before Finish resolves.

Local green evidence before commit:

- focused Finish/tracking/coverage/manual set: 6 files / 170 tests;
- full deterministic unit gate: 272 files / 2,204 tests;
- ESLint, `tsc --noEmit`, production build, bundle budgets and diff checks;
- backend: 51 passed, with the intentional real macOS keychain test ignored;
- participant/coverage/tracking Chromium: 13/13;
- selected critical visual Playwright: 2/2; and
- fresh uncached critical visual review: 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T14-35-09Z.json`.

The manual now states the actual cutoff order. No visible layout or warning
surface changed, so the existing screenshots remain accurate. Earlier macOS
and Ubuntu package/soak evidence is invalidated as exact application-code proof
by this lifecycle change. Candidate-B geometry/index construction, schema v10,
G2/G3, exact Dots and the 3.704 GB migration surface are unchanged. Commit,
push, exact-head macOS/Linux package evidence and five fresh independent PR-3
reviews from zero remain required. No merge or release occurred.

## Exact package binding after pre-cutoff accepted-fix remediation

Application code head
`9253d89d10ad1b6684c07dbe9a4bba2eb256ba7d` passed the final package gates
serially. The unsigned macOS arm64 directory package completed locally with:

- executable SHA-256
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
  and
- `app.asar` SHA-256
  `5703bc60bc64183a2377521d9e204546eb9e29db78abebce3621314b3ef58890`.

Exact-head Ubuntu 22.04 X11 run
[`32981424686`](https://github.com/donal0c/sartracker-web/actions/runs/32981424686)
completed successfully on the same code SHA. Linux x64 AppImage and `.deb`
construction, native SQLite inspection, Mesa llvmpipe attestation, packaged
CI-scale tracking soak, non-black real AppImage launch (`0.484747` grayscale
mean), Openbox close-control delivery and graceful shutdown all passed.

The packaged soak recorded:

- 6/6 accelerated batches, equivalent to 1,080 production polls;
- 8,664/8,664 exact position rows, zero missing source identities, digest
  `68899fd5416dd4a90fed81efa82475a8ff6938cbc45efd9eafbfd50e0b08a794`;
- SQLite integrity `ok`, zero unexplained mission events and zero redundant
  telemetry slope;
- one restart checkpoint, zero renderer crashes and two graceful process exits;
- Electron-main maximum `25.242748 ms`, p95 `7.695776 ms`, zero samples over
  the `200 ms` main-isolate threshold;
- four interactions classified healthy and zero interaction errors; one
  external-action sample measured `255.025373 ms` against the descriptive
  `250 ms` sub-threshold, while the harness verdict remained valid/PASS; and
- peak measured process-tree RSS `1,154,412,544` bytes.

Artifact bindings:

- AppImage SHA-256
  `75b74b34989043561a7a9e036344c0d84fbe68fae1ff6c8f04528d4f18becfc7`;
- `.deb` SHA-256
  `37715f04284532857dabe0b2ee4f574b5f7685d31451891b1b8761f161c26b54`;
- soak-report SHA-256
  `81bf188df22641fe49aa899c05ecc20bcc3a619ea42e5ba1e80c22bae8330fb4`;
- package artifact `9611798155`, uploaded-zip digest
  `fe70f54ce2a798dc9d5c209a20786207cc892107a6fea0a72e33fb079a51a00c`;
  and
- validation artifact `9611799941`, uploaded-zip digest
  `0551c3b942e40b782b7425c677a9d6c29bdf6df96a239691d080036be90b70bc`.

This binding change modifies documentation and handoff only; executable code,
package inputs and test trees remain byte-identical to `9253d89`. Candidate-B
geometry/index construction, schema v10, G2/G3, exact Dots and the 3.704 GB
migration surface remain unchanged. There was no pre-merge packaged 960k/2M
coverage run outside G2 and no packaged forced-kill matrix. Five fresh
independent PR-3 reviews from zero remain required on the final evidence-bound
head. No merge or release occurred.

## Fatal-main and unclean-session evidence remediation

Fresh broad review of evidence-bound head
`848bfb2246939fd4635a7125edd8d0fe5002fcb9` found a further P1. The fatal
main-process exception handler recorded diagnostics and called `app.exit(1)`
without using the renderer-evidence coordinator. Because `app.exit` bypasses
the guarded `before-quit` path, renderer-held mission evidence could disappear
without a durable blocker and a later restart could claim Complete.

Central source retrace confirmed the direct exit and the missing fatal-path
coordinator call. Three REDs proved that fatal relaunch did not wait for the
evidence fence, fence failure still relaunched, and a recorded unclean restart
opened the operator window without marking uncertainty. A fourth RED proved
that a hard process loss without a JavaScript crash callback was not detectable
from the existing clean-exit timestamp alone. The manual RED rejected the
missing operator guidance.

The remediation makes the fatal handler await the main-owned durable loss
marker before relaunch. If that marker cannot be written, SAR Tracker refuses
automatic relaunch, keeps the current process open and shows a native safety
message. The crash log now owns an atomic active-session marker: startup checks
the previous marker, then records the current session; clean exit removes it
only after its durable clean timestamp succeeds. After a fatal exception,
SIGKILL, power loss, or other unclean termination, startup durably blocks every
`active`, `paused`, or `finished` mission before creating an operator window.
Failure to write those blockers aborts startup and is retried on the next
launch. A composed real-SQLite regression proves the recovered mission health
is `critical` with `renderer_pending_evidence_lost`.

Local green evidence before commit:

- focused crash/main/coordinator/store/coverage/manual set: 7 files / 140 tests;
- full deterministic unit gate: 272 files / 2,208 tests;
- ESLint, `tsc --noEmit`, production build, bundle budgets and diff checks;
- backend: 51 passed, with the intentional real macOS keychain test ignored;
- participant/coverage/tracking Chromium: 13/13;
- selected critical visual Playwright: 2/2; and
- fresh uncached critical visual review: 2/2 PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T15-09-43Z.json`.

The first full-unit attempt recorded one unrelated breadcrumb-accumulator
timing at `102.629 ms` against its `100 ms` test gate. The exact assertion then
passed three serial isolated repetitions and the full 2,208-test rerun passed.
The first Chromium attempt lost one harness execution context during navigation;
the affected flow passed three serial isolated repetitions and the full 13-test
rerun passed. Neither partial run is counted as the final green gate.

The manual now documents fatal-restart refusal and pre-window recovery marking.
The existing critical evidence screenshot remains accurate because the tracking
warning surface did not change. Earlier macOS and Ubuntu package/soak evidence
is invalidated as exact application-code proof by this Electron startup change.
Candidate-B geometry/index construction, schema v10, G2/G3, exact Dots and the
3.704 GB migration surface are unchanged. Commit, push, replacement exact-head
macOS/Linux package evidence and five fresh independent PR-3 reviews from zero
remain required. No merge or release occurred.
## Evidence-lifecycle architecture pause — 2026-08-26

Donal paused the repeated PR-3 review loop and applied the bounded review
topology to PR-3. Fresh Fable session
`a5493464-eb53-4231-a686-1aed764e3cb7` attacked the full admission → renderer
RAM → durable outbox/ledger → coverage claim → Finish/finalize → teardown/crash
→ restart seam at exact clean head
`397adc8d275b63b7a71d3d96208eb0bf787cd1c6`. Its bound report is
`tmp/agent-mail/fable-pr3-evidence-seam-20260826.md` with sentinel
`AGENT_MAIL_DONE_1787758367`.

Central source retrace confirmed two engineering defects before production
changes resumed:

1. `crash-log.cjs` atomically renames the active-session marker but does not
   fsync the file or containing directory, and removes it without a directory
   fsync. Power loss can therefore erase the evidence-loss startup fence or
   resurrect it after a clean exit.
2. `render-process-gone` starts `markRendererUnavailable()` without joining it
   to application lifecycle state. `window-all-closed` can enter clean quit
   while that promise is pending, see no remaining windows, remove the active
   marker, and exit before the mission loss marker is durable. macOS activation
   can likewise create a replacement renderer before a failed loss fence is
   retried.

Strict RED command:

`npx vitest run tests/unit/electron-durable-file.test.ts tests/unit/renderer-teardown-coordinator.test.ts --pool=forks --maxWorkers=1`

Expected RED result: `electron/durable-file.cjs` does not exist, and both
unexpected-renderer-loss lifecycle tests fail because
`ensureUnexpectedRendererLossFenced` does not exist (`2 files failed`; existing
coordinator tests remained `8 passed`). No production code was changed before
this recorded RED.

Fable also proposed an admin acknowledgement that would permit finalization and
archive after known evidence loss while keeping Complete blocked. The ledger
does not contain a direct team answer authorizing that transition. Donal asked
for the safest repository-consistent engineering interpretation because he is
the developer, not an operational team member, and no further team answer is
available. The locked interpretation is therefore recorded explicitly as an
inference from `SAR-QA-020`: known evidence loss remains visible forever and
permanently blocks Complete and 100%; a roster-authorized admin may append their
identity, timestamp and reason against the exact current loss occurrence only
to permit archive and read-only finalization. The acknowledgement does not
restore evidence or certify completeness, and any later loss occurrence
invalidates it.

Additional central attack testing found that the generic finalization error
could initially open that acknowledgement UI for unrelated pending, corrupt or
globally degraded evidence. The recorded RED reproduced the incorrect dialog
for `outbox_corrupt_record`. The UI now offers acknowledgement only for
`renderer_pending_evidence_lost` or
`renderer_pending_capacity_exhausted`; every other evidence-health failure
remains an absolute finalization/archive blocker. A separate adapter RED proved
that the legacy Tauri adapter would invoke a nonexistent command. It now fails
closed with an explicit Electron-only boundary instead of advertising backend
support that does not exist.

The coherent implementation uses a shared durable-file boundary: a temporary
0600 file is written, file-synced, closed, atomically renamed and followed by a
containing-directory sync; clean removal is also directory-synced. The
renderer teardown coordinator records unexpected loss synchronously, coalesces
the in-flight durable fence, retries a failed fence, and makes clean quit and
macOS replacement-window activation await it. A failed replacement fence keeps
the new renderer closed and raises an operator-visible native safety message.

The mission-scoped outbox retains a monotonic loss generation in its durable
marker. An acknowledgement token binds the mission scope, exact sticky reason
set and generation. It is accepted only when the mission has no pending or
corrupt durable evidence and no global or non-acknowledgeable failure. The
append-only SQLite audit records admin, time, reason, loss reasons and token;
the outbox marker is never removed. Finalize/archive re-check the current token
inside the serialized evidence fence. Restart preserves it, and another loss
increments the generation and invalidates it. Health stays `critical`, so the
coverage controller can never claim Complete or 100%.

Further REDs and refactor evidence:

- `outbox_corrupt_record` initially opened the acknowledgement dialog from the
  generic finalization error; it now remains a hard block and the dialog is
  limited to the two exact renderer-loss reasons;
- a pending mission outbox file initially allowed a loss candidate to be read;
  candidate creation now rejects until all pending/corrupt durable evidence is
  resolved;
- the legacy Tauri adapter initially invoked the nonexistent
  `acknowledge_ingest_evidence_loss` command; it now fails closed with an
  explicit Electron-only boundary; and
- the first production build exceeded the default application-chunk budget by
  1,104 bytes. The evidence dialog and shared keyboard-contained decision
  surface were split into bounded lazy chunks; the application chunk is now
  497,910 bytes against the unchanged 500,000-byte budget.

Final local code-tree verification before the package binding commit:

- full deterministic unit gate: 273 files / 2,227 tests;
- focused seam gate: 11 files / 194 tests, followed by the added containment
  regressions;
- ESLint, TypeScript production build and unchanged bundle budgets: PASS;
- changed Electron CJS syntax: PASS;
- exact paged Dots contract: 10/10;
- participant/coverage/tracking Chromium: 13/13;
- known-loss archive flow Chromium: 1/1;
- known-loss critical visual Playwright: 1/1;
- fresh uncached visual review: PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T16-41-44Z.json`;
  and
- backend: 51 passed, with the intentional real macOS keychain test ignored.

The new operator screenshot is
`public/manual/assets/mission-evidence-loss-acknowledgement.png`. The manual
states that acknowledgement does not restore evidence, never permits Complete
or 100%, and does not apply to repairable, pending, corrupt or newly changed
evidence. Replacement exact-head macOS/Linux package and soak evidence remains
required before the bounded final review wave. No merge or release occurred.

## Whole-seam replacement package binding — 2026-08-26

Application and documentation commit
`a4de1f07fbfc94a6fdd298a4af85eb0a38e1d342` was pushed before package
qualification. Unsigned macOS arm64 packaging passed. The packaged executable
and `app.asar` SHA-256 values are
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and
`c1fa878437d7db8709510019f3d81ba2bfb65d92f3fdbfd4c07e1ae97b144d65`.

The Ubuntu reference host cloned that exact pushed commit into the isolated
path `/home/donal/sartracker-pr3-exact-a4de1f0/repo`, verified its HEAD and
clean tree, installed the lockfile dependencies, and built the unsigned x64
package. The packaged executable and `app.asar` SHA-256 values are
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and
`4d71baa844dad0c761e974b4a8be3f419f2b5e41eff62348e1f92cfc02dec376`.

The single replacement CI-scale packaged soak used the host's existing active
Xwayland desktop at display `:0`; ANGLE/OpenGL and `glxinfo` both attested Mesa
llvmpipe. It passed:

- 6/6 batches and 8,664/8,664 source-exact positions with matching SHA-256;
- one clean restart, two graceful exit-zero launches and zero renderer crashes;
- database integrity `ok`, WAL `0/0/0`, 32 participant rows, two declared
  backfill-completion events and zero unexplained operational events;
- four healthy operator interaction checks with zero errors;
- main-process maximum 8.199 ms and renderer maximum 100.200 ms, both below
  their gates;
- zero redundant telemetry slope; and
- peak measured process-tree RSS 1,135,435,776 bytes.

The report SHA-256 is
`7a0f49ea3d4120a45607cae3ebf6ddd041d82086d9ce8aec6aa4962dce33e7c5`.
The post-run coverage ledger has one mission at change sequence 74, 32 chunks,
zero pending invalidations, 20,480 coverage bytes and integrity `ok`. Bound
evidence is under
`output/pr3-packaged-soak/a4de1f07fbfc94a6fdd298a4af85eb0a38e1d342/`;
its evidence-manifest SHA-256 is
`4a7fae1767aaeaef6f147ccce67058393bf06e343d2127b95bc24ef0db5e1ad8`.

This replacement validates the changed Electron lifecycle and packaged hot
path. The earlier 3.704 GB v9-to-v10 migration remains standing because this
commit changes neither schema/open code nor Candidate-B geometry/query
construction. G2's 960k/2M benchmark and corrected production qualification
likewise remain standing under their recorded invalidation rules. As required,
there was no new packaged 960k/2M coverage run, packaged forced-kill matrix,
Windows run, field-hardware run, or post-merge coordinator checkpoint. The
next commit binds only evidence and current handoff state; executable code and
test trees remain byte-identical to `a4de1f0`. One fresh broad exact-head review
plus the three targeted exact-head rechecks remains required. No merge or
release occurred.

## Final bounded-review evidence-lifecycle attack — RED, 2026-08-26

The amended one-broad-plus-targeted review wave was paused after independent
renderer, persistence and concurrency retraces converged on the same lifecycle
seam. Central source retrace confirmed four release-blocking RED reasons before
production code changed:

- `markRendererUnavailable()` retained the first successfully settled crash
  fence forever. A later explicit renderer crash therefore reused an older
  `no_unfinalized_mission` or loss result instead of recording a new durable
  loss generation. This can either erase a later mission's renderer-only
  evidence entirely or leave an earlier admin acknowledgement incorrectly
  valid after another loss.
- a breadcrumb-history snapshot could start before Finish but publish through
  the async `onSnapshot` path without joining the mission observation fence.
  Finish could make the mission inactive first, after which the queued accepted
  fixes were silently discarded by the active-mission persistence check.
- startup hydrated evidence health only for the active mission. After restart,
  a finished mission with permanent renderer evidence loss remained blocked in
  the backend, but the governance UI did not have its mission-scoped reason and
  could not offer the narrow audited acknowledgement path.
- the browser-validation store retained evidence loss in session storage but
  its coverage claim considered only participant backfill. After reload it
  could return `databaseReady: true` for a mission with known evidence loss,
  allowing the validation UI to exercise a false Complete/100% path that the
  production backend correctly blocks.

The required RED regressions are: two explicit crash incidents produce two
durable loss occurrences while a concurrent lifecycle join still coalesces;
pre-Finish history publication is joined or rejected before persistence scope
closes; governance startup rehydrates the exact finished mission's health and
uses it for acknowledgement containment; and browser coverage claims remain
blocked across a retained-loss reload. No production fix is credited until all
four fail for the recorded reason and then pass together.

The four core REDs failed exactly as recorded: the replacement-renderer API did
not exist; the governance runtime never read finished-mission health; the
browser claim returned `databaseReady: true` with no blockers after retained
loss; and neither fallback breadcrumb publication nor direct reconciliation
persistence entered the mission observation fence. The first corrected visual
run then found a fifth edge at the same seam: loss injected after the finished
mission had already been selected left governance health stale until reload,
so the durable finalization refusal showed only a generic error. A focused RED
proved that blocked finalization did not refresh mission-scoped health.

The coherent GREEN uses explicit renderer-incident generations. Concurrent
quit, relaunch, or restore work joins the current durable loss fence; only a
successfully loaded replacement renderer marks that incident closed, after
which another fault creates another durable loss occurrence. Current fixes,
fallback breadcrumb publications, and direct reconciliation writes now use one
mission-scoped admission counter. Finish closes admission, drains everything
already accepted, then changes durable mission status; later history remains
outside the closed mission without delaying current safety positions.

Governance now owns health for its exact finished/finalized mission, reloads it
at startup, refreshes it again after a blocked finalization, and never projects
that warning onto a different active or recoverable mission. The browser
validation claim mirrors the production mission-scoped ingest blocker across
session reload and after acknowledgement, so its Complete/100% oracle cannot
certify known loss.

Final pre-commit local GREEN:

- focused evidence-lifecycle set: 9 files / 244 tests;
- full deterministic serial gate: 273 files / 2,234 tests;
- ESLint, TypeScript production build, unchanged bundle budgets, diff checks,
  and changed Electron CJS syntax: PASS;
- participant/coverage/tracking Chromium: 13/13;
- loss → Finish → browser reload → acknowledgement → archive Chromium: 1/1;
- known-loss critical visual Playwright: 1/1;
- fresh uncached visual review: PASS at
  `test-results/visual-verification/reports/visual-review-2026-08-26T17-26-45Z.json`;
  and
- backend: 51 passed, with the intentional real macOS keychain test ignored.

The fresh broad, persistence, concurrency, and renderer-containment reviewers
independently converged on only these four original blockers at documentation
head `d4a6f18`; no additional renderer/input-containment blocker was found.
Those reviews diagnose the superseded code and do not approve this fix. The
amended topology therefore requires one fresh broad review plus only the three
affected targeted exact-head rechecks after the replacement macOS/Linux
package evidence is bound. No five-review restart, merge, or release occurred.

### RED — renderer drain deadline contract after Opus exact-head review

The Opus review of application head `ae134245e833a20bd67b0bae0ab5194779e17599`
identified one additional P1 at the same evidence-lifecycle seam. Central source
retrace confirmed the defect before production changes: main treats the
five-second renderer drain timeout as proof of permanent evidence loss, while
the renderer first awaits a bootstrap promise whose own watchdog is 30 seconds.
A clean drain acknowledgement arriving after five seconds is discarded, so a
benign slow boot or cleanup can permanently block Complete/100% and advance the
loss generation despite no evidence being lost.

One detail in the review's reproduction was disproved without weakening the
finding: the 3.704 GB v9-to-v10 migration runs synchronously in Electron main
before the renderer window is created, so that migration cannot itself occupy
this renderer acknowledgement window. Renderer bootstrap and runtime cleanup
still have legal paths longer than five seconds, so the deadline inversion and
false permanent-loss result remain confirmed.

The replacement contract is pinned red before implementation:

- five seconds is a soft deadline that durably records provisional uncertainty
  but does not allow renderer teardown or consume a loss generation;
- a matching late `ok: true` acknowledgement retracts that exact provisional
  marker and permits teardown;
- an explicit negative acknowledgement, actual renderer loss, or restart with
  unresolved provisional uncertainty seals permanent loss exactly once;
- every mission-scoped provisional write carries the bounded reason that the
  mission could own renderer evidence; and
- the production claim boundary has named tests for `not_enumerated`,
  `chunk_missing`, and `ingest_outbox_pending` rather than relying on the
  browser harness as the database oracle.

Expected RED reasons: the current coordinator settles at the five-second timer
and calls permanent `recordIngestEvidenceLoss`; the outbox has no provisional
stage/retract contract; the mission store returns bare mission IDs without scope
reasons; and the three production claim blockers are not pinned as named cases.

### GREEN — provisional uncertainty, exact promotion, and direct claim proof

Main now treats five seconds as a soft durability checkpoint rather than a
teardown permission. It writes `renderer_evidence_pending` against each exact
mission scope and leaves the renderer alive. A matching late clean drain removes
that exact incident without changing `lossGeneration`; an explicit negative
reply or actual renderer loss promotes it to `renderer_pending_evidence_lost`;
and startup promotes a provisional marker left by process loss exactly once.
Active, paused, and finished missions carry distinct bounded scope reasons, and
the mission store rejects a reason that does not match durable mission state.

The browser harness remains UI/workflow evidence, not the production database
claim oracle. Named production-boundary tests now pin `not_enumerated`,
`chunk_missing`, and `ingest_outbox_pending`. The pull-request Linux workflow
now runs ESLint, the complete unit suite, and the production build/bundle budgets
before packaging instead of running only `vite-config.test.ts`.

Current local GREEN before replacement package proof:

- deadline/outbox/mission-store/claim focus: 5 files / 153 tests;
- renderer main wiring focus: 4 files / 43 tests;
- full deterministic serial gate: 273 files / 2,242 tests;
- ESLint: PASS; and
- TypeScript, production build, and bundle budgets: PASS.

### Replacement package and packaged-soak binding

Application head `42f169426170cbc450dd02e32b617c7238f7705e` packages the
coherent soft-deadline correction. The review source is Donal's Opus artifact
at <https://claude.ai/code/artifact/2fca49bf-5dbf-4f9b-a75d-5a33573ca7bd>;
that review was static and did not itself run tests, builds, or packaged proof.

- macOS arm64 package executable SHA-256:
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
- macOS arm64 `app.asar` SHA-256:
  `74e292ce8707b3244cd503d5a445fbeda00420e05838233115df05a5bda48aba`;
- Linux x64 package executable SHA-256:
  `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`;
  and
- Linux x64 `app.asar` SHA-256:
  `adeb6020e2698d59600f3736eb3a7183f1b51a6a76de12f8d6e347eff16839ad`.

The one permitted replacement packaged CI-scale soak ran serially on the
reference Ubuntu X11 session with Mesa llvmpipe through ANGLE/OpenGL and passed:

- 6/6 accelerated batches, 8,664/8,664 source-exact positions, and digest
  `92ba4387791f767ff8f28a32b930c455f1373dd81c1c2f82a79c48031c5c7c13`;
- one restart, two accepted WebGL launches, and zero renderer crashes;
- SQLite integrity `ok`, WAL 0/0/0, zero unexplained mission events, and zero
  redundant-telemetry slope;
- main-process maximum 8.871 ms and renderer maximum 100.3 ms, both below
  their gates;
- all four operator interactions classified `healthy`, with action maximum
  33.2 ms and external-action maximum 84.452 ms; and
- peak process-tree RSS 1,148,829,696 bytes.

The post-soak coverage ledger contains one mission row at change sequence 84,
32 chunk rows, zero pending invalidations, 20,480 bytes across coverage
tables/indexes, and integrity `ok`. The immutable evidence bundle is
`output/pr3-packaged-soak/42f169426170cbc450dd02e32b617c7238f7705e/`.
Its manifest SHA-256 is
`3a3641ef531e376c7dd3d6eaa9d858101b01c082a47c0a57b56126d80c95c8e4`;
the soak report SHA-256 is
`639a5a699c1ad0c1b83abd3757c530807b4f01b803d34da42b6ca86138c801e5`.

The expanded pull-request Linux job then reproduced the full 273-file suite
and exposed one pre-existing test-contract mismatch: the DON-269 test is named
and specified as a 200 ms renderer gate but asserted 100 ms. GitHub measured
140.628 ms, within the actual gate. That RED is corrected by aligning the
assertion to 200 ms; the focused file passes 26/26 locally. The replacement CI
run and the amended broad plus three targeted exact-head reviews remain before
merge readiness. The package, soak, schema, migration, geometry, and runtime
code are unchanged by this test-only correction.

### RED — final bounded review attack on accepted persistence and drain scope

The amended exact-`80cc941` review wave found three further cases at the same
evidence-lifecycle boundary, all centrally source-retraced before production
changes:

- an accepted pre-Finish fix whose SQLite write rejected settled its observation
  as a volatile warning only, so Finish could succeed without either the fix or
  a durable completeness blocker;
- the soft-deadline scope snapshot was reused after a later negative drain, so
  a mission opened during the slow drain could lose renderer evidence without
  a marker; and
- sequential multi-mission provisional staging did not retract an earlier
  successful scope when a later scope rejected, allowing restart to promote the
  orphaned provisional marker to false permanent loss.

The strict-TDD RED run was 3 files / 107 tests with exactly five failures: no
public durable mission-persistence-loss boundary, no marker call after an
accepted write failure, the snapshot callback resolved when marker durability
failed, the late mission was omitted from the negative-drain result, and the
partially staged first scope was not retracted. Current-position rendering
remained synchronous and visible in the failure reproduction. No production
code is credited until the five cases pass together.

### GREEN — accepted-write durability and refreshed teardown scope

The renderer still publishes every valid current position before mission
persistence side effects. If an accepted mission write then rejects, the
runtime records `mission_persistence_failed` through the same durable critical
health boundary used by finalization. The observation cannot settle safely
without that marker: a failed marker write rejects the callback, remains in the
delivery object's in-process loss state, and is retried by the Finish fence.
Once durable, finalization and Complete/100% remain blocked under the existing
audited known-loss policy.

The teardown coordinator now re-enumerates current mission scopes after an
explicit negative drain or actual renderer loss and unions them with the soft-
deadline snapshot. Missions opened during the wait therefore cannot be missed.
Sequential provisional staging is compensating: if any scope write fails, all
earlier successful provisional records are retracted before teardown rejects.
Promotion/retraction attempts cover every scope and aggregate any failures
instead of abandoning the suffix.

Current local GREEN before replacement exact-head package proof:

- focused evidence-lifecycle and manual set: 9 files / 250 tests;
- full deterministic gate: 273 files / 2,249 tests;
- ESLint, TypeScript, changed CJS syntax, diff check, production build, and
  bundle budgets: PASS;
- selected Chromium mission lifecycle: 16/16; and
- selected critical visual workflows: 2/2, with both fresh uncached Opus
  visual reviews PASS.

The earlier `42f1694` macOS/Linux packages and Ubuntu soak are superseded for
the changed runtime seam. Replacement exact-application-head package and soak
bindings, expanded Linux CI, and the amended broad plus three targeted reviews
remain mandatory before merge readiness.

### Replacement application-head package and Ubuntu soak

Application head `21a16fec2baadde01be8f79b717a1b8d77592199` contains the
complete accepted-write/scope-compensation repair. Its exact packages bind as:

- macOS arm64 executable SHA-256:
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
- macOS arm64 `app.asar` SHA-256:
  `d867354b871679658f1c91ba7ab660611abf66446d59f9caadf185beb1e88962`;
- Linux x64 executable SHA-256:
  `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`;
  and
- Linux x64 `app.asar` SHA-256:
  `7231827edc96227de19ee9413801eac404c3e9666ca827524045f7749cc782c8`.

The one replacement packaged CI-scale tracking soak ran serially on the
reference Ubuntu X11 session with Mesa llvmpipe through ANGLE/OpenGL and
passed:

- 6/6 accelerated batches, 8,664/8,664 source-exact positions, and digest
  `3e42e488cce2e76ae1dc728876aaf24472de48425d50f8df135ee0c4c132175b`;
- one restart, two accepted WebGL launches, and zero renderer crashes;
- SQLite integrity `ok`, WAL 0/0/0, zero unexplained mission events, and zero
  redundant-telemetry slope;
- main-process maximum 12.160 ms and renderer maximum 100.234 ms, below their
  gates;
- all four operator interactions classified `healthy`, with action maximum
  37.0 ms and external-action maximum 96.707 ms; and
- peak process-tree RSS 1,148,231,680 bytes.

The coverage ledger contains one mission row at change sequence 82, 32 chunk
rows, zero pending invalidations, 20,480 coverage-table bytes, and integrity
`ok`. The immutable bundle is
`output/pr3-packaged-soak/21a16fec2baadde01be8f79b717a1b8d77592199/`.
Its manifest SHA-256 is
`5a0f1d379f1f2e96895e46e449cb6a10623695580fe8225528d97459da232489`;
the soak report SHA-256 is
`9c31de2105471c9212946b89b3ad558e84f322c0c6448554862ff1e502243d61`.

Expanded GitHub run `33002926988` exercised all 273 files and found one
execution-harness failure: the unchanged 200 ms DON-269 assertion measured
216.929 ms while its file competed with the rest of the suite on the shared
runner. The budget remains 200 ms. The pull-request workflow now runs the full
suite with `--no-file-parallelism`, preserving all 2,249 tests and removing
cross-file CPU contention from wall-clock gates. That exact command passes
locally in 135.74 s; the focused accumulator file passes 26/26. A green GitHub
rerun remains required.

### RED — deferred accepted evidence and durable renderer incident ownership

The amended exact-head concurrency review and Donal's final Opus review found
two release-blocking cases at the same evidence-lifecycle seam. Central source
retrace confirmed both before production changes:

1. A current-position poll accepted for mission evidence could finish its
   mission observation while participant scope was still loading. The single
   deferred display slot was then overwritten or persisted later outside the
   Finish/runtime-stop fence; mission change returned fulfilled `null`, so
   accepted fixes could disappear without `mission_persistence_failed`.
2. Sequential provisional renderer staging compensated a partial stage, but a
   failed compensation left durable `renderer_evidence_pending` state with no
   retained incident owner. A later clean drain did not retract it, and restart
   promoted it to false permanent loss.

The strict RED requires: every deferred accepted snapshot owns a bounded live
mission-observation token until scoped persistence or a durable loss marker;
Finish refuses actionably while participant scope is unavailable; runtime stop
marks before releasing tokens; queue overflow is fail-closed; a single durable
incident record precedes multi-scope provisional projection; later clean drain
removes that incident and all orphan projections; restart promotes only scopes
owned by a surviving incident, exactly once.

Recorded RED command:

```text
npx vitest run tests/unit/deferred-mission-evidence.test.ts tests/unit/start-tracking-runtime.test.ts tests/unit/rejection-evidence-delivery.test.ts tests/unit/ingest-anomaly-outbox.test.ts tests/unit/renderer-teardown-coordinator.test.ts
```

The run recorded 131 passing tests plus eleven assertion failures and the
expected import failure for the absent deferred-evidence module. Failure
reasons before production code were the missing deferred-evidence module,
queue/token dependencies, Finish settler registration, bulk durable incident
APIs, and clean-drain sweep; the old coordinator still called the per-scope
stage/resolve methods.

The central attack pass added four narrower REDs before their production
changes: Finish closing the observation scope during queue ownership transfer;
an incident write failure leaving volatile ownership; an explicitly blank
incident identity sweeping all incidents; and an idle/no-mission runtime
registering stale closure state. The manual contract also failed before it
named the new actionable Finish refusal and durable multi-mission incident
ordering.

### GREEN — bounded deferred ownership and crash-safe incident settlement

Every accepted snapshot that must wait for participant scope now transfers to
a bounded per-mission queue under its own live observation token. The queue
settles only after participation-scoped SQLite persistence or after the shared
mission-loss boundary owns the failure. Finish asks the queue to settle before
waiting on observations; it refuses with a retry instruction while scope is
unavailable. Runtime stop either persists entries for the still-current
mission or marks them lost before releasing their tokens. A scope that closes
during ownership transfer is marked within the original poll callback, so the
pre-Finish observation cannot disappear between owners. Current-position
rendering remains independent of these persistence obligations.

Renderer soft-deadline state now has one durable incident truth record written
before any per-mission health projection. Clean drain removes or rewrites the
incident before retracting projections. Confirmed loss seals each scope before
removing it. Restart promotes only scopes in a surviving incident, does not
advance an already-promoted loss generation twice, and retracts orphan pending
markers. The mission-store boundary validates every scope and the main
coordinator sweeps earlier partial incidents on the next clean drain or actual
renderer loss. No incident is created when no mission can own evidence.

Current local verification before the frozen application-head package and
Linux replacement evidence:

- focused seam: 6 files / 231 tests PASS;
- adjacent runtime, finalization, mission-store, wiring, and manual set:
  12 files / 269 tests PASS;
- exact final serial deterministic gate: 274 files / 2,265 tests in 135.55 s
  PASS (the preceding same-tree run also passed in 133.54 s);
- ESLint, TypeScript/project build, changed CommonJS syntax, diff check,
  production build, and bundle budgets PASS; the default application chunk is
  473,690 bytes against 500,000 after the tracking runtime moved behind its
  existing async service boundary;
- legacy backend: 51/51 PASS with one intentional real-keychain ignore;
- selected mission/participant Chromium: 22/22 PASS; and
- participant critical visual flow: 4/4 PASS, with the actionable Finish
  screenshot receiving one fresh uncached Opus PASS.

The `21a16fe` packages and Ubuntu soak above remain valid evidence for the
previous application head, but are superseded for merge readiness because this
repair changes packaged renderer/runtime and Electron-main bytes. One final
exact-application-head macOS/Linux package proof and the single permitted
replacement Ubuntu CI-scale tracking soak remain required, followed by green
exact-head CI and the amended broad plus three targeted reviews.

### Final application-head package and Ubuntu soak

Application head `b42c57f844d7a434b2948e04e9fed1b2c3933453` contains the
complete deferred-evidence queue, durable renderer-incident settlement, and
their runtime/finalization wiring. Its exact packages bind as:

- macOS arm64 executable SHA-256:
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
- macOS arm64 `app.asar` SHA-256:
  `12c3f1beb84160887a0d6aef7ec99fe056a88836bda300eb6ad3bac60897084c`;
- Linux x64 executable SHA-256:
  `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`;
  and
- Linux x64 `app.asar` SHA-256:
  `98046918fe6c5811c78dc5efd12f602aa5504f11a596d97ed4a8902aabf1fc9b`.

The single permitted replacement packaged CI-scale tracking soak ran serially
on the reference Ubuntu host through its active Xwayland `:0` display, using
Mesa llvmpipe through ANGLE/OpenGL. It passed:

- 6/6 accelerated batches, 8,664/8,664 source-exact positions, and digest
  `4df781906486a3ab3c113d05e697dcd87ad8a0bf61e5700a58211da54b23496d`;
- one restart, two accepted WebGL launches, and zero renderer crashes;
- SQLite integrity `ok`, WAL 0/0/0, zero unexplained mission events, and zero
  redundant-telemetry slope;
- main-process maximum 7.965 ms and renderer maximum 100.300 ms, below their
  gates;
- all four operator interactions classified `healthy`, with action maximum
  31.200 ms and external-action maximum 74.075 ms; and
- peak process-tree RSS 1,144,680,448 bytes.

The post-soak coverage ledger contains one mission row at change sequence 77,
32 chunk rows, zero pending invalidations, 20,480 coverage-table bytes, and
integrity `ok`. The immutable evidence bundle is
`output/pr3-packaged-soak/b42c57f844d7a434b2948e04e9fed1b2c3933453/`.
Its manifest SHA-256 is
`9211f70e6bd35bba97cff204ef47a033e6149b08768b65eeeaa57983bfb2a7a0`;
the soak report SHA-256 is
`2f6f759b846812468fd48d41670e9ee18a46de94e3b8f31b676bdbc93019522e`.

This package/soak evidence closes the changed Electron/runtime proof tier for
the frozen application code head. Green exact-head CI and the amended one broad
plus persistence, concurrency, and renderer-containment review wave remain
before merge readiness.

The following documentation-only descendant is constrained to this evidence
record, the workplan/handoff state, and the immutable six-file soak bundle. Its
parent is application head `b42c57f844d7a434b2948e04e9fed1b2c3933453`.
Executable and test inputs are byte-identical to that parent, with Git tree
objects: `src` `279aee22fc45bf4fa59075ae25df34e5aaa62259`, `electron`
`c32c2cf1cf05604b255c7a4d98556905b180e463`, `tests`
`249b07d656b5b361fc07a17487f3afa2b1a2e930`, `build`
`b91f42810f4ef07e7f4686cc2e750caa00a7fc54`, `scripts`
`b3472c9139381b5d27ce4a461c975c5080f74b60`, and `tools`
`950a5b1c2e2e5ebc149c9de22dae5a5fbd5a33ed`. `package.json`
(`ca10e37bab0a1e0d9a05a9295289cf733e32d418`) and `package-lock.json`
(`ed6b7918e5808c565bf11fa70cdf8da4a3f371d9`) are also unchanged. The staged
diff gate must reject any path outside those documentation/evidence files.

### RED — accepted history ownership and queued incident lifecycle sealing

The bounded exact-head review of documentation head
`dc7f14ae12306d764077f2139a611df5d0016909` returned one clean broad review and
one clean renderer/input-containment review, but the persistence and concurrency
reviewers independently found two reachable ownership failures. Central source
retrace and deterministic reproduction confirmed both before production code:

1. initial-wave and anti-entropy history writes released their mission
   observation after SQLite rejection without first transferring ownership to
   durable `mission_persistence_failed`; Finish could therefore beat the
   in-memory reconciler retry and archive without an accepted fix; and
2. renderer incident scopes were validated before joining the outbox fence, so
   a stage queued behind finalization could commit after the mission became
   `finalized`, survive restart as false permanent loss, and leave no valid
   acknowledgement path.

The strict RED command was:

```text
npx vitest run tests/unit/electron-mission-store.test.ts tests/unit/start-tracking-runtime.test.ts --maxWorkers=1 --no-file-parallelism
```

It produced four expected failures among 154 tests: the finalization-held stage
resolved instead of rejecting, and the initial wave plus both initial and
anti-entropy chunk failures made zero durable-loss calls. This is the recorded
red reason for the coherent seam change.

### GREEN — loss ownership before observation release and in-fence revalidation

Every production history persistence catch now awaits the shared durable loss
boundary for the exact expected mission before rethrowing to the reconciler.
That ordering keeps the poller's mission observation live until either the
write succeeded or the fail-closed delivery layer owns a sticky loss marker;
marker-write failure remains retained in memory and blocks Finish while retrying.

Renderer incident staging now revalidates every normalized mission/scope pair
inside the same serialized outbox mutation used by finalization. A finalization
already ahead in the queue changes mission state first, so the later stage is
rejected before incident truth or per-mission health is written. The regression
proves health remains clean across store restart.

Current repaired-tree verification:

- focused affected seam: 6 files / 304 tests PASS;
- exact serial deterministic gate: 274 files / 2,269 tests in 134.21 s PASS;
- ESLint, TypeScript, CommonJS syntax, production build and bundle budgets PASS;
- legacy backend: 51/51 PASS with one intentional real-keychain ignore;
- selected mission/participant Chromium: 22/22 PASS;
- participant critical visual flow: 4/4 PASS; and
- fresh uncached critical review of `participant-backfill-finish-fence`: PASS.

The `b42c57f` packages and Ubuntu soak remain valid evidence for their exact
superseded application head, but they no longer qualify the repaired runtime and
Electron-main bytes. Freeze and push one repaired application head, then bind
replacement macOS/Linux packages and one serial Ubuntu CI-scale soak before the
amended fresh broad plus persistence, concurrency, and renderer/input-
containment rechecks. No five-review restart, merge, or release occurred.

### Repaired application-head package and Ubuntu soak

Application head `d21e5df7e2151e6c97e501a2a32894cda157a806` freezes the
accepted-history and queued-finalization ownership repair. Its exact packages
bind as:

- macOS arm64 executable SHA-256:
  `f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`;
- macOS arm64 `app.asar` SHA-256:
  `53a67225c357a8e0177f0ae14d3eb784b17e50b11679282abc70066403159e0f`;
- Ubuntu-built Linux x64 executable SHA-256:
  `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`;
  and
- Ubuntu-built Linux x64 `app.asar` SHA-256:
  `6aa617967679a4ccb04b5609daa5707ac2538177e536483d22dfe4bdfb2849ba`.

The one replacement packaged CI-scale tracking soak ran serially on the active
Ubuntu Xwayland `:0` desktop with Mesa llvmpipe through ANGLE/OpenGL. It passed:

- 6/6 batches and 8,664/8,664 source-exact positions, with actual and
  independent expected digest
  `53ef76a74d66e2146b1a7f9d03e6b57be45b6910d62961cfc69b32a8bdf956c9`;
- one restart, two accepted WebGL launches, zero renderer crashes, and graceful
  code-0 shutdown for both launches;
- SQLite integrity `ok`, WAL 0/0/0, zero unexplained mission events, and zero
  redundant-telemetry slope;
- main-process maximum 9.335 ms and renderer maximum 83.600 ms;
- four operator interactions classified `healthy`, with action maximum
  39.800 ms and external-action maximum 94.646 ms; and
- peak process-tree RSS 1,138,122,752 bytes.

The first launch attempt was retained separately on the Ubuntu host and rejected
before application startup: the unprivileged unpacked directory did not have a
root-owned setuid Chromium sandbox. The qualifying rerun used the repository's
standard Linux CI `--no-sandbox` plus Mesa/ANGLE flags and passed. This was a
harness launch configuration failure, not product evidence.

The post-soak coverage ledger contains one mission row at change sequence 83,
32 chunk rows, zero pending invalidations, 20,480 coverage-table bytes, and
integrity `ok`. The immutable six-file evidence bundle is
`output/pr3-packaged-soak/d21e5df7e2151e6c97e501a2a32894cda157a806/`.
Its manifest SHA-256 is
`382336d8b51448d9930f34d547466d79510ae60bdda231a000fcad68e02f21f5`;
the soak report SHA-256 is
`6f28ce0bc75512a780eb981ef1ab90f9f8487a73a3d46db06538b3b8e34f66e7`.

The following binding commit must be documentation/evidence-only. Its
executable and test trees must remain byte-identical to application head
`d21e5df`, whose Git tree objects are: `src`
`90b21ffdfd6391cecb8b888b08ce9580685cf514`, `electron`
`7efdbd2af58fbbf164a1bb3de9c5e1b25a6da193`, `tests`
`d4173c90a56c1d2f4bfd3b826ce018c32db64def`, `build`
`b91f42810f4ef07e7f4686cc2e750caa00a7fc54`, `scripts`
`b3472c9139381b5d27ce4a461c975c5080f74b60`, and `tools`
`950a5b1c2e2e5ebc149c9de22dae5a5fbd5a33ed`. `package.json`
(`ca10e37bab0a1e0d9a05a9295289cf733e32d418`) and `package-lock.json`
(`ed6b7918e5808c565bf11fa70cdf8da4a3f371d9`) are unchanged. Green
exact-head CI plus one fresh broad and the three targeted exact-head rechecks
remain before merge readiness. No merge or release occurred.

### Final bounded review and merge-readiness binding

The amended review topology completed on documentation/evidence head
`25d963b329f920fd39a6aba39ba91a6d424df177`, whose executable and test inputs
are byte-identical to repaired application head
`d21e5df7e2151e6c97e501a2a32894cda157a806`. One fresh broad review plus the
three targeted persistence/completeness, concurrency/finalization, and
renderer/input-containment rechecks all returned **CLEAN** with no P1/P2
finding:

- broad safety: 6 files / 282 tests PASS;
- persistence/completeness: 13 files / 415 tests PASS;
- concurrency/finalization: 6 files / 236 tests PASS, including the controlled
  finalization-held outbox attack and reopen proof; and
- renderer/input containment: 8 files / 201 tests PASS, including main-owned
  request identity, numeric tile validation, cache-root containment, sender
  ownership, and in-queue incident-scope validation.

The broad review confirmed the repaired history-loss ordering and serialized
renderer-incident lifecycle together, and found no regression in false
Complete/100%, lost evidence, mission scope, current-position independence, or
Electron-main bounds. The persistence review traced failed initial-wave and
anti-entropy writes through durable `mission_persistence_failed` ownership,
restart hydration, Finish/finalization refusal, coverage health, and loss-
generation acknowledgement invalidation. The concurrency review reproduced
the former finalization race: finalization completed, the later queued stage
rejected, and evidence health remained `healthy` before and after store reopen.
The renderer review found no path or control-field override reachable through
the normalized IPC and worker boundaries.

The six-file Ubuntu evidence manifest verifies completely. Its report remains
PASS at 8,664/8,664 exact positions, one restart, zero renderer crashes,
SQLite integrity `ok`, and zero redundant slope. The documentation-only final
binding preserves the attested `src`, `electron`, `tests`, `build`, `scripts`,
`tools`, `package.json`, `package-lock.json`, `public/manual`, and `.github`
trees from `d21e5df`; completed code reviews therefore remain valid under the
approved exact-tree/diff rule. The live PR head and final CI run are bound in
PR #3.

Proof limits remain explicit: no pre-merge packaged 960k/2M coverage run was
performed outside the ratified G2 comparison, no packaged forced-kill matrix
was run, and no Windows, field-hardware, or coordinator-owned post-merge Ubuntu
960k checkpoint was performed. The accepted 3.704 GB v9-to-v10 migration proof
remains standing because schema and migration trees are unchanged. PR #3 is
merge-ready after its final documentation-only descendant receives a green
GitHub check; it was not merged or released by this task.
