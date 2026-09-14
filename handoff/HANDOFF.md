# HANDOFF.md — Current state

Updated 2026-09-14. Read after `CLAUDE.md`.

## Current baseline and active work

Model routing: `docs/model-routing-and-agent-execution-policy.md` is now the
current authority for Luna, Sol, Astra, reasoning effort, bounded delegation,
escalation, and cost control. It supersedes fixed-Sol and default-Fable wording
without weakening requirements, review, evidence, merge, or release gates.

Master is `cda87aa03f27eb69532ae9506aa9e719cef7e364`. Donal merged
[PR27](https://github.com/donal0c/sartracker-web/pull/27) and
[PR28](https://github.com/donal0c/sartracker-web/pull/28) on 2026-09-14.
Train D participant completeness, audited legacy roster recovery (SAR-QA-022),
stable Search Operations pagination, and WAR-11 offline-map package
qualification/freshness are integrated. The merged-head Linux pipeline
[34826211836](https://github.com/donal0c/sartracker-web/actions/runs/34826211836)
passed. Its explicit skips remain limits, not release proof.

Active next lanes are the native-runtime/packaged-qualification blocker repair
and Repair Train C map interaction/rendering repair. They are separate Astra
Low owner tasks with only bounded independent Luna X-High delegation.

## Verification and next action

Run 34826211836 passed full correctness, property/mutation controls, renderer
attribution, web build/budgets, WAR-06 and WAR-11 browser regressions, Electron
packaging, packaged map/GPX/breadcrumb/WAR-06/legacy-recovery smokes, native
SQLite inspection, llvmpipe attestation, AppImage launch, and artifact upload.
The strict 200 ms qualification, 960k replay, dedicated Train D packaged proof,
tracking soak, archive lifecycle, and field acceptance were skipped or remain
separate. Next: complete and merge the two active bounded repair lanes, then
rerun the affected exact-head packaged qualification. Do not release.

## Remaining limits

Release HOLD; DON-254 and DON-7/DON-76 remain In Progress. Strict `<200 ms`,
960k replay, tracking soak, archive lifecycle and installer/field qualification
are not established by the green map CI. Train D's deferred packaged gate is
NOT RUN. The 41 renderer diagnostics lack sufficient request attribution.
Original decoder crash PID80389 remains ours with native cause unconfirmed;
raw crash/process evidence stays private under `tmp/war-11/crash/`.

Retain DON-254's coverage result-bound race, baseline settings failures,
204.046 ms concurrent SQLite read and incomplete 239.509 ms attribution.
No private/licensed tiles or credentials were read; Windows, distribution,
provider and BCP-17 qualification remain separate. Follow the
[two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md) and
[testing cadence](../docs/testing-and-review-cadence.md).
Older history is in [the archive](archive/pre-war06-repair-20260913.md).
