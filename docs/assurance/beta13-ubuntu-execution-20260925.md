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

## PR54 instrumented roster navigation diagnostic — 2026-09-26

One coordinator-approved run used isolated checkout
`/home/donal/sartracker-pr54-nav-9b034092`, unchanged source
`9b0340921e6468f454bd8500803af41f5fbab3a6`, tree
`750444691da5f6dfa40175f5c678d1451e2554c4`. Astra's ignored diagnostic
bundle preserved the exact original roster test and normal setup from
`ui-feedback-batch.spec.ts`, including every assertion. Discovery listed one test;
execution used `CI=1`, one Chromium worker, zero retries, a fresh owned Vite
server and first-attempt trace/screenshot. The test passed, exit 0, reported
3.8 seconds. Testing stopped after this single attempt.

The retained CDP/browser attachment recorded one initial document request and
main-frame navigation, with one execution-context clearing at that initial
navigation. The Vite websocket recorded only `connected`; 343 script/document
requests started and finished. There were no failed requests, page errors,
subsequent navigation requests or outstanding requests at test end. Server
stdout/stderr is retained with the complete execution log. The screenshot shows
the active synthetic mission and available layer controls. This is a negative
reproduction result; it neither establishes the CI cause nor falsifies a
full-suite/server-lifecycle-dependent failure.

All 12 raw file copies matched remote SHA-256/size identities. Trace SHA-256:
`ed5e73beea3029253d12e4d3566ad8556e574321fb9531adfe0e7ce3eb25808e`;
execution log SHA-256:
`658de9e9ed8a00dc103125aa2d273914fa5024b15a1eb38781cc39f0bb2b7ac7`.
The closed receipt and extracted navigation events are retained under worktree
3226's `tmp/pr54-nav-diagnostic-ubuntu-20260926/evidence/`; raw originals remain
in the isolated Ubuntu checkout and `/tmp/sar-pr54-navigation-diagnostic-ubuntu.log`.
The source and bundle hashes stayed fixed, the source worktree remained clean,
port 1420 was free, and no Node/Chromium/Electron workload survived completion.
Environment matches the earlier diagnostic: Ubuntu 24.04.2, kernel 7.0.0-28,
Node 22.22.2, npm 10.9.7, Playwright 1.59.1, Chromium 147.0.7727.15,
20 logical CPUs and 33,303,224,320 bytes of physical RAM. GitHub Ubuntu 22.04
and full-suite predecessor/load conditions remain unrepresented. No candidate
qualification, source fix, package installation or campaign mutation occurred.

## Validation-installer archive diagnostics — 2026-09-26 evening

Donal authorized bounded Ubuntu diagnostics before final candidate admission.
These use validation workflow run `36255209914`, source
`09343ee94b8d4f4347da416fdb6596a83e08624c`, tree
`bba3dc8e0c74e7ca2ade28e92fdc3af9596c46b0`. Both Mac and transferred Ubuntu
installers matched the supplied full identities: AppImage
`6a7ac24ff242d521aa39d141ca57266d693ab51229228f86a00561ccae99804e`, Debian
`96f003907a5bbc325632ee8ff2b767cc7381da93d77397d847167f9458bb40c5`.
Both contain executable `6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`
and application archive `6f350c02f544b9351d6227dd000008034b69fbdef85499436c216b62f16583d2`.
Release and validation workflows may use identical filenames; provenance and
hashes identify the bytes. No final candidate campaign was compiled.

The isolated checkout `/home/donal/sartracker-archive-diagnostic-09343ee9`
remained clean at the exact source. Each package received one unchanged lifecycle
workload: 4,096 positions, 101 outing choices and 202 replay objects. Execution
used the existing CI launch flags and software-rendering environment
(`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`, `LP_NUM_THREADS=2`) on native
`DISPLAY=:0`, with same-user Xauthority. The strict 200 ms gate and 50 ms poll
cadence remained unchanged. No timing profiler or retry was added.

