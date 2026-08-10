# SAR Tracker Electron Desktop Beta 0.1.0-beta.12.9

> **Internal beta draft.** Do not share or use for a live incident until every
> packaged gate below is recorded green and the guarded prerelease is
> published.

- **Version:** 0.1.0-beta.12.9
- **Build tag:** `electron-v0.1.0-beta.12.9`
- **Cut date (UTC):** 2026-08-10
- **Linear reference:** `DON-260`
- **Supersedes:** published beta.12.5
- **Replaces:** unpublished beta.12.6, beta.12.7, and beta.12.8 candidates
- **Tag commit, CI run, and artifact checksums:** pending

## Release purpose

Beta.12.5 could take roughly nine minutes to fill a 36-hour breadcrumb window
and could show route gaps absent from Traccar. The corrected pipeline publishes
current fixes immediately, drains two-hour history windows continuously with
at most eight concurrent requests, persists each fetched wave and its durable
frontiers atomically, resumes after crashes, preserves an error-bounded route,
and cancels stale mission work safely.

The release process rejected three candidates rather than weakening a gate:
beta.12.6 missed the 60-second Ubuntu persistence deadline, beta.12.7 exceeded
an under-specified CI unit-test timeout, and beta.12.8 returned exact history
but restarted at `10.177 s` / `9.892 s` against a `10 s` render limit.

Beta.12.9 fixes the last measured bottleneck. SQLite had selected the
mission/device/timestamp index for each 500-row hydration batch, rescanning the
279,936-row mission as many as 215 times. Selected rows now use direct rowid
primary-key lookups. The exact Ubuntu query fell from `4.642 s` to `1.315 s`
with the same 103,633 retained identities. The packaged proof now runs three
completed-history restarts by default and records launch, mission-resume,
first-exact, and stable-render timing; signal exits are cleaned up and reported
instead of being misclassified as 60-second CDP timeouts.

## Required qualification

- [ ] Clean no-skip local `npm run beta:verify`
- [ ] Annotated tag and green tag-driven workflow
- [ ] Exact AppImage and `.deb` match `SHA256SUMS`
- [ ] Exact CI AppImage 36-hour fault/503/SIGKILL/checkpoint proof completes
      within 60 seconds with `279,936/279,936`, integrity `ok`, max history
      concurrency 8, and exact line/dot render oracles
- [ ] Three consecutive post-completion restarts each render exact stable
      history within the unchanged 10-second gate, with a measured maximum no
      greater than 8 seconds for release margin
- [ ] Exact CI AppImage 14-day soak matches all `1,935,384` rows and five-day
      prefix through two restarts, WAL/integrity, responsiveness, and 2 GiB RSS
- [ ] Native Ubuntu AppImage and real installed `.deb` pass lifecycle,
      recovery/finalize/archive, coordinate rejection, sanitized exports,
      corrupt credentials, duplicate launch, and live Traccar
- [ ] Release note, handoff, and Linear contain exact evidence
- [ ] Guarded publish succeeds and fresh public bytes plus final Ubuntu
      AppImage lifecycle smoke re-verify

## Known limits

Internal Linux x86-64 field-test build only; unsigned; no auto-update; not final
operational acceptance and not approved for live incidents. No private
Discovery package is bundled. Full accepted breadcrumb truth remains in SQLite;
the map uses a deterministic bounded representation with an explicit geometry
error bound.

## Rollback

Quit SAR Tracker and return to the qualified beta.12.5 artifact. Uninstalling
does not remove per-user mission databases; capture diagnostics first.
