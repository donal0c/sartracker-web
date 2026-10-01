# beta.13.6: release-note lines collected during development

Fold these into `sartracker-electron-0.1.0-beta.13.6.md` (from TEMPLATE.md)
at release time. The coordinator owns this file; sessions send lines to the
coordinator.

## Upgrade (DON-309)

**Upgrading is one-way.** 13.6 updates the mission database (schema 13 → 14)
so a restored GPX track replays truthfully. After you open a profile in 13.6,
13.5 refuses it. To be able to roll back, copy `~/.config/sartracker-web`
before the first 13.6 start. Archives made by 13.6 can only be reviewed in
13.6 or later; archives made by 13.5 still open in 13.6.

## GPX (DON-309)

**Bring back a retired GPX track:** import the same file again with Import
Files. The track returns with its colour and name, Review records the restore,
and Replay keeps it hidden for the time it was retired. A watched folder never
restores a track.
