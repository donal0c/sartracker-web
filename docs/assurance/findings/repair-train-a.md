# Astra audit Repair Train A

Base: `083f504753089abfcce9decdee8348dc069f03b8`, fetched from `origin/master`
on 2026-09-10. Branch: `codex/astra-repair-train-a`. Owners: DON-267,
DON-269; qualification remains DON-254. Status: implementation validation and
independent review in progress; **not ready for merge or release**.

## Contract and scope

Only AUD-13, AUD-02 and AUD-03. SAR-QA-002 makes current position the priority;
SAR-QA-016 confirms the first roughly twenty-minute stationary interval. Raw
and indexed authority remain `team-feedback/breadcrumb-question-answers-20260822.md`
and `docs/breadcrumb-team-question-and-answer-ledger.md`. Source fixes are
immutable; attention and acknowledgement are derived presentation. No schema,
coordinate-transform, WAR-02A, release, team-feedback or other audit repair.

Failures to guard: overlapping replacement/disposal, late old current or roster
publication, accepted observations exceeding bounded custody, abandoned drains,
false Live state, a revived old stationary episode, and interleaved-history work
blocking renderer frames. Keep the existing accuracy floor/factor, heartbeat
tolerance, isolated-outlier controls and strict frame maximum below 200 ms.

## Exact-base reproductions and repair

| Finding | Fresh red | Repair and durable gate |
| --- | --- | --- |
| AUD-13 P1 | Real Electron, loopback provider, actual Settings Save/Connect then Devices Reconnect while one current response was held. Four requests then no two later polls over 15 seconds; explicit retry recovers. Native result records no automatic recovery. | One tracking session retains evidence, cache and the sole observation settler. Settings replacements serialize; only the selected transport publishes operational state. Retiring transports settle accepted evidence and final disposal joins them. `tracking-reload-custody.test.ts`, runtime suites and native proof script. |
| AUD-02 P2 | Two new policy regressions fail: 0/100/200/100/0 m over twenty minutes falsely warns; returning after confirmed movement revives old attention. | Fold a continuous episode against both its anchor and successive fixes. Retain the reviewed single-outlier exception. A new episode needs new acknowledgement. Policy, store and real browser warning-clear/raise tests. |
| AUD-03 P1 | Actual accumulator, interleaved 100×5,000 history, one-device compaction: 102,783,756 device-field reads exceeds the two-million operation bound, even though only one policy evaluation changes. | Cancel unchanged references once and update only affected device maps. Prepare immutable policy history; newer current fixes revisit the terminal context. Real accumulator/operation-count regression, full-policy differential checks and renderer-frame proof. |

The original audit report and its native/browser evidence remain in the main
local checkout's `output/deep-codebase-audit-2026-09-07` and
`tmp/deep-audit-20260907`; they are historical evidence, not this head's proof.
The original field artifact, first bad version and introducing commits are not
established by this repair. No field-hang attribution is made.

## Cause and escape analysis

AUD-13 coupled reload ownership to service-stop completion. Overlapping callers
could retire the selected service while a different replacement owned the
application handles. Tests of a single awaited replacement did not exercise
actual Settings/Devices overlap with an accepted current request still held.
The repair retains one session and serializes selection; regression tests join
the real poller and evidence queue, including delayed responses and admission.

AUD-02 inferred stationarity from endpoints instead of the continuous route.
Jitter and simple moving/stationary fixtures did not include a corroborated
out-and-back route or a new episode following acknowledged attention. Those
counterexamples now exercise policy, acknowledgement and the rendered surface.

AUD-03 reduced policy calls but still scanned broad interleaved changed segments
once per device, and current-only updates rescanned retained history. A call-count
test alone could pass despite excessive work. The durable gate counts actual
device-field reads through the production accumulator; the separate renderer
probe measures current-only projection, compaction work, long tasks and every
sampled frame gap against the unchanged strict 200 ms maximum.

## Review and rejected evidence ledger

