# WAR-04 Platform-Services Resilience Investigation

**Scope:** local offline-map readiness, local settings/credential startup safety,
and locally generated diagnostics/support-output privacy

**Exact investigation base:** `3d0d36b3874947d3d620bdb5262d9cd2d7233fcf`

**Branch:** `codex/war-04-platform-services-audit`

**Evidence boundary:** defensive quality assurance over repository code and
synthetic disposable data only. No shipping code, dependency, release control,
live provider, licensed map, external host, real credential, or operational data
was changed or exercised.

## 1. Judgment

WAR-04 confirmed nine bounded defects across three coherent seams:

| ID | Result | Severity | Later repair cluster |
| --- | --- | --- | --- |
| `WAR04-MAP-01` | a removed registered package remains `Field ready` | High | WAR-11 map qualification and freshness |
| `WAR04-MAP-02` | an unusable or incomplete tile set can be certified and served as ready | High | WAR-11 map qualification and freshness |
| `WAR04-MAP-03` | same-path package replacement leaves the live SQLite reader on stale content | High, bounded trigger | WAR-11 map qualification and freshness |
| `WAR04-SET-01` | an unreadable credential file fails the whole runtime bootstrap instead of disabling tracking | High | WAR-11 settings/startup consistency |
| `WAR04-SET-02` | settings and credential writes can leave a cross-paired provider configuration | High | WAR-11 settings/startup consistency |
| `WAR04-SET-03` | corrupt settings also disable the support export offered by the startup-fault shell | Medium | WAR-11 settings/startup consistency |
| `WAR04-PRV-01` | the operator's `Copy Report` action includes the full Electron profile path | Medium | WAR-11 diagnostics allow-listing |
| `WAR04-PRV-02` | credential-bearing URL query/fragment forms can be persisted and included in copied/support output | High | WAR-11 diagnostics allow-listing |
| `WAR04-PRV-03` | nested renderer fields and direct main-log coordinates cross the export boundary unsanitized | Medium control defect; potentially high consequence | WAR-11 diagnostics allow-listing |

“High” here means the reproduced state can misstate navigation readiness,
remove the operational shell, cross-pair a provider secret, or expose a
credential/precise coordinate and therefore needs correction before a stronger
readiness claim. “Medium” is a real recovery/privacy contract failure with a
more bounded current trigger. These are investigation judgments, not a release
or field-safety verdict.

The intentionally failing probes are isolated behind custom Vitest configs
under `scripts/assurance/war-04/`; the repository's normal Vitest configuration
does not include them. They are evidence for the later WAR-11 repair train, not
tests that make the ordinary suite red.

## 2. Method and proof tier

The root retraced every confirmed result after independent map and
settings/diagnostics lanes. Each confirmation below contains:

1. the production call/data path;
2. a deterministic red test over production modules;
3. consequence and severity;
4. the exact existing-control escape.

The proof is `T2`: local integration with real production modules, real SQLite
handles, synthetic MBTiles, disposable Electron-profile directories, and one
narrow Playwright-managed headless-Chromium image-decode oracle on macOS. Source
tracing joins the renderer/main boundaries named below. No local package was
necessary because none of the reproduced behavior exists only in a packaged
binary.

### State space exercised