**AppImage: retained lifecycle failure, not a timing pass.** The exact AppImage
launcher used the existing inspected-resource sidecar and extract-and-run path.
At 17:38:42.678Z, after 33,088 ms, restart failed with “Packaged Electron exited
before renderer readiness.” Source flow and the retained process snapshot show
the restore interruption killed the launcher while actual Electron PID 38030
remained alive, adopted by the owned supervisor. The second launch exited;
single-instance rejection is a hypothesis because launch stderr was discarded.
The raw receipt claimed cleanup complete while actual descendants still existed.
Only the verified owned producer PID 38009 was then sent SIGTERM; the supervisor
positively reaped its descendants at 17:40:23.795Z. `cleanupVerified` and
`zeroDescendantsAfterRun` were true, both remaining-process arrays empty. No
AppImage retry occurred. The failure receipt retained no partial phase metrics,
so create/verify/restore timing cannot be presented as passing evidence.

**Installed Debian: one successful diagnostic.** The coordinator completed a
supported transient sudo installation, exit 0. Independent inspection confirmed
`install ok installed`, version `0.1.0~beta.13.2`, the canonical dpkg-owned launcher
and 140 payload entries against the verified installer. The direct installed
executable ran from 17:43:30.114Z to 17:44:10.253Z, duration 40,139 ms, with two
exact-build launches and exits. The harness and independent supervisor passed.

| Phase | Current-fix maximum ms | Main watchdog maximum ms | Renderer frame maximum ms |
|---|---:|---:|---:|
| Create | 109 | 91.482 | 40.300 |
| Verify | 86 | 57.832 | 45.600 |
| Restore | 138 | 68.739 | 53.000 |
| Cleanup | 173 | 56.798 | 28.200 |

Interrupted decrypt received SIGKILL, restart removed both retained plaintext
residual entries, and cleanup archived 5,516 rows with zero breadcrumb rows left.
All closed evidence/privacy checks passed. Producer exit 0, no timeout/error,
positive cleanup and zero descendants were recorded at 17:44:13.812Z; a separate
process/listener check found no remaining workload. No operational profile was used.

Raw receipts, invocations, runtime identities, process results and failure-process
snapshot remain under the isolated checkout's `tmp/ubuntu-archive-diagnostic/`.
Independently hash-verified copies are in worktree 3226's
`tmp/ubuntu-archive-diagnostic-20260926/{appimage,deb}/`. The original CI 201 ms
verify failure remains retained and unexplained. This hardware diagnostic neither
repairs it nor qualifies any final release artifact. AppImage lifecycle ownership
needs a bounded fix before that interrupted-restore path can be trusted. C27/C29,
publication and controlled-handover approval remain separate.

### Bounded archive-harness repair (local development)

The launcher-only interruption and launch-failure cleanup date to the original
smoke harness in `60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95`. That identifies the
source assumption, not a newly established first-bad installer or application
regression. The old harness assumed the spawned PID was Electron main and counted
its exit as cleanup; its tests did not model an AppImage wrapper with surviving
children. Outer producer cleanup also did not validate the inner receipt's claim.

A local disposable wrapper/child/grandchild regression first failed because
`processCleanupCompleted` was true while both descendants survived; an unrelated
sentinel stayed alive. The repair adds per-launch Linux subreaper custody, binds
the inspector main to PID/start identity, obtains its exact SIGKILL wait status,
and requires descendant reaping plus kernel ECHILD before positive cleanup.
Partial launches remain registered, and missing cleanup proof retains the private
profile. macOS uses a distinct direct-executable identity check and dedicated
group cleanup. The ordinary qualification process runner is unchanged.

Review found an unused inherited stderr pipe and a consuming wildcard wait;
red/green controls now require no app stderr pipe and a non-consuming WNOWAIT
exhaustion check. A separate mode-0600 `archive-launch-ownership.json` records
numeric identities and terminal outcomes. The decrypt trigger, material plaintext
oracle, workload, deadlines and strict 200 ms gate remain unchanged. Local tests
and review are development evidence. Full serial correctness passed 585 files,
6,053 tests and 27 skips in 583.27 s; final affected suites passed 212 tests with
one Linux-only skip on macOS, six Python identity controls passed, and lint/build
passed. Native read-only review found no remaining source blocker. Linux
process-tree execution and Sol's
subsequent exact-package AppImage diagnostic remain pending. No product behavior
or operator manual change is involved.
## Installed Debian coverage and replay scale diagnostics — 2026-09-26

