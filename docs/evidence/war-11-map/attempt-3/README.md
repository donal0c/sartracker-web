# WAR-11 packaged attempt 3 — FAILED

This was one coordinated macOS ARM64 run using disposable synthetic MBTiles and
blocked renderer HTTP/S access. [The receipt](receipt.json) binds the unchanged
package and source manifests, process exit, failure and screenshot hashes.

- [Replacement B](02-synthetic-replacement-map.png): visible synthetic replacement
  raster, 15/15 current-view tiles verified and Field ready.
- [Automatic removal](03-automatic-removed-map.png): captured before Save, tile
  fetch or Check View; raster withdrawn, package unreadable, Not field ready.
- [Final failure](workflow-failure.png): after the final removed-package Check
  View click, the mounted Maps popover remains at Current view not checked with
  a missing-package warning. The result-text assertion timed out.

Electron exited 0/signal null without teardown escalation; the runner exited 1.
No new or changed Electron/SAR crash report or residual SAR process was observed.
The original earlier decoder-test crash is separate and remains unexplained.

The complete packaged matrix did **not** pass. In particular, this artifact
predates the subsequent negative-result state repair; that repair has no new
packaged verification. Native event chronology around the final click was not
captured. The 38 blocked-resource console messages have no retained request URLs
and remain unclassified. Source-attributed service-worker diagnostics are not
allowlisted. Raw local logs and private process/crash material are not included.

See [the remediation record](../../../assurance/findings/war-11-offline-map-remediation.md)
for source, browser, review and release limitations. Release remains HOLD.
