# WAR-11A — AppImage builder remediation

Status: implemented for unmerged review; native Ubuntu PR qualification pending.
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
DON-146's existing Done state does not prove its runtime upgrade or SIGTRAP
hypothesis; this bounded builder work does not fulfil those acceptance criteria.

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
