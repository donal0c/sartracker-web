# ABANDONED — DO NOT PUBLISH — SAR Tracker Electron Desktop Beta 0.1.0-beta.12.2

> **Abandoned internal candidate.** The tag and CI evidence are retained
> immutably, but this build must never be promoted or given to testers. Its
> exact Ubuntu newer-schema gate exposed a persistent startup-relaunch loop.
> The incomplete matrix below is preserved as the historical candidate record.

- **Version:** 0.1.0-beta.12.2
- **Build tag:** `electron-v0.1.0-beta.12.2`
- **Cut date (UTC):** 2026-07-29
- **Linear reference:** `DON-260`
- **Supersedes:** `electron-v0.1.0-beta.12`
- **Tag commit:** `af722f5c869c5d0f66b629fb89f8db8d39a06b9a`
- **Local verification report:**
  `verify-0.1.0-beta.12.2-sha.af722f5c869c-2026-07-29T10-54-35Z.json`
- **CI runs:** failed tag runs `30402564688`, `30426564770`, `30427996046`,
  `30429828590`, and `30431931012`; diagnostic branch runs `30435183304`,
  `30437248431`, `30438100453`, and `30439617823`; exact product head
  `c7ffcb43755c` passed Linux validation in `30441228109`; tag run
  `30445518186` passed and created the abandoned draft
- **Exact CI artifact SHA-256:** AppImage
  `cd138f86ad322833697f05ac97a33055c858c2842faf6446ffad8a92cc3085af`;
  `.deb`
  `67fe377cffe527580a64fffbcdff6208b5843d00a8ffcef6a180b7cdae5e9d48`
- **GitHub release:** unpublished draft titled
  `ABANDONED — DO NOT PUBLISH — SAR Tracker Electron beta.12.2`

`electron-v0.1.0-beta.12.1` was pushed against an earlier pre-release commit
but never produced a release. Its tag is left immutable and is not a tester
artifact. This corrected cut uses the next version rather than rewriting
release provenance.

## Why this hotfix exists

Field comparison across two Linux installations showed that apparently identical
team histories could produce different visible breadcrumb representatives. The
earlier dot-render correction removed one display-only omission boundary, but a
full pipeline audit found additional correctness risks in source identity,
poll-batch-dependent retention, restart reconstruction, late fixes, malformed
payload coercion, and stopped/replacement runtime work.

This release is intentionally separate from beta.13. It does not add full
Discovery map loading, destructive retention, database cleanup, or archive
redesign.

## What changed

- Traccar position IDs are preserved separately from local SQLite row IDs.
- Repeated identical fixes are idempotent. A changed payload for the same source
  identity updates one authoritative position and records the previous and
  corrected values in a revision/audit event.
- Same-time distinct fixes remain distinct and use a stable source-identity
  tie-break. Visible whole-route selection is deterministic across response
  order, polling batches, restart, profile, and operating system.
- Long trails remain bounded to 5,000 displayed fixes per device. Selection
  spans the whole route, always includes the latest fix, and the Tracking panel
  explicitly reports the displayed count and a conservative lower bound for
  known fixes. SQLite remains authoritative for the complete stored history.
- Restart reconstruction runs in a read-only worker, keeping O(history) work
  off Electron's main isolate. Current live fixes display before reconstruction
  completes.
- Recent polling uses a bounded live window. Fixed two-hour history chunks run
  separately and repeat across the mission so late or corrected fixes older
  than the normal overlap are eventually reconciled.
- A history failure names the affected device(s) while current fixes remain
  live. Malformed rows are dropped individually with bounded diagnostic detail;
  a wholly malformed device window fails visibly.
- Mission-position persistence and fallback-cache failures are surfaced
  separately. The operator is told whether current fixes are live but restart
  history or the last-known offline view is at risk, and identical snapshots
  retry after recovery.
- Stopped, superseded, cross-mission, and replacement runtimes cannot publish or
  persist stale snapshots. Persistence and cache writes are serialized across
  runtime replacement.
- Device/cache identifiers, timestamps, coordinates, and optional numeric
  fields are parsed strictly. Live fixes become stale after five minutes.
- The Devices inspector shows source fix time and supplied GPS accuracy.

## What the team should test

1. Run the same active mission on two independently installed machines with the
   same mission start and active-device selection.
2. Compare named device trails after both show no history-reconciliation
   warning. Visible source IDs, coordinates, and fix times must match; do not
   compare only screenshots.
3. Leave both installations running through several polling cycles, then
   restart one. Its bounded visible trail must return to the same identities.
4. Confirm current device positions remain live while long history says it is
   reconciling.
5. Open Devices and confirm Fix Time and GPS Accuracy are readable and that a
   fix older than five minutes is visibly stale.
6. On a trail above 5,000 accepted fixes, confirm the informational
   display-summary appears and that Mission Review retains the full stored
   count.

## Verification

Local pre-tag proof is complete:

- lint and production build/bundle budgets passed
- full unit suite passed: 169 files / 1,241 tests
- Rust backend passed: 51 tests plus one expected keychain ignore; formatting
  and strict Clippy checks are clean
