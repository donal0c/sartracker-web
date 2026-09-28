# SAR Tracker — ordered delivery ledger

Updated 2026-09-28. This is the single active queue, replacing the accumulated pre-publication queue. Historical decisions and evidence are preserved in [the previous workplan](../handoff/archive/2026-09-28-pre-reset-workplan.md). Linear owns issue detail; this file owns order and dependencies; [HANDOFF](../handoff/HANDOFF.md) owns continuity.

## Agreed direction and boundaries

Donal asked for one ordered plan covering process/testing repair, remaining defects, team requests, audit findings and backlog cleanup, with parallel work where useful and **purchased-map delivery last**. This supersedes the earlier investigation's suggestion to prepare maps in parallel with the first maintenance release.

The team has beta.13.4 and its existing local map areas for controlled testing. Keep that published release immutable. A successful team beta is not operational/live-incident acceptance.

Mapping logistics remain open for discussion with the team. Donal estimates most work is within perhaps 20×20 or 40×40 km in Kerry, with occasional larger or distant operations. This is a planning hypothesis, not confirmed coverage. Owning national maps does not require installing national detail on every laptop, and files stored on disk are distinct from tiles loaded into memory. Do not estimate tile counts/size without chosen bounds and zoom/detail. Existing maps let other testing continue; no new mapping work is a prerequisite to stages 1–5.

The plan was created on 2026-09-28 with Donal's clarification that CLAUDE.md and the post-mortem cleanup come first. Stage 1 was then executed the same day (see its result note). Rows below are queued work, not claims of completion or blanket approval for destructive actions.

## How we will use this ledger

- **Execution partnership (Donal):** Claude Code, using Opus 5.5, is the primary implementer. Codex supplies one temporary prompt per bounded chunk, coordinates dependencies and independently validates the result before advancing. Claude researches and challenges Codex's recommendations, chooses implementation/test details and explains justified changes. The first prompt groups P01–P05 as the foundation reset; later chunks are scoped from what is learned. Explicit user requirements and safety/authority boundaries still apply.
- Work top to bottom by stage. Name the next row, owner, expected visible result and relevant tests before starting. Keep one product slice and one independent process/evidence slice active at a time; add a specialist only for a genuinely independent task.
- Status vocabulary: **NEXT**, **QUEUED**, **DECISION**, **PARKED**, **ACTIVE**, **DONE**, **DEFERRED**. DONE needs an evidence link; DEFERRED needs an explicit decision, reason and revisit trigger. A missing team answer blocks only dependent work.
- Coordinator owns this queue, deduplication and integration. Assign an actual implementation owner on activation. One owner operates the shared Ubuntu install/profile and performance workloads; independent source work can proceed elsewhere.
- Keep scope bounded. A new finding gets a named disposition; it does not silently expand the active patch or restart every check.
- Close each row with the relevant issue, proof, remaining limits and next action. Implemented, tested locally, tested in the package, and accepted by operators are different claims.
- Build release batches from stable completed slices. Do not issue a release per row or wait for every row to finish before delivering a useful maintenance beta.

## Stage 1 — foundation reset first

