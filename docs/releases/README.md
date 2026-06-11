# SAR Tracker Desktop Beta Releases

This directory holds the source-controlled record of desktop beta releases we
share with the team. Hosted Vercel iteration has its own change cadence; this
folder is exclusively for the desktop operational lane.

> **Current status:** Electron is the production desktop shell. The current
> release pipeline is `.github/workflows/electron-release.yml`, triggered by an
> `electron-v*` tag. The old Tauri `release.yml` has been **removed** (DON-143)
> so it can never be mistaken for the live path; its history is recoverable from
> git if ever needed. Use `docs/electron-beta-handoff.md` for the active
> Electron app + Discovery map loading process.

## Purpose

- Give every beta a written, dated record so testers know what they have and
  what to test.
- Make beta cuts repeatable. A future agent should be able to produce a beta
  by following the template here without inventing the process.
- Keep evidence (verification reports, smoke notes, CI run links) close to
  the release note so that incidents can be traced after the fact.

## Current Electron Release Path (DON-143)

The live release pipeline is `.github/workflows/electron-release.yml`. It is
triggered by an `electron-v*` tag push (or manual `workflow_dispatch`) and:

- builds the **Linux** AppImage + `.deb` on a native Linux runner (so
  `better-sqlite3` is real Linux x86-64; the workflow asserts this);
- creates a **draft + prerelease** GitHub release and uploads the Linux assets;
- runs an **Xvfb launch smoke** against the just-built AppImage (real window,
  non-black content, no runtime fault shell);
- generates and uploads a `SHA256SUMS` sidecar over every release asset;
- leaves the release in **DRAFT** for a human to review and publish.

App artifacts only. The build output is guarded against `.mbtiles` / licensed
map data, and no credentials, source URLs, or raw diagnostics are ever attached.

### Windows (opt-in, default OFF)

Windows NSIS is scaffolded (`electron-builder.json` `win`/`nsis`, the
`electron:dist:win` script, and a gated `bundle-windows` job) but **disabled by
default**. It only runs when `workflow_dispatch` is invoked with
`enable_windows=true`, which must not happen until the Windows official-map
smoke (`DON-141`) passes. We do not attach an unsmoked Windows installer to a
release.

### macOS (local, manual)

macOS arm64 is **not** built in CI (GitHub macOS runners bill at 10x). Produce
it locally and attach it to the draft release:

```bash
npm run electron:pack -- --mac --arm64
ditto -c -k --sequesterRsrc --keepParent \
  "tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app" \
  "tmp/sartracker-electron-validation_<version>_macos_arm64.zip"
gh release upload electron-v<version> --repo donal0c/sartracker-web \
  "tmp/sartracker-electron-validation_<version>_macos_arm64.zip"
```

If you add a macOS asset after CI ran, regenerate `SHA256SUMS` so it covers the
macOS zip too (either re-run the `checksums` job via `workflow_dispatch`, or
hash locally and `gh release upload --clobber SHA256SUMS`).

## Authoring Workflow — Electron release

1. Confirm `package.json#version` equals the version you are about to tag
   (the tag is `electron-v<version>`, e.g. `electron-v0.1.0-beta.4`). The
   workflow fails loudly if the tag and `package.json` disagree.
2. Copy `TEMPLATE.md` to `sartracker-electron-<version>.md` (e.g.
   `sartracker-electron-0.1.0-beta.4.md`). Fill in every required section.
   The workflow fails if this file is missing or empty.
3. Commit the version bump and the new release note in one commit, e.g.
   `chore(release): cut electron-v0.1.0-beta.4`.
4. Tag and push:
   `git tag electron-v0.1.0-beta.4 && git push origin electron-v0.1.0-beta.4`.
   (Optional: dry-run first via the Actions UI with `dry_run=true` to exercise
   gates + Linux bundle without creating a release.)
5. Watch the run at `https://github.com/donal0c/sartracker-web/actions`.
   Resolve any failure before proceeding — never paper over a red gate.
6. When the run ends green:
   - The draft prerelease exists with the Linux assets, the launch-smoke
     evidence, and `SHA256SUMS`.
   - Build and attach the macOS arm64 zip (see above) if macOS is in scope.
   - Run any remaining manual smoke (e.g. the official-offline map check) that
     CI cannot cover. CI proves lint/test/build + that the packaged AppImage
     launches; it does not prove mission persistence or offline maps.
   - Update the release note with smoke results and the CI run link.
   - Promote the draft:
     `gh release edit electron-v0.1.0-beta.4 --repo donal0c/sartracker-web --draft=false`.
   - Record the release in `handoff/HANDOFF.md` with the CI run URL and the
     final asset list.

## Distribution

- Primary channel for the internal betas: GitHub Releases on
  `donal0c/sartracker-web`, marked as **draft** and **prerelease**, with
  the title containing "internal validation".
- Release notes (this directory) are the single source of truth. The GitHub
  release description is built from the matching MD file plus a CI provenance
  footer; the description should not duplicate what is here, only reference
  it.
- A `SHA256SUMS` asset is generated on every CI-driven release. Testers
  should be told to verify their download against this file before running
  the artifact.

## Storage Rule

Only the markdown notes live in this directory. Build artifacts (the
installers themselves) must not be checked in:

- Local working copies stay under `tmp/electron-dist/` (gitignored).
- Shareable artifacts go to GitHub Releases via the draft/prerelease channel
  above. CI uploads the Linux assets and `SHA256SUMS` automatically; the macOS
  zip is uploaded manually via `gh release upload`.
- CI run pages (logs + launch-smoke evidence artifacts) are the evidence for
  the Linux build. Any manual smoke (offline maps, macOS launch) is recorded in
  the release note.

## When To Re-Cut

- Tag is immutable once pushed. If a build fails after upload, **do not
  delete the tag**. Bump to the next beta number
  (`electron-v0.1.0-beta.5`) and cut again. The failed draft release should be
  deleted from GitHub Releases (not `git tag -d`) and the failure recorded in
  the new note's "What Changed" section.
- If a release is published (draft = false) and a critical issue is found,
  the next beta should explicitly call out the regression in its
  "What Changed" section and link the prior beta's known issue.
