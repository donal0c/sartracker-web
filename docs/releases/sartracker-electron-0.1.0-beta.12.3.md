# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.3 (breadcrumb safety hotfix)

> **Internal beta only.** Qualified for controlled team field retest; this is
> not final operational acceptance and must not be used for a live incident.

- **Version:** 0.1.0-beta.12.3
- **Build tag:** `electron-v0.1.0-beta.12.3`
- **Cut date (UTC):** 2026-07-29
- **Linear reference:** `DON-260`
- **Supersedes:** `electron-v0.1.0-beta.12`
- **Tag commit:** `edb5eb2f5e99d22716489cbf49d40859fc6ad1b5`
- **Local verification report:**
  `verify-0.1.0-beta.12.3-sha.edb5eb2f5e99-2026-07-29T12-01-21Z.json`
  passed all 8/8 gates with no skips
- **CI runs:** failed tag runs `30402564688`, `30426564770`, `30427996046`,
  `30429828590`, and `30431931012`; diagnostic branch runs `30435183304`,
  `30437248431`, `30438100453`, and `30439617823`; exact product head
  `c7ffcb43755c` passed Linux validation in `30441228109`; beta.12.2 tag run
  `30445518186` passed but its unpublished draft failed the newer-schema
  Ubuntu release gate; exact beta.12.3 tag run
  [`30449919583`](https://github.com/donal0c/sartracker-web/actions/runs/30449919583)
  passed every job
- **Exact CI artifact SHA-256:** AppImage
  `37a04cc0b1b9d5c58e746038f4953cdf73d6d2f14b5f1a3f60e5623657549d2e`;
  Debian package
  `eb1711a55bc668546c9f4decf0c73adf2450f1a448aad4d24e46c61038b59278`
- **GitHub release:** published as an internal prerelease on 2026-07-29:
  <https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.12.3>

`electron-v0.1.0-beta.12.1` was pushed against an earlier pre-release commit
but never produced a release. `electron-v0.1.0-beta.12.2` then produced a fully
green CI draft, but exact-artifact Ubuntu qualification found that a newer
mission-store schema entered the generic fatal-relaunch path. Both tags remain
immutable and neither draft is a tester artifact. This corrected cut uses the
next version rather than rewriting release provenance.

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
- A mission store created by a newer SAR Tracker version now fails closed with
  an explicit compatibility message, preserves every mission-store byte, and
  exits after acknowledgement without an unhandled rejection or relaunch loop.

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

Product proof and exact-artifact release qualification are complete:

- lint and production build/bundle budgets passed
- full unit suite passed: 171 files / 1,274 tests
- Rust backend passed: 51 tests plus one expected keychain ignore; formatting
  and strict Clippy checks are clean
- Chromium passed: 135/135
- visual Playwright passed: 36/36; fresh uncached independent review passed
  41/41 at the strict high-severity gate
- the final exact-head no-skip `npm run beta:verify` passed all 8/8 gates with
  no skips
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
- exact beta.12.2 Ubuntu qualification preserved all 2,040,000 positions while
  migrating a 3.70 GB schema-4 field store to schema 5, but the mandatory
  newer-schema refusal gate exposed an unhandled-rejection/relaunch-loop
  startup defect; beta.12.2 was marked abandoned before publication
- a locally rebuilt beta.12.3 pre-tag AppImage then passed the corrected
  schema-6 refusal smoke on Ubuntu: native error dialog acknowledged, exit code
  `1`, 50 live descendant-process samples with zero renderer processes, no
  unhandled rejection, durable `startupFailure` evidence, and byte-identical
  database/backup hashes before and after. This proves the correction before
  commit but did not replace the exact-CI-artifact release gate
- exact tag run `30449919583` passed lint, 1,274 unit tests, build/bundle
  budgets, 135 Chromium workflows, native Linux packaging, Mesa llvmpipe
  attestation, the packaged CI tracking soak, real AppImage launch, and draft
  artifact upload. The CI soak retained 8,664/8,664 exact fixes with digest
  `63276a130a720149784dd67139c2135d6fc333c847b0bb7158494bc121e5a9c6`,
  one restart, 4/4 healthy interactions, SQLite integrity `ok`, clean WAL,
  47.6 ms maximum main-process latency, 583.3 ms maximum renderer gap,
  158.9 ms maximum internal action time, 381.6 ms maximum external action
  time, no crash, no throttling, and direct two-launch Mesa attestation
- the freshly downloaded draft contained exactly the AppImage, Debian package,
  and `SHA256SUMS`; local and Ubuntu checksum verification matched GitHub's
  immutable asset metadata
- the exact AppImage passed Ubuntu lifecycle/restart/recovery/finalize/archive,
  coordinate rejection, duplicate launch, sanitized diagnostics/support/
  incident export, corrupt-credential recovery, and live Traccar connection.
  The live gate saw 33 devices, persisted positions, and completed breadcrumb
  reconciliation without a warning
- the exact Debian package installed as `sartracker-web
  0.1.0~beta.12.3`; `dpkg -V` was clean and the installed `/opt` executable
  passed lifecycle/restart/recovery/finalize/archive with a non-empty archive.
  The enclosing `apt` command returned status 100 only after configuring SAR
  Tracker, when it retried three pre-existing unconfigured NVIDIA/kernel
  packages for Linux 7.0.0-28. The apt and dpkg logs attribute every error to
  those packages; SAR Tracker remains `install ok installed`, all declared
  dependencies are installed (including Ubuntu's `t64` providers), and its
  installed files pass `dpkg -V`. The raw apt history, apt terminal log, and
  dpkg log are retained under
  `evidence/deb-install-apt-status-100/` on the qualification host
- same-session Fable review independently returned
  `PASS_WITH_ENVIRONMENT_NOTE` with no P1/P2: the aggregate status 100 does not
  invalidate the package-scoped install gate and the unrelated NVIDIA/kernel
  repair is explicitly non-blocking
- the exact artifact migrated the 3.70 GB schema-4 field fixture to schema 5
  twice in isolated runs, preserving all 2,040,000 positions, integrity,
  required source-identity structures, backup, and reopen. A first CDP-only
  harness timeout never reached `app_start` or mutated the database; the
  ignored validation harness was hardened to await process exit, retain
  failure evidence, and reject singleton residue, then passed with zero
  residue. Same-session Fable review classified this as validation isolation,
  found no artifact P1/P2, and returned `PASS_WITH_BOUNDED_RETEST`
- the exact newer-schema refusal gate showed the native compatibility dialog,
  exited 1 after acknowledgement, sampled the descendant process tree 51
  times with zero renderer processes, recorded no unhandled rejection, and
  preserved byte-identical database and backup hashes
- the exact five-day packaged profile passed 691,224/691,224 fixes, one
  restart, digest
  `93c71e433a7da41c0966bf9a4cad3c1e48a534732bb2ed3e043ff3f66a26c146`,
  zero redundant-event slope, integrity `ok`, clean WAL, 66.3 ms maximum main
  latency, 266.7 ms maximum renderer gap, and 4/4 healthy interactions
- the exact fourteen-day packaged profile passed 1,935,384/1,935,384 fixes,
  two restarts, digest
  `e4d50c8d93f36dbcd19ba97b1adc6f3dd1b533d57d80cb0bef8aa0d7fa1d009e`,
  the exact five-day prefix digest, zero redundant-event slope, integrity
  `ok`, clean WAL, 140.4 ms maximum main latency, 250.0 ms maximum renderer
  gap, and 6/6 healthy interactions

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

Guarded publication completed at `2026-07-29T13:22:44Z`. A brand-new
post-publication download contained exactly the three qualified assets, matched
all release and manifest SHA-256 values, and the freshly published AppImage
then passed lifecycle, persisted-settings, restart/recovery, finish/finalize,
and non-empty-archive smoke on Ubuntu. The release is now ready for internal
field retest; original-machine confirmation remains tracked separately under
`DON-247`.

## Packaged smoke matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.3_linux_x86_64.AppImage` — `37a04cc0b1b9d5c58e746038f4953cdf73d6d2f14b5f1a3f60e5623657549d2e`; manifest, GitHub metadata, local download, and Ubuntu bytes agree. |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.3_linux_amd64.deb` — `eb1711a55bc668546c9f4decf0c73adf2450f1a448aad4d24e46c61038b59278`; manifest, GitHub metadata, local download, and Ubuntu bytes agree. |
| AppImage launch | PASS | Exact AppImage launched under CI Xvfb and Ubuntu Xvfb with a real non-black SAR Tracker shell; CI content mean `0.502046`. |
| .deb install and launch | PASS | `dpkg` configured `sartracker-web 0.1.0~beta.12.3` before `apt` returned status 100 while retrying three pre-existing broken NVIDIA/kernel packages. SAR Tracker is `install ok installed`, all dependencies are satisfied, `dpkg -V` is clean, and `/opt/SAR Tracker Electron Validation/sartracker-web` passed restart/recovery/finalize/archive. The unrelated host-package failure is retained explicitly rather than represented as a clean aggregate apt exit. |
| Core lifecycle, restart/recovery, finish/finalize/archive | PASS | Exact AppImage and installed Debian executable both persisted settings, recovered the active mission after restart, finalized it, and created non-empty archives. |
| Coordinate rejection | PASS | Coarse grid `V 80 84` resolved to `V 80500 84500`; malformed marker grid input was rejected before marker creation. |
| Diagnostics/support/incident exports sanitized | PASS | Exact AppImage exported sanitized diagnostics, support, and incident bundles on Ubuntu; current exact-head macOS smoke also validated operating-system file opening. |
| Bad/corrupt stored credential reaches shell | PASS | Undecryptable legacy secret reached the normal shell with the explicit re-entry warning and an operable Settings recovery field. |
| Live Traccar connection and breadcrumb reconciliation | PASS | Exact AppImage verified the configured provider, connected online, saw 33 devices, persisted positions, and completed history reconciliation without a warning; evidence contains no private configuration. |
| Official offline Discovery package | NOT APPLICABLE | Breadcrumb hotfix does not change official-map loading, no customer private package was supplied for this cut, and full Discovery loading remains separately scoped. |
| Duplicate launch | PASS | Second exact-AppImage launch exited cleanly with code 0 while the primary shell remained visible and operable. |
| 3.70 GB schema-4 to schema-5 migration and reopen | PASS | Exact AppImage passed two isolated migrations/reopens with all 2,040,000 positions, integrity `ok`, required source-identity index/revision table, and matching schema-5 backup. |
| Newer-schema refusal | PASS | Exact AppImage showed the native compatibility dialog, exited 1, produced 51 process-tree samples with zero renderers, recorded no unhandled rejection, and left database/backup SHA-256 values unchanged. |
| Five-day and fourteen-day packaged soak | PASS | Exact AppImage retained 691,224 and 1,935,384 positions across one/two restarts, exact source truth, zero redundant-event slope, healthy SQLite/WAL, no renderer crash/throttling, and bounded responsiveness. |
| Cross-profile exact breadcrumb identity comparison | PASS | Normal full digest equals the extended normal-prefix digest: `93c71e433a7da41c0966bf9a4cad3c1e48a534732bb2ed3e043ff3f66a26c146`; extended full digest `e4d50c8d93f36dbcd19ba97b1adc6f3dd1b533d57d80cb0bef8aa0d7fa1d009e`. |

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
not point beta.12 at a profile already opened by beta.12.3: beta.12 will reject
schema 5 rather than risk corrupting it. A rollback must use a separately
preserved pre-upgrade schema-4 profile or a fresh isolated profile, with the
schema-5 profile retained for recovery. Do not delete, rename, copy over, or
manually edit mission data without a specific recovery plan.

---

## CI Provenance

- Build commit: `edb5eb2f5e99d22716489cbf49d40859fc6ad1b5`
- Run: [#37](https://github.com/donal0c/sartracker-web/actions/runs/30449919583)
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, unit tests, web build, standard Chromium E2E
- Linux launch smoke: passed