The next authorized serial slice used the same exact `09343ee9` source and
installed validation executable/application archive identified above. Source,
dpkg version and both payload hashes were rechecked before each run. Existing
`compilePackageCommand`, producers and independent raw-file oracles were used
unchanged, behind the existing Linux subreaper. Each run used an exclusive owned
fixture copy and disposable, network-blocked profile; no campaign was compiled.

Both C08 coverage paging diagnostics passed the independent full-stream oracle:

| Fixture | Primary fix rows | Retained pages | Devices | Outings |
|---|---:|---:|---:|---:|
| 960k | 959,988 | 1,500 | 100 | 12 |
| 2m | 1,999,988 | 1,900 | 100 | 12 |

The twelve other generator rows belong to the separately inventoried legacy
mission. Original fixtures remained unchanged: 960k SHA-256
`dfe56dd10139ef0502773ab20e80c215556963fff309f871291099f03cc82b3a`,
2m `c90bbb553b59595048cff46c778fb5b6b31c2a9b528e4f6ec079620d8822b317`.
Producer exits were 0, both subreaper cleanup predicates passed, no descendants
remained and disposable profiles were removed. Independent validation completed
at 17:58:13.223Z and 18:09:43.214Z respectively. Screenshots were inspected:
the recovery shell and 100-device participant surface rendered; the deliberately
network-blocked basemap showed degraded tiles. This is exact IPC paging proof,
not rendered coverage, live tracking, or a 200 ms continuity measurement.

**C10 960k replay failed once; 2m replay was not attempted.** The empty
`live-before` lane passed. Ordinary `live-middle` continuation failed with
“Mission replay evidence changed while paging. Re-seek the selected time.”
This occurred before the producer's deliberate concurrent drawing write.
Actual runtime executable/application archive hashes matched the installed
validation package. The report and 57,071,289 bytes of partial raw pages were
retained; raw SHA-256
`a1bd71a67a9bc869364169f769da4845e0ba9320f559c5faad307b4d6c9ec435`.
Producer exit was 1, without timeout or supervisor error; application/profile
cleanup passed, both positive subreaper predicates passed and a separate process
check found no surviving workload. The original fixture remained unchanged.
There was no retry, producer edit or workload substitution.

Astra's read-only exact-source triage found three possible consistency guards
sharing this error: generation, eligible-position count, or total-track count.
Last successful middle-page metadata carried offset 182,000 to 183,000,
generation 1 and both counts 480,000. Root cause remains unknown; a failure-only
guard name and expected/observed integers would discriminate it. This failure
is separate from the AppImage ownership defect and original CI 201 ms risk.

All 12 first-scale and seven 2m retained evidence files were copied locally and
independently matched remote hashes/sizes. Originals remain under
`/home/donal/sartracker-archive-diagnostic-09343ee9/tmp/ubuntu-scale-diagnostic-20260926/`;
copies and custody manifests are in worktree 3226's corresponding
`tmp/ubuntu-scale-diagnostic-20260926/`. No qualification or release claim follows.

## Field archive diagnostic fixture rejection — 2026-09-26

After both coverage runs closed, the coordinator authorized one independent
installed-Debian field archive/restore diagnostic. The unchanged existing
`composite-large-archive-probe.mjs` was selected through reviewed C20 scenario
`streamed-archive`, fixed producer variant `field-archive-37gb`, with its generated
`field` fixture and unchanged 60-minute timeout. Source, package and payload
identities remained those above. Preflight recorded 96,382,918,656 available
bytes against the producer's conservative 68,719,476,736-byte minimum.

An initial controller command preflight rejected my incorrect outer scenario
name before producer launch. Its log was retained; correcting the outer name
selected the same fixed reviewed producer. The single actual producer attempt
ran from 18:11:22.991Z to 18:13:51.536Z, then failed before Electron launch:
“Paging fixture primary mission is missing or ambiguous.” No archive, restore,
all-table comparison or runtime timing was exercised. No retry or fixture
substitution occurred.

