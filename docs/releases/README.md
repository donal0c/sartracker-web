# SAR Tracker Desktop Beta Releases

This directory holds the source-controlled record of every Tauri beta we share
with the team. Hosted Vercel iteration has its own change cadence; this folder
is exclusively for the desktop operational lane.

## Purpose

- Give every beta a written, dated record so testers know what they have and
  what to test.
- Make beta cuts repeatable. A future agent should be able to produce a beta
  by following the template here without inventing the process.
- Keep evidence (verification reports, smoke notes) close to the release note
  so that incidents can be traced after the fact.

## Structure

- `TEMPLATE.md` — canonical template. Copy it, do not edit it in place.
- `sartracker-web-<version>-beta.md` — one file per real beta cut.
- `*-DRAFT.md` — release notes that have not yet been shared. Promote a draft
  by removing the `-DRAFT` suffix and the draft banner once the artifact is
  uploaded and the verification report is attached.

## Authoring Workflow

1. Run the verification gate: `npm run beta:verify`. Resolve any failures
   before writing release notes — never paper over a red gate.
2. Copy `TEMPLATE.md` to `sartracker-web-<version>-beta-DRAFT.md`. The version
   string must match `package.json` and `src-tauri/tauri.conf.json`.
3. Fill in every required section. Leave the `-DRAFT` suffix until the
   artifact is uploaded and the smoke checklist is signed off.
4. Reference the JSON evidence report path under `tmp/beta-artifacts/`. The
   relative path written by `beta-verify` is the canonical reference.
5. Promote: rename the file to drop `-DRAFT`, drop the draft banner, and
   record the release in `handoff/HANDOFF.md`.

## Distribution

- Primary channel for the first internal betas: GitHub Releases on
  `donal0c/sartracker-web`, marked as **draft** and **prerelease**, with
  access limited to the team via the "internal beta" tag in the title.
- Release notes (this directory) are the single source of truth. The GitHub
  release description should link to the corresponding file here, not
  duplicate it.
- macOS arm64 `.app` zips are the only currently proven artifact (see
  `docs/tauri-beta-release-plan.md`). Do not upload other platforms until
  packaging is proven on a real build host.

## Storage Rule

Only the markdown notes live in this directory. Build artifacts (the `.app`
zip itself) must not be checked in:

- Local working copies stay under `tmp/beta-artifacts/` (gitignored).
- Shareable artifacts go to GitHub Releases via the draft/prerelease channel
  above.
- Verification reports stay under `tmp/beta-artifacts/` for the agent's local
  evidence and are referenced by relative path in the release note.
