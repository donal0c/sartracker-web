# Beta 13 Ubuntu execution — 2026-09-25

Owner: Ubuntu execution lane. This is a diagnostic and input-preparation record for DON-254. Release and candidate qualification remain **HOLD**. The initial diagnostic source was `3b27b1c586d02dfa2c3d0b019d8a73d878e5f918` (tree `9d1989882c4784dc3ee4ecd845ee5d02dbefaac8`), matching origin/master at the start of work. GitHub run [36174038700](https://github.com/donal0c/sartracker-web/actions/runs/36174038700) passed correctness and package production, then failed packaged checks in C12; it does not admit a candidate. Its exact installer artifact is `10880449533`, attempt 1, still unexpired when checked.

After the C12 harness and installer-name repair was integrated, exact-source run [36179770541](https://github.com/donal0c/sartracker-web/actions/runs/36179770541) for `00f1a8a9af4c57436f152c3cc1a51d69190da9e6` completed successfully, including bounded C12 cleanup. Its artifact is `10884001990`. Further fixture and C08 response-contract source work is in progress, so that successful development run is not the final candidate freeze or campaign execution. The failed run and its diagnostic evidence remain retained.

## Host and immutable package observations

- Reference controlled Ubuntu host: Linux x86_64, Node 22.22.2. The host was idle at admission. Free space was 123–129 GB across checks, above the plan's 64 GiB minimum. Xvfb, xauth, xdotool, unzip, unsquashfs, dpkg-deb, xwininfo and sqlite3 are present. The separate owned `/mnt/sartracker-beta13-enospc` mount remains available; no real disk was filled.
- CI AppImage: `07b8cc13b1ffd26b29ff1746e03857b3ee5065b2c6c000536809243d58ac18a3`. CI Debian installer: `19b3dc7a204cfb116266bf84a0d04786b5f0c7dcbe2295a6acb50f4198d68129`. The AppImage-extracted executable (`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`) and `app.asar` (`e4b52164ed650acab1ed8699106cb9e23133ac273cfceb26803ce6f6a73df99e`) exactly match the retained CI producer-development summary. Extraction is diagnostic and is **not** installed-deb proof.
- The installed Debian package is still `sartracker-web 0.1.0~beta.12.11`. The new `.deb` declares `sartracker-web 0.1.0~beta.13 amd64`, but has not been installed. `sudo -n -l /usr/bin/dpkg` returned `sudo: a password is required` (exit 1). Install only the final admitted candidate Debian artifact through a supported administrator session; the old diagnostic installer is not the pending release candidate. No credential or policy change was attempted. A supported authenticated administrator session is needed for genuine installed-deb execution.

## C12 diagnosis and proportional repair check

The failed CI C12 development result retained `exitCode: 0`, `timedOut: true`, `zeroDescendantsAfterRun: true`, `infrastructurePassed: false`, `productCheckPassed: null`, and `qualificationExecuted: false`. Its marker receipt records the original and replacement synthetic attachment bytes with matching stored/archive/restored SHA-256 digests. CI logs show an external Edge viewer and keyring prompt during the 300,000 ms timeout. The CI failure remains retained.

On Ubuntu, an instrumented copy of the unchanged C12 probe wrote its receipt at epoch-ms `1790363408676`, entered `app.close()` at `8677`, and observed Electron exit code 0 at `1790363409523`. `app.close()` remained pending while `xdg-open` and GNOME Text Editor, launched to show the disposable attachment, held inherited stdout/stderr sockets in the exited Electron process group. `/proc` showed the parent Node socket endpoints `52708`/`52710` and viewer endpoints `52709`/`52711`. Terminating only that synthetic viewer released the child `close` event and `app.close()` at `1790363441619`/`1620`. This confirms the viewer-lifetime mechanism on the reference host; it does not retrospectively turn CI green.

Astra supplied a narrow **harness-only** helper and probe change for a diagnostic transfer. With the **unchanged** installer and unchanged 300,000 ms owned-process supervisor, C12 then returned `exitCode: 0`, `timedOut: false`, `processError: null`, `zeroDescendantsAfterRun: true`, `ownedPidsAfterExit: []`, and `cleanupVerified: true`. The new synthetic attachment receipt was written and validated. On Linux, the helper and owned-process/custody unit files passed 31/31 tests; the final listener-lifetime test delta also passed 31/31. This is old-installer/new-harness diagnostic evidence; exact-source CI must pass after the source repair. The diagnostic checkout was restored clean before subsequent package probes.

## Other serialized AppImage diagnostics

- C28 routine composite passed on the clean source checkout in 13.8 seconds with nine recorded phases: settings, mission/outing/participants, GPX, marker/search, coverage/replay, pause/restart, finalise/archive, archive review/restore and sanitized diagnostics. Its receipt has no gaps, clean profile removal, exact executable/ASAR hashes and zero owned descendants. A first run with the temporary C12 harness patch correctly failed only its clean-source binding; that failed receipt is retained separately.
- C26 duplicate launch passed on the clean checkout: second launch rejected, no second window or mission write, one authoritative mission/creation audit remained after restart, and owned process cleanup was verified.
- C07 960k paging against the freshly generated schema-13 fixture completed all 480 pages on the exact older CI AppImage bytes. The primary mission contributed 959,988 positions, 100 devices and 12 outings; the fixed legacy mission contributed 12 more rows. The separately reopened, independent file oracle passed every retained primary row against the immutable source (`fixtureSha256` `edb2e790ce686dd279538c9bbc8f372f4644a2e848a34964d515eaf903d4c389`). Raw pages (203,975,964 bytes), report and screenshot remain in the owned Ubuntu diagnostic directory; the small report and oracle result are copied under `tmp/ubuntu-execution-20260925/receipts/c07-960k/`. The temporary profile was removed and no app process remained. This does not exercise rendered breadcrumbs, the new exact-head candidate, or installed `.deb`.
- C08 960k against that same source **failed before page capture** at the reviewed manifest-completion gate. An isolated repeat retained the returned manifest: `enumerated=true`, `pendingInvalidation=false`, 1,300 chunks summing to exactly 959,988 primary fixes, but `backfillIncomplete=true`. The generated source intentionally has one `participant_backfill_checkpoints` row with `completed=0` for the primary mission; `readCoverageManifest` correctly reports that state. This is a fixture/probe readiness contradiction, not missing source rows or failed enumeration. The failed command and sanitized manifest summary are retained under `tmp/ubuntu-execution-20260925/receipts/c08-960k/`; a reviewed C08-ready source or explicit backfill-completion flow is needed. The original source and hard-fail predicate were not changed.

Local copies of the small synthetic receipts and execution records are under `/Users/donalocallaghan/.codex/worktrees/3226/sartracker-web/tmp/ubuntu-execution-20260925/receipts/`. Remote diagnostic evidence is under `/home/donal/sartracker-beta13-diagnostic-3b27b1c5/tmp/`. The original CI failure evidence remains in its retained downloaded location; none of these diagnostic receipts is a sealed campaign attempt.

## Fixture discovery and admission gaps

Historical synthetic 960k and 2m files matched their old manifests and read-only row counts, but are **rejected for candidate paging**: they are schema 9 and lack the current `positions.timestamp_source` column used by C07/C08. Some old directories also contain WAL/SHM sidecars. Their copies and preparation record are retained under the owned Ubuntu `tmp/qualification-fixtures/` path, explicitly as rejected inputs. The reviewed generator v5 produced fresh schema-13 `bcp-960k` (766,058,496 bytes; SHA-256 `edb2e790ce686dd279538c9bbc8f372f4644a2e848a34964d515eaf903d4c389`) and `bcp-2m` (1,593,966,592 bytes; SHA-256 `d0ae7f1f7f5e588cc9638d5963125dd06cb85c5e2d9a1251f9395d7616ea0592`) files. Independent read-only verification confirmed both manifest hashes, schema 13, `timestamp_source`, `quick_check=ok`, standalone files, 100 devices and 12 outings on the primary mission, and exactly 960k/2m total positions. The verification receipt is `tmp/ubuntu-execution-20260925/fixtures/current-fixture-verification.json`; final campaign binding remains pending.

The available 4,159,836,160-byte v12 field storage fixture has **32 devices, zero outings and 1,935,360 positions** by read-only inspection. It cannot satisfy C07/C08's 2m/100-device/12-outing paging source oracle. It may be suitable as the 3.7GB C24/C25 **storage baseline**, because the reviewed soak producer separately creates the 100-device/12-outing workload mission after loading and retiring that fixture mission; this remains to be verified against the exact bound copy. A read-only inventory of all 24 Ubuntu `/home/donal` SQLite/database files at least 3.5GB found no C07/C08 field-envelope source: the legacy large files lack the required 100 devices/12 outings, and most also lack `timestamp_source`. The original generator lacked a preset combining 3.7GB, 2m positions, 100 devices and 12 outings; the reviewed generator-v6 addition has since filled that input gap, as independently verified below. Prepared storage, map and live inputs still need exact campaign binding, and live GET-only scope and human authority remain separate. Scale runs and soaks have not started.

The existing private offline map was copied to the owned Ubuntu fixture area with mode 600. Both local and remote files are 1,211,482,112 bytes with SHA-256 `e317fd016b02d88f0fdc0e4f97653a2c4758acc46779bad7ffb55ac2807b6589`. An immutable read-only SQLite `quick_check` returned `ok`; the MBTiles metadata says PNG zoom 8–16 with 31,729 tiles. The existing C15 synthetic matrix remains intact; the separate private-map supplement is under reviewed-PR preparation. Its first diagnostic rejected valid edge transparency before launch. The independent decoder now matches the native visible-pixel policy (including partial alpha, rejecting entirely invisible tiles), with red/green regressions, and the 4 MiB byte cap matches the product. The second attempt decoded all 31,729 PNG tiles and launched the older exact diagnostic AppImage, then failed the registration attestation predicate before rendering. Both attempts exited 1 without timeout/process error, proved zero descendants/cleanup, removed disposable private copies, and retained the unchanged source hash. Owner-local diagnosis confirmed the original metadata declares zoom 8–16 while actual tile rows span 9–16. The product correctly rejected the package in about 42.9 seconds, inside its unchanged timeout. This is an input defect, not a product regression. The coordinator authorized a separately named/hash-bound metadata-only disposable derivative for positive-path diagnostics, preserving original rejection and provenance; it is not proof that the original works. Contract review permits later admission only by explicitly binding the derivative in a new immutable campaign and retaining private lineage; C29 human acceptance remains separate. The original package remains rejected and uncertified. Raw map/log content stays in controlled private custody.

For positive-path diagnosis only, a **separately named private disposable derivative** was copied from the unchanged source and changed exactly one metadata value, `minzoom` 8 to 9. Its SHA-256 is `16e55b8e652d7fe25a9ff547c401457a09edbe50e47ca37b977d36452ec8b233`; size remains 1,211,482,112 bytes. Independent streaming digests over every tile address and payload matched across all 31,729 source and derived rows; all other metadata values matched. The derived file returned `quick_check=ok` with no sidecars, and the original source SHA remained unchanged. This derivative is diagnostic input under the coordinator's explicit direction and is not evidence that the original private package works. The full reviewed probe then passed against the older exact CI AppImage: all source PNG tiles decoded independently, the packaged app attested the derived hash and tile count, served and decoded the selected tile, loaded the official raster source, captured a render frame on the target view, reported 15/15 local tiles and field ready, blocked the external network probe, and made zero external map requests. The owned process exited 0 with no timeout, process error or descendants; the disposable profile was removed. The receipt retains neither private tile bytes nor screenshots. It is derived-package/older-installer diagnostic evidence, not a sealed final candidate or installed-deb C15 result.

The schema-12 storage baseline was copied into the owned fixture directory as `storage-mission-v12.sqlite` with mode 600. It is 4,159,836,160 bytes and has SHA-256 `53fd13f87775529b46346a83519b823c50b22bd20297c489e0165d52ff3abcb6`, identical to the original closed source. It has no SQLite sidecars, and the immutable read-only `quick_check` returned `ok`. The one mission is active with the required `fixture-mission-` ID prefix, 32 configured devices (eight represented in positions), 1,935,360 positions and no outings. It is prepared for C18's bound storage-mission role. Static inspection of the C24/C25 soak producer confirms it copies this field-size file, finishes the preloaded fixture mission through the packaged UI and creates a separate 100-device/12-outing workload. Packaged load, migration, finish and soak behavior remain unverified.

The Ubuntu user's documented SAR Tracker config has app-owned `settings.json` and `credentials.json`. Only those two files were copied to an owned mode-700 `live-config` directory with mode-600 members, and the reviewed directory-identity parser accepted their names, sizes and JSON format. A historical beta.12.10 owner-only target selector was copied to an owned mode-600 `live-selector` file; the reviewed selector parser accepted its syntax without printing the identifier. No live request was sent. Donal explicitly authorized reuse of that existing configured account and selected tracker on 2026-09-25, strictly GET-only, as recorded in DON-254 comment `af5f3aa6-5cd3-40c0-8947-4c327d3a5a3e`. Sol alone executes after scoped preflight and candidate binding; no writes or expanded target selection are authorized. Current provider/target validity and live proof remain unverified. Credential and selector contents and hashes are deliberately absent from this report.

The reviewed generator patch produced separate schema-13, generator-v6 paging-ready fixtures while preserving the original v5 mixed-backfill files. The new 960k file is 766,058,496 bytes (SHA-256 `dfe56dd10139ef0502773ab20e80c215556963fff309f871291099f03cc82b3a`); the new 2m file is 1,593,966,592 bytes (SHA-256 `c90bbb553b59595048cff46c778fb5b6b31c2a9b528e4f6ec079620d8822b317`). Independent verification confirmed exact total/primary/legacy counts, 100 devices, 12 outings, two completed participant backfill checkpoints reconciled to their window ends, immutable source hashes, `quick_check=ok` and no sidecars. The manifest and verification copies are under `tmp/ubuntu-execution-20260925/fixtures/paging-ready/`. A diagnostic `readCoverageManifest` on the new 960k fixture returned `enumerated=true`, no pending invalidation, `backfillIncomplete=false`, and 1,300 chunks summing to 959,988 primary fixes. These inputs are not yet frozen campaign bindings.

The full C08 diagnostic against the new 960k fixture stopped after retaining its first 167-row page. Independent lookup of the first returned row matched its ID, device, source position ID, timestamp and coordinates; `data_origin` was absent from the coverage response while the source stored `live`. `electron/coverage-query.cjs` selects only six coverage row fields, but the shared paging oracle requires `data_origin` as a seventh. The old `CoverageChunkPage` type promised a full `Position`, which also required that field. The pending PR repairs both SQL selection and worker-envelope preservation and narrows the type; exact repaired-package proof remains outstanding. This is a separate source/contract mismatch exposed only after the complete-backfill fixture passed manifest admission. The failed one-page raw evidence remains under the owned Ubuntu `tmp/paging-diagnostic-c08-ready-960k/`; no oracle or source data was altered.

The separate reviewed `bcp-field-37gb` preset generated a closed 5,320,654,848-byte schema-13 source (SHA-256 `43cbe38949bdcb3b419c1a745a8f36aee8d4ec62cb55a219babcf8922dd25ed2`). An independent read-only verifier confirmed generator v6 and the synthetic historical audit profile, 3,999,988 primary fix rows plus the fixed 12 legacy rows, 100 primary devices, 12 outings, both backfill checkpoints complete/reconciled, and 3,999,988 distinct valid one-to-one audit links with zero invalid links. Both `quick_check` and `integrity_check` returned `ok`; there are no sidecars. The input is within the four-million-row primary oracle cap and above the 3.7GB file floor. Its manifest and verification JSON are copied under `tmp/ubuntu-execution-20260925/fixtures/paging-ready/`. No field paging package run has occurred.

The publicly published beta.12.11 rollback AppImage, Debian installer and `SHA256SUMS` were independently downloaded from the GitHub release and copied to the owned Ubuntu rollback directory. Release metadata and both local/Ubuntu checksum checks agreed: AppImage SHA-256 `2844b75fe9fc2fff7623f4a5db7c360804787b4a4d278153659cc8c9ce1c295b`, Debian SHA-256 `d5e33b41417e444ea524e73c9e25e21d526b70289d68d0ef7c37cf1726fc2954`, checksum-file SHA-256 `965110afec47a638951dc16a97f203e5a5106ab5897c2d7723da4b17fbb4cfc1`. This prepares rollback inputs; it is not a C27 candidate or publication result.

## Formal contract status snapshot

`NOT_RUN` means no admitted immutable `bcp17-final` receipt, even where the diagnostic above passed. These statuses are not release verdicts.

| Contract | Status | Reason / next gate |
| --- | --- | --- |
| C00 | NOT_RUN | Exact CI identity/fresh public bytes phase not admitted; no publication. |
| C01 | NOT_RUN | Candidate installed-deb startup/fault and physical ENOSPC matrix pending. |
| C02 | NOT_RUN | Candidate lifecycle/recovery package tiers pending. |
| C03 | NOT_RUN | Candidate source/browser/package family pending. |
| C04 | NOT_RUN | 100-device, 12-outing tracking soak and both package tiers pending. |
| C05 | NOT_RUN | GET-only reuse explicitly authorized by Donal on 2026-09-25; scoped preflight and exact-candidate ingest/source/display proof remain pending. |
| C06 | NOT_RUN | Stationary attention package tiers pending. |
| C07 | NOT_RUN | Four bound paging fixture profiles and installed-deb tier pending. |
| C08 | NOT_RUN | Four bound coverage fixture profiles and installed-deb tier pending. |
| C09 | NOT_RUN | Candidate GPX custody pending. |
| C10 | NOT_RUN | Strict replay, 960k/2m and 201-outing probes pending. |
| C11 | NOT_RUN | Candidate family/source/browser/package pending. |
| C12 | NOT_RUN | Earlier CI timeout retained; later exact-head development CI passed, but final-source candidate package run and sealed campaign receipt pending. |
| C13 | NOT_RUN | Candidate coordinate surface and golden oracles pending. |
| C14 | NOT_RUN | Candidate map/offline/rendered surface pending. |
| C15 | NOT_RUN | Original map correctly rejected; explicit derivative passed older-installer diagnostic only. Final candidate and installed-deb proof pending. |
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

Update: PR52 is merged at `b1bc51a2ed5e479b8eeaaf21b759001f2a208838`, CI36192361874 passed. Its repaired PR-CI AppImage C08 diagnostic passed 959,988 exact primary rows over 1,500 pages and 1,300 chunks, independent sequence oracle and cleanup. This does not change the final-campaign NOT_RUN rows above. Original-map failure and separately bound derivative diagnostics remain distinct.

Next: verify/review the staged-admission correction, create the now-authorized candidate tag/unpublished draft, obtain final release-workflow artifact provenance, arrange supported authenticated `.deb` installation, bind/rehash technical inputs, then execute applicable technical rows serially on Ubuntu. Donal clarified that controlled handover to Eamonn follows Ubuntu technical validation and final approval; C29 original-machine acceptance follows handover. No human signer is needed to start technical checks. Publication/distribution remain subject to final approval. Recheck affected/dependent rows if source changes.

## Bounded Ubuntu prerequisite follow-up — 2026-09-26

The clean Ubuntu preparation checkout is now at `2ff4d5742649da016a52c0e682f404d17df8c5dd`
(tree `611d8947b1a30ec8715c7f9e7c40f266ecd22e9f`), in the existing owned directory
`/home/donal/sartracker-beta13-final-2d4f436a`. Its pathname is historical, not source identity.
Beta13 and beta13.1 release attempts failed before a final installer/draft existed;
their source-CI packages are not qualification substitutes. Installation/runtime remain held.

The release-path audit's H1 check found no Ubuntu `gh` CLI. Under explicit bounded setup
authority, the official Linux amd64 GitHub CLI `2.101.0` was installed without sudo at
`/home/donal/.local/share/gh/gh_2.101.0_linux_amd64/bin/gh`, with a user-local
`/home/donal/.local/bin/gh` symlink. The archive SHA-256 was
`9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8`;
the official checksum-file SHA-256 was
`f8bbc37fc5568a6a162d1a67b1e9c1afa9139f7b5a46dcde4a57bdaa0db33b60`.
Both matched fresh official release metadata, and the archive also matched that checksum file.
Node successfully resolved `gh --version` with `/home/donal/.local/bin` prepended to PATH.

CLI authentication remains **FAIL**, separate from successful CLI installation:
supported GitHub token environment/configuration was absent, and redacted
`gh auth status` and `gh api` reads failed. The existing desktop Secret Service is
present. A single supported OAuth device flow was subsequently authorized and
started in a retained PTY, then canceled cleanly before any browser authorization
at Donal's request to reassess the need. No grant, duplicate flow, credential
transfer, insecure storage or policy change occurred. No credentials were read,
copied or searched beyond supported integration presence.

The subsequent bounded Ubuntu HTTPS probe supplied no credentials or cookies,
followed no redirects and downloaded no package payloads. At 08:36 UTC it observed:

| Official endpoint under `api.github.com/repos/donal0c/sartracker-web` | HTTP status |
| --- | --- |
| `/actions/runs/36225417118` | 200 |
| `/actions/runs/36225417118/attempts/1/jobs?per_page=100` | 200 |
| `/actions/runs/36225417118/artifacts?per_page=100` | 200; zero artifacts |
| `/actions/runs/36224020563/artifacts?per_page=100` | 200 |
| `/actions/artifacts/10900340922` | 200 |
| `/actions/artifacts/10900340922/zip` | 401; requires authentication |
| `/releases/368408426` (known beta12.10 draft) | 404 |
| `/releases/tags/electron-v0.1.0-beta.12.11` | 200 |

The reference source-CI artifact is not a final candidate; these are access checks
only. The beta12.10 draft's existence was separately confirmed by an authorized
Mac metadata read. Public provenance metadata does not itself require login;
the current controller's `gh api` transport does. Archive downloads and unpublished
draft access are genuine authentication boundaries, and C27 explicitly requires
fresh authenticated draft reads/transfers. Response headers confirmed the public
60-request/hour budget, with 52 remaining after eight probes. Native unauthenticated
metadata transport would need a reviewed source change and rate-aware execution;
no fake token, CLI wrapper or authentication bypass was used. The coordinator is
deciding whether a new account grant is required. The closed sanitized probe is
retained privately at `tmp/ubuntu-execution-20260926/public-github-access-probe.json`
in the Ubuntu preparation checkout.

H2 passed from Node with the existing explicit `DISPLAY=:0` and same-user Xauthority.
Bare SSH inherits neither display nor Xauthority. Every actual controller invocation
must explicitly supply current display authentication and the user-local CLI PATH;
availability in a separate probe is not an admitted campaign or package launch.

C27 is scheduled last and remains **unattempted** while known controls gaps would
yield `NEEDS_HUMAN_DECISION`; such a retained attempt cannot later be erased by PASS.
The 201 other technical variants may run when admitted. Optional risk authority,
signed acceptance and reviewed public-key digest are frozen at compilation and
cannot be inserted later. No waiver or repository settings change is authorized.
Campaign compilation remains held for the coordinator's waiver/live-controls disposition.

Final admission must freshly record the exact release artifact's `expires_at` and
remaining margin for serial checks, repeated input verification and soaks. It must also
compare `dpkg-deb -f <final-deb> Version` with the strict mapped candidate version,
then independently verify installed package status/version, canonical launcher and
payload. These artifact/install checks are **NOT_RUN**: no final replacement artifact
exists yet. Donal authorized administrator installation, with secure transient
credential handling owned by the coordinator; no further install permission is needed.

## PR54 two-test Linux diagnostic — 2026-09-26

At the coordinator's bounded request, the isolated checkout
`/home/donal/sartracker-pr54-focused-a92266f9` ran unchanged source
`a92266f92d8ef2aae20f6b83403e288b86c2e2c5`, tree
`0d8811107d83ca52cc2a19bddb9f24db720a309e`. Only
`mission-review.spec.ts:123` and `ui-feedback-batch.spec.ts:176` ran, with
`CI=1`, Chromium, one worker and zero retries. Both passed on their first attempt:
2,285 ms and 1,962 ms respectively; total 5,754 ms, exit 0, no skipped/flaky tests.
Testing stopped after this one run; the CI failures were not reproduced here.

First-attempt trace ZIPs and screenshots were captured for both tests and independently
hashed in `tmp/pr54-focused-diagnostic-20260926/closed-receipt.json` in the diagnostic
checkout. Copies under worktree 3226's matching `tmp/` evidence directory matched
all four retained SHA-256/size identities. The source remained clean, and no Node,
Chromium or port-1420 workload remained after completion. The temporary config
only added screenshots and an explicitly owned, non-reused Vite server.

Environment: Node 22.22.2, npm 10.9.7, Playwright 1.59.1, Chromium
147.0.7727.15, Ubuntu 24.04.2/kernel 7.0.0-28, 20 logical CPUs and about 31 GiB RAM.
GitHub uses Ubuntu 22.04; its full-suite predecessors and hosted-runner contention
were not reproduced by this focused idle-host run. This evidence neither diagnoses
the races nor qualifies a candidate. No app code, assertions, browser version,
final fixture, operational profile, package installation or campaign binding changed.
