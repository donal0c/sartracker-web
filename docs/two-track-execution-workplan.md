# SAR Tracker — ordered delivery ledger

Updated 2026-09-30. This is the single active queue, replacing the accumulated pre-publication queue. Historical decisions and evidence are preserved in [the previous workplan](../handoff/archive/2026-09-28-pre-reset-workplan.md). Linear owns issue detail; this file owns order and dependencies; [HANDOFF](../handoff/HANDOFF.md) owns continuity.

## Next release (13.6) — ordered queue, 1 October (Claude tracks these)

beta.13.5 was published on 1 Oct 2026 (tag fac5adcf). This is the queue for the
next release, safety and fail-visible issues first. Each item has a ticket.
Claude keeps the list current; Donal does not need to remember any of it.

| Order | Item | Ticket | Needs |
| --- | --- | --- | --- |
| 1 | Initial history catch-up can starve live trail polling (all 8 shared transport slots) | DON-311 | Tests first (see DON-305's live-polling test) |
| 2 | Main-thread stalls of 400–670 ms in the normal-profile soak (pre-existing; data exact) | DON-310 | Attribute the stalls, then fix; re-test on a GPU machine |
| 3 | Discovery remembered as the map across restarts (team ask; offline safety) | DON-304 | Tests first |
| 4 | Visible failure when WebGL is unavailable or GPU-blocklisted | DON-288 | Fallback wording decision, then fix |
| 5 | Unwritable profile exits silently | DON-285 | Implementation |
| 6 | Clean exit recorded as a crash, plus the "was lost" wording | DON-284 | Donal wording decision, then fix |
| 7 | Restore a retired GPX track with truthful replay | DON-309 | Migration plus replay/archive changes |
| 8 | Default team group pre-ticked at Start | DON-296 | **Donal decision** |
| 9 | Simplify the right-hand panel; Eamonn's layout doc; Outings panel clarity | DON-297 | Eamonn's doc and call, then a design proposal |
| 10 | PCLinuxOS VM on the test box; smoke the AppImage there | DON-298 | Setup |
| 11 | Hidden-gap sweep: persisted legacy state, mid-mission controls, checks during failures | DON-299 | Implementation |
| 12 | Cosmetic items from the manual pass; merge the manual rewrite | DON-300, DON-301 | Implementation, review |
| 13 | Replay of backfilled history (question not yet sent) | DON-293 | Ask the team |
| 14 | Retire or rewrite the obsolete live-exact smoke | DON-302 | Donal OK to retire |
| 15 | Harvey and Hiker maps | DON-303 | Maps last |

Release carry-overs: repeat the native file-picker hand check on the next
candidate; run the installed normal-profile soak again (now about 20 min on
the box) and compare with DON-310's baseline.

## Locked queue — Donal's working plan, 28 September

**NEXT: 1.2a — realistic team-mission smoke scenario and retro register of team reports (Donal, 29 Sep). 1.2 / DON-283 implemented (bc34425e), awaiting Codex review, CI and Ubuntu lifecycle row. DON-291 DONE (not released).**

Coordinator priority decision, 28 September: investigate Eamonn's missing initial
history before the next numbered fix because it affects current team testing.
This is one bounded interruption, not a confirmed diagnosis or a parallel lane.
The original numbered order resumes at 1.2 when this slice is validated or its
specific missing decision is recorded.
Foundation P01–P05 and archive recovery R01 / DON-281 are DONE. Do not repeat them.
The five numbered steps below own execution order; the older R/T/A/H/M tables
below supply detail and acceptance criteria, not a competing queue.

| Step | Ordered handovers within the step | Step exit |
| --- | --- | --- |
| **1. Repair the current reliability problems** | **1.1 DONE:** older-mission upgrade coverage (R02 / DON-282). **1.2 IN REVIEW:** paused crash recovery (R03 / DON-283). **1.2a NEXT:** realistic team-mission smoke scenario on a lived-in profile, mandatory offline-map/upgrade/no-GPU-flag rows, and retro register of past team reports (gap audit 29 Sep; see below). **1.3:** clean window/SIGTERM exits (R04 / DON-284). **1.4:** unwritable-profile error (R04 / DON-285). **1.5:** slow open/quit and native startup investigation (R05 / DON-286). **1.6:** malformed IPC identifiers (R06 / DON-287). **1.7:** unavailable-WebGL visible failure (R08 / DON-288). **1.8:** resolve the recorded crash-warning wording decision from DON-281; retain the safety restriction unless separately approved. | Each defect repaired with relevant proof, or a concrete diagnosis/decision and explicit residual disposition. An investigation is not automatic authority for a store rewrite. |
| **2. Finish the original non-mapping team requests** | **2.1:** settings/admin/unlock/recovery authority decisions, then agreed implementation (T01 / DON-219/220/221). **2.2:** active mission rename (T02 / DON-257). **2.3:** search-area labels, then marker coordinates (T03 / DON-214/135). **2.4:** local map image/print output (T04 / DON-216). **2.5:** external resources/drone/media and evacuation/gear residual decisions (T05 / DON-217/218). **2.6:** reconcile all 29 ODT rows, including delivered items and outings/layers (T06 / DON-100/215/256; replay successor DON-278). **2.7:** Clear Alias, then confirmed Replay/Search usability residuals (T07 / AUD-12 and DON-289). | Every ODT request has evidence of delivery or a recorded, agreed decision. Mapping rows transfer to step 5; no unanswered request is silently dropped. |
| **3. Close the remaining WAR, audit and support obligations** | **3.1:** GPX recovery accounting (A01 / DON-289 candidates). **3.2:** remaining PR5/Astra/layer candidates, reproducing before fixes (A02 / DON-289). **3.3:** original-machine freezes and outstanding persistence/retention/audit proofs (A03 / DON-151/159/160/161/162/163/164/240/247). **3.4:** storage integrity, large-store recovery, indexes/retention and native-isolation decisions (A04 / DON-249/250/251, DON-286). **3.5:** residual package/scale/timing/memory and supported Electron runtime work (A05 / historical DON-254/146). **3.6:** supported platforms, support upload/inbox and optional extras dispositions (A06 / DON-25/179/181/115/141/21/258). | Every retained finding is repaired/proven, superseded with evidence, or explicitly deferred with owner, limits and revisit trigger. Broad old WAR charters do not become compulsory new audits. |
| **4. Validate and release the stable non-mapping batch** | **4.1:** reconcile parity/requirements and historical programme accounting (H01 / DON-5/6/12/25/241/254/265). **4.2:** ordinary operator workflow on the supported package, manual and support handover (H02). **4.3:** maintenance release decision using the single checklist (R07 / DON-290). | One stable exact CI artifact, truthful results/known issues and Donal's publication decision. No claim that all 205 historical bindings passed, or that controlled testing equals operational acceptance. |
| **5. Purchased maps and final handover — last** | **5.1:** agree normal/travel area logistics, products/rights and grid requirements (M01). **5.2:** private preparation, distribution and area import/management (M02 / DON-144). **5.3:** provider/grid/offline/platform verification (M03 / DON-7/76/115/141; DON-116 terrain decision). **5.4:** final integrated handover and explicit operational/QGIS-retirement decision (M04 / DON-5/6). | Required map workflow works on agreed devices and areas; final acceptance is explicit. No all-Ireland-in-memory assumption. |

### 1.2a — close the team-usage testing gap (Donal, 29 Sep)

A gap audit after DON-291 found that every team-found bug needed realistic or
carried-over state: real settings, real map files, metadata persisted across
days and betas. The smoke checks subsystems in a fresh profile at defaults.
Deliverables, before 13.5:
1. One team-smoke **team-mission** scenario on a lived-in profile: 48 h offset;
   Traccar **group** plus individual devices, before and after Start; about
   30 mock devices including stationary heartbeat devices; two outings with a
   clean quit and next-day resume between them; outage; stationary, stale and
   offline indicators asserted; casualty marker plus two-stage delete; search
   area; timed and untimed GPX; replay into the backfilled window; finish,
   archive, and reopen with the **recovery code**.
2. Mandatory rows: offline map using the package the team holds, upgrade from
   the team's current release with an active mission, and one launch without
   `--ignore-gpu-blocklist` (DON-288).
3. Retro register: give every past team report (DON-185/186/187/62/85/86/128/
   89/90/127/189/259/260/261, Devices click leakage, DON-148/176, and the
   recurring "Map Tools fail until Reset Layer Catalog Metadata") a register
   line naming its durable test or a queued gap. Confirm the Map Tools failure
   was root-caused.
4. Ask the team for their own written test-mission steps; the scenario follows them.
Audit working notes: `tmp/test-gap-audit/` (local, gitignored).

### The handover loop

On **“what's next?”**, Codex reads this cursor and current evidence, then writes
one bounded temporary prompt for the next numbered item. Claude investigates,
challenges the proposed approach, implements and tests. Codex reviews, verifies
the relevant runtime boundary, integrates and updates Linear plus this cursor.
Only then does the cursor advance. A grouped item is split into named subparts
inside its existing number when necessary; it is not handed over as a giant batch.
No product work starts merely because an automated watch finishes.

Codex may reconcile evidence and prepare missing team questions while Claude
implements; only one product change and one owner of the Ubuntu test runtime.
Team questions reuse existing answers and ask for operational choices, not
developer diagnostics. Sending email still requires Donal's instruction.

### New feedback and explicit exceptions

- **Team follow-up, 28 September:** TB13-01 resolved by Eamonn; TB13-02 original supplied filename confirmed, corrected-package validation/delivery still pending under DON-144. New TB13-03 / DON-291 reports missing 48-hour history in a new mission, with beta 12 comparison. Step 1 intake: investigate after DON-282 review and explicitly decide priority before changing implementation order. No parallel product slice. DON-282 also exposed “All mission history shown” while unconfirmed legacy rows remain excluded: visibility/policy decision under 2.7/3.2; retain fixTime-only evidence rules.
- **Already owned:** TB13-01 orientation confirmation and TB13-02 existing-area
  Discovery repair (DON-144). These are immediate support follow-ups alongside
  the queue, not permission to start step 5. The drafted reply has not been sent
  by Codex; no answer or corrected-map acceptance is assumed.
- Every new report gets checked for duplication and assigned a numbered home.
  Confirmed safety defects or blockers to team testing may interrupt the queue;
  state the reason, the inserted bounded task and the resume point. Other bugs
  join the appropriate step. No silent expansion or parallel implementation swarm.
- A required team answer blocks only its dependent item. Record the missing
  decision and the return point before taking the earliest independent item.
  Skipping it is not completion or an approved deferral.
- This is an order, not a two-week promise to implement every open issue.
  Step 4 is the planned release checkpoint after required fixes/dispositions.
  An earlier useful maintenance release needs an explicit recorded batch decision;
  it must not disappear or move silently between the detail tables.
- Release rules remain unchanged: no rebuild after failure without Donal,
  preserve actual failures, and do not rerun unrelated campaigns. The process
  reset is implemented; its first complete release remains to be exercised.

### Coverage lock

Live Linear refresh on 28 September returned **45 open, non-archived project
issues**, all mapped to this queue through the coverage register below. All
29 original ODT rows, the WAR/Astra/PR5 residual registers, current beta defects,
and both new team reports are included. This means **every known item has a
home**, not that every historical allegation is a current bug or every desired
feature is approved. Decisions/deferrals require explicit recording.

The additional DON-281 observations also remain accounted for: overstated crash
wording → 1.8; existing Settings-mast/inline-dialog Escape conflict → 3.2;
Mac renderer-crash process exit observation → 1.3/3.6, without assuming the Linux
result proves Mac behavior. No extra unowned investigation is created.

## Agreed direction and boundaries

Donal asked for one ordered plan covering process/testing repair, remaining defects, team requests, audit findings and backlog cleanup, with parallel work where useful and **purchased-map delivery last**. This supersedes the earlier investigation's suggestion to prepare maps in parallel with the first maintenance release.

The team has beta.13.4 for controlled testing. Its existing-area Discovery import is blocked for the reporting tester pending the support repair above; available public basemaps permit other appropriate testing. Keep the published release immutable. A successful team beta is not operational/live-incident acceptance.

Mapping logistics remain open for discussion with the team. Donal estimates most work is within perhaps 20×20 or 40×40 km in Kerry, with occasional larger or distant operations. This is a planning hypothesis, not confirmed coverage. Owning national maps does not require installing national detail on every laptop, and files stored on disk are distinct from tiles loaded into memory. Do not estimate tile counts/size without chosen bounds and zoom/detail. Existing maps let other testing continue; no new mapping work is a prerequisite to stages 1–5.

The plan was created on 2026-09-28 with Donal's clarification that CLAUDE.md and the post-mortem cleanup come first. Stage 1 was then executed the same day (see its result note). Rows below are queued work, not claims of completion or blanket approval for destructive actions.

## How we will use this ledger

- **Execution partnership (Donal):** Claude Code, using Opus 5.5, is the primary implementer. Codex supplies one temporary prompt per bounded chunk, coordinates dependencies and independently validates the result before advancing. Claude researches and challenges Codex's recommendations, chooses implementation/test details and explains justified changes. The first prompt groups P01–P05 as the foundation reset; later chunks are scoped from what is learned. Explicit user requirements and safety/authority boundaries still apply.
- Follow the locked numbered queue above. Name the next item, owner, expected visible result and relevant tests before starting. Keep one product slice and one independent process/evidence slice active at a time.
- Status vocabulary: **NEXT**, **QUEUED**, **DECISION**, **PARKED**, **ACTIVE**, **DONE**, **DEFERRED**. DONE needs an evidence link; DEFERRED needs an explicit decision, reason and revisit trigger. A missing team answer blocks only dependent work.
- Coordinator owns this queue, deduplication and integration. Assign an actual implementation owner on activation. One owner operates the shared Ubuntu install/profile and performance workloads; independent source work can proceed elsewhere.
- Keep scope bounded. A new finding gets a named disposition; it does not silently expand the active patch or restart every check.
- Close each row with the relevant issue, proof, remaining limits and next action. Implemented, tested locally, tested in the package, and accepted by operators are different claims.
- Build release batches from stable completed slices. Do not issue a release per row or wait for every row to finish before delivering a useful maintenance beta.

## Reference: foundation reset (complete)

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

The reset is complete. Campaign front-door retirement was resolved in P01/P02;
useful packaged probes remain. Do not reopen the reset as a prerequisite to each fix.

## Reference: recovery and lifecycle acceptance

Reproduce first. Use the actual installed application for native/packaged claims. A Settings shortcut must not silently redefine authority; a legacy migration must not invent provenance.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| R01 DONE (2026-09-28) | DON-281: empty-roster Settings return route, including shared Admin Unlock, in 6a7cfd53. Independent unit/browser/Mac checks; CI 36454746119 on 77e300e7 passed; exact CI AppImage passed focused Ubuntu crash → Settings → acknowledgement → archive → restart with audit/warning retained. Hashes and evidence in DON-281. Not released. | Foundation complete. | Outbox durability defect not established; unconditional crash-marker wording remains a separate finding. No completeness/authority rule changed; no other lifecycle defect closed. |
| R02 DONE | DON-282: fixTime promotion now invalidates coverage; generation fence repairs older-code damage repeatedly. | Fixes 019ccdbe + 2a6cc03f; CI 36474893891 passed. | Exact CI AppImage on Ubuntu: profile-copy upgrade, promotion, repeated old-code rollback repair, stable reopens and rendered warning PASS. Counts 10/10/1; unknown provenance retained. Evidence/hashes in DON-282. Not released; no live Traccar or cold-scale proof claimed. |
| R03 QUEUED | Recovery resumes a previously paused mission. | Explicit expected recovery state; distinct from R01. | Running/paused pre-crash states produce the agreed visible recovery result without silent tracking changes. |
| R04 QUEUED | Window-X false unexpected-shutdown marker (team-smoke also reproduces it for a plain SIGTERM quit); unwritable profile silent exit (reproduced by team-smoke). | Independent native reproductions; may be separate patches. | Actual window-close and restart prove clean exit; unwritable profile shows an actionable error without weakening true duplicate-launch handling. |
| R05 QUEUED | Slow quit and first ~1M-fix open; native synchronous startup/watchdog limitation. | After foundation checkpoint; may overlap independent team-question preparation. | Distinguish SQLite startup from mission-open and pending reads. Test PR5 P3-12 held-read shutdown cancellation; measure full process tree. Give native isolation a separate design/estimate if needed, not an automatic rewrite inside 13.5. |
| R06 QUEUED | Residual minor validation defect: malformed IPC identifiers reach SQLite before rejection. | Risk triage from actual boundary, not symptom guessing. | Bounded validation correction with rejection tests, or explicit low-priority disposition; no silent omission. |
| R08 QUEUED | With WebGL unavailable (Chromium GPU blocklist) the app shows a black window with no message. Found by team-smoke on the Ubuntu box, 2026-09-28. | Reproduce on a disposable profile; decide the visible fallback. | The operator sees an actionable message when the map cannot render; the rest of the app stays usable or fails visibly. Not an Ubuntu-box workaround. |
| R07 QUEUED | First maintenance release checkpoint, likely beta.13.5. | Foundation checkpoint and selected stable R fixes; outstanding rows stated. | Exact CI-built package passes agreed smoke and changed-surface tests; remaining issues/NOT_TESTED cases collected for one owner decision. Do not wait for all later features. No rebuild after a failure without Donal's approval. |

R07 is a release checkpoint, not permission to ship or an assertion that every recovery issue is cheap. An unexplained failure remains recorded; independent checks continue. A harness-only repair reruns against the same binary.

## Reference: original non-mapping team requests

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

## Reference: audit and resilience obligations

Inventory and bounded diagnosis can run earlier; implementation order follows evidence and shared-file ownership. Bring a confirmed serious defect forward immediately. Broad unexecuted WAR charters are not a blanket prerequisite.

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| A01 QUEUED | GPX recovery accounting: repeated staged-source failures and published/assigned imports falsely marked interrupted. PR5 P3-8/10. | Bounded native reproduction; may follow R01 before other stage 4 work. | Per-attempt accounting and source custody proved; repair confirmed failures with restart regressions, otherwise record precise non-reproduction limits. |
| A02 QUEUED | Other retained audit candidates: layer subtree partial persistence/optimistic visibility, reorder races, count wording/subscription cost; remaining PR5 hardening and nine unconfirmed Astra leads. | Current-source candidate must reproduce before implementation. | Each candidate has a repair/proof, supersession, bounded evidence gap or explicit deferred trigger. Keep one residual register; do not create a ticket for every unconfirmed observation. |
| A03 QUEUED | Original-machine freeze/performance and implemented-but-unclosed evidence. DON-151/159/160–164/240/247; WAR05/13B. | Reuse relevant 13.4 team observations; targeted original-machine follow-up. | Exact pending assertions covered: quiet-device retention, locked-delete refusal, distinct archives, Review events/first contact and original slowdown. Preserve platform/long-duration limits; a short Ubuntu pass cannot close an unrelated field symptom. |
| A04 DECISION | Storage/integrity/legacy recovery/index-retention and native isolation. DON-249/250/251 plus R05 assessment. | Measured supported workload and safety design; review artificial dependency chain. | Each capability is either designed, implemented and verified, or explicitly scheduled/deferred with limits and revisit trigger. No automatic purge/VACUUM or giant store rewrite; required safety work cannot be silently parked for speed. |
| A05 QUEUED | Remaining package findings and dependency health. DON-254 C10/large archive/201ms/C26/C28; DON-146 runtime upgrade; memory-growth observation. | Separate product, harness and measurement causes; selected workload only. | Each failure has a bounded disposition; full-process memory measurement replaces the undercount. Builder upgrade is not Electron runtime upgrade. Pick/verify an appropriate runtime target when needed, with package proof. No generic full-campaign retry. |
| A06 DECISION | Support upload/inbox, platform support and optional extras. DON-179/181; DON-13/14/115/141; DON-21/258. | Product/support decisions; local support export already exists. | Clear first-handover platforms; retain Windows evidence if required. Remote upload/privacy/retention explicitly chosen or deferred. Shortcut hints and portfolio/demo work explicitly later unless requested. |

**Audit exit:** no unowned major finding. Source fixes, package acceptance and
deferred capabilities remain distinguishable. The campaign front door is retired;
retained regression probes do not reinstate the 205-row release gate.

## Reference: non-mapping handover acceptance

| ID / status | Work and existing owner records | Depends on / may run alongside | Finish condition |
| --- | --- | --- | --- |
| H01 QUEUED | Refresh QGIS replacement/functional acceptance and close historical programme accounting. DON-5/6/12/25/241/254/265. | Stages 2–4 dispositions; evidence may be collected incrementally. | Current parity matrix marks delivered functionality correctly and exposes remaining requirements. Closed programme parents do not imply 205 passes or completed deferred storage work. |
| H02 QUEUED | Exercise the complete ordinary operator workflow on the supported package with existing maps; update manual/support/handoff and reconcile backlog again. | H01 and ready non-mapping features. | Start/resume, track/outage, participants/GPX, visibility/replay, drawings/markers, pause/recovery, review/export, finish/archive/reopen and diagnostics work together. Native pickers and relevant fault paths have actual proof. Required field acceptance remains distinct. |

Do this once on a stable integrated slice with risk-selected negative paths. Reuse unchanged evidence where justified. This is a coherent operator check, not a relaunch of 205 rows under a new name.

## Reference: purchased mapping and final handover

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
- **R01 complete:** DON-281 passed its own CI and focused exact-artifact Ubuntu recovery/archive/restart proof; recorded Done, not released. Watch stopped. Next queued slice is R02 / DON-282; no next implementation started. Existing-area Discovery recovery and tester compass confirmation remain separate team-feedback actions; broader purchased maps stay last.
- **Later:** T-stage decisions/features, audit/resilience closeout, non-mapping acceptance, then M01–M04.
- **Open decisions:** governance/product questions above and actual mapping logistics. Campaign front-door retirement is resolved; useful intertwined packaged probes are retained.
- **Evidence baseline:** foundation source be5fc69f; smoke tool 7173c301; released executable source a273ae6d. Recheck live state before activating an issue.

Investigation sources: private post-mortem 10 and its six supporting reconciliations, prepared 28 September, under ~/workspace/vibes/release post-mortem/. Public/repository execution records must not copy licensed assets, credentials or private raw history. The earlier report's map-in-parallel recommendation is superseded by Donal's later instruction recorded above.