**Donal's clarification:** the CLAUDE.md/instruction, document and process cleanup proposed in post-mortem 09 §6a belongs first, before starting the next product fixes. This is the first work chunk, not optional housekeeping after a maintenance release. Source-of-truth cleanup, smoke tooling and backlog reconciliation may run in parallel inside this stage, with one integrator for shared files. Read-only baseline checks and preparation of team questions may proceed; product implementation waits for the reset checkpoint.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| P01 **DONE** (CI 36445372627) | Rewrite CLAUDE.md and clarify AGENTS.md's relationship; establish one short release checklist and consistent testing cadence. Start from post-mortem 09 §6a and 08 §§3/7. | First; coordinator/instruction owner. | Roughly 150 readable lines, a target rather than a hard limit: active release rules, coordinate/persistence/no-silent-failure invariants, feature-work guidance and source pointers. Move visual internals/historical programme rules out. Preserve the master AGENTS.md symlink. Distinguish release gates from development practices. Resolve qualification retirement/cadence explicitly; the existing non-gating policy is not silently changed. |
| P02 **DONE** (CI 36445372627) | Archive obsolete assurance/release documents and remove retired campaign/controller surfaces, npm commands and CI-only orchestration after dependency review. | P01 policy; can overlap P03. | Active docs contain no conflicting instructions. Linked release notes, template and history remain accessible. Extract shared helpers; preserve useful startup/I/O, privacy, archive, tracking, GPX, map freshness, strict responsiveness and WAR02B property/negative-control tests. Do not delete all assurance-named tests blindly. Correct docs-trigger/concurrency behavior and obsolete Tauri release checks. |
| P03 **DONE** (CI 36445372627) | Bring working Ubuntu launcher, CDP driver, real-time Traccar/outage mock and required fixtures into simple team-smoke tooling. | P01 checklist; parallel to P02 on separate files. | Required rows run against unchanged 13.4 bytes, bounded cleanup and truthful PASS/FAIL/NOT_TESTED. Artifact and harness identities separate; no build trigger. Fix GPX/refusal/argument harness defects only as needed. Record Ubuntu environment health; half-configured NVIDIA packages are separate maintenance, not app failure. |
| P04 **DONE** (CI 36445372627) | Align publisher and release template to the checklist, including explicit owner-approved exceptions. | P01; integrate with P02/P03. | Dry-run and rejection tests preserve CI/tag/download/hash/provenance guards. Exceptions bind artifact/check/evidence/exposure/use/actual owner approval and expire per release; FAIL never becomes PASS. One reviewed result table supports one release decision. |
| P05 **DONE** | Live backlog reconciled: DON-239 Done; DON-8 superseded by DON-278; DON-11/13/14 canceled for obsolete scope. DON-254/265 explicitly limited to controlled-beta delivery; residuals extracted as DON-281–290. | Coordinator; live audit and readback on 2026-09-28. | Original descriptions/comments retained; archived duplicates left untouched. Remaining acceptance gaps retain their existing issues and rows below. |

**Stage 1 result (2026-09-28; complete).** Claude shortened CLAUDE.md, aligned the checklist/publisher, archived obsolete procedures and removed the campaign front door while retaining useful CI probes. Codex's independent review reproduced and corrected three harness defects: failed-spawn cleanup, loss of earlier fixes escaping the oracle, and incomplete human checks reported as PASS. Exceptions now bind both approved artifact hashes as well as the tag. Mixed automated/manual rows remain NOT TESTED until completed. Keep the intertwined qualification library for now; extracting its useful probes is a separate bounded improvement, not a reason to delay this reset. P05 live backlog reconciliation is complete and independently verified. New findings: R08 below; SIGTERM quit also recorded as unclean (R04).

**Immediate team feedback:** restore the existing-area Discovery package separately from the final purchased-map feature. The retained original has a reproduced minzoom mismatch; confirm the tester's bytes before prescribing the correction, then validate a separately named derivative on unchanged 13.4. For the orientation report, first confirm compass reset on the affected installation; no coordinate defect has been established. Private reports and original attachments stay outside this public repository.

**Foundation finish condition:** active instructions, checklist, tooling, publisher and handoff agree; obsolete machinery no longer dictates work; important safety tests remain runnable; a bounded rehearsal on immutable 13.4 shows the new path is usable. Then move to R01. Mere document shortening is not completion, and exhaustive automation of every old check is not required.

Fable's budget is one to two working sessions. If a step grows beyond roughly half a session, record the concrete remaining work and reduce the reset scope with Donal rather than silently expanding it. Preserve required checks and existing working tools. Proposed retirement of the non-gating campaign needs the explicit policy disposition in P01 before removal; there is no new automatic approval ceremony for ordinary reversible cleanup.

## Stage 2 — repair the shipped recovery and lifecycle problems

