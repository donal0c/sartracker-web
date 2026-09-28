# HANDOFF.md — Current state

Release baseline updated 2026-09-28 by Claude; planning sequence updated by Codex after Donal's clarification. **beta.13.4 is published to the team as a controlled
test build** (pre-release, not for live incidents).

## Release state

- Tag `electron-v0.1.0-beta.13.4` → `a273ae6d` (= `origin/master` at release).
  CI run 36319976860 green (all 5 jobs). Published 2026-09-28T06:39:54Z.
- `.deb` `804aa08f…1891`, AppImage `466ce20d…41fc`. CI artifact = draft = `SHA256SUMS`
  = anonymous public download (verified on Ubuntu).
- Published **manually** after repeating the guarded publisher's checks, because one
  gate is an approved deviation (5-/14-day soak not run; 15 h installed soak +
  CI soak substituted). Recorded in the release note and post-mortem.
- Release note: [beta13.4](../docs/releases/sartracker-electron-0.1.0-beta.13.4.md).

## Process decision (Donal, 2026-09-27)

Team betas are gated by an operator-shaped **smoke matrix** on the exact CI
artifacts (the release note's table), not by the 205-binding programme. The
205-binding programme continues as **non-gating qualification**; its findings
feed the next beta. Do not rebuild after a failure without Donal's approval —
record, continue independent checks, report. Full rationale: the private
post-mortem (`~/workspace/vibes/release post-mortem/08-claude-takeover.md`).

## Known issues shipped (fix in next beta, in priority order)

1. **Crash → Archive & Lock blocked without an Admin Roster.** Evidence-loss
   acknowledgement dialog shows only "No admins configured"; operator is stuck.
   Team told to configure an admin. **Top priority for the next build.**
2. Active 12.11 mission carried across upgrade: coverage permanently "History
   incomplete — Reason: worker"; legacy fixes lack v8+ provenance columns; data intact.
3. Recovery Resume un-pauses a mission paused before a crash.
4. Window-X close is recorded as unclean ("Unexpected shutdown detected" next
   launch) — the known C02 false-unclean finding.
5. Unwritable profile directory → silent exit (singleton lock failure treated as
   duplicate launch).
6. Quit takes 8–15 s; first open of a ~1M-fix mission took >2 min (second open
   0.24 s; undiagnosed).
7. Minor: malformed IPC ids reach SQLite before rejection (still rejected).

Earlier Codex-era findings (C10 replay generation, field archive 60-min timeout,
201 ms archive verify, C26/C28 harness issues) remain open in DON-254; see
[archived handoff](archive/2026-09-27-beta13-qualification-era.md).

## Next actions

Follow the [ordered delivery ledger](../docs/two-track-execution-workplan.md).
Donal's latest order is **foundation reset first; purchased mapping last**.
Claude Code owns implementation and testing; Codex coordinates and independently
validates each chunk before advancing. The temporary first prompt is prepared at
`/Users/donalocallaghan/workspace/vibes/sartracker-web/tmp/claude-handoffs/01-foundation-reset.md`.
It covers P01–P05 and invites independent challenge. It has not been dispatched.

1. P01–P05: simplify `CLAUDE.md`/active instructions, archive obsolete process
   surfaces safely, establish the short checklist/smoke/publisher path, and
   reconcile the backlog. Start from private post-mortem 09 §6a. Keep useful
   safety tests; resolve campaign retirement explicitly rather than infer it.
2. R01 first after that reset: crash/archive recovery, followed by scoped native
   recovery fixes and a maintenance beta through the new process.
3. Remaining team requests, audit/resilience dispositions and integrated
   non-mapping verification follow the ledger. Gather team feedback meanwhile.
4. Purchased-map delivery is the final functionality stage. Existing areas are
   sufficient for team testing; normal Kerry coverage and occasional travel
   logistics remain questions for the team, not an agreed national package.

Only the plan was prepared in this chunk; no product tests, issue changes,
release actions or team messages were performed. The old workplan is preserved
in [the planning archive](archive/2026-09-28-pre-reset-workplan.md). The Ubuntu
helpers remain at `~/sartracker-beta13.4-smoke/`; no execution is claimed here.

## Verification snapshot (Ubuntu 24.04, 27–28 Sep)

Installed `.deb` 140/140 files byte-identical; 12.11 → 13.4 upgrade row-for-row
intact; lifecycle/SIGKILL/renderer-crash recovery gap-free; coordinates;
duplicate launch; sanitized bundle; bad credential; corrupt/newer DB refusal;
archive create/reopen/wrong passphrase; GPX (via bridge); replay; attachments;
stationary attention; 90 s provider outage zero-gap backfill; 960k-fix fixture;
live Traccar 28/28 exact; 15 h soak 16,394 fixes zero gaps. Not tested: native
file pickers, calendar-length soaks, 2M/field-scale, offline maps, disk-full.

## Evidence pointers

- Ubuntu smoke workspace: `~/sartracker-beta13.4-smoke/` (logs, shots, profiles)
- [Active workplan](../docs/two-track-execution-workplan.md)
- [Codex-era handoff](archive/2026-09-27-beta13-qualification-era.md)
- Linear: DON-254 (qualification), DON-255 (publication)
