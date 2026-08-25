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