Reproduce first. Use the actual installed application for native/packaged claims. A Settings shortcut must not silently redefine authority; a legacy migration must not invent provenance.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| R01 QUEUED | Crash → Archive & Lock blocked without admins; separately test the rejected-position evidence/outbox durability hypothesis. DON-254 closeout. | After foundation checkpoint; highest product priority. | Operator has a truthful recovery route, acknowledgement/authority preserved; crash/pending-evidence scenarios tested. Distinguish navigation fix from evidence durability proof. |
| R02 QUEUED | Active 12.11 upgrade permanently reports incomplete history. | Reproduction profile; define legacy semantics before migration. | Original records preserved; missing provenance represented honestly; coverage stops repeatedly diverging. Upgrade and restart proof on a copy of the real profile. |
| R03 QUEUED | Recovery resumes a previously paused mission. | Explicit expected recovery state; distinct from R01. | Running/paused pre-crash states produce the agreed visible recovery result without silent tracking changes. |
| R04 QUEUED | Window-X false unexpected-shutdown marker (team-smoke also reproduces it for a plain SIGTERM quit); unwritable profile silent exit (reproduced by team-smoke). | Independent native reproductions; may be separate patches. | Actual window-close and restart prove clean exit; unwritable profile shows an actionable error without weakening true duplicate-launch handling. |
| R05 QUEUED | Slow quit and first ~1M-fix open; native synchronous startup/watchdog limitation. | After foundation checkpoint; may overlap independent team-question preparation. | Distinguish SQLite startup from mission-open and pending reads. Test PR5 P3-12 held-read shutdown cancellation; measure full process tree. Give native isolation a separate design/estimate if needed, not an automatic rewrite inside 13.5. |
| R06 QUEUED | Residual minor validation defect: malformed IPC identifiers reach SQLite before rejection. | Risk triage from actual boundary, not symptom guessing. | Bounded validation correction with rejection tests, or explicit low-priority disposition; no silent omission. |
| R08 QUEUED | With WebGL unavailable (Chromium GPU blocklist) the app shows a black window with no message. Found by team-smoke on the Ubuntu box, 2026-09-28. | Reproduce on a disposable profile; decide the visible fallback. | The operator sees an actionable message when the map cannot render; the rest of the app stays usable or fails visibly. Not an Ubuntu-box workaround. |
| R07 QUEUED | First maintenance release checkpoint, likely beta.13.5. | Foundation checkpoint and selected stable R fixes; outstanding rows stated. | Exact CI-built package passes agreed smoke and changed-surface tests; remaining issues/NOT_TESTED cases collected for one owner decision. Do not wait for all later features. No rebuild after a failure without Donal's approval. |

R07 is a release checkpoint, not permission to ship or an assertion that every recovery issue is cheap. An unexplained failure remains recorded; independent checks continue. A harness-only repair reruns against the same binary.

## Stage 3 — finish the remaining non-mapping team requests

Prepare a small, deduplicated set of operational questions during stages 1–2, so answers can arrive before dependent implementation. Preparing questions is in scope; sending them requires Donal's instruction. Use the existing raw transcript/Q&A ledger, not a new question system.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| T01 DECISION | Protected settings, coordinator/admin changes, unlock authority and lost-access recovery. DON-219/220/221. | Team/domain decisions first; source analysis can proceed during stage 2. | One coherent authority and recovery rule, then tested allowed/denied/recovery flows. Do not strand operators or claim mutable local names are authentication. |
| T02 QUEUED | Rename an active mission. DON-257. | T01 authority decision/implementation. | Stable identity; audited old/new name; persistence, restart, archive and export consistency. Finalized-mission semantics explicit. |
| T03 QUEUED | Search-area label position/anchor and marker coordinate simplification. DON-214/135. | Confirm narrow intended behavior; can run alongside T01 on separate files. | Label moves without changing geometry and survives reload; coordinate display stays truthful. Rendered UI, persistence and relevant export/replay verified. |
| T04 QUEUED | Map image/print output for local sharing. DON-216; SAR-QA-007. | Existing maps suffice; confirm applicable export rights. | Usable local output with required scale/extent/time and state context. Verify render/export without building a WhatsApp integration. Purchased-map-specific final acceptance waits for M03 if rights/source prevent earlier proof. |
| T05 DECISION | Remaining external-team/drone/media and evacuation/gear log workflow. DON-217/218. | Existing live+GPX answers stand; ask only actual residuals. | Each residual is implemented and tested, or explicitly deferred/declined by decision. Do not invent a video or logistics subsystem. Core external live+GPX is not rebuilt. |
| T06 QUEUED | Check implemented ODT requests and outings/layer presentation residuals. DON-100/215/256; DON-8 replay. | Actual beta feedback and existing evidence; throughout stage 3. | All 29 ODT rows accounted for. Retain delivered UI/visibility/replay and existing answers; fix only real regressions or residual grouping needs. Accepted evidence linked rather than every batch rerun. |
| T07 QUEUED | Clear Alias and a bounded Replay/Search clarity batch. AUD-12; selected PR5 P3 items. | Can run independently of authority work; prioritize real impact. | Clear Alias fixed with regression. Explicitly disposition page-progress wording, limitation detail, stale success, assignment refresh/unassignment, pending filters and autumn-hour Search Pass entry. Do not invent unassignment semantics. |