| Surface | Exercised locally | Disposition |
| --- | --- | --- |
| MBTiles registration | missing path, non-SQLite/wrong schema, nonzero valid schema, unreadable tile bytes, absent requested tile | wrong schema/missing at registration cleared; content/coverage qualification confirmed deficient |
| Package lifecycle | removal after validation, app-owned atomic same-path replacement, fresh versus cached SQLite reader, explicit invalidation | two freshness defects confirmed; explicit invalidation cleared |
| Readiness join | persisted registry → checklist → operator label → tile proxy | false-positive `Field ready` confirmed |
| Credential reads | missing, zero-byte/garbage/foreign-shaped JSON, directory substituted for file, local permission-denied read | normal corruption degrades safely; non-`ENOENT` read failure confirmed to abort bootstrap |
| Settings reads | missing, zero-byte/garbage JSON, out-of-range intervals | missing/default and bounded normalization cleared; malformed JSON fails visibly |
| Settings writes | credential-write failure, failure after credential commit, identical-timestamp collision, controlled unique-temp concurrent interleaving | first failure ordering cleared; cross-file atomicity/serialization defect confirmed |
| Provider URL | ordinary URL, raw/encoded userinfo, raw/percent-encoded `session` query key/value, double-encoded `session` value, and fragment-borne placeholder credential | userinfo rejection cleared; credential-bearing query/fragment persistence and copied/support export confirmed |
| Support output | renderer report, Copy Report, Electron diagnostics/support join, startup-fault export, incident-format join | three privacy/recovery defects confirmed |
| Encodings | canonical POSIX and Windows paths, UNC, JSON-escaped nested data, percent/double-percent path text, nested secret/coordinates | canonical controls cleared; representation-sensitive gaps split between confirmed current boundaries and unproven producer cases |
| DON-264 | overlay-sync retry/error path versus all WAR-04 production seams | no exact overlap; left separately owned |

## 3. Confirmed findings

### WAR04-MAP-01 — removed package remains `Field ready`

**Invariant:** readiness must mean the selected local package is still readable;
a prior metadata result cannot remain a positive operational verdict after the
file disappears.

**Production path:** `electron/settings-store.cjs:636-687` validates the package
only during save. Later loads trust persisted status and metadata at
`electron/settings-store.cjs:552-634`. The renderer checklist consumes that
status, timestamp, bounds, and zoom metadata at
`src/features/map/field-readiness-checklist.ts:34-70,87-94,130-153,201-238`,
then the hook/UI publish `Field ready` through
`src/features/map/use-field-readiness-checklist.ts:43-57,78-106` and
`src/components/basemap-switcher.tsx:184-233`. Only when a tile is requested
does `electron/official-map-proxy.cjs:274-323` reopen the missing file and fail.

**Red reproduction:** `does not keep a registered package field-ready after the
file disappears` in
`scripts/assurance/war-04/maps/official-map-readiness-red.test.ts`. It registers
a valid synthetic package, removes it, creates a fresh settings store, and joins
the registry, checklist, and real proxy. Observed: status `ready`, verdict
`ready`, label `Field ready`, followed by `Official map package is unreadable.`

**Consequence/severity:** High. An operator can leave connectivity after a
positive readiness check and only discover the missing map at use time.

**Escape analysis:** the existing save-time test proves that a path already
missing during Settings save becomes `missing`; it does not remove a package
after a successful validation and rejoin the checklist. The checklist tests
receive already-classified metadata and never re-stat the package.

### WAR04-MAP-02 — unusable or incomplete tile content is certified as ready

**Invariant:** declared metadata and a nonzero row count cannot establish that
the required view has decodable map tiles.

**Production path:** `electron/settings-store.cjs:636-743` checks the file,
required tables, metadata, bounds, zoom range, and nonzero tile count but never
checks a requested tile's presence or decodes `tile_data`.
`electron/official-map-proxy.cjs:185-194,274-299,337-346` labels returned bytes
from persisted format metadata. The same checklist path as `WAR04-MAP-01`
therefore publishes `Field ready` from declared bounds.

**Red reproductions:** two tests in
`scripts/assurance/war-04/maps/official-map-readiness-red.test.ts`:

- `does not label or serve a tile row whose bytes are not a decodable PNG`
  registers `not-a-decodable-png`; observed status/readiness are `ready`, and
  the proxy returns the bytes as `image/png`; a local Playwright-managed
  headless-Chromium decoder rejects them even though the proxy serves them as
  image content.
- `does not certify declared coverage when the requested in-bounds tile is
  absent` registers one valid tile elsewhere while metadata covers the target;
  observed verdict is `Field ready`, then the target returns the visible
  no-coverage hatch.

