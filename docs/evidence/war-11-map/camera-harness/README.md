# Camera setup correction — source-only evidence

The preceding [Linux run](../linux-ci-34776633574/README.md) failed with a loaded
official source at camera zoom 12 instead of the synthetic target zoom 11. Its
10-second render deadline expired. The captured final camera is direct evidence;
the native event order leading to it was not recorded.

The production `applyMapStylePreservingCamera` helper registers a later
`styledata` callback after `setStyle`. A source-only reproduction with that
helper and MapLibre Evented demonstrates that restoration can overwrite an
early harness camera jump. A separate Chromium trace observed the opposite,
safe ordering. Neither result establishes the unrecorded Linux chronology.

The correction is confined to the smoke harness and its tests. It waits for
camera restoration, moves to and verifies the finite synthetic target camera,
then enters the original 10-second source/GPU readiness window. Setup and cleanup
have explicit bounds. Production camera preservation, fixture extent and the
qualification assertions are unchanged.

The first added camera tests were not independently captured failing before
their implementation. Their later green output must not be presented as a
red-first test cycle. The preceding CI failure remains separate regression
evidence. Two injected synchronous-event controls failed before their respective
corrections, including the install-to-click task gap that caught the first
timer-based correction. They use the actual production preservation helper and
the observer called by the smoke; injected ordering is a robustness control,
not a claim about the failed Linux event sequence.

The selection coordinator controls were added after implementation and have no
pre-fix red receipt. Isolated post-implementation sensitivity checks establish
that their assertions detect removed cleanup (two failures) and removed expired
deadline rejection (one failure). The unchanged copied control passes all three
selected tests. This is gate-sensitivity evidence, not a retrospective TDD claim;
the working source was not modified for these controls.

The [receipt](receipt.json) binds all three changed input hashes, the 1,170
unchanged prior inputs, commands and raw logs. Final focused checks pass 39/39
(27 harness, 12 hook); TypeScript, targeted lint, syntax and whitespace checks
pass. The original 10-second render deadline is unchanged. The 15-second setup
budget covers selection, restoration and target-camera movement; failure cleanup
has its own bounded one-second path and cannot admit a late successful result.

There was no further local Electron launch or rebuild. Source-only tests do not
qualify the packaged workflow; a fresh remote Linux run is required. The earlier
macOS failures, decoder crash and unclassified console messages remain open in
their original records.
