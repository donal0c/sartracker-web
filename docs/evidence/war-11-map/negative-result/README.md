# Negative Check View result retention

The actual hook and Chromium operator flow first publish incomplete coverage.
A later `sartracker:official-map-tile-failed` event originally erased it and
displayed Current view not checked. The [unit red log](use-official-map-view-qualification-red.log)
and [browser red log](browser-negative-result-red.log) retain the failing evidence.

The repair preserves a current published negative/unavailable result after a
redundant tile failure. Positive and pending results still invalidate. Movement,
active map changes, settings/package changes and focus still reset stale state;
a fresh successful recheck can restore readiness. Bare failure events have no
source/package-generation attribution; retaining a newer negative result after
an old failure remains conservative and does not promote readiness.

The [final Chromium run](browser-negative-result-final.log) passes the operator
flow, including positive withdrawal, negative retention, package restoration and
successful recheck. [The screenshot](browser-negative-result-retained.png) shows
the retained incomplete result. Browser native responses are mocked; React and
MapLibre are real. The final focused hook suite passes 12 tests, with independent
review. [The receipt](receipt.json) records byte hashes and the final source manifest.

Packaged attempt 3 predates this repair and remains FAILED. No new Electron
build or run was performed; source/browser proof does not establish the repaired
packaged transition or retrospectively establish its unrecorded event ordering.