| ID | Observation | Disposition |
| --- | --- | --- |
| A-R1 | First stable-session candidate lets a delayed old response arrive after the replacement fills eight evidence slots; old source fix is discarded. | Accepted P1. Shared admission now reserves in-flight observations; matched no-reload/reload regressions retain the old fix and assert no loss marker. |
| A-R2 | Reserving before held authentication lets retired authenticators retain all eight slots. | Accepted P2. Authenticate and check retirement before reserving; regression retires eight held authenticators then requires a healthy replacement to request positions. |
| A-R3 | Old participant discovery may publish after reconfiguration. | Accepted P2. Discovery is tied to the selected client and refreshed for the replacement. |
| A-R4 | A retirement error warning could disappear after a healthy response. | Accepted failure-path repair. Keep the warning in status decoration and retain failed custody for disposal. |
| A-R5 | Throwing candidate construction could invalidate the existing publisher. | Injected robustness case. Construct the candidate before committing new dependencies/publication generation. |
| A-R6 | New episode could inherit acknowledgement; current cache key ignored changed accuracy. | Accepted same-policy-boundary repairs; red/green store and current-input regressions. |
| A-R7 | All 100 current fixes with retained history took 215.3 ms; renderer maximum 200.1 ms. | Rejected timing retained. Prepared history removes the repeated full-policy scan; differential tests compare against full evaluation, including gross outliers and reordered timestamps. |
| A-R8 | Retiring request failure replays an old fallback into last-known retention; a later empty fresh response revives the old coordinate. | Accepted P1, independently reproduced (`old` instead of `fresh`). Suppressed callbacks use pure scope filtering and cannot mutate operational retention. Durable runtime regression passes with the custody suite (85 tests). |
| A-R9 | A retiring successful response can clear or replace the selected connection's current rejection warning. | Accepted P2 on `e38c55b4`, independently reproduced with real pollers. Retiring rejection context now suppresses operational publication; the app still records its durable anomalies. Real-poller/context and app delivery tests fail red then pass, including a nonempty retired anomaly with its original mission/time. Affected four-file gate: 139 passed; independent recheck clear. |
| A-X1 | Held storage eventually stops current admission at eight payloads. | Matched exact-base no-reload, candidate no-reload and candidate reload controls all behave identically and retain every fix after release. Pre-existing bounded admission policy, not attributed to this repair; broader TRK-001/DON-267/DON-252 work remains separate. No claim of current availability through unlimited storage failure. |

Native development first needed the Electron SQLite ABI rebuilt; that launch
failure is not a product reproduction. A preliminary changing-roster provider
run returned critical capacity health and is rejected, not counted green. A
stable-roster control resumed with healthy evidence; final native gates also
require the held source ID to persist. A packaged probe initially held the first
mission response before any current position existed, so its retained-row
assertion timed out. The corrected probe first observes a current row before
holding a later request. These failed runs remain in local evidence.

## Verification snapshot

Focused runtime/custody/poller/queue: 184 tests passed before later focused
refinements. Stationary, store, projection and Devices: 43 passed. New browser
route clear/new-episode and existing acknowledge/clear flows: 2 passed.
Prepared/full policy differential and custody checks: 29 passed.

First full serial source cycle: 416 files / 4,284 tests passed in 471.97 s.
The isolated renderer's unchanged/current-only/three-compaction run measured
1.0 ms current-only projection, 57.4–75.6 ms combined compaction/projection and
a maximum frame gap of 68.6 ms. A warmed prior-candidate packaged reconnect
showed UNKNOWN / Last known while reconnecting, rendered a replacement fix
40 ms after releasing replacement responses and before releasing the old
response, then resumed polling with healthy SQLite evidence including the old
source fix. These remain scoped to their source snapshots; final refinement
checks and package binding are recorded below when complete.

Local package checks on candidate `e38c55b4` pass on macOS arm64, Electron 40.10.0,
with the source blobs and ASAR SHA-256 in
[local-source-binding-e38c55b4.json](../../evidence/repair-train-a/local-source-binding-e38c55b4.json).
Both stable and changing-roster loopback providers show UNKNOWN / Last known,
replacement coordinates before the retiring response is released, continuing
automatic polls, the held source fix in SQLite and healthy evidence status.
The changing-roster control rendered the replacement 36 ms after response
release. Its frequent roster changes deliberately cause extra wakeups; its
request count is not presented as a normal polling-cadence measurement.

