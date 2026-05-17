# SAR Tracker Desktop Beta Releases

This directory holds the source-controlled record of every Tauri beta we share
with the team. Hosted Vercel iteration has its own change cadence; this folder
is exclusively for the desktop operational lane.

## Purpose

- Give every beta a written, dated record so testers know what they have and
  what to test.
- Make beta cuts repeatable. A future agent should be able to produce a beta
  by following the template here without inventing the process.
- Keep evidence (verification reports, smoke notes, CI run links) close to
  the release note so that incidents can be traced after the fact.

## Two Production Paths

There are now **two** ways to produce a desktop beta. Both must end with a
matching release note in this directory.

### Path A: CI-driven Linux + Windows release (default after B4)

This is the new default. The release pipeline at
`.github/workflows/release.yml` builds Linux and Windows artifacts in parallel
from a single tag, drafts a GitHub release, and uploads all assets plus a
`SHA256SUMS` sidecar.

Use this path for any beta that needs Linux or Windows artifacts. After B4
this is the only supported way to produce Linux or Windows artifacts.

macOS arm64 was deliberately dropped from the CI matrix to keep GitHub Actions
billed minutes inside the free tier (macOS bills at 10x the rate of Linux).
See `sartracker-web-590` for the deferred re-add when build cadence
stabilizes. Until then macOS uses Path B.

### Path B: Local-only macOS build

Retained for macOS artifacts. Produces a macOS arm64 `.app` zip via
`npm run beta:verify` as described in `docs/tauri-beta-release-plan.md`.
Upload the resulting zip to the GitHub release manually with
`gh release upload <tag> <file>` if a macOS artifact needs to ship alongside
the CI-built Linux/Windows assets.

## Authoring Workflow — Path A (CI-driven)

1. Confirm the version trio agrees:
   - `package.json#version`
   - `src-tauri/tauri.conf.json#version`
   - the tag you are about to push (without the `v` prefix)
2. Copy `TEMPLATE.md` to `sartracker-web-<version>-beta.md` (NO `-DRAFT`
   suffix at this point — see step 6). Fill in every required section. The
   workflow will fail loudly if this file is missing.
3. Commit the bumped version and the new release note in one commit, e.g.
   `chore(release): cut v0.1.0-beta.1`.
4. Tag the commit: `git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1`.
5. Watch the workflow at
   `https://github.com/donal0c/sartracker-web/actions`. Resolve any failure
   before proceeding — never paper over a red gate.
6. When the workflow ends green:
   - The draft release exists with all artifacts and `SHA256SUMS`.
   - Run the local smoke checklist on the primary platform (Linux) before
     publishing. The CI gate covers lint/test/build but cannot prove the
     packaged app actually launches and persists missions.
   - Update the release note with the smoke result and the CI run link.
   - Promote the draft:
     `gh release edit v0.1.0-beta.1 --repo donal0c/sartracker-web --draft=false`.
   - Record the release in `handoff/HANDOFF.md` with the CI run URL and the
     final asset list.

## Authoring Workflow — Path B (local macOS only)

Use this only when you explicitly do not need Linux or Windows artifacts.

1. Run `npm run beta:verify`. Resolve any failures before writing release
   notes — never paper over a red gate.
2. Copy `TEMPLATE.md` to `sartracker-web-<version>-beta-DRAFT.md`. Fill in
   the macOS section only; explicitly mark Linux and Windows artifacts as
   "not produced by this drop". Promote `-DRAFT` to a real note when the
   smoke checklist is signed off and the artifact is uploaded.
3. Reference the JSON evidence report path written by `beta-verify` under
   `tmp/beta-artifacts/`.

## Distribution

- Primary channel for the first internal betas: GitHub Releases on
  `donal0c/sartracker-web`, marked as **draft** and **prerelease**, with
  the title containing "internal beta".
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

- Local working copies stay under `tmp/beta-artifacts/` (gitignored).
- Shareable artifacts go to GitHub Releases via the draft/prerelease channel
  above. CI uploads them automatically; the local Path B flow uploads
  manually via `gh release upload`.
- Verification reports (Path B) stay under `tmp/beta-artifacts/` for the
  agent's local evidence and are referenced by relative path in the release
  note. CI runs are the equivalent evidence for Path A.

## When To Re-Cut

- Tag is immutable once pushed. If a build fails after upload, **do not
  delete the tag**. Bump to the next beta number (`v0.1.0-beta.2`) and cut
  again. The failed draft release should be deleted from GitHub Releases
  (not `git tag -d`) and the failure recorded in the new note's "What
  Changed" section.
- If a release is published (draft = false) and a critical issue is found,
  the next beta should explicitly call out the regression in its
  "What Changed" section and link the prior beta's known issue.