**Consequence/severity:** High. A locally present package can satisfy the
pre-deployment check while the required map is blank/unrenderable or incomplete.
The hatch is a useful use-time fallback, but it does not make the earlier
positive readiness statement true.

**Escape analysis:** existing tests prove schema/metadata transport. In
particular, `tests/unit/electron-official-map-proxy.test.ts` treats arbitrary
short bytes as a successful PNG response. No existing test joins tile
decodability or required-view tile presence to the positive checklist verdict.

### WAR04-MAP-03 — same-path replacement retains stale live tiles

**Invariant:** after the app replaces a package, the live reader must either
serve the replacement or mark readiness unavailable; it must not keep serving a
different inode under the same path.

**Production path:** the importer atomically copies then renames at
`electron/file-system.cjs:93-130`. Its IPC handler at
`electron/main.cjs:724-730` does not invalidate map readers. The proxy caches a
SQLite reader by package path and persisted-metadata fingerprint at
`electron/official-map-proxy.cjs:204-323`, neither of which changes during a
same-path replacement. Successful Settings save does invalidate readers at
`electron/main.cjs:642-647`, but import itself does not. The operator-reachable
path is `src/components/settings-workspace.tsx:943-981` through
`electron/preload.cjs:532-537`: choosing a package completes the irreversible
copy/rename before Settings save. Discard at
`src/components/settings-workspace.tsx:861-873` closes the draft but does not
undo or invalidate that imported file.

**Red reproduction:** `switches a live reader to the package atomically imported
at the same path` uses the production store, proxy, SQLite reader, and importer.
A fresh handle sees the replacement bytes while the live proxy still serves the
old bytes; `invalidateSettings()` immediately switches it to the replacement.

**Consequence/severity:** High safety impact with a bounded trigger. Old or wrong
map content can remain visible after the app-owned library changes. The window
is the directly reachable import-before-save state, discard/save failure, or
another same-path replacement.

**Escape analysis:** existing tests separately prove atomic import and successful
Settings-save invalidation. They do not keep a live SQLite reader open across
the production rename or exercise the import/discard window.

### WAR04-SET-01 — unreadable credential file aborts runtime bootstrap

**Invariant:** a missing, corrupt, or unreadable provider credential disables
tracking with a warning; it must not remove the mission shell.

**Production path:** `electron/settings-store.cjs:116-145` reads the credential
during runtime bootstrap. `readCredentials()` at
`electron/settings-store.cjs:350-371` degrades `ENOENT` and JSON parse failures
but rethrows other filesystem read failures. That rejection propagates through
`src/features/runtime/start-app-runtime.ts:250-255,284-304` into
`src/features/runtime/bootstrap-app-runtime.ts:85-104`, producing the failed
boot shell instead of a tracking-disabled runtime.

**Red reproduction:** `keeps the shell operable with tracking disabled when
credentials cannot be read` substitutes a directory at `credentials.json` and
calls the production bootstrap-settings loader. Observed: deterministic
`EISDIR` rejection rather than a resolved `trackingConfig: null`. A separate
local mode-`000` probe produced the same branch as `EACCES`; that permission
behavior is not claimed cross-platform.

**Consequence/severity:** High availability impact. A local profile permission
or file-type fault disables every mission function, although the generic fault
shell remains visible.

**Escape analysis:** tests cover absent, garbage, legacy, and undecryptable
credential content. Those paths either return empty credentials or a reviewed
unsafe reason. The non-`ENOENT` filesystem-read branch had no joined bootstrap
test despite its comment promising any read failure would degrade safely.

### WAR04-SET-02 — settings and credential writes can cross-pair

**Invariant:** provider URL/identity and its credential form one configuration;
an interrupted or concurrent save must expose either the complete old pair or
the complete new pair, never a mixture.

**Production path:** `saveAppSettings()` writes the credential first and settings
second at `electron/settings-store.cjs:97-113`. Each file uses a separate rename,
and `writeJsonAtomically()` uses only PID plus `Date.now()` for its temporary path
at `electron/settings-store.cjs:385-404`. There is no transaction, generation,
rollback, or save queue across the two files.

