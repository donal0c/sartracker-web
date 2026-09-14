# HANDOFF.md — Current state

Updated 2026-09-13. Read after `CLAUDE.md`.

## Current state

Master is `2b2bf8e605e27123c9e454598828d71cb7c062aa`; PR25/26 are merged.
DON-267 is Done. DON-254 remains In Progress; release remains HOLD.
[PR27](https://github.com/donal0c/sartracker-web/pull/27), Repair Train D
(`codex/repair-train-d`, AUD-08/DON-271 and AUD-09/DON-279), is **not ready to merge**.
Earlier readiness at `e3eac2b68d2bf67c3bbe71e0116a3c64e6c62764` is withdrawn after
Claude review. Follow-up fixes are verified locally; exact-head PR checks and
reviews control the next decision. Preserve the retained qualification failures.
Train C rebases after Train D merges. Donal owns merge; no merge is authorized here.

## Active work and decision

The [Claude review disposition](../docs/assurance/findings/pr27-claude-review.md)
records each finding, reproductions and the pending decision. Confirmed fixes cover
backdated group scope/scheduling, corrupt-row isolation, drawing retirement parity,
progress display, input types and an uploaded NOT RUN qualification receipt.
Generation fallback is intentional immutable-archive compatibility; a native test
now covers cascade invalidation. Removing a participant never clears required history.

**Approved by Donal:** audited coordinator recovery for missing legacy membership,
including explicitly attested empty scope (SAR-QA-022). Implementation preserves the
NULL snapshot and appends an audit event; supplied members require the original
history window. Native/restart/archive checks and independent native/shared and
UI/IPC reviews pass. No new local build or Electron run was performed.

## Verification and next actions

Full serial correctness: 4,825 tests / 458 files pass; six existing exclusions.
Affected Chromium: 26/26 pass, with inspected screenshots and retained traces.
Lint, typecheck, workflow and syntax checks pass. A stale drawing-delete assertion
was corrected to verify visible removal plus retained retirement; production inputs
were unchanged after the full source cycle. PR checks are separate from packaged acceptance.
The [original Train D record](../docs/assurance/findings/repair-train-d.md) retains
earlier full-source/browser/CI proof. Native attempt 1 remains FAILED.
Do not repeat native runs on unchanged baseline blockers. Existing gate requirements
remain; source binding also changed quoted Git syntax and exported the expected tree.

## Remaining limits

DON-254 retains the coverage result-bound race, three baseline settings failures,
unresolved 204.046 ms concurrent SQLite read and incomplete 239.509 ms attribution.
Strict responsiveness, replay/soak, provider, field and publication qualification
remain separate. Use the [coordinated ledger](../docs/assurance/coordinated-work-ledger.md),
[two-track queue](../docs/two-track-execution-workplan.md) and
[testing cadence](../docs/testing-and-review-cadence.md). Earlier history is in
[the archive](archive/pre-war06-repair-20260913.md).
