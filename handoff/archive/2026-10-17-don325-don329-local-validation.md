# DON-325 / DON-329 — local validation, 17 October 2026

Source baseline: `a9a4750d826ea316d19ea03c415356a8970348f8`, macOS arm64.
This is local synthetic development evidence. Linux CI, Ubuntu soak budgets,
release qualification and operational acceptance are separate and not established.

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

No Ubuntu access, external provider writes, push, release, threshold change or automatic
store/worker rewrite was performed. Fresh exact-commit Linux CI and packaged
Linux checks remain owed. Parent coordinates Linear and the draft PR; DON-312
must remain open.