**Red reproductions:** two tests in
`scripts/assurance/war-04/settings-privacy/settings-startup-red.test.ts`:

- a deterministic injected settings-rename failure after credential commit
  leaves `old.example.invalid` plus `old@example.test` paired with the new
  placeholder secret;
- one simultaneous-save probe separates two failure modes: a fixed timestamp
  makes one write reject through a temporary-path collision; then unique
  temporary names plus a controlled save-context/rename schedule make both
  writes fulfil in credential-one → credential-two → settings-two →
  settings-one order, leaving the first URL/email with the second placeholder
  secret. A full-save queue bypasses the hostile ordering, so temp-name-only
  repair cannot make the oracle green.

**Consequence/severity:** High. Tracking can fail after an apparently bounded
save error, and a newly entered secret can be sent on the next connection
attempt to the previously configured provider rather than the intended one.

**Escape analysis:** the existing `DON-237` test covers the opposite ordering:
credential write fails before Settings is advertised. It never injects failure
after credential commit. No existing test starts simultaneous saves or checks
that the final cross-file pair belongs to one completed draft.

### WAR04-SET-03 — corrupt settings also disable startup-fault support export

**Invariant:** when startup fails on malformed settings, the recovery control
shown in the fault shell must still export bounded evidence without re-entering
the same failing settings path.

**Production path:** malformed JSON throws in
`electron/settings-store.cjs:329-381`, and bootstrap renders the fault shell.
The shell's `Export support bundle` action at `src/App.tsx:315-375` calls the
Electron support bridge through
`src/infrastructure/support-report/tauri-support-report-store.ts:67-81`.
`electron/main.cjs:1104-1115` wires that exporter back to
`settingsStore.loadAppSettings`; `electron/runtime-files.cjs:66-89` calls it
before writing the report, reproducing the startup failure.

**Red reproduction:** `exports startup support evidence even when settings JSON
is corrupt` joins the production settings store and runtime-files adapter over
`{not-json`. Observed: the export rejects with the same JSON parse error and no
support artifact is written.

**Consequence/severity:** Medium. The app fails visibly, but its primary bounded
evidence/recovery action fails exactly for the fault it is meant to capture.

**Escape analysis:** generic boot-shell browser tests mock a successful support
export. Runtime-files tests use valid settings. No existing test joins corrupt
settings → failed boot → support export → settings re-read.

### WAR04-PRV-01 — `Copy Report` includes the Electron profile identity

**Invariant:** a report designed for sharing must not include a user/profile
path, regardless of whether it is copied or written to a file.

**Production path:** `electron/mission-store.cjs:393-394,705-710` returns absolute
database/backup paths. Generic mission-store IPC exposes them at
`electron/main.cjs:865-872` and `electron/preload.cjs:574-582`.
`src/features/diagnostics/start-diagnostics-runtime.ts:297-326` hands them to
`src/features/diagnostics/diagnostics-model.ts:106-109,240-243`, which embeds
them verbatim. `src/components/diagnostics-workspace.tsx:121-129,268-275`
copies that report directly. File export later redacts the exact profile root;
Copy Report bypasses that boundary.

**Red reproduction:** `keeps the Electron profile identity out of the report
copied by the operator` builds the production report with a synthetic Windows
profile. Both database and backup rows retain `field-operator` and the full
profile prefix.

**Consequence/severity:** Medium privacy impact. A normal support action can
disclose the operator account/profile identity and directory layout.

**Escape analysis:** Electron file-export tests prove final `userData` path
redaction, while diagnostics-model tests intentionally retain storage paths for
display. No test asserts that the exact string passed to the clipboard is safe
to share.

### WAR04-PRV-02 — query/fragment provider credentials reach shareable output

**Invariant:** provider credentials must not be accepted in any persisted URL
form or appear in diagnostics.

