# WAR-11A — AppImage builder remediation

Status: review corrections in progress; earlier review-readiness withdrawn after
the confirmed AppRun dialog-prefix bypass. Prior CI remains historical evidence.
Release **HOLD** remains.
Base `c51e4b3537c4b026f7079dd40193a894cedcdd9f`; owner DON-146, with
DON-254/DON-255 retaining final qualification/publication authority.

## Dependency selection and review

Exact `electron-builder` / `app-builder-lib` 26.0.12 → 26.16.1. On 2026-09-09,
the [npm registry](https://registry.npmjs.org/electron-builder) `v26` channel
points to 26.16.1, while `latest` is 26.15.3 and `next` is a 27 alpha. The
[26.16.1 release](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder@26.16.1)
is the maintained, non-prerelease v26 backport, published September 7.
[GHSA-7g7r-gx96-252g](https://github.com/advisories/GHSA-7g7r-gx96-252g)
fixes both AppImage generation paths at 26.15.0. The default FUSE2 format remains;
the removed app-builder-bin implementation is replaced by upstream TypeScript
construction. No Electron, SQLite, MapLibre, Vite or application upgrade.

The [complete lock and script ledger](../../evidence/war11a/dependency-review.json)
enumerates 195 package paths: 45 added, 111 removed, 39 changed. All are within
the builder development dependency closure; no production lock entry changes.
Compatible subtree refreshes are accepted deterministic re-resolution, not all
strict minimum upgrades. Root mkdirp/rimraf decreases are hoist relocations;
app-builder-lib's semver 7.7.4 follows its new `~7.7.3` constraint.

The changed graph covers builder/ASAR collection, rebuild/node-gyp/ABI lookup,
archive/download tooling, config parsing and upstream cross-platform signing
helpers. No added/changed registry package has preinstall/install/postinstall
hooks. Its declared development scripts are listed separately. Actual builder
invocation still downloads checksum-bound toolsets and compiles native code;
explicit environment tool overrides remain a trusted build-environment boundary.
Rebuild/node-abi now require Node ≥22.12.0. Repeating lock-only regeneration
produced an identical lock hash. No `npm audit fix` was run.

## Durable controls and red-first evidence

`build/appimage-launcher-safety.js` reads actual extracted AppRun bytes and
requires the four known safe search-path exports. It rejects unexpected
references, missing/duplicate exports and the old unconditional colon append.
It evaluates only the inspected allow-listed exports in bash, never the
application or arbitrary launcher commands. Unset/empty/populated inherited
paths must have no empty or relative components; populated values are retained.
This controls the named generated search-path boundary, not arbitrary shell
program equivalence or caller-supplied malformed search paths.

`build/linux-package-inventory.js` inspects physical files and logical ASAR
entries, checks known private filename/signature categories, and matches shipped
module identities to the lock. `scripts/verify-linux-package.mjs` extracts the
finished AppImage and Debian package plus control metadata, checks the generated
launcher, compares payloads with the unpacked smoke target and exercises native
SQLite in packaged Electron. Missing, ambiguous or rejected output fails the
Linux package command before successful completion; native restoration still
runs. The normal validation and release workflows use that command. The release
workflow retains the safety receipt with its validation evidence.

Initial tests failed on the missing control/wiring. Seeded old loader assignment
is rejected without an exploit or shared-library load. Early independent review
also found alternate-assignment, outside-opt Debian scanning and partial-payload
binding gaps; their fixtures failed before the corrections and pass afterward.
The stable local source cycle passed 402 files / 4,186 tests. Subsequent
inspection-only corrections passed focused regressions and lint; exact-head CI
will exercise the final source. Build and budgets passed. Red evidence includes
symlink escape, executable-mode drift, actual upstream launcher drift, bounded
ELF extraction and Debian-only metadata distinctions.

## Audits and retained limits

Fresh production audit: one critical MapLibre record. Fresh full audit: 16
records (2 low, 4 moderate, 9 high, 1 critical). These are graph records, not
exploit counts. Per-record paths, advisory identifiers and reachability are in
the ledger. The AppImage advisory drops out of this graph; output proof is
required separately. Remaining Electron EOL/named runtime advisories,
Electron-install extract-zip exposure, controlled-source build/config findings
and test/lint findings retain their distinct boundaries. Fixed catalogue
attribution still supplies the inspected MapLibre sanitizer input; this does
not clear the affected library for arbitrary future attribution.

All historical WAR-04B/PR12 timing failures remain recorded. The strict 200 ms
gates, cold-Mesa/source corrections and application behavior are unchanged.
No settings/rulesets/action-pinning, signing, SBOM/attestation, immutable release,
Windows support, live-provider, original-machine, field or BCP-17/WAR-12 work.
Package exclusion checks cover named categories/signatures, not arbitrary
embedded-secret absence. A `.deb` extraction is not installation qualification.
DON-146 was historically Done despite the unchanged runtime; live recheck now
shows In Progress. This bounded builder work does not fulfil its runtime-upgrade
or original-machine SIGTRAP acceptance criteria.

## Package, CI and final review evidence

The [Linux package summary](../../evidence/war11a/local-linux-package-summary.json)
records both installer hashes, generated AppRun hash, inventories and native
probe. A Debian 12 x64 container emulated on Apple Silicon built both formats
from disposable snapshot `18c0b4dcc996d896b0f7a3b0a2bd92127b7ee88c`.
The extracted launcher passes unset/empty/populated path probes. All shared
payload bytes and execution bits match linux-unpacked, with FUSE2 libraries
bound to the upstream checksum-verified toolset. Each format contains 234
lock-matched modules; packaged Electron 40.10.0 / ABI 143 loads SQLite and passes
an in-memory query and integrity check.

The emulator cannot execute the embedded AppImage runtime (`ENOEXEC`). The gate
therefore derives a bounded ELF/SquashFS offset and uses nonexecuting extraction;
the actual extracted Electron native probe passes. Inspection corrections were
applied after the artifact build, so the receipt explicitly records dirty source.
This is local package evidence, not final-head or native Ubuntu launch proof.
The first metadata comparison rejected Debian's later-added AppArmor/package-type
files; the corrected gate excludes only these two Debian controls from the
AppImage comparison while retaining exact Debian matching and private-data scans.

Generated Debian control scripts were read, not installed. The new builder's
postrm removes the registered `/opt/.../sartracker-web` alternative and unloads
AppArmor before removing its profile, guarded for chroot execution. Existing
postinst namespace/SUID/AppArmor behavior remains, apart from output redirection.
These upstream installer-template changes require platform qualification before
release. Existing author/default-icon/signing warnings and the new desktopName
warning are deferred; this slice does not change branding or signing policy.

The [native macOS lifecycle summary](../../evidence/war11a/local-native-archive-summary.json)
binds clean disposable snapshot `c762b9f40fa772410beb33f09b0965ddcda2cf2b`
to its packaged executable and ASAR. The canonical terminal receipt independently
validates create/verify/restore/cleanup, interrupted-restore recovery, two exits
and zero plaintext residue. Current-fix maxima are 32/35/28/60 ms; frame maximum
147.9 ms; the 200 ms gates are unchanged. This does not resolve historical timing
failures or establish Linux/field equivalence.

Final PR-head CI, downloaded receipt validation and both independent final-head
reviews are recorded on the PR, avoiding a self-referential evidence commit.
Until those records exist, no final-head readiness claim is made.

PR review follow-up: CI `34395228284` passed 403 files / 4,195 tests and every
packaged gate on `f72ade97`. Automated review then found that named credential
files with non-JSON extensions escaped the category filter. Five new regressions
failed first (including logical ASAR), then passed after extending the exact
credential basename match to every suffix, including multiple extensions.
`credentials-store.cjs` remains allowed. Final-head CI and independent rechecks
supersede the earlier green head; the earlier run is retained, not relabelled.

## External review corrections and dispositions

| Finding | Disposition / evidence |
| --- | --- |
| AppRun dialog-prefix exemption accepts appended loader reassignment | Confirmed blocker. Four mutated dialog regressions fail first (semicolon, AND, OR, command substitution). Only six complete literal commands from the selected no-EULA template are exempted; actual upstream launcher still passes. Earlier independent reviews missed this defect and do not clear it. |
| Hardcoded runtime identities and opaque failures; inventory mixes policy | Corrected. Inventory records contents; `linux-package-policy.js` compares exact locked Electron and root better-sqlite3 identities with the actual runtime probe and reports field/expected/observed. Native load/query/integrity and x64 checks remain; ABI is recorded after actual native loading instead of duplicating Electron's ABI mapping. No runtime version changed. |
| Undeclared inspection dependencies / internal builder import | Corrected. Direct exact dev declarations own ASAR 3.4.1, app-builder-lib 26.16.1 and builder-util 26.16.0. Every non-root lock record is unchanged. One adapter verifies declarations, installed versions, supported builder pin and API shape before calling the internal helper. Future builder upgrades require adapter review. |
| Hardcoded FUSE2 toolset | Corrected. Read `electron-builder.json` toolsets.appimage with the selected builder's default; record the selection. Modern/custom toolsets remain subject to actual format/launcher/payload gates and are not separately qualified by this slice. |
| Generated version makes sourceDirty ambiguous | Corrected with receipt v2: capture before and after packaging; retain pre-existing changes, record both raw states and generated-file hashes, and distinguish build-command capture from standalone inspection. Only the known post-build generated file is separated from source edits. No claim of cryptographic source attestation. |
| Prohibited directory names may collide with dependency conventions | Latent, no current collision identified. Keep fail-closed inspection; distinguish a filename-category match requiring inspection from a known payload signature. No blanket node_modules exemption or assertion that a name match proves leaked data. |
| Dangling symlink returns raw ENOENT | Confirmed by failing regression, corrected with package-relative path and filesystem error code. Escape rejection remains. |
| ELF section-header overrun | Not reproduced; no parser change. The whole count × 64-byte table is bounded before reads. All 68 truncation lengths 64–131 reject with the explicit bounds error, not RangeError. Each section's furthest field ends at byte 40 of its bounded 64-byte entry. |
| trimEnd hides a trailing empty output field | Removed broad whitespace trimming; strip only the final protocol newline. The fixed allowlisted exports cannot produce the reported empty final field, so no reachable launcher bypass was established from this item. |
| Non-Linux distribution fails after building | Fail before build on unsupported hosts; build documentation explicitly names Linux x64 and prerequisites. macOS engineering `--dir` packaging is unchanged. |
| Missing receipt can be masked by another upload path | Confirmed workflow contract gap; failing workflow regression corrected with a separate single-path required receipt upload. |

Final correction-head source/package CI, receipt validation and independent
rechecks are recorded on PR #14. Neither prior green run nor a historical local
receipt is silently promoted to evidence for these corrections.

Correction validation: the stable local suite passed 406 files / 4,218 tests,
lint and build/budgets. Subsequent provenance-mode and builder/library guard
regressions passed after first failing; final focused check is 9 files / 101
tests plus lint. Reinspection of the original local Linux installers passes the
new launcher/inventory/lock-native controls and emits v2 `inspection-only`, with
pre-build capture explicitly false and the dirty inspection checkout retained.
Those installer hashes are unchanged from the local summary above; this is
functional gate evidence in x64 emulation, not a fresh build or lifecycle claim.

CI integration follow-up: validation runs a web build before the package command.
That earlier build also rewrites version metadata, so it now restores only that
generated file after rejecting other tracked/staged changes, then requires a
clean checkout. An executable shell regression fails before the change and
passes afterward, including preservation/rejection of an unrelated edit. This
keeps the package command's pre-build capture meaningful without ignoring a
pre-existing generated-file edit supplied by a caller. Run `34411977668` is
superseded by this correction; no result from it is promoted to the final head.
