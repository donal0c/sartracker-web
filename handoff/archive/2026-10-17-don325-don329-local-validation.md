# DON-325 / DON-329 — local validation, 17 October 2026

Source baseline: `a9a4750d826ea316d19ea03c415356a8970348f8`, macOS arm64.
This is synthetic development evidence; later sections record Linux CI separately.
Ubuntu soak budgets, release qualification and operational acceptance are not established.

## Unchanged-source coverage A/B

Two immutable local packages differ only by `VITE_SARTRACKER_COVERAGE=1` versus
`0`. Both used a saved copy of the existing normal-profile harness with
`--profile-renderer-drain`, fresh isolated profiles, 480 batches, 32 devices
(8 moving / 24 stationary), one restart and 691,224 expected positions. Runs
were serial; no other heavy build/test ran during either measurement. This is
the actual current normal profile, not a 100-device historical release workload.

| Measurement | Coverage on | Coverage off |
| --- | ---: | ---: |
| Wall time | 462,433 ms | 375,283 ms |
| Peak process-tree resident bytes | 2,529,853,440 | 2,090,680,320 |
| Main IPC maximum | 2,867.259 ms | 199.994 ms |
| Independent main-loop maximum, launch 1 / 2 | 197.688 / 2,853.916 ms | 168.400 / 198.823 ms |
| Unique revision-moved IPC errors | 729 | 0 |
| Unique chunk-stale IPC errors | 35 | 0 |
| Exact positions / integrity | 691,224 / ok | 691,224 / ok |
| Existing soak verdict | FAIL (memory and stalls) | PASS, narrowly below timing limit |

Each run matched its complete independent position oracle, including coordinates
and timestamps. The profile clocks differ by run; this does not mean database
files have equal hashes. Error counts match one `Error occurred in handler`
header per rejection, not repeated stack tokens.

The pair supports a material local coverage contribution (439,173,120 fewer
peak bytes and 87,150 ms less elapsed time with coverage off). It does not prove
that coverage explains all memory growth or any Linux allocator behavior. One
serial pair is not a timing distribution. The disabled run has little timing
headroom and is diagnostic, not a proposed product posture.

Allocation sampling, including collected objects, reported 51,038,770,812 bytes
enabled versus 44,620,430,888 disabled over their respective final-drain windows.
These totals are not normalized allocation rates. The enabled top frame (13.9%)
maps to the newest-fix-per-device scan in the built bundle. That is a follow-up
hypothesis, not a DON-328 defect finding or authorization for a collateral rewrite.

Artifacts are under `tmp/don325-baseline/`: `manifest.json`, immutable
`coverage-on.app`, `coverage-off.app`, saved `harness/`, and `on-evidence/` /
`off-evidence/` reports, logs, screenshots and allocation profiles.

- Enabled ASAR SHA-256: `40ad20781659d216c7272dd926b34dfc8ef90e601b5850a679ae1ee584ed0775`.
- Disabled ASAR SHA-256: `ba40518a7e415e5724f073b3d9189632c9932c6b1314e76102c709e3d8b640d7`.
- Soak entrypoint SHA-256: `6db329b506fc286ca195786ba3c1008b35f839ccd7c400be9482caf779b96c25`.

The enabled main report contains actual budget failures. Its secondary failure
report generically labels the closeout exception `unclassified_harness_error`;
that classification does not erase the complete primary measurements. An initial
copied-harness preflight lacked its imported `electron/` modules and failed before
app launch; the snapshot was completed, without rebuilding the product.

## DON-325 reproduction and change

The baseline regression drove 100 accepted-revision notifications and counted
101 manifest reads including the initial load. Store regressions returned thrown
IPC errors at pre-sync revision mismatch, structural manifest mismatch and staged
build rejection. An unchanged healthy evidence object also restarted coverage.