**Production path:** both validation layers reject only URL `username` or
`password`: `src/features/settings/settings-validation.ts:82-94` and
`electron/settings-store.cjs:419-426,479-497`. The base URL is then persisted
and printed by the renderer report and at
`electron/runtime-files.cjs:177-199`; the sanitizer's key and URL-userinfo
patterns in `electron/diagnostic-sanitizer.cjs:1-25` do not recognize query or
fragment credential forms such as `session`.

**Red reproduction:** `does not persist or export credential-bearing query and
fragment forms` runs five independent disposable profiles through the
real store: raw `session` query, percent-encoded `session` key, percent-encoded
`session` value, double-encoded `session` value, and fragment `session`. Each
accepted case builds the exact renderer text used by `Copy Report` and sends it
through a real Electron support export. Every case is accepted; each placeholder
representation remains persisted and in both copied and exported output. A safe
future rejection must equal the specific Provider-URL embedded-credentials
policy message and leave that independent profile clean, so partial rejection
or an unrelated credential-file failure cannot false-green the probe.

**Consequence/severity:** High privacy impact. A connection credential carried
in a base URL can be copied into a shareable artifact.

**Escape analysis:** existing controls and tests cover direct and encoded URL
userinfo plus separately stored credential fields. They do not define or test a
credential-bearing query/fragment policy across persistence, renderer Copy
Report, and main export, including encoded representations.

### WAR04-PRV-03 — nested and direct-main coordinate fields evade sanitization

**Invariant:** sanitization is recursive and representation-independent at every
log/report boundary; precise coordinates, credentials, and profile identity
must not survive because a value is nested or encoded once more.

**Production paths:**

- Renderer events accept `Record<string, unknown>` but inspect only top-level
  keys at `src/features/diagnostics/diagnostic-event-log.ts:138-175`; nested
  objects are flattened with `JSON.stringify()`. Reports JSON-encode the field
  again at `src/features/diagnostics/diagnostic-event-log.ts:84-97` before
  `electron/runtime-files.cjs:177-199` performs one text pass.
- The main IPC copies renderer fields at `electron/main.cjs:693-706` into the
  recursive secret/path sanitizer at
  `electron/diagnostic-sanitizer.cjs:28-63`. That sanitizer has no coordinate-key
  rule. Runtime-log entries are formatted/exported at
  `electron/runtime-log.cjs:59-70` and `electron/runtime-files.cjs:164-174`.

**Red reproductions:** two tests in
`scripts/assurance/war-04/settings-privacy/diagnostics-privacy-red.test.ts`:

- a nested renderer context retains a precise coordinate, placeholder token,
  and synthetic Windows profile identity after the report/support join;
- a direct main-log object is appended with `createRuntimeLog.appendDurable`,
  read back from the persisted JSONL log with `readRecent`, and retains both
  `latitude` and nested `longitude` there and in the support bundle.

**Consequence/severity:** Medium current control defect with potentially high
consequence. If such fields reach either boundary, shared output can expose a
precise operational location, connection detail, or host identity.

**Escape analysis:** top-level renderer coordinate keys are tested and redacted;
main sanitization is recursively tested for secret/path keys. The tests do not
nest renderer values, double-encode the report representation, or require the
main sanitizer to recognize coordinate keys at durable append/read/export. The
current in-tree renderer producers inspected by WAR-04 use primitive
allow-listed fields; no current built-in producer of the nested probe was found.
The inspected direct-main producers at
`electron/main.cjs:515-519,1021-1025,1075-1083` and
`electron/storage-diagnostics.cjs` emit error names, version/platform, or
bounded storage timing/size fields rather than coordinates or host identity.
Those producer limits constrain present operator reachability for both halves,
but do not satisfy the explicit recursive sanitizer contract.

## 4. Unproven hypotheses and policy questions

These observations did not meet the confirmation contract and are not repair
authorization:

