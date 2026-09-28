# WAR-11 Settings, Startup and Diagnostics-Privacy Repair

**Date:** 2026-09-17

**Baseline:** `67300313ab2bc800f9522f54e8de443fcb97fcae` (PR33 merge)

**Scope:** `WAR04-SET-01..03` and `WAR04-PRV-01..03` only

**Release effect:** closes the known six-finding repair input once the exact
repair head and required CI are merged; it does not qualify or release a beta.

## Repair contract

- A missing, corrupt, unreadable, or generation-mismatched credential never
  removes the mission shell. Tracking stays disabled with an actionable reason.
- Provider settings and credentials carry one generation. If either atomic
  publication fails, a later read cannot silently combine the old half with the
  new half. Full saves remain serialized and temporary paths are collision-safe.
- Startup support export succeeds when settings cannot be loaded and labels the
  unavailable boundary instead of inventing configuration values.
- Provider URL userinfo and credential-bearing query/fragment parameters are
  rejected in both renderer and Electron-main validation before persistence.
- Copied and exported reports remove the private profile root, provider URL
  credentials, nested renderer coordinates/secrets/paths, and direct-main
  coordinate fields.

## Evidence

The isolated WAR-04 reproductions were run before production changes: seven
tests failed and the existing concurrent-save serialization control passed.
After the repair, the same joined suite passes all eight tests:

```text
vitest --config scripts/assurance/war-04/settings-privacy/vitest.config.ts
2 files / 8 tests passed
```

The production regression layer adds the same boundaries to the ordinary unit
suite. Focused result: six files / 89 tests passed. UI validation additionally
tests raw, fragment and double-encoded credential parameter keys. Lint and the
production build pass with the lockfile dependency graph installed by
`npm ci`.

An independent exact-head review then found four missed cases. Tests-first
repairs now prove that legacy credential migration remains coherent across a
second startup, a corrupt app-owned credential file cannot resurrect a stale
legacy secret, support export recursively redacts coordinates already written
by older versions, and common OAuth-style query/fragment keys such as
`access_token`, `auth_token`, and `refresh-token` are rejected. The expanded
focused regression set passes 66/66 tests; lint and the production build pass.
A second review pass also proved that deleting a generated current credential
could revive a stale legacy secret; generated settings now make any missing
matching credential fail closed, with a dedicated restart regression. That
expanded review set passed 66/66 before the final migration probe. A final
red-first migration probe found that a corrupt legacy `secrets.json` could still
abort runtime bootstrap when the app-owned file was absent; legacy read errors
now use the same fail-closed tracking-disabled path, with a dedicated regression.

The repository's required stable source gate then passed in serial correctness
mode: 477 files passed, 5,074 tests passed and the six explicitly separated
wall-clock qualification cases were skipped as designed. This is correctness
evidence only; strict responsiveness remains a later release gate.

The arm64 macOS Electron directory package built successfully. The existing
packaged bad-secret smoke initially reached the correct shell and warning but
its text locator became ambiguous because the application now exposes the same
warning in two operator surfaces. The smoke was tightened to the canonical
`tracking-warning` control and its exact message; the retry passed and proved
the packaged shell remains available and Settings accepts credential re-entry.
This is a bounded local package check, not Linux or release-candidate proof.

The first broad run used a stale borrowed `node_modules` tree and is invalid as
product evidence: it lacked declared packages including `fast-check`,
`geojson-vt`, the pinned ASAR version and builder internals. After `npm ci`, the
latest ordinary suite passed 5,089 of 5,092 tests. Its three failures were
unrelated concurrent-load observations: a scratch-test timeout, a 217 ms legacy
recovery heartbeat, and the synthetic ASAR exact-match test. All three affected
files then passed together in isolated serial execution (129/129), including a
maximum observed recovery heartbeat of 12.93 ms. These reruns are retained as
flake observations, not permission to weaken or remove an assertion; required
CI remains authoritative for the exact repair head.

## Retained CI receipts

The first broad attempt recorded one transient `222.6 ms` packaged observer
timing excursion; rerun [`35228305218`](https://github.com/donal0c/sartracker-web/actions/runs/35228305218)
passed the same proof. Exact-head repair commit
[`f7cb1503`](https://github.com/donal0c/sartracker-web/commit/f7cb15032d089df9c54c5875e4fd00c57034b39c)
was covered by [`35235173989`](https://github.com/donal0c/sartracker-web/actions/runs/35235173989),
and the pre-PR34 baseline packaged run
[`35199520928`](https://github.com/donal0c/sartracker-web/actions/runs/35199520928)
also passed. The strict responsiveness step was skipped in these workflow
receipts; they are retained repair/baseline evidence, not final-candidate
qualification.

## Remaining boundary

This repair does not change the accepted trusted-machine plaintext credential
model, resolve free-form/double-encoded diagnostic-text hypotheses, qualify a
packaged platform, close other WAR investigations, freeze a candidate, run
BCP-17/WAR-12, or authorize publication. Those remain in the locked release
train under `DON-254` and `DON-255`.
