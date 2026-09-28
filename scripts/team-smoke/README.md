# team-smoke

Runs the automatable rows of the [release checklist](../../docs/release-checklist.md)
against an exact, already-built release artifact and prints the release-note
table. It never builds the app. The product is identified by artifact SHA-256;
the tool's own git commit is recorded separately, so a tool fix is re-run
against the same bytes.

## Run on the Ubuntu test box

```sh
npm ci                                     # tool checkout; any reviewed commit
gh release download electron-v<version> --dir ~/rc   # exact draft assets
sudo apt install ./rc/*.deb                # needed for the installed-payload check
node scripts/team-smoke/run.mjs \
  --deb ~/rc/*.deb --appimage ~/rc/*.AppImage --sha256sums ~/rc/SHA256SUMS \
  --previous-profile <copy of a profile made by the team's current release> \
  --out ~/smoke-<version>
```

- Tests the installed `.deb` by default; pass `--app <file>` (and
  `--app-arg --no-sandbox` for an AppImage) to test something else.
- If Chromium blocklists the machine's GPU the app shows a blank window (no
  WebGL). The repo's other packaged smokes pass `--app-arg --ignore-gpu-blocklist`;
  do the same and say so in the release note. Launch args are recorded in
  `results.json`.
- `--only lifecycle,tracking` runs selected checks. Check ids are printed with
  every result.
- Over SSH it borrows the logged-in desktop display automatically. Start long
  runs detached so a dropped session cannot stop them:
  `setsid nohup node scripts/team-smoke/run.mjs … > run.log 2>&1 < /dev/null &`.
- Every launch uses a fresh profile under `--out`; real profiles are never
  touched. Processes are killed by process group when a check ends.
- Output: `results.md` (paste into the release note), `results.json` (tool
  commit, artifact hashes, timings), and per-check logs and screenshots.

A full run takes about 25 minutes. Rows not automated here (live Traccar, large
mission, soak, strict responsiveness, offline maps, CI run) show as NOT TESTED
and are filled in by hand from the sources the checklist names.

## Results

- **PASS** — the check ran and the product behaved correctly.
- **FAIL** — the product behaved wrongly (`ProductFailure`); the evidence says what.
- **NOT TESTED** — a prerequisite was missing or the tool itself failed. A tool
  error is missing evidence, not a product result. Verify by hand if cheap;
  if a check fails twice on the same step, stop fixing it during a release.

## Adding or changing a check

A check is `{ check, id, run(ctx) }` in `checks/`. `check` must be a name from
`build/release-checklist.js`. Throw `ProductFailure` (via `expectProduct`) only
for wrong product behaviour, `NotTested` for missing prerequisites; anything
else is reported as a tool error. Verify outcomes in SQLite (`lib/store.mjs`),
not only on screen. Use the real-time mock in `lib/mock-traccar.mjs`; the older
`tools/mock-traccar` replay server emits historical times that a fresh mission
rejects. Keep checks short: no receipts, judges, locks or fixture hashing.