The patch returns a discriminated stale result only for branded expected revision
races; genuine authority, worker and attestation failures still reject. A stale
result carries no inventory or delivery attestation. The controller retains prior
geometry as Partial, counts races per mission/renderer session, preserves the
highest observed sequence, and requires a fresh exact claim for Complete.

Change-triggered background reads coalesce behind 30 seconds after the preceding
load finishes, using a monotonic clock. Periodic refresh cannot queue a rerun while
active. Retry/context changes remain immediate, as do actual ingest-evidence
blocker transitions. Equivalent healthy aggregate objects no longer restart work.
Cancel, stop and mission switch drop deferred work.

Initial focused tests: 113 passed; monotonic follow-up: 73 passed. Full source,
browser, fixed-package and review evidence will be recorded below after execution.

## DON-329 reproduction and change

Both native baselines reproduced a `sync-backup` database-closed IPC error and a
prior interrupted diagnostic at `renamed` after the mid-run graceful restart.
The atomic mirror survived; final audit/diagnostic ownership was absent.

Real SQLite regressions held requested diagnostics, the post-rename phase and
completion diagnostics. Baseline `prepareClose()` returned at all three held
boundaries. The bounded-join and startup orphan-removal expectations also failed.

The coordinator now admits requests synchronously, refuses admission after closing,
joins every admitted request through rename/audit/durable completion, and blocks
direct close while backups remain pending. Post-rename audit work is inside the
operation's failure reporting. The existing shutdown deadline is retained; timeout
refuses quit while the backup continues and permits retry after it settles.

After successful primary open/migration, an asynchronous sweep gates the first new
copy. It removes only recognized app temporary UUID names and exact WAL/SHM
sidecars, bounded to 64 sets per startup. Unknown names, nonregular files, linked
sets, primary/mirror and candidates when primary open/migration fails are preserved. Counts
and removed bytes are recorded without names or paths. No new integrity scan,
worker architecture or generic diagnostics flush was introduced.

Observed completed online-backup durations during sustained writes were 248,171 ms
enabled / 195,078 ms disabled. These are not residual quit times after writers
quiesce and do not justify guessing a new shutdown policy. Packaged quit evidence
and any remaining 5-second-deadline limitation will be recorded after the fixed run.

## Source verification and review

The complete correctness command ran 629 suites: 6,601 tests passed, 27 skipped,
and three assertions failed because they encoded thrown stale errors or immediate
change-event refreshes. The complete first failure log is preserved. Corrected
contention and claim-revocation suites passed all 17 tests; the manifest-growth
suite then passed its one test after retaining immediate Partial/no premature
sync assertions and requiring fresh Complete after the background interval.
No production code changed as a result of these wider failures.

Focused DON-329 checks passed 128 tests. Lint initially found unused typed mock
arguments; the signatures were made explicit without changing runtime bodies,
then lint passed. TypeScript, Vite, bundle budgets and local macOS packaging passed.
The unrelated generated-version file was restored and byte-compared to its
original SHA-256 `ef1a29faa953528b7373639721094c069e0480a15d8ed9d05c5581db698066eb`.

The immutable fixed local package is `tmp/don325-fixed/fixed.app`; ASAR SHA-256
`2e3a219dbbedd16d3c9439754d19e94d072fdd5b7c80d3f4a8ccc900e5ba58cc`.
It was built from baseline HEAD plus the recorded dirty implementation, not a
clean CI commit. `source-manifest.json` and `source.patch` identify those bytes.

The parent performed an independent direct review of changed production modules,
IPC callers and key regressions, finding no actionable defect. Fable worker
`1fcfb45f0f1a` supplied two design opinions which were reconciled with live issue
requirements. Its final code-review attempt failed at the subscription quota;
there is no Fable endorsement of the final patch.

Chromium coverage workflows passed 8/8, including the new twenty-notification
quiet-ingest regression: immediate rendered Partial, no manifest rereads during
the interval, then Complete after one two-manifest delivery cycle. Visual coverage
checks passed 8/8. New Partial/Complete captures and affected retained-history,
claim-failure, renderer-reattachment and pending-filter captures were inspected;
the operator wording remains explicit and readable. The manual explains the
background interval and immediate Retry.

