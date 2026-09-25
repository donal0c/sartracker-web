# Post-Beta 13: mission-store startup isolation

Status: deferred backlog, unresolved. Owner: SAR coordination.

## Donal's decision — 2026-09-25

Address this after Beta 13, not in PR #47 and not as a prerequisite for that
release on account of this known limitation. This is a scope decision, not
evidence that the limitation is fixed or qualified, and does not waive other
release checks or authorize publication.

Linear issue creation was attempted on 2026-09-25 but rejected because the
workspace has exceeded its free issue limit. This file is the interim issue
record; migrate it to Linear when available.

## Problem

PR #47's asynchronous startup watchdog cannot interrupt synchronous
`createElectronMissionStore()` / native SQLite opening or migration on
Electron's main process. A blocked native call can prevent the timeout and
fault window from responding. The separate `app.whenReady()` bootstrap gap
must not be claimed solved by isolating SQLite.

Source: PR #47, https://github.com/donal0c/sartracker-web/pull/47.
At head `0e6db8a26b62327055d76f1b61782e6d600caa96`, Linux run
`36116343282` passed the scoped repair checks, not this uncovered native case.
Related: DON-179 startup fault support and DON-241 mission-store reliability.
Distinct from DON-249 background integrity checks.

## Proposed follow-on work

Plan a safe process boundary for live mission-store ownership, such as a
utility process behind a typed asynchronous interface. Inventory reads,
writes, query lifetimes, attachment callbacks, coverage notifications,
shutdown/drain and recovery before choosing the implementation. A timer
wrapped around a synchronous native call is insufficient.

Acceptance requires:

- Reproduce native startup stalls with disposable profiles and retained evidence.
- Keep the main process responsive and report truthful operator-visible state.
- Preserve atomic migration, WAL durability and mission evidence; prove
  interruption/restart safety before adopting a worker termination policy.
- Test worker failure, rejected requests, late replies, bounded shutdown and
  prevention of unsafe same-profile relaunch.
- Verify normal mission reads/writes and affected archive/attachment workflows
  on relevant packaged platforms.
- Keep the never-ready Electron boundary separately recorded unless addressed.

## Sequencing

Surface this in post-Beta-13 resilience planning. Assess complexity and model
allocation before implementation. Do not reopen it as PR #47 scope without a
new explicit decision. Keep the known exclusion visible in the next release's
qualification and limitation records; never label a deferred case as passed.