**Second checkpoint:** non-mapping team requirements are implemented with evidence, or have an explicit agreed deferral. Publish stable improvements in sensible batches using the same process. “No answer yet” is not “no longer required.”

## Stage 4 — close audit and resilience debt proportionately

Inventory and bounded diagnosis can run earlier; implementation order follows evidence and shared-file ownership. Bring a confirmed serious defect forward immediately. Broad unexecuted WAR charters are not a blanket prerequisite.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| A01 QUEUED | GPX recovery accounting: repeated staged-source failures and published/assigned imports falsely marked interrupted. PR5 P3-8/10. | Bounded native reproduction; may follow R01 before other stage 4 work. | Per-attempt accounting and source custody proved; repair confirmed failures with restart regressions, otherwise record precise non-reproduction limits. |
| A02 QUEUED | Other retained audit candidates: layer subtree partial persistence/optimistic visibility, reorder races, count wording/subscription cost; remaining PR5 hardening and nine unconfirmed Astra leads. | Current-source candidate must reproduce before implementation. | Each candidate has a repair/proof, supersession, bounded evidence gap or explicit deferred trigger. Keep one residual register; do not create a ticket for every unconfirmed observation. |
| A03 QUEUED | Original-machine freeze/performance and implemented-but-unclosed evidence. DON-151/159/160–164/240/247; WAR05/13B. | Reuse relevant 13.4 team observations; targeted original-machine follow-up. | Exact pending assertions covered: quiet-device retention, locked-delete refusal, distinct archives, Review events/first contact and original slowdown. Preserve platform/long-duration limits; a short Ubuntu pass cannot close an unrelated field symptom. |
| A04 DECISION | Storage/integrity/legacy recovery/index-retention and native isolation. DON-249/250/251 plus R05 assessment. | Measured supported workload and safety design; review artificial dependency chain. | Each capability is either designed, implemented and verified, or explicitly scheduled/deferred with limits and revisit trigger. No automatic purge/VACUUM or giant store rewrite; required safety work cannot be silently parked for speed. |
| A05 QUEUED | Remaining package findings and dependency health. DON-254 C10/large archive/201ms/C26/C28; DON-146 runtime upgrade; memory-growth observation. | Separate product, harness and measurement causes; selected workload only. | Each failure has a bounded disposition; full-process memory measurement replaces the undercount. Builder upgrade is not Electron runtime upgrade. Pick/verify an appropriate runtime target when needed, with package proof. No generic full-campaign retry. |
| A06 DECISION | Support upload/inbox, platform support and optional extras. DON-179/181; DON-13/14/115/141; DON-21/258. | Product/support decisions; local support export already exists. | Clear first-handover platforms; retain Windows evidence if required. Remote upload/privacy/retention explicitly chosen or deferred. Shortcut hints and portfolio/demo work explicitly later unless requested. |

**Third checkpoint:** no unowned major finding. Source fixes, package acceptance and deferred capabilities remain distinguishable. Non-gating qualification keeps its current status until Donal explicitly changes it; P01/P02 must not silently turn retirement into an accomplished decision.

## Stage 5 — verify the non-mapping handover before the final feature

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| H01 QUEUED | Refresh QGIS replacement/functional acceptance and close historical programme accounting. DON-5/6/12/25/241/254/265. | Stages 2–4 dispositions; evidence may be collected incrementally. | Current parity matrix marks delivered functionality correctly and exposes remaining requirements. Closed programme parents do not imply 205 passes or completed deferred storage work. |
| H02 QUEUED | Exercise the complete ordinary operator workflow on the supported package with existing maps; update manual/support/handoff and reconcile backlog again. | H01 and ready non-mapping features. | Start/resume, track/outage, participants/GPX, visibility/replay, drawings/markers, pause/recovery, review/export, finish/archive/reopen and diagnostics work together. Native pickers and relevant fault paths have actual proof. Required field acceptance remains distinct. |

