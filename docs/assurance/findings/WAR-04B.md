# WAR-04B — release integrity, dependencies, and repository controls

## Verdict

**Current-base release decision: HOLD.** The exact audited base must not be used
to cut or promote another field candidate. Two dependency findings are directly
release-blocking:

1. Electron `40.10.0`, which is the shipped desktop runtime, reached end of life
   on 2026-06-30.
2. `electron-builder@26.0.12` resolves `app-builder-lib@26.0.12`, whose generated
   AppImage launcher is affected by `GHSA-7g7r-gx96-252g`.

The source and lockfile were not changed by this investigation. No production,
dependency, workflow, release, tag, publication, or GitHub-setting mutation was
made. This report is evidence for a controlled remediation and qualification
sequence; it is not release proof and does not authorize remediation.

The latest published internal beta remains a historical, unsigned, non-immutable
prerelease. Its live hashes and identity were internally consistent at the audit
snapshot, so WAR-04B did not find evidence that it was altered. That does not
clear the blockers above or make the beta a current-base or field candidate.

## Scope and proof boundary

| Item | Value |
| --- | --- |
| Audit date | 2026-08-30 |
| Exact base | `3d0d36b3874947d3d620bdb5262d9cd2d7233fcf` |
| Base authority | fetched `origin/master`; local `HEAD` and `origin/master` matched before evidence collection |
| Branch | `codex/war-04b-release-integrity-audit` |
| Pull request | [#9](https://github.com/donal0c/sartracker-web/pull/9) |
| Dependency inputs | exact `package.json` and lockfile v3; no install or lock mutation |
| Live repository | `donal0c/sartracker-web`, read-only API snapshot at 2026-08-30T13:22:43Z and central refresh later that day |
| Existing artifact | one bounded inspection of the published beta.12.11 `.deb`; no second artifact inspected |
| Excluded | production/private systems, credentials, real operational data, private maps, exploit development, dependency changes, package/config/workflow changes, release activity, and cross-machine qualification |

Proof tiers follow `docs/assurance/README.md`. Repository/configuration and
package-graph inspection is `T0/T1`. The one already-published `.deb` inspection
is historical `T4` only for beta.12.11. No current-base artifact was built or
inspected, and no claim below is production or field proof.

WAR-04 PR #8 was read in full to avoid overlap. Its map/settings/privacy findings
remain separate and are neither duplicated nor cleared here. The active archive
lifecycle work was inspected read-only only for a future refresh boundary; it is
unmerged and mutable.

## Dependency and runtime snapshot

The lockfile contains 898 resolved package entries. Every resolved entry has an
integrity value. Of those entries, 897 resolve from the npm registry and
`@electron/node-gyp@10.2.0-electron.1` resolves to the content-addressed upstream
commit `06b29aafb7708acef8b3669835c8a7857ebc92d2`. The snapshot hashes are:

- `package.json`: `db3cfef9c1273193c3381ee5c837e5fbc2c5a2a32ddd7d066fdf421177452e6c`
- `package-lock.json`: `0127526b35829794af69db4b817f6fd581c0f8045973517618e8d171af999fef`

`npm audit --omit=dev --json` reported zero vulnerable package records across
238 production dependencies. The full `npm audit --json` reported 24 vulnerable
package records: 1 low, 22 high, and 1 critical, with 50 unique advisory URLs.
The four direct records were `electron`, `electron-builder`, `postcss`, and
`vite`.

Those counts are inputs, not verdicts. In this repository npm's production/dev
partition is not a shipped/runtime partition: Electron is declared as a
development dependency but its binary is the application runtime, while the
builder is a development dependency whose generated AppRun script ships inside
the AppImage.

### Relevance table

| Dependency group | Exact path or version | Release-path role | Classification and consequence |
| --- | --- | --- | --- |
| React, MapLibre, Turf, `geojson-vt`, `saxes`, `vt-pbf`, `proj4`, Zustand and other production JavaScript | direct `dependencies` and transitive graph | bundled renderer/application code | `cleared` against the npm advisory snapshot: the production-only audit found zero records. This does not clear Electron/Chromium or builder-generated runtime code. |
| `better-sqlite3@12.10.0` | direct production dependency | shipped native SQLite module; rebuilt for Electron target | `cleared` for known npm advisories, but compatibility qualification remains open. Upstream Electron 42 PR #1475 is no longer blocked: it merged and shipped in `12.10.1`. |
| `electron@40.10.0` | direct dev dependency; Chromium `144.0.7559.236`, Node `24.15.0`, V8 `14.4.258.32` | shipped application runtime | `confirmed`: unsupported/EOL runtime. Two audit advisories are separately cleared for current code paths below, but unsupported Chromium/Electron servicing remains release-blocking. |
| `electron-builder@26.0.12 -> app-builder-lib@26.0.12` | direct builder dependency and exact transitive | creates AppImage and `.deb`; generated AppRun ships in AppImage | `confirmed`: AppImage path is affected by `GHSA-7g7r-gx96-252g`; `.deb` is not affected by that specific advisory. |
| `electron-builder -> app-builder-lib/@electron/rebuild -> @electron/node-gyp -> tar@6.2.1` | packaging/native rebuild graph | release-production build input | `confirmed exposure`, not a compromise claim: vulnerable archive handling is reached when release builds fetch/unpack build inputs. A malicious archive can exhaust resources or escape intended extraction boundaries, but the integrity lock and expected upstream downloads constrain input. |
| `electron -> @electron/get -> extract-zip@2.0.1` | Electron install graph | build/install only | `confirmed exposure`, not shipped app code: affected symlink handling is invoked while extracting Electron downloads. Embedded checksums materially constrain input. A maintained Electron line removes this dependency path. |
| `builder-util-runtime` credential-redirect advisory | builder/update graph | updater/provider helper | `cleared` for this repository's path: there is no `electron-updater` or `autoUpdater`, packaging uses `--publish never`, and the guarded publisher is separate. |
| Vite, PostCSS, Babel, YAML, brace expansion, nanoid | build/dev graph | repository-controlled source transformation | `cleared` as a shipped-runtime claim. The audited release path does not feed attacker-controlled build source to these packages. Upgrade and re-audit them after release-bearing seams. |
| jsdom/undici and test packages | test graph | deterministic test inputs | `cleared` as a packaged-runtime claim; absent from the inspected historical package. |
| dmg, Squirrel, Flatpak and publish-only transitive packages | unused platform/target paths | not used by the current Linux AppImage/`.deb` release path | `cleared` for the supported Linux path; do not extrapolate to future Windows/macOS/Flatpak lanes. |

## Confirmed findings

| ID | Finding and evidence | Practical consequence | Current containment | Smallest repair boundary |
| --- | --- | --- | --- | --- |
| `WAR04B-C01` | **AppImage launcher search path is vulnerable.** `electron-builder@26.0.12 -> app-builder-lib@26.0.12`; [GHSA-7g7r-gx96-252g](https://github.com/advisories/GHSA-7g7r-gx96-252g) affects `<26.15.0`. `electron-builder.json` targets AppImage, `scripts/electron-package.mjs` invokes the builder, and both release workflows execute that path. | If an attacker can place a malicious shared library in the directory from which a generated AppImage is launched, the empty search-path component can load it with the operator's privileges. The published beta.12.11 AppImage was built with the same affected versions. This finding does not apply to the `.deb` format. | Internal-only status, trusted-machine boundary, and avoiding launch from writable/untrusted directories reduce exposure but do not repair the generated launcher. | Do not promote another AppImage from this builder. Upgrade the builder in isolation to an exact reviewed 26.x version at or above `26.15.0`, regenerate/review the lock, inspect AppRun, launch from an ordinary user-writable directory, and re-run native/package/hash gates. |
| `WAR04B-C02` | **Shipped Electron runtime is unsupported.** The lock selects Electron `40.10.0`. Electron supports only its latest three stable majors; Electron 40 reached EOL on 2026-06-30. At the snapshot, supported majors were 42–44. See the [Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines), [schedule](https://releases.electronjs.org/schedule), and [40.10.0 runtime versions](https://releases.electronjs.org/release/v40.10.0). | Chromium/Electron/embedded-Node security and correctness fixes are no longer promised for the shipped line. This blocks the next candidate even though the two named Electron audit advisories are not reachable through current code. | Electron `40.10.6` would close the named ProtocolResponse record and remove the affected extraction package, but remains EOL and is only a short-lived containment option. | Select a currently supported Electron line at implementation time and qualify the whole Electron/Chromium/Node/native seam. Do not call a patch within Electron 40 the final repair. |
| `WAR04B-C03` | **Full-audit release relevance is not gated.** Neither `beta:verify` nor the release workflows run a full dependency audit/reachability check. The clean production-only audit omits both C01 and C02 because of dependency classification. | A release can pass existing gates while shipping an unsupported runtime or affected builder-generated launcher. Blindly failing on advisory counts would create the opposite error by treating unused test/platform packages as field exposure. | Manual WAR-04B reachability review. | Add an always-run inventory that records both production and full audit results and requires explicit packaged/runtime/build/test classification for release-bearing records. Do not use `npm audit fix` as the gate. |
| `WAR04B-C04` | **Release-production archive tooling is affected.** `tar@6.2.1` is reached through builder/native-rebuild paths and includes critical [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw); `extract-zip@2.0.1` is reached during Electron install and is affected by [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv). | A malicious build archive can exhaust the build host or escape the intended extraction boundary. No hostile archive, compromise, or shipped runtime use was found. | Lock integrity, upstream-origin expectations, Electron download checksums, and ephemeral hosted runners constrain the input and persistence opportunity. | Clear these paths through the isolated builder/Electron update steps, regenerate the lock, re-run both audits, and retrace the exact graph. |
| `WAR04B-C05` | **Published-release immutability is not enforced.** Beta.12.11 reports `immutable:false`; there is no `electron-v*` tag ruleset; the tag and target commit are unsigned. The guarded publisher strongly checks the draft twice, peels the tag before/after, verifies exact asset metadata and fresh hashes, and refuses published clobbering—but it is a voluntary local path and cannot protect bytes after publication. The exact-base release guide and beta source note incorrectly called the tag immutable; this branch corrects that source wording without mutating the live release. | An authorized or compromised account can move/delete the tag or change/delete published assets after the publisher's final observation. Co-located `SHA256SUMS` detects transfer mismatch only when a trusted copy is already available; it does not establish independent origin. No such mutation was observed. | Exact release notes, fresh-download hashes, retained prior artifact, internal-only unsigned posture, and manual publisher discipline. | Enable [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) before the next publication; add a compatible tag ruleset; keep the guarded publisher. Do not move or reuse the historical tag. |
| `WAR04B-C06` | **`master` and release-bearing changes have no server enforcement.** Live state: `master protected=false`; branch-protection endpoint absent; zero repository/effective rulesets; no required review, latest-head approval, conversation resolution, status check, force-push or deletion guard. The exact master SHA had no check runs/statuses. The PR validation path filter omits `.github/workflows/electron-release.yml` and packaged `field-tools/**`. | Direct or force mutation, or a PR changing uncovered release inputs, can reach release source without a technical review/check boundary. Human discipline and event-triggered CI are bypassable. | Default workflow token is read-only and cannot approve PRs; the release job alone raises `contents:write`. Existing PR review practice remains useful but unenforced. | First add an always-emitted release-policy check covering all release inputs. Then apply a small `master` ruleset requiring PR, one independent latest-head approval, resolved conversations, that named check, and blocked force-push/deletion. |
| `WAR04B-C07` | **Workflow inputs and security visibility are under-controlled.** Every current action is GitHub-owned, but references use mutable `actions/*@v4`; Actions allows all actions and does not require SHA pinning. Secret scanning, push protection, non-provider patterns, validity checks, Dependabot alerts/security updates, and CodeQL are disabled or not configured. Disabled endpoints make alert counts unobservable, not zero. | An action tag or build environment can drift; known dependency/secret/static findings may not be surfaced before merge. | Only GitHub-owned actions are currently referenced; global workflow permissions default read-only. | Pin verified actions to full commit SHAs, restrict the allowlist, enable Dependabot alerts without automatic upgrades, enable secret scanning/push protection, and establish CodeQL baseline before making it merge-blocking. GitHub calls a full SHA the only immutable action reference in its [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use). |
| `WAR04B-C08` | **Cryptographic provenance/SBOM is absent and the build environment floats.** There is no artifact or release attestation, no packaged-dependency SBOM, and no signing/notarization. Node is pinned only to major 22; runner image, npm, apt/compiler inputs, and action tags float. Node 22 itself remains Maintenance LTS through 2027-04-30. | Release notes and hashes identify observed bytes but cannot cryptographically tie them to a workflow/source/build recipe, enumerate the packaged graph, or reproduce every native byte. Unsigned artifacts cannot be OS-authenticated to Donal. | Explicit internal/shadow-only note, no auto-update, exact asset hashes, native ELF inspection, and retained rollback artifact. | After immutable releases and exact build controls, attest the exact installers, create and attest a packaged-dependency SBOM, verify both in promotion, and capture runner/Node/npm/toolchain/native-module identity. Signing remains a separate authorization/qualification decision. See [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations). |
| `WAR04B-C09` | **Private-data exclusion checks do not cover the actual package boundary.** The builder uses a narrow allowlist, but `asar:true` hides packaged files from the workflow's ordinary filesystem `find`. That guard only rejects `.mbtiles`, `*discovery*`, and `mountainrescue_org*`; it does not enumerate generic credentials, profiles/databases, archives, fixtures, or raw evidence. `field-tools/**` is copied by wildcard. | A future allowed-path addition or generated file can enter `app.asar`, `app.asar.unpacked`, or extra resources without this guard seeing the relevant filename. This is a confirmed control-coverage gap, not evidence that private material is currently packaged. | Tracked-name scan was clear except excluded `.env.mock`; the build allowlist excludes docs/tests/tmp; historical beta.12.11 `.deb` inspection found no known private filename and exactly three intended field tools. | At the exact candidate, generate a manifest for ASAR, unpacked files and extra resources; enforce explicit private-map, credential, runtime DB/profile, archive/ZIP fixture, verification-output and raw-evidence exclusions; enumerate allowed field tools without reading or printing secret contents. |
| `WAR04B-C10` | **Release/support documentation overstates enforced state.** The exact-base release guide and beta.12.11 source note called tags immutable; this evidence branch corrects those two active statements, while the live release is deliberately unmodified. The desktop support policy still describes Windows CI/release and platform support not present in the Linux-only workflow, and treats dev dependencies as low release priority despite Electron/builder being release-bearing. | Operators or maintainers can mistake procedural intent or historical lanes for current technical enforcement and qualification. | Release notes explicitly say current artifacts are unsigned/internal and not approved for live incidents. | Reconcile the remaining support policy with live workflow and selected controls. Retain the existing `PKG-002` owner rather than creating a duplicate platform finding. |

## Hypotheses and unproved claims

| ID | Hypothesis | Evidence for/against | Required settlement |
| --- | --- | --- | --- |
| `WAR04B-H01` | The exact current base packages a private map, credential, mission database, archive fixture, or operational evidence. | No tracked filename matched the private categories; the builder allowlist is narrow; the historical `.deb` was clear. Against that, the current base adds dependencies and `shared/**` packaging after beta.12.11, the ASAR boundary is not inspected, and no current-base artifact was opened. | Inspect the exact final-candidate ASAR/unpacked/extra-resource manifest with no content or secret disclosure. Until then current exposure is **unproven**, not confirmed or cleared. |
| `WAR04B-H02` | A release build has processed a hostile archive or the historical beta was compromised. | No hostile input, compromise evidence, unexpected live asset, digest mismatch, publisher bypass, or post-publication mutation was found. Vulnerable build behavior and mutable controls establish exposure, not an incident. | Preserve build logs/hashes and investigate only if concrete provenance or integrity evidence appears. Do not manufacture a proof of concept. |
| `WAR04B-H03` | The remaining 24-record full audit implies 24 shipped exploitable defects. | Graph tracing clears multiple records as unused platform, build-only controlled-input, test-only, updater-only, or absent API paths. Two release blockers and two conditional build-input paths remain. | Repeat the same reachability classification after each controlled lock change; never use the count alone as a release verdict. |
| `WAR04B-H04` | The unmerged archive-lifecycle implementation leaves dependency/release posture unchanged. | The remote branch still points to `eec92812b783a795c093f37268b295dd2179a3af`. Its local uncommitted implementation currently changes no package, lock, builder, release-workflow, package-wrapper or publisher path, but it is large and mutable. | Run the exact post-PR6 checklist below against the merged SHA. Current inspection is a forward-risk note only. |
| `WAR04B-H05` | Windows, macOS, installed `.deb`, AppImage and long-duration behavior are equivalent after upgrades. | No WAR-04B cross-platform/scale/package matrix was authorized. Existing evidence is historical and platform-specific. | WAR-12/final qualification owns the exact candidate matrix. |

## Cleared and positively controlled items

| ID | Cleared claim or positive control | Evidence and limit |
| --- | --- | --- |
| `WAR04B-K01` | Current production JavaScript graph has a known npm advisory. | Cleared at the 2026-08-30 registry snapshot: `npm audit --omit=dev --json` returned zero. This excludes Electron/builder classification errors noted above. |
| `WAR04B-K02` | Electron sandboxed-iframe advisory is reachable. | Cleared for current code: no iframe/webview is embedded and `setWindowOpenHandler` always returns `deny`, matching the advisory's stated non-affected path for [GHSA-9f4c-93c8-jc8g](https://github.com/advisories/GHSA-9f4c-93c8-jc8g). |
| `WAR04B-K03` | Electron ProtocolResponse/session-cache advisory is reachable. | Cleared for current code: no custom protocol registration, `ProtocolResponse.url`, or isolated session-partition path exists. See [GHSA-r4w5-6pfg-jxp5](https://github.com/advisories/GHSA-r4w5-6pfg-jxp5). |
| `WAR04B-K04` | Updater credential-redirect advisory is reachable. | Cleared for current path: no updater API exists, auto-update is disabled, builder publication is disabled, and the release publisher does not use `builder-util-runtime`. |
| `WAR04B-K05` | Lock entries are floating after `npm ci`. | Cleared: lockfile v3 resolves every entry with integrity, including the one exact git commit. Declared caret ranges matter during deliberate lock regeneration, not an unchanged `npm ci`. |
| `WAR04B-K06` | Beta.12.11 identity is presently inconsistent. | Cleared at snapshot only: annotated tag peeled to `bced8052b85c110792a7af5ccb7122a94b2fafad`; release/run identity agreed; all five jobs were green; exactly AppImage, `.deb`, and `SHA256SUMS` were present; live API digests matched the note. Non-immutability remains C05. |
| `WAR04B-K07` | Historical beta.12.11 `.deb` contains the audited builder/test toolchain or a known private filename. | Cleared for that one historical artifact only: fresh SHA-256 `d5e33b41417e444ea524e73c9e25e21d526b70289d68d0ef7c37cf1726fc2954` matched published records; `better_sqlite3.node` was Linux x86-64; builder/test tools, docs/tests/tmp and known private names were absent; field tools were the expected three scripts. |
| `WAR04B-K08` | DON-146 is still blocked on upstream `better-sqlite3` PR #1475. | Cleared: [PR #1475](https://github.com/WiseLibs/better-sqlite3/pull/1475) merged on 2026-06-13 and [v12.10.1](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.10.1) explicitly includes it. The repo remains on 12.10.0, so qualification work is now locally actionable. |
| `WAR04B-K09` | WAR-04 PR #8 already proves or owns WAR-04B release findings. | Cleared: PR #8 is a separate map/settings/privacy investigation. It changes evidence/docs/tests only and supplies no dependency/release remediation or release proof. |

## Native module, lock, rebuild, and support posture

Positive controls:

- `npm ci` consumes the committed integrity lock.
- `electron-builder.json` enables `npmRebuild` and
  `buildDependenciesFromSource`.
- `scripts/electron-package.mjs` removes the stale `.forge-meta` marker, builds
  for the target, and restores host-Node `better-sqlite3` even after failure.
- Release CI finds the packaged native module and requires Linux x86-64 ELF.
- The packaged launch and SQLite smoke gates exercise the target build.
- Host build Node 22 remains a supported Maintenance LTS line according to the
  [Node.js Release Working Group](https://github.com/nodejs/Release).

Residual gaps:

- Node and npm are not exact-pinned; there is no root `engines`,
  `packageManager`, `.nvmrc`, or `.node-version` contract.
- the hosted runner image, apt/compiler packages, GitHub CLI and Actions refs
  can drift;
- target and restored native-module hashes/ABI metadata are not recorded
  independently, although the final artifact hash covers packaged bytes;
- there is no automated dependency/reachability gate; and
- the desktop support policy is stale against the live Linux-only release lane.

## Controlled upgrade order

Do not combine every upgrade into one opaque lockfile change.

1. **Builder/AppImage first.** Select an exact reviewed 26.x builder at or above
   the advisory's fixed `26.15.0`; regenerate and review only the required lock
   graph; re-run full and production audits; inspect the generated AppRun;
   package AppImage and `.deb`; run native/SQLite/package/hash checks.
2. **Optional short containment only:** Electron `40.10.6` clears the named
   ProtocolResponse record and affected extraction dependency, but remains EOL.
   It is not an acceptable final release endpoint.
3. **Qualify `better-sqlite3` independently.** `12.10.1` is the minimum
   upstream-unblocked release; select the exact maintained 12.x version at
   implementation time, and exercise migrations, WAL/recovery, workers,
   backup/archive/read paths and target/host rebuild. Do not jump to v13/N-API
   without treating that major as its own persistence seam.
4. **Move Electron to a currently supported line.** Electron 42 plus
   `better-sqlite3>=12.10.1` is the smallest upstream-proven bridge, but Electron
   42 reaches EOL on 2026-10-20. Select for support runway at execution time;
   Electron 44 crosses more runtime/native behavior and requires the complete
   exact-candidate matrix.
5. **Then refresh remaining build/test dependencies and reproducibility
   controls.** Pin exact Node/npm/action/toolchain identities, rerun both audits,
   and classify every residual by actual path.

Every step remains implementation work under its owning Linear issue. WAR-04B
does not authorize or perform it.

## Release integrity and repository controls

| Boundary | Present control | Confirmed gap | Minimum next control |
| --- | --- | --- | --- |
| Reviewed SHA to draft bytes | tag/package version match; exact checkout; gates; native inspection; launch smoke; exact asset allowlist | Actions and build environment drift; no dependency audit | exact action/toolchain inputs plus reachability record |
| Draft to published bytes | guarded publisher validates exact tag/body/matrix/assets/API digests/fresh downloads twice | publisher is not a server-enforced only-path | retain publisher and require release-authority discipline |
| Published bytes and tag | historical hashes and notes | release is mutable; tag unsigned/unprotected; checksums share trust domain | immutable releases plus compatible tag ruleset |
| Build provenance | commit/run text in release body | no cryptographic attestation | attest exact installers and verify during promotion |
| Dependency transparency | lockfile and npm graph | no packaged SBOM | generate/attest packaged SBOM, not merely source graph |
| Artifact origin | explicit unsigned/internal status | no code signing/notarization | keep status explicit; decide and qualify signing separately before stable field use |
| Merge source | human PR/review practice | no branch/ruleset/required checks or reviews | always-emitted gate, then small master ruleset |
| Secret/static/dependency visibility | local reviews and one narrow map filename guard | platform security features disabled; alert count unknown | enable alerts/scanning incrementally and triage baseline |
| Private/evidence exclusion | source allowlist; historical package clear | current ASAR/extra-resource manifest unproved | exact-candidate manifest and explicit exclusion policy |

GitHub's [ruleset controls](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
support required PRs, reviews, status checks, deletion/force-push restrictions and
tag controls. For a personal repository, one independent latest-head approval
and one always-emitted required gate are the smallest credible starting point;
do not require a path-filtered workflow that sometimes never reports.

GitHub's [public-repository security guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)
recommends Dependabot alerts, secret scanning/push protection and code scanning.
Enable visibility first, triage the baseline, and only then decide which results
are safe to make merge-blocking.

## Private map, credentials, and evidence exclusion

The tracked repository scan found:

- zero `.mbtiles` files;
- zero key/certificate-material filenames;
- zero runtime database/archive/ZIP filenames in the checked categories;
- one `.env.mock`, which is outside the builder allowlist; and
- exactly the three expected field-tool scripts.

The historical beta.12.11 `.deb` inspection found no known private filename,
tests, docs, `.git`, or `tmp`, and its fresh digest matched. It predates the
current base's `geojson-vt`, `saxes`, `vt-pbf`, and `shared/**` additions.
Therefore the correct current-base conclusion is: **source controls are
encouraging; current exact packaged exclusion is unproved.** No credentials,
private-map bytes, operational data, or secret values were sought or handled.

## REL hazard reconciliation

| Hazard | WAR-04B reconciliation |
| --- | --- |
| `REL-001` | Point-in-time draft/publisher identity is strong and beta.12.11 was internally consistent. Post-publication tag/asset immutability is absent, so the invariant remains unenforced after publication. |
| `REL-002` | Confirmed release blockers: EOL Electron 40 and affected AppImage builder; conditional archive-tool build exposure; native rebuild controls remain positive. DON-146's upstream blocker is cleared, not the local upgrade/qualification work. |
| `REL-003` | Unsigned/internal/no-auto-update posture remains explicit. No attestation or SBOM exists; checksums are co-located with mutable unsigned assets. Accepted residual is not stable-field approval. |
| `REL-004` | Live 2026-08-30 state confirms no branch/ruleset/required review/check enforcement and disabled security visibility. Release-workflow and field-tool PR coverage is also incomplete. |
| `PKG-002` | Support policy continues to overstate platform and release-lane posture and now also needs runtime-support reconciliation. No unavailable platform was qualified here. |

## Exact post-PR6 refresh checklist

PR6 is not release evidence. The remote branch snapshot was
`eec92812b783a795c093f37268b295dd2179a3af`; its active implementation is local,
uncommitted and mutable. At inspection time it changed no package, lock,
builder, release-workflow, package-wrapper or publisher path, but that observation
cannot survive later edits or merge.

After PR6 merges, and before WAR-04B is used in any release decision:

1. Record the exact merged PR6 SHA and diff it from this audited base across
   `package*.json`, `electron-builder.json`, both Electron workflows,
   `scripts/electron-package.mjs`, publisher/library, `electron/**`, `shared/**`,
   and `field-tools/**`.
2. Refresh full and production audit graphs, registry/support versions and every
   changed package's packaged/runtime/build/test reachability.
3. Build one exact merged-head candidate through the unchanged intended release
   path and inventory `app.asar`, `app.asar.unpacked`, native modules and all
   extra resources.
4. Confirm archive outputs, `.sararchive`/ZIP and legacy-plaintext fixtures,
   verification/scratch directories, mission databases/profiles, credentials,
   private maps, diagnostics and raw test evidence are absent from shipped bytes.
5. Recheck `better_sqlite3.node` target architecture/ABI/hash and run the exact
   packaged archive lifecycle/restart/recovery/verify/restore flows. Current
   unmerged tests or source are no substitute.
6. Rerun release-safety tests and the applicable no-skip beta/package gates;
   retain exact commands, results, hashes and proof tier.
7. Re-fetch `master` and tag rules, required reviews/checks, Actions policy,
   security-analysis features, immutable-release state, attestations and live
   release/asset metadata.
8. Freeze hashes, SBOM/provenance records, release-note claims and the updated
   `REL-*` rows only after those exact bytes pass.

## Evidence ledger

Representative read-only commands:

```text
git fetch origin
git rev-parse HEAD origin/master
git status --short --branch
npm audit --omit=dev --json
npm audit --json
node lockfile graph/integrity traversals
rg for Electron protocol/iframe/updater/window controls
git show electron-v0.1.0-beta.12.11:{package.json,package-lock.json,electron-builder.json,.github/workflows/electron-release.yml}
gh api repository/branch/protection/rulesets/actions/security/release/tag/commit endpoints
gh run view 31482052296
gh release view/verify/verify-asset and gh attestation verify
one fresh beta.12.11 .deb download, SHA-256 check, package/ASAR/native/resource inventory
git diff/status of PR8 and mutable PR6 release/dependency paths
```

Primary technical sources:

- [Electron release support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- [Electron release/EOL schedule](https://releases.electronjs.org/schedule)
- [Electron 40.10.0 embedded versions](https://releases.electronjs.org/release/v40.10.0)
- [Electron 44.0.0 release](https://releases.electronjs.org/release/v44.0.0)
- [AppImage advisory GHSA-7g7r-gx96-252g](https://github.com/advisories/GHSA-7g7r-gx96-252g)
- [node-tar advisory GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)
- [extract-zip advisory GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
- [Electron iframe advisory GHSA-9f4c-93c8-jc8g](https://github.com/advisories/GHSA-9f4c-93c8-jc8g)
- [Electron ProtocolResponse advisory GHSA-r4w5-6pfg-jxp5](https://github.com/advisories/GHSA-r4w5-6pfg-jxp5)
- [`better-sqlite3` Electron 42 fix PR #1475](https://github.com/WiseLibs/better-sqlite3/pull/1475)
- [`better-sqlite3` v12.10.1](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.10.1)
- [Node.js release schedule](https://github.com/nodejs/Release)
- [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub Actions secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub ruleset controls](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [GitHub security and analysis settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)

## Residual uncertainty and ownership

- No current-base or PR6 artifact was built or inspected.
- The one artifact inspection was a historical `.deb`; the affected historical
  AppImage was not opened because the packet permits one artifact only.
- Disabled security features make current alert inventories unknowable.
- Live GitHub settings, support lines, registry versions and advisories can
  change and must be refreshed at the exact release decision.
- No exploit, compromise, private-data exposure, production behavior, unavailable
  platform, or post-publication mutation was demonstrated.
- WAR-12 still owns the full exact-candidate package/platform/scale/field matrix.
- Donal owns all remediation, GitHub-setting, merge, tag and release decisions.

WAR-04B is complete only when this report and its reconciliations have passed
two independent reviews on the final exact PR head. Review evidence belongs in
the PR and must be repeated for any corrective head.
