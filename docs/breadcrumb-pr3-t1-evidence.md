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