The packaged native-runtime smoke passed on the fixed ASAR: 24 concurrent actual
preload reads, coherent snapshot under a live write, stale claim withheld,
cancellation observed only after physical worker exit, and exit 0 without forced
cleanup. Its receipt identifies package, source and harness hashes. Network is
deliberately blocked in that smoke; those expected tile failures are classified
separately and are not connectivity proof.

## Fixed-package soak and native boundaries

The fixed package ran the same current 32-device normal workload, serially with
allocation sampling. The primary report remains **FAIL**: peak resident memory
was 2,217,132,032 bytes against 2,147,483,648; independent main-loop maxima were
226.367 / 165.314 ms against 200 ms. IPC main maximum was 188.187 ms and renderer
maximum 490.098 ms. All 691,224 positions matched the independent full and prefix
oracle, and primary integrity was `ok`. DON-312/313 performance work remains open;
these changes do not establish Linux budgets, release or operational acceptance.

There were zero revision-moved, chunk-stale or closed-database IPC error headers.
The seven remaining headers were two breadcrumb cancellations and five tile-read
cancellations. Renderer-drain allocation sampling still reported 49,761,197,660
bytes, including collected objects; the newest-fix scan remained the leading
frame at 12.6%. This does not justify a collateral rewrite in this patch.

The copied soak entrypoint adds only a separately identified post-measurement
backup/quit probe (SHA-256
`db999bd5a3e594f8a900177788721c8e67517f983952faf575bda69e6648dd16`).
Its 394,627 ms total includes that extra work and is not an apples-to-apples
duration comparison with the baseline. The change and identities are preserved
in `harness-change.patch` / `harness-manifest.json`. The fixed report's secondary
failure classification is again `unclassified_harness_error`; the primary report
contains the real budget failures.

Both quits observed an active backup before requesting real graceful exit.
The observed operation completed durably 339 / 667 ms after the quit request;
both processes exited 0 without forced cleanup. Each saved after-quit checkpoint
had no active/interrupted operation, a matching durable completion log entry,
and no closed-connection error. Primary/mirror position counts were equal at
345,624 and then 691,224, mirror integrity was `ok`, and primary backup audit
counts were 11 / 13. The five-second shutdown policy was unchanged and was not
exceeded in either native quit. Timeout/refusal and later retry are covered by
the deliberately held real-SQLite regressions, not claimed as native timeout UI
proof. Artifacts: `tmp/don325-fixed/soak-evidence/backup-{before,after}-quit-*.json`.

The saved soak screenshots do not expose the coverage panel below the sidebar
scroll position. A separate post-measurement check therefore copied the terminal
synthetic profile, disabled provider auto-connect and autosave only in copied
settings, and reopened the same immutable package. The actual renderer showed
**All mission history shown**, with 2 coverage map layers. Native inventory and
claim agreed: all 691,224 fixes, 32 fresh chunks, no pending invalidation or
backfill, 32 claimed chunks and no blockers. Recovery was observed after 1,927 ms;
that is a separate quiet recovery observation, not a measured ingest timing.
It exited 0 without forced cleanup. Report, harness hash and inspected captures:
`tmp/don325-fixed/quiet-recovery/`; source script:
`tmp/don325-fixed/native-quiet-recovery.mjs`.

