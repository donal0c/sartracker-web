# PR27 Claude review follow-up

Status: **do not merge**. Review applies to `e3eac2b68d2bf67c3bbe71e0116a3c64e6c62764`.
The earlier merge-ready conclusion is withdrawn. Source correctness and package
CI at that head remain historical evidence, not acceptance of these cases.
Source: Donal's pasted Claude review, 2026-09-13, attachment
`b1231be5-2d1e-4de2-8c74-21c0cba98d5c/pasted-text.txt`.

| Finding | Disposition |
| --- | --- |
| P1 legacy unknown roster cannot Finish, even after removal | Confirmed by real SQLite reproduction. Donal approved SAR-QA-022; explicit audited recovery is implemented below, with no removal bypass or inferred-empty migration. |
| P2 exact re-add omits historically required departing member | Confirmed red. Preserve observed snapshot, union same-team historical scope over the effective interval, and schedule missing adjacent windows. Unrelated-group checkpoints must not leak into scope. Native focused regression green; browser scheduling has its own red/green. |
| P2 browser retirement differs from native | Confirmed. Retain all drawing identities and version snapshots, reject reuse after reload, and record retirement. Native audit is actually `drawing_deleted` with `retired: true`, not `drawing_retired`; stable area audit is `search_area_retired`. |
| P2 generation fallback/schema 13 | Deliberate compatibility, not a reproduced live-store fallback. Live migration installs the new column/triggers before queries; historical immutable archive scratch preserves its feature-detected physical schema. Existing exact schema/trigger and migration tests cover both shapes. |
| P3 cascade deletes do not bump each linked row | One parent-pass bump is sufficient to expire all page kinds; direct link changes retain their own triggers. Added native regression verifies link removal plus exactly one fence bump. |
| P3 redundant pending checkpoint hides completed coverage | Completed contiguous coverage now remains complete despite a redundant overlapping pending window. Native regression separately proves the mission-wide pending-checkpoint Finish guard remains. |
| P3 corrupt snapshot hides participant list | Confirmed red. Return visible per-row scope error, retain healthy rows and keep Finish blocked. Native restart and browser projection tests cover it. |
| P3 optional runtime roster type | Store input now requires roster; controller UI intent remains separate and resolves the observed roster before persistence. Typecheck exposed and verified that boundary. |
| P3 misleading initial-selection error | Neutral "Group member device ids are required" wording for initial/normalization paths. |
| P3 empty exact roster has no status | Confirmed rendered-component red. Explicit zero-member status is now visible. Progress uses "required group members" because a backdated interval can include departed members. |
| P3 handoff length | Replace chronological prose with current state, outstanding decision and next verification only. Detailed evidence stays here and in the original Train D record. |
| PR body says every pre-existing gate unchanged | Correct to say gate requirements are preserved; source binding also gained quoted Git syntax and EXPECTED_SOURCE_TREE export. |
| NOT RUN absent from uploaded evidence | New atomic non-pass qualification receipt is included in uploaded evidence. Writer/workflow tests red then 2/2 green. Manual strict validator stays unchanged. |

## Approved domain decision (SAR-QA-022)

Question sent to Donal: for legacy missions whose group roster cannot be
reconstructed, may an audited coordinator recovery action confirm an empty
roster or supply missing device IDs, with Finish blocked until required history
completes?

Recommendation: explicit coordinator attestation with actor, reason, timestamp
and preserved original evidence/provenance. No fabricated membership observations;
no automatic unknown-to-empty conversion; no clearing history requirements when
a participant is removed. Alternative: retain the blocker pending a separate
recovery design. Donal answered "go with your recommendation." on 2026-09-13;
the raw transcript and indexed SAR-QA-022 preserve that approval. Implementation
uses one append-only `participant_roster_attested` mission event (actor, non-empty
reason, timestamp, explicit empty/member mode, original NULL snapshot). It does
not change the original participant row or manufacture membership events. Supplied
members create the original-window checkpoints atomically with the attestation.
Repeated attestations reject; no silent correction or corrupt-record repair is added.

Independent native/shared and UI/IPC review found and closed additional recovery
boundaries: participant-scoped event identity isolates corrupt JSON; invalid,
reversed, pre-mission and future-ending intervals reject before mutation;
`confirmed: true` is required and persisted; browser returns the native-equivalent
projection; removed corrupt groups remain visible without offering attestation.
Fault injection proves audit and scheduled checkpoints roll back together.
Both final focused reviews report no remaining concrete findings. The recorded
actor is a coordinator attestation, not a newly introduced authentication system.

SAR-QA-001/002/008 require complete history and honest progressive loading;
SAR-QA-015 authorizes coordinator selection and late additions. These do not
specify how missing legacy membership may be attested. SAR-QA-022 adds Donal's
explicit recovery authority without changing those original history requirements.

### Recovery validation

Native tests cover empty/member, removed groups, required actor/reason/mode,
repeated resolution rejection, original-window checkpoints, Finish fence,
restart and finalized archive preservation. Browser store tests cover both modes,
reload and Finish. Two actual Chromium flows pass through the form's explicit
confirmation and Finish after history completion. Logs: `/tmp/pr27-recovery-archive-green.log`,
`/tmp/pr27-browser-recovery-green.log`, `/tmp/pr27-recovery-e2e.log`.
The initial native parameter table was malformed; corrected tests were also run
against the pre-action API and failed with the missing method (`/tmp/pr27-recovery-api-red.log`).
Browser store and rendered component reds precede their implementations.

## Verification boundary

Working-tree focused tests: 71/71 across eight files, with typecheck passing.
Combined result: `/tmp/pr27-followup-final.log`. Logs include `/tmp/pr27-projection-red.log`,
`/tmp/pr27-projection-green.log`, `/tmp/pr27-browser-backdated-red.log`,
`/tmp/pr27-browser-backdated-green.log`, `/tmp/pr27-drawing-red.log`,
`/tmp/pr27-drawing-green.log`, and `/tmp/sar-train-d-pr27-participant-review-green.log`.
Final full serial correctness passes **4,825 tests / 458 files**, with six existing
qualification exclusions (`/tmp/pr27-final-correctness.log`). Final affected Chromium
passes **26/26** with traces (`/tmp/pr27-final-browser-green.log`). The expanded first
browser run passed 25 and failed one stale assertion expecting a hard-deleted row;
the corrected assertion verifies visible removal and retained retirement. This is
a test-only follow-up; production source stayed unchanged after the full source run.
Inspected screenshots cover both attestation forms, pending Finish, drawing retirement
and recovered Search Operations. The owned 1437 server stopped; no listener remains.
Lint, typecheck, syntax and actionlint pass. Exact-head review/CI are the next boundary.
Independent browser/P3 review found two additional boundaries: cross-mission drawing
identity reuse and a controller type allowing a string group reference. Drawing reuse
now rejects before mutation (two failing regressions then green); the controller uses
a discriminated kind/ref input, with its UI caller checked by TypeScript. Retirement
and component checks pass after these corrections. Logs: `/tmp/pr27-cross-mission-red.log`,
`/tmp/pr27-review-final-green.log`, `/tmp/pr27-followup-types.log`.
No new build or native run; prior native attempt 1 remains FAILED. Release HOLD.
