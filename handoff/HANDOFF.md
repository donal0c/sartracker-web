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
bounds/current sequence, shared renderer lifecycle listeners, physical worker
exit on cancellation, supported service-worker protocols and diagnostic custody.
Merged Train C owns map renderer/style/navigation repairs, including bounded
target expiry across clock corrections. Its [review disposition](../docs/assurance/findings/pr30-claude-review.md)
and [original record](../docs/assurance/findings/repair-train-c.md) retain evidence
and earlier failures. Broader DON-264/DON-6 acceptance and AUD-12 remain open.

## Verification and next action

PR31 is rebased onto merged PR30. Only handoff/workplan conflicted; code, tests,
manual and workflow changes retain the same patch. All 82 focused native tests
pass after rebase. Earlier CI34834365325 is historical; fresh exact-head CI is
required before renewing readiness. The checks linked below own that result.

Red/green controls reproduce the original enumeration error, unsupported
file-scheme registration, 24-listener pressure, early shutdown settlement and
same-inventory stale manifests. Affected 60 tests and seven independent native
receipt controls pass; lint/build/types pass. Full correctness passes 469 files /
4,969 tests / six existing qualification skips. Final broad review is clear.
Persistence and IPC focused reviews are clear; diagnostic
review repairs are verified, including split-chunk stderr redaction (35 affected
diagnostic/receipt tests pass). [PR31](https://github.com/donal0c/sartracker-web/pull/31)
contains the committed repair; its checks and evidence comment hold the live
exact-head Linux result and readiness. Do not infer readiness from local tests.

macOS packaged scoped control passes on the same ASAR used for the failed
Train D attempt: 24 real preload coverage reads, separate packaged-store
snapshot-growth/cancellation control and graceful code-zero exit. This is local
working-tree proof, not clean CI or default-app cancellation qualification.
Train D still fails: expected one pending member, observed 2/2; provider 503
warnings and a moved-snapshot rejection remain retained. No diagnostic gate
was relaxed. See [native repair evidence](../docs/assurance/findings/native-runtime-repair.md).

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