The retained generated fixture is 3,718,189,056 bytes, SHA-256
`bbb7790172e377ef749013ab366f163a6268e3ca2e3fdacbf542a2b606c5e1f7`;
its private oracle copy independently matches. Generator version 2, preset
`field`, schema 13 reports 32 devices and 1,520,000 positions. An immutable,
read-only query confirmed one active mission with start time
`2026-01-01T00:00:00.000Z`; all 1,520,000 positions have `timestamp_source NULL`.
The production probe's `selectPagingSource(C07)` accepts only `timestamp_source
= 'fix'`, so its primary eligible count is zero. This confirms a generated
fixture/selector incompatibility before application execution; it establishes
neither an archive product defect nor the cause of the separate C10 failure.

Producer exit 1, no timeout or supervisor error, positive supervisor cleanup
and zero descendants were retained. The profile is absent, the failure receipt
has no observed userData path or application launch, a separate process check
found no workload, and the exact source tree remained clean. Both 3.7 GB source
files remain remote. Seven small failure/invocation/process/manifest/query/log
files were mirrored locally and independently hash/size verified under
`tmp/ubuntu-field-archive-diagnostic-20260926/`, with their custody manifest.
Remote originals are under the same named directory in the isolated Ubuntu
checkout. Both affected replay and field archive paths are held for source-owner
triage. Independent coordinate, IPC and synthetic settings diagnostics are the
next useful bounded slices; none was started in this chunk.

## Independent installed Debian safety diagnostics — 2026-09-26

The coordinator subsequently authorized serial C13 coordinates, C23 IPC
containment and C16 synthetic settings diagnostics. Each run rechecked exact
`09343ee9` head/tree, clean source, installed package version and executable/
application archive hashes above. Existing reviewed compiler variants and
producers/oracles remained unchanged, with fixed 15-minute timeouts, no retries
and task-owned network-blocked profiles. C13 retained its internal Linux launch
flags; C23/C16 used their supported repeatable `--app-arg` interface for the same
software-rendering launch flags. No provider or operational credentials were used.

All three passed the existing independently recomputed validators:

- **C13:** golden DD/Irish Grid/DMS conversions, visible rejection of NaN,
  Infinity and out-of-range latitude, magnetic bearing label, persisted/rendered
  geometry identity and independent map-measurement math. The retained line was
  2,000.000000001 metres at 94.50000000000074 degrees. Validation completed at
  18:18:53.132Z. All four screenshots were inspected: golden conversion,
  rejection, magnetic bearing and rendered bearing/measurement overlay are
  visible; the intentionally blocked basemap remains degraded.
- **C23:** all eight source/app identity, secure web preferences, renderer
  isolation, invalid sender, invalid payload, capability and no-operational-data
  predicates passed. Validation completed at 18:19:14.100Z.
- **C16:** all seven identity, undecryptable-secret startup recovery,
  save/restart read-back, authoritative clear/restart, re-entry/restart,
  embedded-URL-credential rejection and custody predicates passed. Validation
  completed at 18:19:52.167Z. Three screenshots were inspected: the actionable
  warning and URL rejection are visible; saved settings show auto-connect off.
  Receipt/read-back evidence supplies the persisted/restart claims. No real
  provider authentication, network availability or operator credentials were
  exercised.

Each producer exited 0 without timeout/error; positive subreaper cleanup and
zero descendants passed, and separate process checks found no workload. C13
and C23 removed their own profiles. C16 intentionally retains synthetic userData
in its producer; after preserving successful sanitized receipts, the controller
verified the exact task-owned directory and removed it without reading/copying
credential values. A separate cleanup receipt confirms absence. No operational
profile was touched.

All 23 small raw receipts, invocations, process/cleanup results, independent
validations, screenshots and logs were copied locally and independently matched
remote SHA-256/size identities. Originals remain under the isolated Ubuntu
checkout's `tmp/ubuntu-independent-safety-diagnostic-20260926/`, with copies and
custody manifest in worktree 3226's matching directory. These are bounded
installed-package diagnostics, not campaign, operational or release proof.
The C10 continuation failure, field fixture incompatibility, AppImage ownership
defect and original CI 201 ms failure remain separate unresolved work.

## Independent lifecycle and export-privacy diagnostics — 2026-09-26

The next authorized slice used unchanged reviewed C02 `graceful-close` and
C17 `family-contract` producers on the same exact source/package, with fresh
small synthetic profiles and fixed 15-minute limits. C02 does not use the
AppImage wrapper, replay continuation or field selector. C17's scoped family
returns after sanitized export, before the unrelated coverage/replay/archive
journey. No source edits, retries or final campaign admission occurred.

**C02 is a retained independent-validator rejection, despite producer PASS.**
The graceful-window close was observed; PID 55339 exited 0 without a signal.
Recovery PID 55466 matched both package hashes and the same disposable profile.
The raw recovery state nevertheless reported `uncleanShutdown: true`,
`lastCrash: null`, and a visible recovery notice; the mission changed from active
to paused. Both recorded closes exited 0. The producer emitted `result: pass`,
but the existing `validateC02LifecycleReceipt` rejected the observation with
“C02 graceful close was classified as unclean.” Its expected value is false.
This cannot be accepted as a passing diagnostic. Source/harness/policy cause
remains unconfirmed. Reload was not attempted because the related lifecycle
lane is held; no blind retry followed.

**C17 passed its scoped independent privacy validator**, with no coverage gaps
or failure reasons. The fixed source adversarial corpus passed three tests
across renderer and Electron-main boundaries, covering ten corpus case IDs.
The packaged export retained all thirteen positive canary controls, leaked
canary IDs were empty, and the existing bounded scanner compared all 3,915
export bytes against the retained copy. Output SHA-256 is
`870f61e948ca51dee568ddee3e92d8f5388fe52ad3b7f5dd7712430dab98cf9e`.
Independent validation completed at 19:01:30.227Z. This scoped sanitized-export
result neither clears C02 recovery nor represents a full operational workflow.

Both producers exited 0 without timeout/error; both positive supervisor cleanup
predicates passed and independent process checks found no remaining workload.
Profiles were removed, source remained clean, and no real provider or credentials
were used. Twelve small raw reports, commands, process results, logs, oracle/
source-corpus records and retained export/canary files were copied locally and
independently hash/size verified. Their custody manifest is
`tmp/ubuntu-independent-safety-diagnostic-20260926/lifecycle-privacy-closure-file-identities.json`.
The exact retained 117,289,870-byte application archive remains remote with its
already-bound SHA-256. Originals remain in the isolated Ubuntu checkout's
matching directory. Runtime is available for reviewed process-ownership fix
proof; no further heavy diagnostic was selected.

## PR55 patched native process-ownership proof — 2026-09-26

Astra independently accepted patched head
`5f546b454db6ebc9eec9dfa079c360960a3c661a`, tree
`9638ef337c4b61a2aadce8f56ff749bd4028fb0e`, for bounded native proof.
The supplied Git bundle SHA-256
`c54b82c5dbb21c163f618c3205d9c350f2bf683546e266ffbe83640e0ae4966b`
matched on Mac and Ubuntu. Its prerequisite is the existing exact `09343ee9`
source; import produced an isolated detached checkout at
`/home/donal/sartracker-pr55-ownership-5f546b45`. Package manifest/lock were
unchanged, so existing 093 dependency bytes were reused without installation.
The installed 093 Debian product remained unchanged.

Both supplied commands ran once under the existing independent Linux subreaper:

- `python3 -B tests/unit/archive-launch-supervisor-regression.py`: 13 passed.
- `npx vitest run tests/unit/archive-launch-ownership.test.ts`: six passed,
  three Mac-only tests skipped; total 1.28 seconds.

The real Linux fixtures asserted wrapped-child/grandchild cleanup while an
unrelated sentinel remained alive, actual direct-main SIGKILL status, partial
launch cleanup and unrelated-main rejection. Both outer commands exited 0,
without timeout/error; positive cleanup and zero-descendant predicates passed.
External process inspection found no fixture runtimes and source stayed clean.
Seven raw invocation/process/log/closure files were mirrored locally and
independently hash/size verified in `tmp/pr55-native-diagnostic-20260926/`.
This proves the patched native fixture slice, not a new packaged executable.

The unchanged archive harness uses the same `--expected-head` for clean source
and visible packaged version. A mixed 5f harness/093 AppImage invocation would
be rejected and was not attempted. Astra supplied the already-built matching
5f CI installer from run `36265017480` for the separately authorized single
4,096-position AppImage lifecycle diagnostic below. No identity guard was overridden.

## Matching PR55 AppImage lifecycle diagnostic — normal exit unresolved

The matching CI validation AppImage from run `36265017480`, installer artifact
`10913855885`, is 157,874,024 bytes, SHA-256
`18fbcb60882fb64acb719c665631c1300a572cc36cf45a18f7b3632e2592c605`.
CI evidence artifact `10913965843` binds the exact 5f head/9638ef tree, clean
pre-build source, and only the expected generated-version change after build.
The application archive SHA-256 is
`72197fd9e47fa276490bfc33e92259e8ada68eafcad334a9f991b78348b43d1c`;
Electron executable SHA-256 remains
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`.
Installer and CI records were independently verified on Mac and Ubuntu. The
existing runtime helper prepared a byte-identical AppImage launcher and inspected
resources sidecar; extraction was inspection, not substituted launch evidence.
The installed 093 Debian package was not replaced.

