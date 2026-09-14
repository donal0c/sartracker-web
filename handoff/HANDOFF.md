# HANDOFF.md — Current state

Updated 2026-09-14. Read after `CLAUDE.md`.

## Baseline and active lane

Master is `58c65641483bbdb83515d8793bb1abce1e5755c4`: PR30 (Train C) is
merged after PR27/PR28. Earlier baseline CI34826211836 remains historical.
Prior WAR-11 source/browser/native
failures and limits remain in [WAR-11 remediation](../docs/assurance/findings/war-11-offline-map-remediation.md);
Train D's original failed native attempt remains in its
[repair record](../docs/assurance/findings/repair-train-d.md).

Active: DON-254 bounded native-runtime repair on
`codex/don-254-native-runtime-repair`. Scope: snapshot-consistent coverage
bounds/live revision progress, shared renderer lifecycle listeners, physical worker
exit on cancellation, supported service-worker protocols and diagnostic custody.
Merged Train C owns map renderer/style/navigation repairs, including bounded
target expiry across clock corrections. Its [review disposition](../docs/assurance/findings/pr30-claude-review.md)
and [original record](../docs/assurance/findings/repair-train-c.md) retain evidence
and earlier failures. Broader DON-264/DON-6 acceptance and AUD-12 remain open.

## Verification and next action

PR31 is rebased onto merged PR30. Claude review superseded earlier readiness
and CI34845492157. The [review disposition](../docs/assurance/findings/pr31-claude-review.md)
records live-ingest progress, structural partial/retry outcomes, isolated lifecycle
cancellation, bounded physical joins, worker-local mutation controls and complete
stderr custody. Independent re-review found no introduced P1/P2 blocker.

Local correctness: 476 files / 5,045 passing tests / six qualification skips;
172 affected tests, seven coverage browser flows and visually checked partial /
Retry recovery pass. Final lifecycle edit has a subsequent 19-test pass; final
lint, build/package and workflow lint pass. Rebuilt macOS ASAR `ebd6cd7e` passes
24 preload reads, separate packaged-store live-ingest/snapshot/cancellation
controls and drained code-zero shutdown. Module/harness hashes were independently
matched. This is working-tree evidence, not clean CI or default-app cancellation
qualification. [PR31](https://github.com/donal0c/sartracker-web/pull/31)'s checks
and latest evidence comment own the live exact-head Linux result and readiness.

The original Train D attempt remains FAILED: expected one pending member,
observed 2/2; AUD09/restart NOT RUN. Original ASAR `a5e09019`, provider 503 warnings
and moved-snapshot rejection remain retained in the
[native repair evidence](../docs/assurance/findings/native-runtime-repair.md).
No diagnostic or release gate was relaxed.

Next: inspect PR31's latest exact-head Linux CI/artifact evidence and reconcile
with current master before any merge decision. Donal owns merge. This branch
does not qualify or publish a release; remaining Train D work stays separate.

## Limits

DON-254 remains In Progress; release HOLD. Strict `<200 ms`, 960k replay,
tracking soak, archive lifecycle, installer/field acceptance and official-map
distribution are outside this lane. Pre-attachment renderer diagnostics remain
unobserved; capture timestamps are not event-origin timestamps.
The historical 204.046 ms concurrent read, incomplete 239.509 ms attribution,
baseline settings/browser gaps, and WAR-11 macOS/CI failures remain retained.
No credentials or licensed map bytes were read.

Follow the [two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md), and
[testing cadence](../docs/testing-and-review-cadence.md).
Older history: [pre-Train C archive](archive/pre-train-c-20260914.md) and
[earlier archive](archive/pre-war06-repair-20260913.md).