The final renderer repeat measured 2.5 ms for all-device current-only projection,
64.4–81.3 ms combined compaction/projection and a maximum frame gap of 67.4 ms.
Both this run and the earlier isolated renderer run stay below 200 ms; the
rejected 200.1 ms candidate remains in the evidence directory. Initial fixture
construction/first projection are excluded: this proves the incremental seam,
not cold hydration of a 500,000-fix mission.

Committed receipts and inspected screenshots live in
[`docs/evidence/repair-train-a`](../../evidence/repair-train-a). Synthetic native
profiles, full app logs and earlier failed harness runs remain locally under
`output/repair-train-a` and `/tmp/sar-train-a-*.log`; profiles are not committed.
The final source cycle after A-R8 passed: **416 files / 4,285 tests**, 465.99 s.
Lint and package build pass; both stationary browser flows pass again.
Exact-head reviews and normal CI are pending. Local scripts are
`scripts/tracking-reload-native-proof.mjs` and
`scripts/tracking-stationary-renderer-proof.mjs`; neither depends on WAR-02A.
These are synthetic local engineering checks, not live-provider, field,
cross-platform release or final-candidate acceptance.

The first draft head `e38c55b4` received clear concurrency and stationary reviews;
the broad review found A-R9, so it was not accepted. CI `34476378669` was cancelled
when the executable changed for that repair, not counted as a pass or an
unexplained failure. Final source/package proof and all exact-head reviews are
being refreshed for the A-R9 commit. The earlier package source binding remains
as `local-source-binding-e38c55b4.json`; it must not be presented as the new
executable's receipt.

The rebuilt A-R9 package has its own
[source binding](../../evidence/repair-train-a/local-source-binding.json) and
[native warning-retention receipt](../../evidence/repair-train-a/packaged-a-r9-warning.json).
It repeats actual overlapping Save/Connect and Reconnect, Last known status,
fresh replacement-before-old publication, automatic continuation and held-fix
SQLite custody, while injecting a rejected coordinate in the replacement feed.
Future replacement responses are held after the old response is released so
they cannot conceal an incorrect warning clear. The warning remains visible;
six anomalies are recorded with healthy evidence state. Replacement render was
37 ms after replacement-response release. The inspected screenshot is
`retained-rejection.png`. This targets A-R9; unchanged stationary source/test
blobs retain their earlier renderer/browser proof. The final A-R9 source cycle
passes **416 files / 4,285 tests** in 462.33 s; lint and package build pass.
Exact-commit reviews and normal Linux CI will run on the updated PR head.

## Repeat the bounded proofs

Run `npx vitest run tests/unit/tracking-reload-custody.test.ts
tests/unit/start-tracking-runtime.test.ts tests/unit/stationary-attention.test.ts
tests/unit/stationary-attention-projection.test.ts tests/unit/stationary-attention-store.test.ts`
for the core custody/policy/operation gates. The normal full source command is
`npm run test -- --no-file-parallelism`; standard Playwright
`tests/e2e/stationary-attention.spec.ts` proves visible clear/new-episode behavior.

Build a local package with `VITE_SARTRACKER_MISSION_MODEL=1 npm run electron:pack`.
Set `TRAIN_A_EXECUTABLE` to that package's executable and `TRAIN_A_OUTPUT` to a
fresh output directory, then run `node scripts/tracking-reload-native-proof.mjs`;
repeat in another directory with `--changing-roster`. The script uses only a
new synthetic local profile and loopback provider. It does not use real credentials.

With a local Vite server on port 1439, run
`node scripts/tracking-stationary-renderer-proof.mjs`. This is a real Chromium
renderer importing production code, not the WAR-02A harness. It records
every sample and fails on a maximum frame gap at or above 200 ms or absent
frame samples. Preserve any rejected result before further changes.