The single authorized attempt used source and visible package head 5f, the
unchanged CI flags/software-rendering environment, 4,096 positions, 101 outing
choices, 202 replay objects, 50 ms compressed poll cadence and strict 200 ms
gate. It ran from 19:19:19.818Z to 19:20:02.529Z, duration 42,711 ms. Existing
lifecycle/timing oracle returned PASS, with no failure reasons:

| Phase | Current-fix maximum ms | Main watchdog maximum ms | Renderer frame maximum ms |
|---|---:|---:|---:|
| Create | 104 | 64.276 | 46.500 |
| Verify | 110 | 56.760 | 61.600 |
| Restore | 167 | 85.486 | 54.500 |
| Cleanup | 174 | 103.034 | 30.700 |

Interrupted decrypt now bound and killed actual Electron PID 58793 with retained
`SIGKILL` status, distinct from launcher PID 58792. Ownership cleanup passed.
Restart PID 59042, launcher 59041, removed both retained plaintext entries.
Final cleanup archived 5,516 rows with zero breadcrumbs remaining; immutable
review counts/content matched before and after cleanup, privacy scan found zero
exact-secret matches, and final plaintext residue count was zero. Source and
rendered build identity matched the exact head.

**The normal terminal exit is unresolved.** The separately retained ownership
receipt records the second main process exiting with `code: null`,
`signal: SIGTRAP`, `interrupted: false`, despite `cleanupVerified: true`.
That is not a clean exit. The lifecycle oracle still passed, and the outer
producer exited 0 with empty stderr, but neither fact explains the SIGTRAP.
The unexpected terminal status was immediately escalated to Astra/CoS before
merge judgment. No retry, threshold relaxation, silent identity override or
release qualification claim followed. The original 093 AppImage failure and
original CI 201 ms evidence remain retained.