- Chromium passed: 135/135
- visual Playwright passed: 36/36; fresh uncached independent review passed
  41/41 at the strict high-severity gate
- the earlier full no-skip `npm run beta:verify` passed 8/8; the final
  exact-head rerun remains a pre-tag gate
- packaged CI profile passed: 8,664/8,664 exact fixes
- packaged five-day profile passed: 691,224/691,224 exact fixes, one restart,
  exact digest `93c71e43…c146`, zero redundant-event slope, SQLite integrity
  `ok`, clean WAL, main-process maximum 96.3 ms, renderer maximum 143.1 ms, and
  slowest individual operator action 502.8 ms
- packaged fourteen-day profile passed: 1,935,384/1,935,384 exact fixes, two
  restarts, exact digest `e4d50c8d…009e`, exact five-day prefix digest, zero
  redundant-event slope, SQLite/WAL healthy, main-process maximum 193.6 ms,
  renderer maximum 198.8 ms, and slowest individual operator action 808.0 ms
- packaged lifecycle/restart/recovery/finalize/archive, bad-secret startup, and
  sanitized diagnostics/support/incident export smokes passed locally
- same-session Fable review passed the final diff and evidence with no P1/P2
  finding and disposition `PASS_TO_FULL_RELEASE_GATES`

The first tag-driven run (`30402564688`) passed the product truth gates and
persisted all 8,664 expected soak positions with the exact deterministic digest,
restart, SQLite, main-process, renderer, and growth checks. It correctly blocked
publication because all four real operator probes reported `target_missing`.
The captured Linux logs showed both WebGL implementations blocklisted on the
runner, leaving the map/root workspace unavailable. No draft release or assets
were created. A red-to-green harness regression now keeps the packaged soak's
Linux software-rendering switches aligned with the separate launch smoke. The
same package and harness then passed on the Ubuntu validation machine under an
isolated Xvfb display: 8,664/8,664 exact positions, exact digest, 4/4 healthy
operator interactions, 187.5 ms maximum main-process latency, and 971.6 ms
maximum individual action latency.

The second tag-driven run (`30426564770`) proved the rendering fix: all product
gates passed, the real map/UI rendered, all four interactions were `healthy`,
and position truth remained exact. It still blocked before artifact upload
because the headless window was background/occlusion throttled
(`rendererThrottledByDesktopSession: true`): renderer gaps reached 1,699.9 ms
and one otherwise healthy operator action took 2,772.2 ms. A second
red-to-green harness regression now prevents Chromium background, renderer, and
occluded-window throttling for this foreground-equivalent CI measurement. On
the Ubuntu machine's isolated Xvfb display, the revised harness passed again
with 8,664/8,664 exact positions, 4/4 healthy interactions, 176.4 ms maximum
main-process latency, 149.9 ms maximum renderer gap, and 646.2 ms maximum
operator action. A deliberately locked real desktop still reported throttling,
confirming that locked-session timing is not valid release-performance
evidence. The 1,000 ms release threshold remains unchanged.

The third tag-driven run (`30427996046`) again preserved exact truth and
completed all four trusted interactions without error, but GitHub's renderer
still ran at a 66.6 ms median frame cadence. Its logs identified the missing
boundary: Chromium selected a SwiftShader/Vulkan fallback and
`vkCreateInstance()` failed on the Azure runner. The slowest otherwise healthy
action was 2,403.9 ms, so publication remained blocked. A third red-to-green
harness correction requested ANGLE's OpenGL backend while retaining the
background-throttling guards and unchanged 1,000 ms gate.

The fourth tag-driven run (`30429828590`) proved that request alone was not
fail-closed. Position truth remained exact, all four interactions remained
healthy, and no product error occurred, but the retained
`--enable-unsafe-swiftshader` permission still allowed Chromium to select the
failing Vulkan fallback. Renderer median cadence remained 66.6 ms, the maximum
renderer gap was 1,499.4 ms, and the slowest action was 2,664.7 ms. Publication
again stopped before release or distributable upload.

The final red-to-green correction removes SwiftShader permission, explicitly
provisions Mesa, scopes `LIBGL_ALWAYS_SOFTWARE=1` and
`GALLIUM_DRIVER=llvmpipe` to Linux validation processes, and requires
ANGLE/OpenGL. The action timer now measures the real click-to-visible-state
interval rather than including recorder setup/readback CDP diagnostics, while
trusted-click delivery remains mandatory. A separate fail-closed renderer
maximum gate now rejects any frame gap at or above the unchanged 1,000 ms
threshold, so the timing boundary cannot conceal a renderer freeze.

The exact wrapper passed three consecutive times on the Ubuntu Xvfb host with
8,664/8,664 exact positions, 4/4 healthy interactions, zero error/growth
findings, 179.6-188.8 ms main-process maxima, 133.4-166.7 ms renderer maxima,
16.7 ms median renderer cadence, and 600.9-776.6 ms maximum operator action.
No Vulkan or SwiftShader error appeared. A second independent adversarial review
found no P1/P2 issue and confirmed the timer and renderer gate remain
fail-closed. The full committed-state beta verifier then passed 8/8 with no
skips from `sha.a852dc198832`; its packaged soak retained all 8,664 fixes and
kept the main-process maximum to 101.6 ms. None of the four failed CI runs
created a release or promoted distributable artifacts.

