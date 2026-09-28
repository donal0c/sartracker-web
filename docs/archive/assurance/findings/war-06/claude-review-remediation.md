# PR26 Claude review remediation

Review supplied by Donal on 2026-09-13 against `7fc4aa08aeab20eadd98229a743f75b55383c58e`.
The prior merge-ready verdict was withdrawn in PR26 and DON-267. No merge or release
was performed. The five `w1-*.md` source reports were read from Donal's supplied
Claude scratchpad; this record tracks dispositions rather than copying the reports.

## Safety contract

Current mission fencing and accepted evidence custody remain unchanged. Cached
presentation provenance is independent of transport connectivity. A partial live
response must retain selected cache-only current rows and restored trail display;
live current coordinates must win on overlap. Cached trail rows must never enter
new durable evidence through the presentation merge. Pausing must not strand an
already persisted history batch behind a slow current request. Invalid/mismatched
cache warnings must remain visible until relevant fresh data arrives.

## Findings and dispositions

| Finding | Disposition and evidence |
| --- | --- |
| R1 mixed cache/live loses cache banner | Reproduced RED. Derive a separate notice from the published, participant-filtered cached positions/trails. The prior code did refresh cache health before merging; the reproduced defect was the lost banner. |
| R2 restored breadcrumbs disappear | Reproduced RED. Named pure presentation merge unions fix identities with live overlap winning, sorts chronologically, retains only live raw persistence input, and drops live-only reduction metadata that cannot describe the union. |
| R3 live precedence untested | New integration assertion conflicts a cached position with live latitude 53.2 and requires live coordinates plus cache-only device retention. Source mutation proof is recorded below. |
| R4 cache hydration overwrites online state | Reproduced RED. Publication no longer changes connection mode, last success, failure count or recovered status; provenance is a separate notice. |
| R5 blank map claims last-known positions | Reproduced RED on failed first B poll. Poller says no current positions received for this mission when it has no position-bearing fallback. Same-mission fallback stays supported. |
| R6 timer guard lacks falsifying proof / pause latency | Pause RED reproduced with current I/O held at 100 ms. Publication now checks mission/lifetime independently of active-fetch mode, so same-mission pause flushes already persisted display rows on time; wrong-mission display rows are discarded. The revised timer test holds the next history chunk to prevent early completion flush and observes timer firing. All 93 poller tests pass; source mutant proof is recorded below. |
| C1 warning stuck through snapshot adapter / reconfigure | Adapter RED reproduced and fixed. Clear on accepted live current rows through either callback; clear rejected old-provider cache advice when provider changes. Same-provider reconnect retains advice until fresh rows. |
| C2 runtime generation rejection records false loss | Retained intentionally when accepted writes actually fail to settle before replacement. A new in-flight current-write test stops and drains before starting replacement, requires observation completion and no loss record. The existing forced-replacement test still requires a durable loss record. No claim that routine restarts always lose evidence. |
| C3 writer accepts invalid mission id | Three RED cases (empty/padded ids); use the same validation predicate on read and serialization before disk write. |
| C4 corrupt cache is silent | RED reproduced; separate read-failure advice survives transport status and clears on accepted live positions. Startup rejection uses idle, not an unproven offline assertion. |
| Follow-up retained cache health | Same-Codex recheck found subsequent partial polls erased cache age. Unit and runtime integration RED reproduced it. Retention now remembers per-device cache write time, advances age and expires by cache age as well as fix age; live replacement and mission reset clear that provenance. |

Additional full-report points: rejecting legacy cache is the intentional migration
cost of unknown mission identity, already documented in the manual and repair
contract; never infer identity merely to recover a cache. Recovery holds at most
one bounded cache candidate until trusted participation, expiry check or disposal.
The provider's current response retains precedence over cache; timestamp ranking
across cache and provider current responses is not introduced by this repair.
The extra roster observation does not establish a new position leak: provider
metadata remains reusable, current publication takes authority from the current
request's `rosterComplete`, and operational device visibility is participant
filtered. Synthetic metadata cleanup is not claimed repaired or independently
qualified here; broader provider/roster identity remains a follow-up.