Outer positive subreaper cleanup and zero descendants passed; independent
process inspection found no workload, source remained clean, and final disk
headroom was 87,207,034,880 bytes. The owned lifecycle evidence directory has
only the closed lifecycle report and ownership JSON; no retained crash/exit
logs there explain the status. Eleven small raw/CI/input/invocation/runtime/
process/ownership/lifecycle/closure files were mirrored locally and independently
hash/size verified under `tmp/pr55-appimage-diagnostic-20260926/`. Original
installer, launcher and inspected payload remain remote and were rehashed at
closure. Runtime is idle; normal-exit triage is outstanding.

### Corrected C02 window-close diagnostic — producer error retained

One reviewed source `8b71fb5493a28caed2e8bb0bd17e7efc395ea34a`
(tree `28d0a8132374cef2ff61d18b3478946f2ea65ad8`) window-close attempt
used the unchanged installed 093 Debian executable/ASAR identities. The existing
C02 interface binds harness source and application bytes separately; no identity
guard was overridden. The original app.quit/unclean-recovery failure remains
separate and retained.

The producer exited 1 with an unhandled Playwright `ProtocolError`:
`Page.handleJavaScriptDialog: No dialog is showing`. It wrote no lifecycle
receipt, so neither graceful exit, shutdown-marker state, recovery behavior nor
the independent lifecycle oracle has an accepted result. The failed profile is
retained remotely; no retry or reload followed. This is an observed automation
failure, not proof of a product shutdown defect or a passing corrected close.

Outer process custody reported positive cleanup and zero descendants; independent
process inspection confirmed no owned survivors and clean source. Four small
invocation/process/log/external-closure files were mirrored and hash/size verified
under `tmp/c02-window-close-diagnostic-20260926/`, with a separate identity manifest.
The external closure includes existence-only checks for two named files after
forced cleanup; these are not the producer's shutdown-marker receipt and carry
no lifecycle conclusion. Astra/CoS received the primary failure immediately.

