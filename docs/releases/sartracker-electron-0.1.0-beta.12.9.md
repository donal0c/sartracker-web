# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.9

> **Qualified internal beta prerelease.** This build is ready for controlled
> team field testing. It is not final operational acceptance and must not be
> used for a live incident.

- **Version:** 0.1.0-beta.12.9
- **Build tag:** `electron-v0.1.0-beta.12.9`
- **Cut date (UTC):** 2026-08-10
- **Linear reference:** `DON-260`
- **Supersedes:** published beta.12.5
- **Replaces:** unpublished beta.12.6, beta.12.7, and beta.12.8 candidates
- **Tag commit:** `32a4326442b93185da300b8456fbaed69ea30705`
- **Tag workflow:** [`31414363788`](https://github.com/donal0c/sartracker-web/actions/runs/31414363788)
- **Published prerelease:** [electron-v0.1.0-beta.12.9](https://github.com/donal0c/sartracker-web/releases/tag/electron-v0.1.0-beta.12.9)
- **AppImage SHA-256:** `d7503d2eb96c2f1ff7a55a321ecb8d21dfc80f5ce8a85af358e3509122550aa7`
- **Debian package SHA-256:** `b1baae233d09e353422c559aff0531b533213142dd295baf52bb1936f4f36fa6`
- **`SHA256SUMS` SHA-256:** `7b5c8b7434e9428c87774c4ef588f4471699f22e38f8b83be6d403b621753919`

## Release purpose

Beta.12.5 could take roughly nine minutes to fill a 36-hour breadcrumb window
and could show route gaps absent from Traccar. The corrected pipeline publishes
current fixes immediately, drains two-hour history windows continuously with
at most eight concurrent requests, persists each fetched wave and its durable
frontiers atomically, resumes after crashes, preserves an error-bounded route,
and cancels stale mission work safely.

The release process rejected three candidates rather than weakening a gate:
beta.12.6 missed the 60-second Ubuntu persistence deadline, beta.12.7 exceeded
an under-specified CI unit-test timeout, and beta.12.8 returned exact history
but restarted at `10.177 s` / `9.892 s` against a `10 s` render limit.

Beta.12.9 fixes the last measured bottleneck. SQLite had selected the
mission/device/timestamp index for each 500-row hydration batch, rescanning the
279,936-row mission as many as 215 times. Selected rows now use direct rowid
primary-key lookups. The exact Ubuntu query fell from `4.642 s` to `1.315 s`
with the same 103,633 retained identities. The packaged proof now runs three
completed-history restarts by default and records launch, mission-resume,
first-exact, and stable-render timing; signal exits are cleaned up and reported
instead of being misclassified as 60-second CDP timeouts.

## Required qualification

- [x] Clean no-skip local `npm run beta:verify`
- [x] Annotated tag and green tag-driven workflow
- [x] Exact AppImage and `.deb` match `SHA256SUMS`
- [x] Exact CI AppImage 36-hour fault/503/SIGKILL/checkpoint proof completes
      within 60 seconds with `279,936/279,936`, integrity `ok`, max history
      concurrency 8, and exact line/dot render oracles
- [x] Three consecutive post-completion restarts each render exact stable
      history within the unchanged 10-second gate, with a measured maximum no
      greater than 8 seconds for release margin
- [x] Exact CI AppImage 14-day soak matches all `1,935,384` rows and five-day
      prefix through two restarts, WAL/integrity, responsiveness, and 2 GiB RSS
- [x] Native Ubuntu AppImage and real installed `.deb` pass lifecycle,
      recovery/finalize/archive, coordinate rejection, sanitized exports,
      corrupt credentials, duplicate launch, and live Traccar
- [x] Release note, handoff, and Linear contain exact evidence
- [x] Guarded publish succeeds and fresh public bytes plus final Ubuntu
      AppImage lifecycle smoke re-verify

## Recorded evidence

- Local no-skip `npm run beta:verify` passed all eight gates from a clean
  worktree: lint, production build and bundle budgets, `178` unit files / `1,402`
  tests, backend `51 passed / 1 ignored`, Chromium `142/142`, Electron package,
  CI-profile packaged soak, and manual packaged smoke.
- The exact tag workflow passed every job: gates, Linux bundle, AppImage launch
  smoke, draft prerelease/checksums, and summary. The downloaded workflow
  artifacts and draft-release assets were byte-identical to the checksums above.
- Guarded publication succeeded. A fresh download of all three public assets
  reproduced the recorded SHA-256 values and passed `sha256sum -c SHA256SUMS`.
  The fresh public AppImage was then copied to Ubuntu, re-hashed there, and
  passed the final lifecycle, recovery, finalize, and archive smoke with no
  orphan processes.
- On Ubuntu native Wayland, the exact CI AppImage showed the current fix in
  `144 ms`, the first breadcrumb in `452 ms`, completed reconciliation in
  `44.901 s`, and durably persisted the exact `279,936` source identities in
  `46.287 s`. SQLite integrity was `ok`; all request coverage was complete; one
  deterministic HTTP 503 was retried; SIGKILL recovery resumed from durable
  checkpoints; history concurrency never exceeded eight; and the rendered
  `103,616` coordinates matched the independent canonical oracle.
- Three fresh post-completion restarts rendered the same exact route in
  `5.667 s`, `5.557 s`, and `5.649 s`, all below both the unchanged `10 s` hard
  limit and the `8 s` release-margin target.
- The exact AppImage passed the deterministic five-day and fourteen-day soaks.
  The extended run stored all `1,935,384` source positions and the exact
  `691,224`-position five-day prefix through two restarts, with SQLite integrity
  `ok`, WAL `0/0/0`, zero redundant-event slope, zero renderer crashes, main and
  renderer hard gaps below one second, and peak process-tree RSS
  `1,488,752,640` bytes against the `2 GiB` limit.
- AppImage operator smokes passed mission settings/lifecycle/recovery/finalize/
  archive, coordinate rejection, duplicate launch, sanitized diagnostics and
  support export, corrupt-secret recovery, and the live team Traccar provider.
  The live gate reached tracking online with `34` devices and completed history
  reconciliation without exposing credentials.
- The exact `.deb` installed as `sartracker-web 0.1.0~beta.12.9`; `dpkg -V`
  emitted no differences and `/usr/bin/sartracker-web` resolved to the expected
  `/opt` executable with SHA-256 `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`.
  The installed executable independently completed the 36-hour proof in
  `45.050 s` and exact persistence in `46.447 s`; its three exact restarts were
  `5.703/5.786/5.787 s`. The installed lifecycle/archive, coordinate rejection,
  duplicate launch, sanitized exports, corrupt-secret, and live Traccar gates
  also passed.
- `apt-get` returned status `100` only after SAR Tracker had installed, while
  retrying three pre-existing broken NVIDIA/kernel packages. The SAR Tracker
  package itself is `install ok installed`, its files verify cleanly, and the
  complete installed-app matrix passed. The raw installer output is retained as
  an Ubuntu host-environment note rather than being hidden or treated as an
  application pass.

## Packaged smoke matrix

The exact CI artifacts completed this matrix on Ubuntu before publication; the
public AppImage was then re-downloaded and the core lifecycle smoke repeated
after publication.

| Gate | Result | Evidence |
| --- | --- | --- |
| AppImage SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.9_linux_x86_64.AppImage` — `d7503d2eb96c2f1ff7a55a321ecb8d21dfc80f5ce8a85af358e3509122550aa7`; workflow artifact, release asset, `SHA256SUMS`, fresh public download, and Ubuntu bytes agree |
| .deb SHA-256 | PASS | `sartracker-electron-validation_0.1.0-beta.12.9_linux_amd64.deb` — `b1baae233d09e353422c559aff0531b533213142dd295baf52bb1936f4f36fa6`; workflow artifact, release asset, `SHA256SUMS`, and fresh public download agree |
| AppImage launch | PASS | Tag workflow launch smoke plus native-Wayland Ubuntu lifecycle and 36-hour AppImage proof |
| .deb install and launch | PASS | `sartracker-web 0.1.0~beta.12.9` is `install ok installed`; `dpkg -V` clean; installed executable completed the full 36-hour and operator matrix |
| Core lifecycle, restart/recovery, finish/finalize/archive | PASS | Exact AppImage and installed `.deb` both persisted settings, resumed the active mission, finalized, and produced a non-empty archive |
| Coordinate rejection | PASS | Both package paths resolved `V 80 84` to `V 80500 84500` and rejected invalid grid input without opening a marker dialog |
| Diagnostics/support/incident exports sanitized | PASS | Both package paths exported all three bounded reports; allow-list and credential privacy inspection passed |
| Bad/corrupt stored credential reaches shell | PASS | Both package paths reached the normal shell, showed the explicit warning, and allowed recoverable Settings entry |
| Live Traccar connection and breadcrumb reconciliation | PASS | Both package paths matched the configured provider, reached tracking online with 34 devices, persisted positions, and completed reconciliation without a warning |
| Official offline Discovery package | NOT APPLICABLE | A private Discovery package is not configured or bundled; full Discovery loading remains explicitly out of scope |
| Duplicate launch | PASS | Both package paths retained one primary instance and intact mission state while the second process exited normally |
| Five-day and fourteen-day packaged soak | PASS | Exact CI AppImage stored `691,224/691,224` and `1,935,384/1,935,384` positions through one/two restarts, with integrity/WAL/memory/responsiveness gates green |
| Cross-profile exact breadcrumb identity comparison | PASS | Five-day digest `93c71e433a7da41c0966bf9a4cad3c1e48a534732bb2ed3e043ff3f66a26c146` exactly equals the fourteen-day prefix digest; extended full digest `e4d50c8d93f36dbcd19ba97b1adc6f3dd1b533d57d80cb0bef8aa0d7fa1d009e` |

## Known limits

Internal Linux x86-64 field-test build only; unsigned; no auto-update; not final
operational acceptance and not approved for live incidents. No private
Discovery package is bundled. Full accepted breadcrumb truth remains in SQLite;
the map uses a deterministic bounded representation with an explicit geometry
error bound.

## Rollback

Quit SAR Tracker and return to the qualified beta.12.5 artifact. Uninstalling
does not remove per-user mission databases; capture diagnostics first.

---

## CI Provenance

- Build commit: `32a4326442b93185da300b8456fbaed69ea30705`
- Run: [`31414363788`](https://github.com/donal0c/sartracker-web/actions/runs/31414363788)
- Workflow: `.github/workflows/electron-release.yml`
- Release gates: lint, unit tests, web build, standard Chromium E2E, Linux
  packaging, private-map guard, llvmpipe packaged soak, and AppImage launch
