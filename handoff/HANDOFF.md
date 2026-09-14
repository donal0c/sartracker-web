# HANDOFF.md — Current state

Updated 2026-09-14. Read after `CLAUDE.md`.

## Baseline and active work

Master is `cda87aa03f27eb69532ae9506aa9e719cef7e364`, including merged
PR27 (Train D) and PR28 (official-map freshness), freshly checked on 2026-09-14.

[PR30](https://github.com/donal0c/sartracker-web/pull/30), branch
`codex/repair-train-c`, repairs AUD-04 / DON-264 and AUD-06 / DON-6.
Claude's review superseded its original readiness verdict. The valid findings
are corrected: safe missing-layer reads and structural equality, camera
destination ownership through style changes, bounded style failure cleanup,
explicit retry and store-owned target expiry across teardown. Requests expire
within 30 seconds, shortened to eight seconds after verified attachment; the
earliest wall-clock/monotonic deadline prevents backward clock changes extending it.
Operator gestures release camera ownership; actual overlay changes still apply.

## Verification and next action

The [Claude-review disposition](../docs/assurance/findings/pr30-claude-review.md)
owns current evidence; the [original record](../docs/assurance/findings/repair-train-c.md)
retains earlier findings and failures. Stable local correctness passes
**473 files / 4,999 tests / six existing qualification skips**. Lint,
TypeScript/Vite build/bundle budgets and six rendered Chromium regressions pass.
Owner inspected synthetic screenshots. Targeted independent source review is
clear; the updated packaged-smoke observation has 27 passing source tests.
An earlier full run was interrupted for the no-op health correction, not passed.
CI on f7da1d8b was cancelled for the clock correction; its replacement is required.

The [current PR30 checks](https://github.com/donal0c/sartracker-web/pull/30/checks)
control new-head CI/package readiness. The old green CI on `01fb1c24` is
historical. Follow the new check to terminal completion before restoring
PR readiness. Donal owns merge; no merge or release is included here.
The manual and Linear review receipts are current. Broader DON-264 warning
work and DON-6 parity acceptance remain open. AUD-12 remains deferred.

## Remaining limits

Release remains HOLD. Strict `<200 ms`, replay/soak, installer/field and
official-map distribution qualification remain separate. Train D's deferred
packaged gate remains NOT RUN. Native coverage IPC, service-worker registration,
mission enumeration and diagnostic custody are unchanged.

See the [coordinated ledger](../docs/assurance/coordinated-work-ledger.md),
[two-track queue](../docs/two-track-execution-workplan.md), and
[testing cadence](../docs/testing-and-review-cadence.md).
Earlier detailed history is [archived](archive/pre-train-c-20260914.md).