| ID | Observation | Missing evidence / decision |
| --- | --- | --- |
| `WAR04-HYP-01` | free-form crash/report text is representation-sensitive for UNC, case variants, percent/double-percent paths, JSON-escaped paths, and double-encoded secret text | deterministic helper probes show survivors, but no current fatal-error producer emitting those forms was found |
| `WAR04-HYP-02` | raw device IDs, exact per-device breadcrumb times, and mission names are deliberately included in renderer reports and incident exports; existing tests positively assert device IDs, while the workplan says device identity is excluded | repository authority does not settle which of those bounded identifiers/names are permitted in support output; do not invent or ask the team within WAR-04 |
| `WAR04-HYP-03` | offline-map package bounds are included in readiness certificates and Electron support output | bounds are package extents rather than live mission coordinates; their sharing policy is not explicit |
| `WAR04-HYP-04` | browser fallback and historical Tauri export paths write renderer contents without Electron's final redaction pass | Electron is the current operational packaged lane; no current supported packaged Tauri/browser claim was established |
| `WAR04-HYP-05` | profile aliases created by symlinks, Unicode normalization, or platform-specific path canonicalization may evade exact-root redaction | no current producer plus supported-platform packaged reproduction was established |
| `WAR04-HYP-06` | Windows file replacement and permission behavior may change the map/settings outcomes | the reproductions are macOS-local; Windows remains a WAR-12 platform-proof gap |

## 5. Cleared controls

“Cleared” is limited to the stated state and joined boundary:

### Maps/readiness

- A package already missing, unreadable, non-SQLite, truncated beyond SQLite
  readability, or missing required schema at Settings-save time becomes
  `missing`/`invalid`; it is not registered ready.
- A ready entry whose SQLite database cannot open/query fails loudly. It does
  not silently switch to the online provider.
- A normal requested-tile miss without online fallback produces the visible
  no-coverage hatch. WAR04-MAP-02 concerns the earlier false-positive readiness
  statement, not absence of that fallback.
- A successful Settings save invalidates cached readers. Explicit invalidation
  in the replacement probe immediately served the new package.

### Settings/credentials

- Missing, zero-byte, garbage, and foreign-shaped credential JSON degrade to an
  empty credential set and disable tracking with a reason.
- A missing settings file uses reviewed defaults. Out-of-range/corrupt numeric
  intervals normalize to bounded defaults.
- Zero-byte/garbage settings do not silently substitute unsafe values; they
  reach the visible failed-startup state. WAR04-SET-03 concerns the recovery
  export offered there.
- A credential write that fails before commit does not advertise new provider
  settings. Existing `DON-237` coverage proves that ordering.
- Raw and encoded URL userinfo are rejected on save and again at runtime.
- The trusted-team-machine plaintext credential decision, best-effort mode
  `0600`, authoritative clear, and legacy re-entry behavior remain the accepted
  `DON-177` residual; WAR-04 did not redesign it.

### Diagnostics/support output

- Top-level renderer keys `lat`, `lon`, `lng`, `latitude`, `longitude`,
  `coordinate`, `coordinates`, and `bounds` are redacted.
- Main-process recursive secret keys, authorization headers, bearer/basic
  tokens, and direct URL userinfo are redacted.
- Canonical raw POSIX/Windows home usernames and exact `userData` raw,
  slash-normalized, and JSON-escaped variants are redacted during Electron file
  export.
- Runtime/crash/renderer event collections are bounded and time-filtered;
  native minidumps are not included in support bundles.
- Current inspected in-tree renderer event producers use primitive allow-listed
  fields rather than the nested object that reproduces WAR04-PRV-03.

## 6. DON-264 assessment

`DON-264` is not absorbed by WAR-04. Its exact path is persistent map-style
overlay synchronization failure in `src/features/map/map-style-sync.ts` and the
overlay hooks, where bounded retries end in a developer-console error without a
durable operator warning. WAR-04's map findings are local base-map package
qualification, registry freshness, and SQLite reader identity. Its settings and
diagnostics findings are separate again.

No shared failing call path, state owner, or repair seam was found. `EVD-003`
therefore remains separately owned by `DON-264` with its existing operator
warning/clearance requirement. This investigation neither closes nor replans it.

## 7. Bounded WAR-11 follow-up

