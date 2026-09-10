# Linux GitHub-follow-up receipt

[Run 34496976736, attempt 2](https://github.com/donal0c/sartracker-web/actions/runs/34496976736/attempts/2)
passed all normal steps at clean source `713461bfa4018f8009e51660618515f78b8e23c0`,
tree `867d22df5a9e5fceef591e8f472d25d2c1b019cb`: **427 files / 4,377 tests**,
lint/build, package, 960k replay, native SQLite, tracking soak, archive lifecycle,
terminal evidence and AppImage launch/graceful close. Artifact **10162802100**,
created 2026-09-10 16:39:41 UTC, was downloaded separately from attempt 1.

The parsed [inspection](linux-ci-attempt-2-inspection.json) verifies clean source,
matching AppImage/deb/unpacked ASARs, SQLite integrity/ABI, archive/soak executable
identity, all sampled archive phases, restart/cleanup/privacy and exact soak
position truth. ASAR is `e913bc32b55e0827a15d4ff8b7abb003f672bb2e484d8f8be0a9f51cf780f826`.
Installer and raw receipt SHA-256 hashes are in that inspection. The AppImage
screenshot shows a rendered map, ready/idle shell and explicit unconfigured
tracking; graceful window close passed.

Archive maxima were **193 ms current fixes / 84.38 ms main / 118.9 ms frames**,
all below the unchanged strict 200 ms gate. Both launches exited. Interrupted
restore was swept; cleanup moved 5,516 rows, leaving none live. No secret match
or terminal plaintext residue was found. Replay maximum was 83.16 ms; soak
retained exactly 8,664 positions with no renderer crash and graceful restart.

This is not universal sub-200 ms or release evidence. Soak renderer telemetry
reached **499.9 ms**, with 13 samples above 250 ms; external action timing reached
**374.58 ms** (one above 250 ms), internal action timing 90 ms, and main 101.55 ms.
The soak uses a separate 1,000 ms freeze gate. DON-254 retains these observations
alongside prior 466.7/416.7/333.3 ms renderer observations.

Attempt 1's [224 ms failure](linux-ci-attempt-1-archive-failure.json) remains
unexplained. The one repeat followed timing-trace and changed-path inspection;
no code, threshold or graphics change was made. The unavailable failed binary
and lack of a narrower hosted entrypoint required rebuilding the same source.
Attempt 2 proves its own pass, not a causal fix or erasure of attempt 1. This
supports review of the bounded repair; DON-254 qualification remains open.

Any following documentation-only closeout commit reuses these unchanged
application/test/build/probe inputs; it is not a new executable CI claim.