No Ubuntu access, external provider writes, release, threshold change or automatic
store/worker rewrite was performed. After local validation, implementation commit
`da069fe62a9ebdc633a3461b215868a6640652ae` was published in
[draft PR #56](https://github.com/donal0c/sartracker-web/pull/56). Its Checks tab
is the authoritative current exact-head Linux CI record; those results are
separate from this local evidence. Installed Ubuntu checks remain owed.
DON-325/329 are In Review; DON-312/313 remain open.

## Linux CI closeout

[Run 39021107552](https://github.com/donal0c/sartracker-web/actions/runs/39021107552)
completed successfully on exact source `3caaae49292a98bc3f1370be09cbf39da88b46c6`,
tree `982906aa1f1ec890de9553f802e2cfab64c60fae`. All four jobs passed.
The correctness log records 629 suites, 6,621 tests passed and 10 skipped;
full Chromium records 253 passed and 9 skipped with fail-on-flaky enabled.
Targeted browser, property/mutation, lint/build and packaged checks also passed.
The earlier run39021059271 was superseded by the documentation push; its
cancellation-related final gate failure is not a product failure or rerun flake.

Package source binding was clean. AppImage SHA-256 is
`2afabbbe172ec4bdb2ea37dbdb60609193000ae17635044d46ef3874316c3fc0`;
Debian package SHA-256 is
`ce7693420394ee22911702ce04b7dbdaa876ba7e0db79c9bb87360ed72f74ab7`.
AppImage, Debian and unpacked app share ASAR SHA-256
`993b1979467275b0b4ee5d719c7d1c5353188707263c21c884bee0b8c106857d`.
Downloaded source/package/native receipts and job logs were inspected, as was
the rendered AppImage capture. Native coverage passed 24 real preload calls,
live-write snapshot/claim fencing, physical-exit cancellation and exit 0 without
forced cleanup. AppImage graceful window close passed.

The 19 candidate producer checks completed but explicitly report
`qualificationExecuted:false` and `releaseEligible:false`. Strict responsiveness,
long soak, installed Ubuntu and operational acceptance remain separate and owed;
the Mac performance failures above remain open. Local CI evidence is under
`tmp/don325-linux-ci/`. This documentation-only closeout reuses the tested
ancestor after confirming executable inputs are unchanged, per the testing cadence.

## PR review repair — 17 October

Donal's code review found two real gaps despite the earlier green CI and parent
review. That earlier readiness judgment is superseded. The review itself was
read-only; the reproductions below were run subsequently on `913fa342` plus the
repair. The initial review against unrelated checkout documentation was discarded.

DON-329: four real-SQLite regressions failed before the repair. Backup admission
refusal now has `AbortError` / `BACKUP_SHUTDOWN_CANCELLED`. Finalization checks
cancellation again after asynchronous evidence admission. A refused replacement
backup preserves an existing finalization fence and creates no false
`mission_archive_failed`; reopening and retrying completes finalization. Direct
archive cancellation releases only its own temporary fence without a failure
audit. A genuine admitted backup failure still records exactly one failure and
rejects shutdown even when cancellation arrives concurrently. The backup suite
then passed all 14 tests.

DON-325: three regressions reproduced live-change notifications replacing error
with Partial. Notifications now retain the error/message and latest observed
revision. Dedicated renderer recovery keeps ownership of its retry and fresh
sources. A further activation test exposed an immediate background reload;
Sol's independent review found the periodic-poll variant, also reproduced red.
The central automatic scheduler now respects renderer recovery ownership. Tests
cover activation and already-displayed failures, a coincident automatic poll,
error at 249 ms, fresh-source recovery at 250 ms, and Complete only after a fresh
claim for the latest revision. Genuine load errors remain visible too.

The final focused run passed 7 suites / 111 tests. Affected Chromium passed 9/9;
the new flow saves a real browser-harness fix during a renderer failure, observes
the error, then verifies prompt recovery to Complete. Both captures were inspected.
The first full-suite attempt was deliberately stopped to add the periodic-poll
regression; it is not recorded as a pass. Logs, source hashes/patch and native
fixture are retained under `tmp/don325-review/`.

The stable full local correctness run passed 629 suites / 6,611 tests, with 27
skipped (634.15 s). Lint, TypeScript/Vite, bundle budgets and macOS package passed.
The immutable review package ASAR is
`1075e19b914c3703647fcc2594743d11011dca6e251bc7fdca4d2fcfac1ebe52`.
Its source hashes match the retained dirty-source manifest and tested patch;
the unrelated generated-version bytes were restored exactly. Packaged native
runtime passed 24 actual preload calls, existing snapshot/cancellation checks,
and four injected real-SQLite store controls: late finalize admission, direct
archive admission, protected finalization cancellation plus reopen/retry, and
genuine admitted failure. The cancellation cases had zero false archive-failed
audits; the genuine failure had one and still rejected shutdown. Receipt and
capture were inspected. This is packaged-store `prepareClose` proof, not a real
quit-during-finalize UI scenario, slow-backup deadline proof or field acceptance.
New exact-head Linux CI is required after publication; the PR Checks tab records
that result without substituting earlier CI for this executable repair.

The failed-quit observation is confirmed but not solved by resetting a backup
flag: shutdown also permanently closes the writer, outbox and other services.
The safe policy for resuming work versus requiring exit/restart after refused
quit needs a separate lifecycle decision on DON-329. Backup timeout wording,
persistent-stale escalation, journal cleanup and stale-result validation remain
follow-ups, not fixes claimed by this repair. No shutdown deadline or performance
budget was relaxed, and no Ubuntu or operational proof is added.

## CI map-warning follow-up — 17 October

Review repair `8738080036ced2256fe3e380ef2406f0fbdfe3cc` passed Linux package
and packaged-runtime jobs in run39032048967. Correctness passed 629 suites /
6,628 tests (10 skipped), but full Chromium failed: 253 passed, 9 skipped,
one failed. The existing basemap-application warning test failed all three
attempts after its first warning assertion passed. The actionable
“Choose another basemap” warning became “Some tiles failed to load”.
This run is retained as a failure, not reclassified as a successful retry.

Both the owning hook and test were byte-identical to pre-PR base `a9a4750d`.
The idle callback already respects a latched application failure, but late tile
errors did not. An unmodified local run passed; explicitly firing five late
tile errors after the application failure reproduced the exact CI failure.
The narrow repair gives the application failure priority until operator map
choice clears the latch. The existing browser regression now forces that
ordering, checks the visible warning, retries the same map, then verifies that
ordinary tile-degradation warnings work again. No assertions or timeouts were
weakened. This follows the existing DON-264/PR30 recovery contract; Sol's
independent read of the causal path and final narrow diff found no remaining
actionable concern. Evidence is under `tmp/don325-review/map-ci-*`.

The failed run's package was source-bound to clean `87380800`, tree
`fe8ea13b462ff655ff7293d0edae38205c6173f9`. AppImage SHA-256:
`8eadb860351d16a3e4db5447ed5eeb0c392a7ee5ba9ab1370f19c4fb1c547888`;
ASAR SHA-256:
`99006a3b11e64a6f0f8bedf30617c20b1a1711ef5ad9db1fc977fdbf6d6be09f`.
Downloaded native receipt passed 24 real preload calls, physical-exit
cancellation and clean exit. AppImage capture and graceful-close proof were
inspected. The 19 producer cases remain development checks with
`qualificationExecuted:false`; skipped long-soak/archive qualification is not
a pass. These artifacts precede the map-warning repair.

Final local map follow-up validation: five focused suites / 34 tests passed;
all 34 affected Chromium map/navigation/coverage flows passed (1.3 min), with
the persistent-warning capture inspected. The fresh full source run passed
629 suites / 6,611 tests, 27 skipped (650.01 s); lint, TypeScript/Vite and
bundle budgets passed. Source/test hashes remained stable and the unrelated
generated-version edit was restored byte-for-byte after the build. This shared
renderer change does not modify SQLite or the native lifecycle boundary;
earlier native receipts retain their stated source binding, and new Linux CI
must validate the follow-up package. No new soak or installed-Ubuntu claim.