No production repair and no speculative Linear issue was created by WAR-04.
The smallest later repair trains are:

1. **Map qualification and freshness** — `WAR04-MAP-01..03`: define a durable
   package identity/attestation, revalidate the selected package at the
   readiness boundary, check required-view usable content, and invalidate live
   readers on import/replacement. Existing owners: `DON-7` and `DON-76`.
2. **Settings/startup consistency** — `WAR04-SET-01..03`: serialize/generate
   unique saves, make settings plus credential publication recoverably
   consistent, degrade non-content credential read failures to tracking-off,
   and make fault export independent of the failing settings read. Existing
   owners: `DON-177` and `DON-237`.
3. **Diagnostics allow-listing** — `WAR04-PRV-01..03`: sanitize the shareable
   renderer report before Copy Report, settle/reject credential-bearing query
   forms, and use one recursive coordinate/secret/path contract across renderer,
   main log, diagnostics, support, and incident output. Existing owners:
   `DON-226` and `DON-237`.

Each WAR-11 train should take these isolated red probes first, then add the
smallest structural repair and normal green regressions. Product questions in
the hypothesis table stay outside implementation until repository authority
settles them.

## 8. Verification record and exact limits

### Baseline and red proof

- Exact-start guard: fetched `origin`; both branch HEAD and `origin/master`
  were `3d0d36b3874947d3d620bdb5262d9cd2d7233fcf` before investigation.
- Unchanged focused baseline: **14 files / 134 tests passed** after rebuilding
  the local `better-sqlite3` native binding; the initial binding error was an
  isolated dependency-install environment issue, not a product failure.
- Map baseline lane: **9 files / 137 tests passed**.
- Diagnostics baseline lane: **7 files / 65 tests passed**.
- `npx vitest run --config scripts/assurance/war-04/maps/vitest.config.ts`:
  **1 file / 4 tests intentionally red**, reproducing all map variants. Its
  invalid-tile oracle uses a local Playwright-managed headless-Chromium image
  decode on one blank local data-URL page; no application page, navigation,
  network, licensed map, Electron runtime, or operator workflow is involved.
- `npx vitest run --config scripts/assurance/war-04/settings-privacy/vitest.config.ts`:
  **2 files / 8 tests intentionally red**, reproducing all settings/privacy
  variants.
- `npx eslint scripts/assurance/war-04` and `git diff --check`: passed.
- `npm run lint`: passed.
- `npm run build`: TypeScript, Vite, and bundle-size budgets passed. The generated
  version file was restored to the exact base content and is not part of WAR-04.
- `npm run test`: final uncontended run passed **296 files / 2,535 tests**. An
  earlier run performed while the Rust tree was compiling timed out one unchanged
  five-second large-batch test after the other 2,534 passed; that exact test then
  passed unchanged in 1.55 s, and the complete uncontended rerun was green. No
  timeout or test setting was altered.
- `npm run test:backend`: **58 passed / 1 ignored** (the repository's existing
  real-keychain test).
- `npm run test:e2e`: **227 passed** across the configured Chromium and visual
  projects. No separate model visual review was required for this docs/evidence-
  only change.

### Proof not claimed

- no production-code repair or green result for the isolated WAR-04 red probes;
- no Electron or local packaged binary, browser-rendered operator flow beyond
  the isolated Playwright synthetic-PNG decode, signed artifact, installed
  `.deb`, AppImage, or Windows run;
- no live provider, licensed map, network fallback, external host, real profile,
  real credential, or operational data;
- no broad malformed-MBTiles corpus, full national coverage proof, scale/soak,
  multi-machine matrix, or field exercise;
- no claim that the nine findings are the only defects in these subsystems;
- no field-readiness, release-readiness, whole-application assurance, or
  production-safety claim.

Broad exact-artifact, supported-platform, live-provider, licensed-map, scale,
and soak qualification remains WAR-12 work after the relevant WAR-11 repairs.
The mandatory independent outcomes must be recorded on the final exact PR head
so they identify the actual reviewed commit without changing that commit.
