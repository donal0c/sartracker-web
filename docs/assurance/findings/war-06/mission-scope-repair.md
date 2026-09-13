# DON-267 WAR-06 mission-scope repair

Base: `deedab27483ad4fe1ca998a4d68afd555f4e2337` (fresh `origin/master`, merged PR24).
Branch: `codex/don-267-war06-mission-scope-repair`.
Status: prior readiness withdrawn after Claude's review of `7fc4aa08`. Follow the
[Claude remediation record](claude-review-remediation.md) and DON-267 for the current
disposition of [PR26](https://github.com/donal0c/sartracker-web/pull/26). Results below
describe the earlier repair inputs, not validation of subsequent changes. Release remains HOLD.

## Scope and authority

Only WAR-06-AUD-01, WAR-06-AUD-02 and WAR-06-CACHE-SIBLING are active under
reopened DON-267 (Linear bookkeeping comment `5cd731a6-41fc-47e2-b474-26f0478790be`).
The original PR1/PR4/PR17 fixes remain merged and valid. The [WAR-06 report](WAR-06.md)
retains the original reachable characterizations and historical failures.
SAR-QA-002/008 and SAR-FIELD-002 require immediate current positions;
SAR-QA-015 requires explicit trustworthy participation; SAR-QA-021 retains
canonical fixTime; SAR-QA-020 preserves finalized evidence. Raw and indexed
authority remain in the existing team transcript and Q&A ledger.

## Repair contract

Mission identity must be checked before operational retention, freshness,
publication, stationary projection or cache admission. Delayed history checks
its live reconciliation identity at the timer boundary, preserving the separate
legitimate idle flush. Deferred participant snapshots keep their captured mission
identity and are discarded on mismatch, with a fresh current poll requested.
Cache payloads carry explicit mission identity; unknown/legacy and different-mission
payloads are never relabelled as current-mission positions. Asynchronous cache
serialization retains its admission identity. Poller fallback positions must also
be cleared at a mission identity change, including a failed first replacement poll.

Accepted evidence ownership remains separate from operational publication:
retiring/stale producers retain their existing settlement and fail-visible loss
handling. Existing expected-mission persistence fences remain intact. No schema,
coordinate, timestamp, stationary-policy or finalized-evidence change is intended.
The time-unverified stationary-attention question remains outside scope.

## Verification contract

Retain baseline RED for all three reachable safety oracles plus cache/fallback
boundary regressions. Require positive current-mission progress and falsifiable
negative controls, then focused lifecycle/retention/custody/cache suites, one serial
correctness cycle, lint/build, browser mission switching and actual packaged
Electron renderer restart/cache proof. Independent broad safety/state-machine and
focused concurrency/cache/custody reviews precede exact-head ordinary PR CI.
Heavy checks run serially. Unchanged strict 200 ms, replay/soak, live-provider,
field and whole-candidate release qualification remain separate; release HOLD.

## Root cause and escape analysis

Delayed history and deferred participant hydration retained Mission A's payload
but did not recheck its operational mission identity before publication under B.
The current-position retention layer could therefore retain A's coordinates and
the stationary projection could rebuild A's attention state after a switch.
The disk cache had no mission identity, and poller failure fallback also survived
a mission-key change. Persistence fences protected accepted mission evidence;
they did not protect these operator-facing surfaces.

Earlier tests covered persistence rejection, normal mission transitions and
cache recovery separately. They did not assert the absence of every transient A
publication while still requiring fresh B progress through the reachable timer,
hydration and restart routes. The repaired oracles now make both requirements
explicit, and controlled stale-publication injection must make each one fail.

The report source is the retained WAR-06 reachable lifecycle investigation,
not a new field report. Last confirmed bad production baseline is `deedab27`;
the introducing commit and last-known-good boundary are not established by this
repair. No historical persisted mission evidence is rewritten. Field confirmation
and live-provider/final-candidate qualification remain outside this local proof.

The repair keeps accepted-evidence admission/settlement before the operational
guard. It checks the history timer independently, clears current fallback at a
mission switch, carries cache identity through asynchronous serialization, and
holds matching recovery cache separately until the operator resumes its mission.

## Retained red/green evidence

Raw command output is retained byte-for-byte, including reporter trailing spaces
and blank final lines. Source/documentation diff whitespace checks pass with the
raw evidence directory excluded; the unrestricted check reports only those logs.

- [Original lifecycle RED](../../../evidence/war-06-repair/lifecycle-red-raw.txt):
  all three named repair assertions fail against unchanged `deedab27` production.
- [Initial boundary RED](../../../evidence/war-06-repair/baseline-red-raw.txt):
  parser/boundary failures retained, including a cleanup timeout. This mixed run
  is not the authoritative three-route lifecycle proof above.
- [Browser RED](../../../evidence/war-06-repair/browser-red.txt): both corrected
  mission-switch flows leave the old stationary attention visible. Earlier
  harness-selector failures are retained separately in the same directory.
- Recovery positive-control RED exposed an idle recovery poll overwriting the
  saved mission cache; the cache is now held until Resume and recovery does not
  write idle snapshots. Warning RED exposed offline status replacing the discard
  explanation; it now remains until a fresh accepted current response.
- Initial focused verification: six files, 224 tests pass. After review
  corrections and explicit-admission fixture updates, the final focused run
  passes six files / 232 tests (`final-focused-green.txt`).

## Review corrections

The independent concurrency review found a matching recovery cache could be
replaced by an empty current response during participant hydration. It also
found the existing shared persistence queue silently fulfilled a queued accepted
operation after runtime replacement. Five additional assertions failed before
their fixes: queued snapshot/history must record loss when rejected, matching
recovery positions must survive an empty poll, and delayed cache publication
must refresh age/health and reject the existing four-hour expiry.
The [raw failures](../../../evidence/war-06-repair/review-regressions-red.txt)
are retained. The affected runtime/boundary suites subsequently pass 112 tests.
The first full correctness attempt was interrupted for these confirmed fixes;
it is retained as incomplete and is not counted as passing evidence.

The shared persistence queue now rejects stale generations through the existing
per-mission durable loss-marker path. This preserves expected-mission fences;
it does not write old evidence into a replacement mission. Recovery cache stays
separate until participation is ready, and a fresh live row wins per device when
the two are combined for operational publication.

Final review extended the protected cache candidate to active runtime reloads as
well as crash recovery. Two additional adapter regressions prevent omitted
callback context from inheriting a new mission: fallback identity is captured
before poller construction, explicit idle remains null, and a contextless callback
cannot invent evidence admission. Existing persistence fixtures now provide explicit
accepted-mission context, as the native poller already supplies. These changes
have separate retained RED evidence in `adapter-active-cache-red.txt` and
`adapter-admission-refinement-red.txt`.

The complete local correctness cycle before that small adapter/active-cache
refinement passed 443 files / 4,662 tests, with six named timing cases visibly
reserved for qualification. WAR-02B separately passes four files / 19 tests.
Final affected verification covers the later refinement; ordinary exact-head CI
must verify the complete pushed candidate. The earlier full run is not relabelled
as a final-head run.
Both independent source reviews are dispositioned in
[production-review-receipts.md](production-review-receipts.md). The pre-existing
mutable provider cache adapter is explicitly deferred there; provider identity
is not claimed repaired by mission identity keying.

## Browser baseline gaps

The broader Chromium run passed 199/203 tests, including both WAR-06 flows.
All four failures reproduced in a separate `git archive deedab27` checkout
with the same isolated browser configuration: DON-187 layer scroll, DON-229
poll diagnostics, DON-228 cursor history, and large hosted history. The history
fixtures report unavailable durable history-request recording; the scroll
assertion observes zero scroll offset. Their [baseline failures](../../../evidence/war-06-repair/browser-baseline-failures.txt)
are retained; the broader suite is not described as green.
The final focused two-flow browser run passes and shows only live Mission B at
`52.01000, -9.70000`, with no old A device or stationary attention. This is a
controlled renderer-hook proof; actual packaged proof remains separate.

## Packaged Electron proof and limits

The actual macOS arm64 package passes the scoped restart/cache matrix, using a
loopback synthetic provider and disposable profile. ASAR SHA-256:
`43355f2ae7fed6bdc08836165cca7a7ba494fe59e25c7ef2ae04ef596ead46f1`.
All packaged `electron/`, `dist/` and `shared/` files match their source/build
inputs; transformed package manifest runtime fields match and both byte hashes
are retained. Local source was dirty at pre-commit packaging, honestly recorded
in the receipt; final clean-head Linux CI is a separate artifact claim.

- A writes current id `601` plus history `611/612`; offline Resume shows cached
  A at `52.10010, -9.70010` and retains three persisted positions.
- B resumes with retained keyed A bytes and then unkeyed legacy A bytes. Both
  have zero operational fixes/cache count, zero B persisted positions and no
  stationary attention in sampled startup/Resume surfaces; the discard warning
  is visible. The retained file still contains A identities.
- Fresh B shows live `52.90010, -9.10010`, writes B-keyed current `701` and history
  `711/712`, persists three positions, contains no A IDs and clears the discard
  warning. Five launches exit cleanly with code zero.

[Final native receipt](../../../evidence/war-06-repair/native/final/receipt.json)
and adjacent screenshots retain the raw result. DOM sampling is every 50 ms,
not an exhaustive frame trace; deterministic publication-trace unit assertions
cover transient callback leaks. B mission/device/participant metadata is explicit
IPC setup, with no seeded B positions; A creation and Resume/Finish use real UI.
Maps are intentionally network-blocked, so tile warnings are expected. This is
not live-provider, map availability, field, scale/soak or release qualification.

Attempt 1 failed an over-specific generic cache-warning assertion (the app
correctly showed the simulated authentication outage while Cache/Fixes were 1).
Attempt 2 read the roster section without its sibling coordinate inspector.
Both harness failures and screenshots are retained. Attempt 3 passed the
boundary but exposed a missing B device setup prerequisite; final setup seeds
device metadata through IPC before participant backfill, and that error is gone.
All attempts use the same package; no application rebuild was used to seek green.

The final receipt still records a coverage-enumeration worker error and
WebContents listener warnings; coverage cancellation is also visible during
Finish. These are not explained or cleared by this mission-cache proof. The
coverage implementation is unchanged from the base and requires separate
investigation before whole-application qualification. No clean-runtime or
release acceptance is inferred from the scoped smoke's pass.

Build/type checking, bundle budgets and final lint pass. Ordinary PR CI now
includes the two rendered WAR-06 regressions and the actual Linux-packaged
restart/cache script, alongside the existing correctness/property/build/native
gates. Donal retains merge authority.