Do this once on a stable integrated slice with risk-selected negative paths. Reuse unchanged evidence where justified. This is a coherent operator check, not a relaunch of 205 rows under a new name.

## Stage 6 — purchased mapping, the final functionality stage

All M rows are **PARKED by Donal's sequencing decision** until the preceding required non-mapping work is complete or explicitly deferred. Gather questions through T-stage planning, but do not start conversion, map feature coding or large package benchmarking early.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| M01 PARKED | Agree the area workflow with the team. DON-144 under DON-7/76; grid/provider residuals. | Team logistics discussion; stages 1–5 checkpoint. | Normal Kerry area, occasional travel/larger areas, preparation responsibility/lead time, keep/replace multiple regions, actual products/rights and supported devices agreed. Confirm grid system/spacing/labels. No national-in-memory requirement. |
| M02 PARKED | Deliver repeatable private package preparation, supply and safe native import/area management. DON-144 absorbs duplicate DON-113. | M01; existing Discovery assets already located. | Measure selected real coverage/detail; safe failed/cancelled replacement; clear progress/errors; versioned private distribution and operator instructions. Current single Discovery slot limitation resolved according to the agreed workflow. |
| M03 PARKED | Complete grid/provider scope and exact-package offline acceptance. DON-7/76/115/141; DON-116 optional terrain. | M02 and actual source/rights; commercial extras may need explicit later disposition. | Required areas render offline after source removal/restart, at boundaries and agreed zooms; Check View/large-file validation remain usable; mission overlays stay responsive. Grid golden fixtures and baked-in lines handled honestly. Hiker/EastWest/Harvey each has a delivery or explicit scope decision. |
| M04 PARKED | Final integrated team handover and operational acceptance decision. DON-5/6. | M03; all required rows complete, remaining deferrals visible. | Exact release, manual, private map instructions, known limits/support route and team acceptance linked. State explicitly whether approval is controlled testing or live use; QGIS retirement is a separate affirmative decision. |

## Team questions to assemble, not send yet

Use SAR-QA-003/004/007/010/014/015/019/020 first. They already settle all-mission history, outings rather than days, live plus GPX, participant selection, local map output, truthful timestamps and evidence retention.

Only unresolved operational choices belong in the next batch:
- Protected settings/unlock/lost-access responsibility, active/finalized rename policy (T01/T02).
- Desired search-area label behavior and simpler coordinate presentation (T03).
- The actual drone/media and evacuation/gear workflows, and whether they belong in this handover (T05).
- First supported laptops/platforms and remote support expectations (A06).
- Later mapping logistics, product source/rights, distribution responsibility and grid presentation (M01).

Check the existing ledger against the precise wording before forwarding. Record new answers append-only and link them to these rows. Do not ask the team to resolve engineering mechanisms.

## Coverage register — no open issue lost

This preserves the original 42-issue audit and its 28 September reconciliation. Linear remains the live status source. DON-239 is now Done; DON-8 is Duplicate → DON-278; DON-11/13/14 are canceled for obsolete intake/Tauri scope; DON-265 is Done for controlled-beta delivery only. Platform and operational acceptance remain open in their owning rows.

| Open issue IDs | Owning row(s) |
| --- | --- |
| DON-5, DON-6, DON-12 | H01, M04 |
| DON-7, DON-76, DON-144 | M01–M03 |
| DON-8, DON-100 | P05, T06 |
| DON-11 | P05: obsolete first-beta intake; current beta feedback retained |
| DON-13, DON-14 | P05, A06: legacy Tauri scope and supported-platform decision |
| DON-21, DON-258 | A06: optional polish/demo |
| DON-25, DON-265 | P05, H01: historical umbrellas and explicit residuals |
| DON-115, DON-141 | A06, M03: supported-platform map proof |
| DON-116 | M03: optional terrain, not silently included |
| DON-135, DON-214 | T03 |
| DON-151, DON-159, DON-160, DON-161, DON-162, DON-163, DON-164, DON-240, DON-247 | A03 |
| DON-179, DON-181 | A06; native startup separately R05/A04 |
| DON-216 | T04; purchased-source proof M03 |
| DON-217, DON-218 | T05 |
| DON-219, DON-220, DON-221, DON-257 | T01/T02 |
| DON-239 | P05: implemented under DON-260, evidence-backed closeout |
| DON-249, DON-250, DON-251 | A04 |