## Production mutation checks

Disposable source copies reject M1 (remove abandoned mission-cache discard),
M3b (cached coordinates override live), M13 (remove runtime lifetime fence), and
M7 (delete the actual delayed timer predicate). Each fails at the named observable
position assertion, not an import error or timeout. Root additionally repeated
M7 against the final `isHistoryPublicationCurrent` predicate: stale A history is
observed and the test fails. Source diffs/hashes and raw logs are retained in
`docs/evidence/war-06-repair/claude-remediation/`.

M8's private cleanup assignments remain, with a public stop contract that invokes
captured callbacks/subscriptions after stop and requires no publication. Removing
only those assignments is masked by unsubscribe and lifetime fences; no claim of
a killed M8 mutant is made. No artificial private-state test was added. M9's
redundant current reset remains alongside last-good reset; no additional mutation
claim is made for that reset. These are separate from the now-killed unsafe mutants.

## Evidence and claim boundaries

Earlier `start-tracking-runtime.test.ts` edits adapted existing fixtures; they did
not add tests. New behavior evidence is in the named boundary/merge/poller tests
and renderer scenario. Earlier injected negative controls prove assertion
sensitivity, not a production route; source mutants separately test the route.

The earlier Luna reviews were separate agents within the same author-controlled
Codex run, not external approval. Claude's supplied review is the external review
being addressed here. The mac-arm64 smoke is local author-run evidence; Linux
packaged evidence is CI-produced. Neither is field or release qualification.

Prior binary evidence is retained as historical failure/proof custody; this
remediation does not rewrite it or duplicate the full screenshot archive. New
receipts will identify source/artifact hashes and link CI. Strict 200 ms and all
release qualification exclusions remain unchanged; release HOLD remains.

## Current verification

Runtime RED: five failures / 23 passes; writer RED: three invalid-id failures;
empty-map RED: one failure / 30 passes; pause and retained-cache-age RED are also
retained. Final focused checks pass 254 tests in eight files, including all 93
poller tests and assertion controls. The first full-source attempt was interrupted
with exit 130 to repair the newly confirmed retained-cache-age defect; it is not
a passing result. The stable serial full-source cycle passed 4,684 tests in 444
files with the six existing timing exclusions (460.86 s). Lint, TypeScript,
production build and bundle budgets pass.

Three browser flows pass, including online mixed cache/live source labels and the
live coordinate inspector. Two initial new-browser failures were selector mistakes
(rows are not ARIA table rows; the inspector is outside the workspace region),
not application regressions; raw attempts are retained. Root visually inspected
the passing capture. The retention follow-up received a bounded same-Codex source
recheck with no additional finding; it is not external signoff. All three browser
flows were repeated successfully after the retention correction.

Actual mac-arm64 package smoke passed five launches, all graceful exit 0: A live
write, A offline recovery, B setup, keyed-A rejection and legacy rejection followed
by fresh B. Read-only SQLite agrees: three A rows, zero B rows before live B,
then three B rows. The B inspector shows `52.90010, -9.10010`; root inspected
the A cache and fresh B device captures. This is a dirty working-tree build atop
`7fc4aa08`, not an exact-commit receipt; the source hashes and packaged input match
are retained in `local-verification.json` and `native-receipt.json`.
ASAR SHA256: `a1ca1b7ea1e4ede0f9a1b13ee578b0069372f69f8888dd366ddbc9eac6687a77`.
Only the build-generated version source delta was restored afterward.
Known coverage enumeration/cancellation/listener warnings and intentionally
blocked map requests remain in the raw native receipt; this is bounded mission
cache proof, not a clean whole-application or live-provider qualification.

The final committed head must pass ordinary Linux CI before owner acceptance.
[PR26](https://github.com/donal0c/sartracker-web/pull/26) and DON-267 carry the
live exact-head CI run and downloaded terminal artifact inspection. No new
external approval is claimed; the result is ready for Donal's re-review once that
gate is green. Merge and release remain separate decisions.