### Reviewed field-selector diagnostic — fixed deadline exhausted

One causally justified attempt used reviewed selector source
`16768356c1b75b8e9fa38fdaf4d5934676a90a72`, tree
`0722153864561c22102e43238993560900d4351b`, bundle SHA256
`16bb4eb369fcd05125b8aa1b6a63463c18950f52779a9211b52875b356febda8`.
The isolated checkout was clean, dependencies unchanged, and the producer's
existing source/app identity separation was inspected. Installed 093 executable
and ASAR hashes remained unchanged. The original field generator, fixed
`field-archive-37gb` variant, independent table oracles and 3,600,000 ms deadline
were retained. Initial headroom was 86,375,186,432 bytes. The earlier fixture
rejection remains retained; no replacement paging fixture was substituted.

The selector passed the earlier preflight boundary and the packaged application
launched. A prearchive snapshot was retained, but no ciphertext was observed
during bounded monitoring. At the original 60-minute deadline, owned-process
custody terminated the producer with `SIGKILL`, reporting `timedOut: true` and
`Owned process exceeded the 3600000-ms timeout.` Outer controller exited 1;
stdout/stderr were empty. No closed producer receipt exists, so no archive,
restore or all-table preservation result is accepted. Sustained main-process CPU
was observed; the actual stalled operation and cause were not established.

Donal's stop instruction arrived after this attempt began. No further workload
or retry was started; the existing bounded operation was allowed to reach its
terminal deadline and owned cleanup. Positive cleanup and zero descendants
passed, with independent process inspection confirming no owned survivors and
clean source. Both installed payload hashes were rechecked unchanged.

The failed profile and databases remain remote. Source and private oracle copy
are each 3,718,189,056 bytes with SHA256
`bbb7790172e377ef749013ab366f163a6268e3ca2e3fdacbf542a2b606c5e1f7`,
identical to the first attempt's fixed fixture. The prearchive snapshot is
3,718,193,152 bytes with SHA256
`913327a08dbc0d7ee820064ce1f99a14c8dd2005ad621739074b3d9ee59f734f`.
Final headroom was 67,760,926,720 bytes. Five small raw invocation/process/log/
manifest/closure files were mirrored and hash/size verified under
`tmp/field-selector-diagnostic-20260926/`, with a separate identity manifest.
This is a retained diagnostic timeout, not qualification. Runtime is idle;
further investigation requires renewed direction.

After renewed authorization, bounded read-only triage confirmed the retained
prearchive mission row is `finished` and its archive registry is empty. The
retained runtime log records backup completion at `2026-09-26T19:40:06.993Z`
after 107,193 ms, with 114 main-event-loop summaries continuing through
`20:35:46.806Z`. The maximum recorded delay was 895 ms at `19:40:50.286Z`,
with later delays also over 200 ms. These overruns are retained; they are not
attributed to an archive phase by this evidence. Continuing summaries rule out
a complete main-event-loop freeze, while prearchive completion alone cannot
distinguish subsequent producer inspection from product issuance/finalization
awaits. No stage checkpoint or archive event in the retained records resolves
that boundary. The 24,033-byte runtime log was mirrored with verified SHA256
`b81f460aa8975c14a2b99c68e0c583da7a7994c0623d05801ab52c93adeecca4`.
No heavy runtime, live-profile mutation or repeat followed this triage.

### Integration assessment after PR55 merge

Donal merged reviewed head5f at6a29a57a; exact-head CI36265017480 passed.
Source review confirmed the retained SIGTRAP is actual main-process status during
the harness's forced teardown, not a graceful-window-close assertion. It remains
unexplained and separate from C02; ownership cleanup proof is accepted within scope.
The reviewed C10 diagnostic and field-selector changes are now integrated for a
testing build. Field preflight is repaired, but its later60-minute timeout is not.
Read-only retained evidence shows mission finish and backup completion followed
by continued watchdog summaries; maximum observed delay895ms is retained, without
per-archive-stage attribution. No fresh field workload or blind retry is authorized.
The C02 partial observer patch remains outside this integration. No release or
whole-candidate qualification follows these source and diagnostic results.
