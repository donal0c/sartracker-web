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

- refuses to continue unless release notes exist and the tag matches
  `package.json#version`;
- runs lint, unit tests, web build, and the standard Chromium Playwright E2E
  suite before any artifact is bundled; the local no-skip beta verifier also
  gates the legacy backend compatibility suite;
- builds the **Linux** AppImage + `.deb` on a native Linux runner (so
  `better-sqlite3` is real Linux x86-64; the workflow asserts this);
- creates a **draft + prerelease** GitHub release and uploads the Linux assets;
- runs an **Xvfb launch smoke** against the just-built AppImage (real window,
  non-black content, no runtime fault shell);
- generates and uploads a `SHA256SUMS` sidecar over every release asset;
- leaves the release in **DRAFT** until the exact Linux assets pass the complete
  qualification matrix and the guarded publisher re-verifies them.

App artifacts only. The build output is guarded against `.mbtiles` / licensed
map data, and no credentials, source URLs, or raw diagnostics are ever attached.

### Windows (disabled)

Windows NSIS remains configured in `electron-builder.json` and available as the
local `electron:dist:win` development script, but the release workflow has no
Windows job or input. `DON-141` must first add Windows CI build provenance,
packaged smoke rows, and guarded-publisher support. We do not attach an
unsmoked Windows installer to a release.

### macOS (not attached)

macOS arm64 is **not** built in CI or attached to this release lane. A future
macOS beta must add a pinned CI build, its own packaged smoke matrix, and
guarded-publisher support. The publisher rejects any extra distributable.

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
   - Download the exact draft AppImage, `.deb`, and `SHA256SUMS`; qualify both
     Linux artifacts and the installed `.deb` on Ubuntu.
   - Treat a non-zero `apt` exit as blocking until the raw apt/dpkg logs identify
     every failing package. If the SAR package itself is `install ok installed`,
     all declared dependencies are satisfied, `dpkg -V` is clean, and the
     installed executable passes its smoke, an unrelated pre-existing host
     package failure may be recorded as an environment note rather than a SAR
     artifact failure. Retain the raw logs and never describe the aggregate apt
     transaction as clean.
   - Run every remaining packaged smoke that CI cannot cover. CI proves
     lint/unit/build, standard Chromium E2E, and that the packaged AppImage
     launches; it does not prove the full mission lifecycle, live Traccar,
     duplicate-launch behavior, or an offline map package.
   - Replace every pending/local-only matrix row in the draft body with final
     evidence paths and full AppImage/`.deb` SHA-256 values.
   - Promote only through the guarded publisher:
     `npm run electron:release:publish -- --tag electron-v<version> --repo donal0c/sartracker-web`.
   - Record the release in `handoff/HANDOFF.md` with the CI run URL and the
     final asset list.

## Distribution

- Primary channel for the internal betas: GitHub Releases on
  `donal0c/sartracker-web`. The workflow creates a **draft prerelease** first;
  after CI evidence, manual smoke evidence, and release notes are checked, the
  guarded publication succeeds, the release becomes a published **prerelease**
  with "internal validation" in the title.
- Release notes (this directory) are the durable source record. The draft
  release body starts from the matching MD file plus CI provenance, then gains
  exact-artifact evidence before guarded publication. The source note is
  reconciled in the release closeout commit.
- Draft releases are not shared with testers until the release note includes
  a completed smoke matrix for the CI-built artifact. Any unexplained flake,
  failed smoke, missing browser validation, or stale handoff/Linear state is a
  release blocker.
- A `SHA256SUMS` asset is generated on every CI-driven release. Testers
  should be told to verify their download against this file before running
  the artifact.

## Storage Rule

Only the markdown notes live in this directory. Build artifacts (the
installers themselves) must not be checked in:

- Local working copies stay under `tmp/electron-dist/` (gitignored).
- Shareable artifacts go to GitHub Releases via the draft/prerelease channel
  above. CI uploads only the qualified Linux candidates and `SHA256SUMS`.
- CI run pages (logs + launch-smoke evidence artifacts) are the evidence for
  the Linux build. Exact-artifact Ubuntu evidence is recorded in the release
  body and reconciled into the source release note.

## When To Re-Cut

- Tag is immutable once pushed. If a build fails after upload, **do not
  delete the tag**. Bump to the next beta number
  (`electron-v0.1.0-beta.5`) and cut again. The failed draft release should be
  deleted from GitHub Releases (not `git tag -d`) and the failure recorded in
  the new note's "What Changed" section.
- If a release is published (draft = false) and a critical issue is found,
  the next beta should explicitly call out the regression in its
  "What Changed" section and link the prior beta's known issue.
