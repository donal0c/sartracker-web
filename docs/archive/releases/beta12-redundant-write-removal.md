# Beta.12 Redundant Tracking Write Removal

## Contract

`DON-245` removes mission-event echoes that duplicated authoritative tracking state while
preserving real data and recovery:

- every device upsert still writes name, colour, status, and `last_seen`;
- first contact emits `device_created`;
- only a name, colour, or status change emits `device_updated`;
- a `last_seen`-only poll writes the row and emits no event;
- single and bulk position writes still validate, deduplicate, persist the complete position, and
  update the device's online/last-seen state;
- new position writes emit no `position_recorded` event because `positions` is the durable source
  of truth;
- legacy `device_updated` / `position_recorded` values remain classified as telemetry so older
  databases are still filterable/reviewable.

Electron and the browser validation harness intentionally diverge here from the historical
Rust/Tauri reference, which remains a compatibility reference rather than the operational desktop
backend. The divergence is explicit in code, tests, the operator manual, and this release evidence.

## Tests-first coverage

Red tests first proved that unchanged single/bulk upserts still emitted updates, last-seen-only
polls added events, position writes added echoes, browser validation mirrored the old behavior, and
diagnostics counted every device/position as an event. Green coverage now proves:

- repeated unchanged and last-seen-only single upserts emit no update;
- bulk upserts persist a later `last_seen` with no event;
- a real name/status/colour change emits exactly one update;
- single and 2,500-row bulk position insertion emit no position echoes;
- diagnostics report genuine changed-device events and zero position telemetry events;
- browser persistence and Mission Review match the new contract while retaining legacy event
  classification.

## Packaged Ubuntu growth proof

Candidate AppImage SHA-256:
`da02f730bad605f77b88db8fd135ec0d89f304cb1d3d3ec9f437976a28979f70`.

The packaged Electron app was driven through the real preload IPC and SQLite backend for:

- 2,000 synthetic five-second polls;
- 32 devices per poll (64,000 device-row upserts);
- eight unique positions per poll (16,000 durable positions);
- one deliberate status change on a device that received no conflicting current-position update;
- full process restart and persisted-state readback.

Final database facts:

| Fact | Result |
| --- | ---: |
| Database bytes | 4,976,640 |
| Devices | 32 |
| Positions | 16,000 |
| `mission_created` | 1 |
| `device_created` | 32 |
| `device_updated` | 1 |
| `position_recorded` | 0 |
| SQLite integrity | `ok` |

The deliberate device ended `offline` with its latest `last_seen`. After restart the mission was
safely recoverable as paused, with all 32 devices and 16,000 positions present. The support bundle
reported `changed device events: 1`, `inserted positions: 16000`, and
`position telemetry events: 0`. Machine verdict: `passed=true`.

Evidence: `~/sartracker-beta12-msr/evidence/don245-growth-2/` on the Ubuntu validator. An earlier
retained harness run intentionally marked a device offline while also inserting its current
position; the position write correctly restored it online, producing repeated genuine transitions.
The corrected probe isolates a single real change and demonstrates that the gate distinguishes
change from heartbeat rather than suppressing valid events.

## Verification

- Focused Electron/browser/review/tracking unit suite: passed.
- Focused Mission Review and Settings Chromium suite: 16/16 passed.
- `npm run lint` and `npm run build`: passed.
- Full unit suite: 160 files / 1,127 tests passed.
- Full Playwright suite: 163/163 passed.
- Visual reviewer high-severity gate: 39/39 passed, zero failures/errors.
- Backend: 47 passed / 1 intentionally ignored.
- `npm run electron:pack`: passed, including native dependency rebuild/restoration.

The longer accelerated multi-day soak and explicit growth budgets are owned by `DON-246`; this
probe establishes the packaged persistence slope required to begin it.
