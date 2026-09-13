# Second review local verification

Candidate: second-review diff atop `dc49da45`; the terminal PR23 receipt binds
the resulting commit and fresh Linux CI. This record does not predeclare CI.

- Stable `npm run test:correctness`: 442 files, 4,634 passed, six qualification-only
  skips, 460.69 seconds. An earlier run was interrupted for a final cancellation
  regression and is not a pass.
- Whole lint passes. Build initially rejected an optional-property TypeScript
  annotation; `NonNullable` correction emits byte-identical JavaScript
  ([proof](type-only-proof.log)). Build and bundle budgets then pass.
- Focused native/client/runtime regression controls retain red/green logs here.
  Browser visual flow passes loading, completion and failure; independent
  inspection passes both loading and failed-history screenshots.
- Rebuilt macOS package [report](package-report.json): hidden window with
  background throttling disabled, 103,626/103,627 exact ordered rows, transfer
  1,173.1/1,278.6 ms, exact dots during transfer 21.7/23 ms, 1,434 progress events
  each. Main maximum 55.21 ms, renderer 18.1 ms, current write 2.7 ms. Repeated
  same-ID reloads obtain different snapshot tokens. Setup and both closes exit 0.
- First package attempt hit Playwright's unload-dialog handling race
  ([failure](package-dialog-failure.log)); Electron can close the dialog before
  Playwright handles it. The smoke now owns that handler, tolerates only the
  specific already-closed-dialog response, and asserts other dialog failures.
  Independent review caught a missing join of those handler promises; they now
  join after application close before the final error assertion. The final
  recheck and repeat pass on the same package; no application code changed.

This is a synthetic direct production-client probe over packaged native
boundaries, not automatic restart hydration, field acceptance, or full-candidate
qualification. The hidden-window fallback is explicit; this is not a five-minute
Chromium throttling simulation. Absolute lifetime and delayed-exit behavior have
deterministic session controls. The separate DON-277 210.8 ms reviewer-reported
failure and 11.8 ms isolated pass remain retained without a causal repair claim.