Five further fail-closed runs then separated validation interference from a
real operator-facing delay. Tag run `30431931012` and branch runs
`30435183304`/`30437248431` exposed probe self-interference and an unfocused
first input. Run `30438100453` then reproduced a genuine greater-than-one-second
Devices-workspace close path. The first product correction made close immediate,
but run `30439617823` still rejected the package because workspace entry retained
multi-frame animation choreography: exact position truth and direct Mesa
attestation passed, while the renderer maximum reached 1,133.2 ms and external
action latency reached 1,732.7 ms.

The final product correction (`c7ffcb43755c`) removes the workspace animation
state machine and transitions, opens and closes directly from application
state, and uses a layout effect for pre-paint modal focus and exact opener
restoration. Docked workspaces remain non-modal and do not steal focus. Focused
red-to-green tests cover immediate unmount and actionable map centre, rapid
close/reopen, docked and nested-Escape behavior, and Settings/Diagnostics focus
return. Full local proof is now 1,241 unit tests, 135 Chromium tests, 36 visual
tests, and a fresh uncached 41/41 independent visual review.

Exact-head Linux branch run `30441228109` is green. It persisted
8,664/8,664 positions with exact digest
`63276a130a720149784dd67139c2135d6fc333c847b0bb7158494bc121e5a9c6`,
accepted two of two direct ANGLE/OpenGL Mesa llvmpipe launches with 23 and 37
renderer samples, completed 4/4 focused and pointer-receiving trusted
interactions, and passed AppImage launch. Main-process maximum was 32.7 ms,
renderer maximum 416.6 ms, internal action maximum 128.1 ms, and external
action maximum 263.3 ms. There were no interaction errors, renderer crashes,
desktop-session throttling, integrity failures, WAL residue, or redundant-event
growth. The downloaded AppImage and `.deb` match the run's `SHA256SUMS`.

The remaining release gates are:

- tag-driven `electron-release.yml` green
- final exact-head no-skip `npm run beta:verify`
- checksum verification and deep smoke of the exact CI AppImage and `.deb` on
  Ubuntu, including schema migration/reopen/refusal, real window-faithful
  request load, live Traccar because tracking changed, and exact-artifact
  five-/fourteen-day soaks
- post-qualification publication and fresh-download checksum/launch

## Packaged smoke matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | TODO | pending exact draft artifact |
| .deb SHA-256 | TODO | pending exact draft artifact |
| AppImage launch | TODO | pending |
| .deb install and launch | TODO | pending |
| Core lifecycle, restart/recovery, finish/finalize/archive | TODO | pending |
| Coordinate rejection | TODO | pending |
| Diagnostics/support/incident exports sanitized | TODO | pending |
| Bad/corrupt stored credential reaches shell | TODO | pending |
| Live Traccar connection and breadcrumb reconciliation | TODO | pending |
| Official offline Discovery package | TODO | pending |
| Duplicate launch | TODO | pending |
| Five-day and fourteen-day packaged soak | LOCAL PASS / CI ARTIFACT PENDING | Local rebuilt package: exact 691,224 and 1,935,384 rows, one/two restarts, zero redundant-event slope, healthy SQLite/WAL, exact full/prefix digests, and bounded main/renderer/operator-action latency. Exact CI Linux artifact must repeat both. |
| Cross-profile exact breadcrumb identity comparison | LOCAL PASS / CI ARTIFACT PENDING | Normal full digest equals the extended run's normal-prefix digest: `93c71e43…c146`; extended full digest `e4d50c8d…009e`. |

## Known limitations

- GPS accuracy is supplied by the tracking device/provider and is not a promise
  of zero physical measurement error.
- The map renders a bounded deterministic representation of very long trails;
  full accepted position truth remains in the mission database.
- Full Discovery map loading remains separate work.
- Multi-gigabyte mission finalization remains owned by `DON-252` for beta.13.
- This release migrates mission stores from schema 4 to schema 5. Beta.12
  deliberately refuses to open a newer schema, so an upgraded profile cannot
  be downgraded in place.
- Linux artifacts are unsigned internal builds; auto-update is not enabled.

## Rollback

Quit the app and preserve the complete profile before doing anything else. Do
not point beta.12 at a profile already opened by beta.12.2: beta.12 will reject
schema 5 rather than risk corrupting it. A rollback must use a separately
preserved pre-upgrade schema-4 profile or a fresh isolated profile, with the
schema-5 profile retained for recovery. Do not delete, rename, copy over, or
manually edit mission data without a specific recovery plan.

## WAR-04B record amendment (2026-08-30)

The original record above uses “immutable” for the project's procedural
write-once tag policy. Read-only GitHub inspection on 2026-08-30 found no
technical release/tag immutability enforcement. The historical wording is
preserved rather than rewritten; see `docs/releases/README.md` and
`docs/assurance/findings/WAR-04B.md`.
