# WAR-04B — post-PR6 release-integrity refresh

## Verdict

**HOLD.** This 2026-09-09 investigation is pinned to fetched `origin/master`
`3cdf555de93459c83198121b31053ff1d53db74e`, tree
`c10d71a340ec2722e50a97a8605a1f99cee3d629`. No production, dependency, lock,
workflow, setting, tag, release or product behavior changed. No field/release
readiness is claimed. The unchanged Electron 40 runtime is end-of-life and the
AppImage builder remains affected. Production audit is now **1 critical**, not
zero: MapLibre's affected sanitizer ships, but its required untrusted-attribution
input is absent from the inspected application path. No application exploit was
demonstrated. Local packaged lifecycle rejected a 203 ms continuity interval;
cause remains uncertain. Independent exact-master Linux validation passed; this does not resolve the local failure.

The [observations](../../evidence/war04b/post-pr6-20260909.json) retain graph,
advisory, package, native, GitHub and failure records. Hashes identify observed
bytes, not approved/frozen release bytes. The immutable
[original report](https://github.com/donal0c/sartracker-web/blob/3cdf555de93459c83198121b31053ff1d53db74e/docs/assurance/findings/WAR-04B.md)
preserves the 2026-08-30 findings and contrary historical evidence. Current
statements below supersede its pre-merge/zero-production-audit assertions.

## Risk and evidence plan

The risk is mistaking pre-merge, source-only or advisory-count evidence for
exact-package release proof. Keep executable/test/config blobs unchanged,
inspect ASAR/unpacked/extra resources, classify actual input reachability,
retain rejected measurements and read live server controls. Follow the
[testing cadence](../../testing-and-review-cadence.md): focused release checks,
the exact-master package boundary, then normal CI. No unrelated full local
source cycle is repeated: final PR6 tested head and master differ only in seven
documentation files, including CLAUDE.md. Their executable, dependency, test,
build and workflow blobs match; the recorded 4,137-test cycle remains reusable.
Fresh CI nevertheless executes its complete mandatory source/package gates.

Full interactive beta verification, tag publication, >2 GiB/32-case interruption,
multi-day, live-provider, original-machine and field matrices remain
DON-254/DON-255 work. No filtered beta run is called a no-skip pass. The local
feature-enabled qualification package is not a tag-release artifact: the release
workflow intentionally omits that feature flag until programme qualification.

## Exact post-programme-PR-6 refresh checklist

Live [PR #10](https://github.com/donal0c/sartracker-web/pull/10) API confirms
merge `e0ead68852b10606551302b5104e409634c962e1` at 08:21:33Z on 2026-09-09,
from tested head `1b1f86ee2abb3b0ef2949a710b549e7e0079ef2e`. This is programme
PR6, not GitHub PR #6. Master matches dispatch; its sole later commit is the
documentation/testing-cadence handover.

| Item | Required evidence | Disposition |
| --- | --- | --- |
| 1 | Exact merge/master identities; prior audited release-input diff | Complete T0. From `3d0d36b3874947d3d620bdb5262d9cd2d7233fcf`: 99 changed selected paths, 38,408 additions/367 deletions. Package manifest adds three qualification commands only. Lock, builder config, release workflow, packager, publisher/library, shared and field-tools are unchanged; Linux validation and 97 Electron files change. Exact path list retained. |
| 2 | Both audits, versions/advisories and actual reachability | Complete T0/T1. Production: 1 critical/238 dependencies. Full: 32 records (2 low, 4 moderate, 24 high, 2 critical), 70 unique advisories. All 70 primary GitHub records fetched, none withdrawn. Dependency versions unchanged. Classification below. |
| 3 | One exact-master package and actual boundary inventory | Local build/inventory complete, T3 inspection. `VITE_SARTRACKER_MISSION_MODEL=1 npm run electron:pack` passed. 3,902 ASAR file entries, 53 unpacked files, 234 package manifests including nested dependencies, icon and three field tools; 4,230 logical/physical manifest records including symlinks and duplicate unpacked views. Local lifecycle failed; Linux CI and downloaded `.deb` boundary inspection passed. |
| 4 | Archive/private/credential/evidence exclusion | Local named categories absent: `.sararch`/`.sararchive`/ZIP, SQLite/database/profile, key-material/private-map files and verification/scratch/raw runtime evidence directories. ASAR payloads checked for ZIP/SQLite signatures without content disclosure. Curated manual screenshots, third-party test source and SQLite test extension do ship; see limits below. No arbitrary embedded-secret clearance. |
| 5 | Native architecture/ABI/hash; packaged lifecycle/restart/recovery/verify/restore | Native load passes: arm64 Mach-O, ABI 143, SQLite 3.53.1, integrity `ok`; restored host ABI 127 loads. Lifecycle failed during create at 203 ms. No successful local restart/verify/restore claim. Same-head retry refused by supervisor. Linux merged-head lifecycle/restart/recovery/verify/restore/cleanup passed; receipt and inspected executable/ASAR hashes match. |
| 6 | Release-safety tests and applicable no-skip package gates | 265/265 focused tests in six files pass; build/typecheck/budgets pass. Canonical lifecycle fails, process/profile teardown passes. Exact-master Linux run `34338004244` passed all applicable workflow steps, including 4,137 tests, build, replay, tracking, lifecycle and AppImage launch. Full beta/tag/field gates are out of this investigation and remain unqualified, not green. |
| 7 | Fresh GitHub rules/reviews/checks/Actions/security/immutability/attestation/assets | Complete read-only T0 snapshot. Unprotected master; zero rulesets/effective rules; no required reviews/checks; all Actions allowed without SHA pinning; immutable releases disabled; security visibility disabled/unconfigured. Historical beta metadata agrees; no available attestation. |
| 8 | Freeze hashes/provenance/claims and affected assurance only after bytes pass | Investigation freeze complete for the successful exact-master Linux bytes/receipts; release freeze remains blocked. Local rejected bytes remain separately identified. Implementation merge permits RPL-004 to leave rewrite-pending; unresolved local timing and final platform/field qualification remain gaps. Final review/CI binding is recorded on the PR. |

## Dependency support and reachability

The lock still has 898 resolved entries, all with integrity: 897 registry entries
and one exact upstream node-gyp commit. Lock SHA-256 is
`0127526b35829794af69db4b817f6fd581c0f8045973517618e8d171af999fef`;
package manifest SHA-256 is
`a035ff86bcc36a4d6293d15ed669d63cfec649cff83e85fe427b96034e0e346e`.
All 234 packaged module name/version pairs occur in that lock. Eleven occupy
different nested/hoisted paths after builder collection; their matching lock
paths are recorded rather than misclassified as unexpected versions.

The [Electron schedule](https://releases.electronjs.org/schedule) confirms 40 EOL
on 2026-06-30 and supported majors 42–44. Registry tags: 42.11.3, 43.6.0,
44.3.0; 42's scheduled EOL is 2026-10-20. Builder/app-builder-lib `latest` is
26.15.3, while `v26` is 26.16.1. These are observations, not approved targets.
better-sqlite3 latest is 13.0.3; latest 12.x is 12.11.1. The upstream
[Electron 42 fix](https://github.com/WiseLibs/better-sqlite3/pull/1475) merged
and shipped in [12.10.1](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.10.1).
[Node 22](https://github.com/nodejs/Release) remains Maintenance LTS through
2027-04-30. Local Node/npm are 22.22.3/10.9.8; CI pins only Node major 22.

| Group | Current actual path/classification |
| --- | --- |
| MapLibre 5.22.0 | Shipped renderer and ASAR. [GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579) affects ≤6.4.0, fixed 6.4.1. Installed DOM sanitizer removes attributes while iterating a live collection; attribution control calls it before innerHTML. Application `map-style.ts` takes fixed attribution strings from `src/lib/map-config.ts`, with explicit raster tile arrays; local coverage vectors add no attribution. No remote style/TileJSON/custom-attribution or Popup HTML input was found. Affected code present; untrusted-input precondition not established. Reassess before dynamic attribution/styles. |
| Electron 40.10.0 | Dev-declared, shipped runtime, EOL blocker. Named iframe advisory remains outside inspected path: no iframe/webview, new windows denied. ProtocolResponse/session-cache API absent. MapLibre tile protocols are not Electron protocol registration. |
| electron-builder/app-builder-lib 26.0.12 | Build tool generates AppImage launcher. [GHSA-7g7r-gx96-252g](https://github.com/advisories/GHSA-7g7r-gx96-252g) affects <26.15.0; empty loader-search component admits a malicious library in launch directory. AppImage affected, `.deb`/local `.app` outside that advisory. No attack demonstrated. |
| tar/extract-zip and native/build graph | tar 6.2.1 via builder/node-gyp/rebuild; extract-zip 2.0.1 directly under Electron install. Conditional upstream build-download exposure, constrained by lock/checksums, not mission archive input. `@electron/node-gyp`, `@electron/rebuild`, cacache, make-fetch-happen, ip-address, builder-util, form-data and tmp are build/install dependencies or conditional helpers. No compromise inferred. |
| Updater/platform helpers | No electron-updater/autoUpdater; packager publication disabled and guarded publisher separate, so builder-util-runtime redirect path not active. electron-publish/Squirrel/DMG are unused by Linux release; xmldom is builder/platform XML tooling. Local `--dir` builds no DMG. No future-platform clearance. |
| Build transformation | Babel, PostCSS, postcss-selector-parser, Vite, nanoid, js-yaml, brace-expansion, browserslist and baseline-browser-mapping consume controlled source/config. New records include query-cache growth/custom stats and invalid baseline input; no untrusted query/stats feed found. Absent from local application package. |
| Test/lint | Vitest/@vitest/mocker redirect-mock advisory concerns test/browser-server inputs; repo uses `vitest run`, not an exposed browser server. jsdom/undici are test graph; humanfs is ESLint tooling. Not packaged runtime claims. |
| Native/retained production | better-sqlite3 12.10.0 packaged and exercised. Tauri API/dialog/sql and type-package metadata physically present; Electron selects its adapters and plugin-sql has no source import. Metadata is not executable type code. npm prod/dev is not shipped/runtime. |

All 32 records and edges are in observations. PR6 adds no dependency version:
archive handling uses repository-owned bounded readers, Node crypto/streams/
zlib and SQLite, not npm tar/extract-zip. Field collector uses host `tar` for
diagnostic creation, a different boundary. Audit counts are not exploitability.

## Exact local package and rejected run

ASAR: 112,207,474 bytes, SHA-256
`3d763b9a6a2f5ca6c73dee979da3022692081defabfbf3208f1d2f96e61fb46f`.
Native SQLite: 1,915,840 bytes, SHA-256
`be5e31bf5f866f23dcd587621144f72322240db425664643e9c45667b5ce3f66`.
`file` reports arm64 Mach-O; `nm` exports `node_register_module_v143`.
Actual packaged load reports Electron 40.10.0, Chromium 144.0.7559.236, Node
24.15.0 and SQLite 3.53.1; disposable in-memory integrity is `ok`. Restored host
ABI-127 module has its own recorded hash and passes a SQLite load.

Unpacked files total 22,516,141 bytes, including upstream SQLite source/build
inputs and `test_extension.node` (16,848 bytes). No application loadExtension
call exists. 249 third-party test source files (2,182,352 bytes), 407 source
maps and 27 curated manual files remain. This is package-minimization debt,
not demonstrated private-data disclosure. The manual custody image derives
from the synthetic browser harness, not an operational credential. Source/
filename/signature checks cannot prove arbitrary embedded secrets absent.
Full local manifest hash and package/version/unpacked/extra-resource inventory
are retained; packages/extracted trees/raw profiles are not committed.

Canonical smoke ran 09:59:31.532–09:59:40.844Z on clean exact-master source.
Create failed: current-fix interval 203 ms (strict <200), main round trip
199.163 ms, frame gap 11.9 ms. Source diagnostic showed 267 ms since last
emission, zero pending requests. This raises a scheduling/cadence question but
does not establish root cause. Process/profile cleanup completed. No successful
restart, verify, restore or cleanup-phase proof is inferred from this run.

Existing trace-option retry was refused before launch: `Archive lifecycle
supervisor refuses an unchanged same-head rerun.` The lease was not removed or
bypassed. Cadence permits diagnosed retries, but that executable restriction
still exists. Independent exact-master Linux run
[34338004244](https://github.com/donal0c/sartracker-web/actions/runs/34338004244)
uses the unchanged workflow for platform comparison, not local blind rerunning.
Its mandatory steps all passed. The canonical receipt independently validates (`valid: true`, `passed: true`). It records two launches/exits, 4,096 breadcrumbs, 202 replay objects and 101 outings; create/verify/restore/cleanup current-fix maxima are 179/125/177/151 ms. Interrupted decrypt leaves a deliberate canary, and restart removes all residual entries. Read-only review before/after credential-gated cleanup passes; final plaintext residue is zero. This is the synthetic CI workload, not the full interruption/scale/field matrix.

The downloaded `.deb` was extracted and inspected, not installed. Its executable and ASAR exactly match the lifecycle receipt. ASAR SHA-256 is `38b624abe91e6feb5e40d64dc472ccac042a20db17521044df8657762315472c`; native SQLite is ELF x86-64, ABI143 registration, SHA-256 `c6dd5b3806e9fdc0e48e5ac18e0f7fac1db4b265f6a010afd275983efac159cd`. Package inspection finds 3,902 ASAR entries, 234 manifests, 53 unpacked files and no named/signature risk-category matches. Linux extras are three field tools, AppArmor profile, package-type and update metadata; update metadata does not create an updater code path. The same upstream test/native-source minimization debt remains.

Downloaded installer hashes match CI SHA256SUMS: `.deb` `77795087c2485bd2f27e9c6a5339130fe9909da03bd4789b95da3a49a0874527`; AppImage `30442079ec8ebf2fcde0fb3f9ed731595c0aca037b265ce0d278fc89b6af78e2`. AppImage launch is CI evidence; its filesystem was not separately extracted here. These internal artifacts retain the existing beta version label but are **not** the historical published beta or a promotion candidate.

## Live controls and historical release

Read-only REST records confirm public repository/prerelease, unprotected master,
zero rulesets/effective rules, no required review/check, all Actions permitted
without SHA pinning, default read-only token without PR approval. Secret scanning,
push protection, non-provider patterns, validity checks and Dependabot updates
are disabled. Alert endpoints say disabled/no analysis, not zero alerts; CodeQL
default setup is unconfigured. Initial master snapshot had no checks/statuses;
the independently dispatched CI above is a later observation.

Immutable release setting is disabled and not owner-enforced. Beta.12.11 is
published, unsigned, public, `immutable:false`. Tag object
`a20d6b1f43533cb01da940be21c6fbf9421330ac` peels to
`bced8052b85c110792a7af5ccb7122a94b2fafad`. Three asset IDs/sizes/update times/API
digests agree with historical records. No fresh historical installer download
or execution here. `gh release verify` reports no tag attestations; historical
`.deb` attestation endpoint returns 404. No evidence of mutation/compromise.
No attested packaged SBOM is produced; this inventory is not an attested SBOM.

PR6 improves PR CI coverage (docs/handoff/manual), exact source binding and
terminal receipt validation. The release workflow and field-tools still lack
PR path coverage. Actions v4 and build environment float. PR6 GitHub review API
has one COMMENTED review at c69b0c23; independent reviews remain in its ledger/
discussion, not a server-enforced latest-head approval.

Two unchanged release-code comments still call twice-observed asset metadata
“immutable”: `scripts/electron-release-publish.mjs:141` and
`build/electron-release-lib.js:314`. They mean observed identity consistency;
they do not establish server enforcement. C10 retains this source-wording debt
for an authorized release-code change.

## Finding reconciliation and ownership

| Stable IDs | Current disposition |
| --- | --- |
| C01/C02 | Confirmed blockers retained: affected AppImage builder, EOL runtime. |
| C03/C04 | Audit-gate omission and conditional build-archive exposure retained; no incident claim. |
| C05–C08 | Mutable source/release controls, floating Actions/toolchain, unavailable provenance/security visibility retained; improved CI is not server enforcement. |
| C09 | ASAR exclusion enforcement gap retained; local inventory narrows private-file hypothesis, does not add a gate. Test/native/build extras are minimization debt. |
| C10 | Current support/manual wording corrected to Linux-only release lane and missing Windows CI/publisher support, without platform qualification. Historical release amendments remain intact. |
| H01 | Narrowed only for named local package categories; arbitrary embedded secrets/other artifacts/future inputs not cleared. |
| H02/H03 | No hostile-build or compromise evidence; audit count does not equal shipped exploits. |
| H04 | Settled: PR6 merged, lock/release selection unchanged, archive source/package content/Linux validation materially changed. Broad unchanged-posture claim rejected. |
| H05 | Platform equivalence unproved, particularly after local rejection; WAR-12/DON-254 owns fleet/install/soak/field. |
| K01 | Original zero-production-audit is historical; MapLibre record supersedes current clearance. |
| K02–K05 | Narrow iframe/protocol/updater path clearances and integrity lock retained after retrace. |
| K06/K07 | Historical beta identity/.deb proof stays artifact/time-specific; current API metadata agrees, bytes not re-downloaded. |
| K08/K09 | Upstream SQLite unblock confirmed; WAR-04 remains separate, not release remediation. |

Controlled remediation stays separate: builder/AppImage first; independently
qualify maintained SQLite 12.x; select supported Electron with runway; then
remaining build/test/toolchain controls. Include MapLibre's affected shipped
code with its fixed-catalogue precondition; do not blindly accept npm's major
upgrade suggestion. Package exclusions/minimization, immutable release/tag/
source rules, security visibility and attested packaged provenance need their
authorized changes. Nothing is repaired in this PR.

Live DON-146 is Done despite upstream-blocked title and comments retaining open
upgrade work. Locked versions prove implementation is not delivered; record the
discrepancy on the existing issue, not a speculative duplicate. DON-254/255 are
Backlog; their qualification/publication authority and the
[shadow-use admission gate](../shadow-use-protocol.md#field-admission-gate)
remain unchanged. Local timing rejection, cause, final candidate/platform/field
matrix, original-machine evidence, custody tabletop and control repairs remain.

## Final review and CI

Exact local commands (logs/receipts are hashed in the observations):

```sh
git fetch origin master
git rev-parse origin/master HEAD
npm audit --omit=dev --json
npm audit --json
npm ci
npm run test -- tests/unit/electron-release-safety.test.ts tests/unit/release-smoke-safety.test.ts tests/unit/beta-verify-lib.test.ts tests/unit/verification-scripts.test.ts tests/unit/electron-archive-lifecycle-smoke-lib.test.ts tests/unit/electron-archive-lifecycle-smoke-script.test.ts --no-file-parallelism
VITE_SARTRACKER_MISSION_MODEL=1 npm run electron:pack
git restore --source=HEAD --worktree -- src/lib/version.generated.ts
EXPECTED_SOURCE_SHA=3cdf555de93459c83198121b31053ff1d53db74e npm run electron:smoke:archive-lifecycle:ci
EXPECTED_SOURCE_SHA=3cdf555de93459c83198121b31053ff1d53db74e SARTRACKER_ARCHIVE_RENDER_TRACE=1 npm run electron:smoke:archive-lifecycle:ci
gh workflow run electron-linux-validation.yml --ref master
```

The first registry attempt was sandbox-DNS-unreachable; the network-enabled
retry succeeded. Audit exit 1 denotes reported advisories, not a failed query.
The trace-option command was refused before a second launch. The generated
version restore changed only that build's generated file, without rebuilding.
The inventory recipe is retained as text in the observations; it enumerates
ASAR logical entries and every bundle/unpacked/resource file, hashes file bytes,
records symlink targets and package metadata. Its predicates are a bounded
investigation, not a new enforced release guard.

Two independent focused reviews cover dependency/release/security and traceability/proof-tier/contradictions. Their exact-head rechecks, dispositions, Linear linkage and final normal CI are recorded on the PR to avoid a self-referential evidence commit. No unavailable setting or platform is converted into a false green claim.