Completed/duplicate record corrections also belong to P05: DON-146, DON-230/241/254/255 and links 113→144, 67→100, 134/138→191, 139→192. These are not extra implementations.

New residual issue anchors (28 September): R01 → DON-281; R02 → DON-282;
R03 → DON-283; R04 clean exit → DON-284; R04 unwritable profile → DON-285;
R05 → DON-286; R06 → DON-287; R08 → DON-288; PR5 residual triage → DON-289;
R07 maintenance checkpoint → DON-290. The five already archived duplicate
records were not restored or deleted again. DON-254/265 preserve their original
specifications as historical text and explicitly retain incomplete qualification.

ODT coverage: delivered T01/04–10/13/18/20–22 → ledger T06; source T12/26 → T03; T14/19 → T01/T02; T23/24/25/28 → T05; T27 → T06; T29 → T04; mapping T02/03/11/15–17 → M01–M03. These T numbers refer to the investigation's 29 source rows, not this ledger's work IDs.

Audit coverage: 13 confirmed Astra groups already repaired; AUD-12 → T07; nine unconfirmed leads and older Ox candidates → A02. Eight named WAR outputs already complete; WAR03/07/08/09/10 inform relevant rows rather than five compulsory whole-app audits; WAR05/13B → A03; WAR12 → P01/A05 as non-gating work. All 20 deferred PR5 candidates are covered by R05, T07, A01/A02 and P05 supersession.

## Verification and release rules

1. Define expected behavior, safety invariants and failure cases; reproduce defects before production changes. Tests first for behavior-bearing/safety logic.
2. Focused unit/integration red→green; browser UI and rendered inspection where affected; actual native/package proof for native, scale, timing, shutdown and persistence claims.
3. One wider stable-source verification cycle per coherent batch, then exact CI-artifact smoke before release. New changes/failures determine repeats; narrative-only edits do not rerun unchanged runtime suites.
4. Preserve useful strict thresholds and actual failures. Diagnose within a bounded scope; no rerunning until green, fabricated PASS, uncontrolled build loop or reuse of evidence across changed relevant behavior.
5. No rebuild following failure without Donal's approval. Continue independent authorized checks and present one concrete diagnosis/proposed change/build decision. Publication and operational acceptance remain separate decisions.
6. Update the relevant issue, operator manual/screenshots, this row and handoff after proof. Close only the claim actually established.
7. Never use “all backlog cleared” to conceal unanswered requirements. Every residual is done, superseded with evidence, or explicitly deferred with an owner/revisit trigger.

## Current checkpoint

- **Done:** Claude's foundation changes and Codex corrections pushed through be5fc69f; P05 live dispositions applied. Corrected-tool rehearsal on unchanged 13.4 passes exact tracking and outage/backfill, and truthfully fails lifecycle for DON-283/284. Mixed manual rows remain NOT TESTED.
- **Foundation complete:** [CI 36445372627](https://github.com/donal0c/sartracker-web/actions/runs/36445372627) passed on be5fc69f: 592 files / 6,197 tests passed / 10 skipped; 225 Chromium preflight tests passed; targeted browser, WAR-02B, package build and packaged checks passed. Later working-tree product edits are not covered. Product fixes are not included in this reset.
- **Next:** Claude's bounded R01 / DON-281 implementation, followed by Codex validation. Existing-area Discovery recovery and tester compass confirmation remain separate team-feedback actions; broader purchased maps stay last.
- **Later:** T-stage decisions/features, audit/resilience closeout, non-mapping acceptance, then M01–M04.
- **Open decisions:** governance/product questions above and actual mapping logistics. Campaign front-door retirement is resolved; useful intertwined packaged probes are retained.
- **Evidence baseline:** foundation source be5fc69f; smoke tool 7173c301; released executable source a273ae6d. Recheck live state before activating an issue.

Investigation sources: private post-mortem 10 and its six supporting reconciliations, prepared 28 September, under ~/workspace/vibes/release post-mortem/. Public/repository execution records must not copy licensed assets, credentials or private raw history. The earlier report's map-in-parallel recommendation is superseded by Donal's later instruction recorded above.
