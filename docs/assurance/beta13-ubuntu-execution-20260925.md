# Beta 13 Ubuntu execution — 2026-09-25

Owner: Ubuntu execution lane. This is a diagnostic and input-preparation record for DON-254. Release and candidate qualification remain **HOLD**. The current source is `3b27b1c586d02dfa2c3d0b019d8a73d878e5f918` (tree `9d1989882c4784dc3ee4ecd845ee5d02dbefaac8`). Origin/master matched at the start of work. GitHub run [36174038700](https://github.com/donal0c/sartracker-web/actions/runs/36174038700) passed correctness and package production, then failed packaged checks in C12; it does not admit a candidate. Its exact installer artifact is `10880449533`, attempt 1, still unexpired when checked.

## Host and immutable package observations

- Reference host: `donal@192.168.18.31`, Linux x86_64, Node 22.22.2. The host was idle at admission. Free space was 123–129 GB across checks, above the plan's 64 GiB minimum. Xvfb, xauth, xdotool, unzip, unsquashfs, dpkg-deb, xwininfo and sqlite3 are present. The separate owned `/mnt/sartracker-beta13-enospc` mount remains available; no real disk was filled.
- CI AppImage: `07b8cc13b1ffd26b29ff1746e03857b3ee5065b2c6c000536809243d58ac18a3`. CI Debian installer: `19b3dc7a204cfb116266bf84a0d04786b5f0c7dcbe2295a6acb50f4198d68129`. The AppImage-extracted executable (`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`) and `app.asar` (`e4b52164ed650acab1ed8699106cb9e23133ac273cfceb26803ce6f6a73df99e`) exactly match the retained CI producer-development summary. Extraction is diagnostic and is **not** installed-deb proof.
- The installed Debian package is still `sartracker-web 0.1.0~beta.12.11`. The new `.deb` declares `sartracker-web 0.1.0~beta.13 amd64`, but has not been installed. `sudo -n -l /usr/bin/dpkg` returned `sudo: a password is required` (exit 1). The exact pending command is `sudo dpkg -i /home/donal/sartracker-beta13-diagnostic-3b27b1c5/tmp/installer-artifact/sartracker-electron-validation_0.1.0-beta.13_linux_amd64.deb`. No credential or policy change was attempted. A supported authenticated administrator session is needed for genuine installed-deb execution.

## C12 diagnosis and proportional repair check

The failed CI C12 development result retained `exitCode: 0`, `timedOut: true`, `zeroDescendantsAfterRun: true`, `infrastructurePassed: false`, `productCheckPassed: null`, and `qualificationExecuted: false`. Its marker receipt records the original and replacement synthetic attachment bytes with matching stored/archive/restored SHA-256 digests. CI logs show an external Edge viewer and keyring prompt during the 300,000 ms timeout. The CI failure remains retained.

On Ubuntu, an instrumented copy of the unchanged C12 probe wrote its receipt at epoch-ms `1790363408676`, entered `app.close()` at `8677`, and observed Electron exit code 0 at `1790363409523`. `app.close()` remained pending while `xdg-open` and GNOME Text Editor, launched to show the disposable attachment, held inherited stdout/stderr sockets in the exited Electron process group. `/proc` showed the parent Node socket endpoints `52708`/`52710` and viewer endpoints `52709`/`52711`. Terminating only that synthetic viewer released the child `close` event and `app.close()` at `1790363441619`/`1620`. This confirms the viewer-lifetime mechanism on the reference host; it does not retrospectively turn CI green.

Astra supplied a narrow **harness-only** helper and probe change for a diagnostic transfer. With the **unchanged** installer and unchanged 300,000 ms owned-process supervisor, C12 then returned `exitCode: 0`, `timedOut: false`, `processError: null`, `zeroDescendantsAfterRun: true`, `ownedPidsAfterExit: []`, and `cleanupVerified: true`. The new synthetic attachment receipt was written and validated. On Linux, the helper and owned-process/custody unit files passed 31/31 tests; the final listener-lifetime test delta also passed 31/31. This is old-installer/new-harness diagnostic evidence; exact-source CI must pass after the source repair. The diagnostic checkout was restored clean before subsequent package probes.

## Other serialized AppImage diagnostics

- C28 routine composite passed on the clean source checkout in 13.8 seconds with nine recorded phases: settings, mission/outing/participants, GPX, marker/search, coverage/replay, pause/restart, finalise/archive, archive review/restore and sanitized diagnostics. Its receipt has no gaps, clean profile removal, exact executable/ASAR hashes and zero owned descendants. A first run with the temporary C12 harness patch correctly failed only its clean-source binding; that failed receipt is retained separately.
- C26 duplicate launch passed on the clean checkout: second launch rejected, no second window or mission write, one authoritative mission/creation audit remained after restart, and owned process cleanup was verified.

Local copies of the small synthetic receipts and execution records are under `/Users/donalocallaghan/.codex/worktrees/3226/sartracker-web/tmp/ubuntu-execution-20260925/receipts/`. Remote diagnostic evidence is under `/home/donal/sartracker-beta13-diagnostic-3b27b1c5/tmp/`. The original CI failure evidence remains in its retained downloaded location; none of these diagnostic receipts is a sealed campaign attempt.

## Fixture discovery and admission gaps

Historical synthetic 960k and 2m files matched their old manifests and read-only row counts, but are **rejected for candidate paging**: they are schema 9 and lack the current `positions.timestamp_source` column used by C07/C08. Some old directories also contain WAL/SHM sidecars. Their copies and preparation record are retained under the owned Ubuntu `tmp/qualification-fixtures/` path, explicitly as rejected inputs. The current reviewed generator has produced a fresh schema-13 `bcp-960k` file (766,058,496 bytes; SHA-256 `edb2e790ce686dd279538c9bbc8f372f4644a2e848a34964d515eaf903d4c389`); independent count/source verification and final campaign binding remain pending. Fresh `bcp-2m` generation was running at this report snapshot.

The available 4,159,836,160-byte v12 field storage fixture has **32 devices, zero outings and 1,935,360 positions** by read-only inspection. It cannot satisfy C07/C08's 2m/100-device/12-outing paging source oracle. It may be suitable as the 3.7GB C24/C25 **storage baseline**, because the reviewed soak producer separately creates the 100-device/12-outing workload mission after loading and retiring that fixture mission; this remains to be verified against the exact bound copy. A distinct 3.7GB paging source with 2m rows and 100 devices/12 outings is still missing from the reviewed generator presets. The 3.7GB beta12 fixture also has only 32 devices and is an older schema. Storage-mission, private map, live GET-only config/selector, release/rollback and human authority inputs need their own exact bindings. Scale runs and soaks have not started.

## Formal contract status snapshot

`NOT_RUN` means no admitted immutable `bcp17-final` receipt, even where the diagnostic above passed. These statuses are not release verdicts.

| Contract | Status | Reason / next gate |
| --- | --- | --- |
| C00 | NOT_RUN | Exact CI identity/fresh public bytes phase not admitted; no publication. |
| C01 | NOT_RUN | Candidate installed-deb startup/fault and physical ENOSPC matrix pending. |
| C02 | NOT_RUN | Candidate lifecycle/recovery package tiers pending. |
| C03 | NOT_RUN | Candidate source/browser/package family pending. |
| C04 | NOT_RUN | 100-device, 12-outing tracking soak and both package tiers pending. |
| C05 | NOT_RUN | Ingest/source/display and GET-only live confirmation pending. |
| C06 | NOT_RUN | Stationary attention package tiers pending. |
| C07 | NOT_RUN | Four bound paging fixture profiles and installed-deb tier pending. |
| C08 | NOT_RUN | Four bound coverage fixture profiles and installed-deb tier pending. |
| C09 | NOT_RUN | Candidate GPX custody pending. |
| C10 | NOT_RUN | Strict replay, 960k/2m and 201-outing probes pending. |
| C11 | NOT_RUN | Candidate family/source/browser/package pending. |
| C12 | BLOCKED | Retained packaged CI timeout; harness repair passed only as diagnostic. |
| C13 | NOT_RUN | Candidate coordinate surface and golden oracles pending. |
| C14 | NOT_RUN | Candidate map/offline/rendered surface pending. |
| C15 | NOT_RUN | Private offline map input and installed-deb proof pending. |
| C16 | NOT_RUN | Candidate settings/bootstrap and failure probes pending. |
| C17 | NOT_RUN | Candidate privacy/family output scans pending. |
| C18 | NOT_RUN | Bound storage fixture, installed-deb recovery and physical ENOSPC pending. |
| C19 | NOT_RUN | Legacy startup/schema/scale/restart matrix pending. |
| C20 | NOT_RUN | Streamed large archive and source custody pending. |
| C21 | NOT_RUN | Candidate archive security corpus pending. |
| C22 | NOT_RUN | Candidate archive restore/cross-machine custody pending. |
| C23 | NOT_RUN | Candidate packaged IPC containment pending. |
| C24 | NOT_RUN | Tracking soak package tiers/field profiles pending. |
| C25 | NOT_RUN | Long-duration and field profile soaks pending. |
| C26 | NOT_RUN | Clean AppImage diagnostic passed; candidate AppImage and installed-deb receipts pending. |
| C27 | NOT_RUN | Draft release, repository controls, rollback and tag CI phase pending. |
| C28 | NOT_RUN | Clean AppImage routine diagnostic passed; all other variants and installed-deb pending. |
| C29 | NOT_RUN | Named original-machine human training acceptance pending. |

Next: integrate the reviewed C12 harness and exact installer-name binding repairs, obtain successful exact-source CI and candidate artifact provenance, arrange supported authenticated `.deb` installation, prepare/rehash every required fixture and scoped private input, compile/preflight one immutable campaign, then execute all mandatory rows serially on Ubuntu. Recheck affected/dependent rows if source changes. No tag, publication or distribution is authorized by this report.
