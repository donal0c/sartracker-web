# PR28 Claude review disposition

2026-09-14. Review input at `3ecb7b8afa79ff8ad8cbbf4a6c086c14f65325e7` is
retained [verbatim](../../evidence/war-11-map/claude-review/review.txt).
Readiness was withdrawn and PR28 returned to draft. CI34812540230 remains genuine
historical green evidence; it does not cover subsequent fixes. No local Electron
launch/build, merge or release is authorized.

## Finding disposition

| ID | Finding | Current disposition |
| --- | --- | --- |
| C01 | Every settings save exhaustively rescans packages | Confirmed, repaired red-first: reuse only prior persisted ready metadata and attestation when package identity remains current. Renderer-supplied attestations are not trusted. |
| C02 | Specific validation errors discarded | Confirmed, repaired: bounded sanitized package messages survive; unexpected errors retain a generic safe fallback. |
| C03 | Readonly WAL open creates sidecars | Confirmed with synthetic SQLite. Reject WAL header before SQLite opens the file, preserving the existing immutable, sidecar-free package contract without creating new sidecars. |
| C04 | Zoom metadata exact equality / missing fallback | Retained explicit schema contract: required metadata extrema match observed tiles. Missing metadata is invalid; internal zoom gaps are checked against the actual view. Restoring metadata inference is outside this validation policy. |
| C05 | Transparent tile invalidates whole package | Retained decoder policy: every tile must contain visible pixels under native-raster-256-or-512-opaque-v1. Accepting transparent padding requires a separately versioned package/coverage policy; it must not silently count as usable imagery. |
| C06 | Bad/oversized row suppresses fallback | Confirmed behavior, retained fail-closed policy. Damaged attested local data is not silently replaced by an online source. Missing rows remain distinct from corruption. Focused explicit controls being added. |
| C07 | Synchronous decode and filesystem work per tile | Confirmed cost, not a measured responsiveness failure. Added a 256-entry same-identity decoded-proof cache with insertion-order eviction; freshness checks remain. Cold-path/main-process performance qualification remains separate. This is not an LRU cache or a strict responsiveness pass. |
| C08 | Optional callback disables 1 Hz monitor | Production always supplies the callback; no production monitoring gap reproduced. Per-request identity checks remain. Lifetime synchronous polling cost is retained performance work, not claimed fixed. |
| C09 | SHA-256 Check View is redundant | Refuted safety claim: filesystem identity does not compare content with the attested digest. Before/after identity checks bracket the hash against mutation. I/O cost is real; removing content verification would weaken the contract. |
| C10 | Every settings save holds map mutation window | Confirmed and repaired. The decision runs inside the serialized settings save: unchanged map settings bypass the guard; registered source path, safe provider metadata, package changes and stale identities hold it. Main IPC and settings regressions cover both branches; import retains its guard. Non-persisted provider edits remain outside this qualification, as recorded below. |
| C11 | Partial raster failure loses reconstruction / retries forever | Confirmed by two failing mounted-hook regressions: absent source stays absent; 21 retries for 21 events. Recovery intent now survives partial mutation and automatic failures are bounded; explicit Check View retries. |
| C12 | Tile error kills pending negative check | Confirmed by three failing regressions (missing/partial/error became unchecked). Negative results now settle; positive results still withdraw when a tile failure occurred in flight. Movement/package generation checks remain. |
| C13 | Tilt reports view unavailable | Supported-view restriction retained: qualification covers flat views only. Misleading message confirmed and repaired to show the actual flat-view recovery instruction. No broader coverage claim added. |
| C14 | Validated package remains warning-colored | Refuted as a readiness defect: package validation alone is deliberately limited; labels distinguish validated/unvalidated. The separate current-view checklist becomes success after usable tiles are verified. |
| C15 | Hook mocks bypass raster path | Confirmed coverage gap for partial failures, not absence of all raster evidence. Existing real Chromium/MapLibre flows cover normal eviction; new structurally initialized mounted-hook tests cover failure/recovery and bounded retry. |
| C16 | Attestation key-order fingerprint | Latent churn risk confirmed; explicit canonical field ordering and a key-order stability regression added. |
| C17 | Duplicate predicates / CRC / Adam7 tables | Adam7 passes consolidated. Attestation checks remain at distinct filesystem, worker-message and renderer trust boundaries; merging them indiscriminately would conflate their contracts. The two small CRC implementations remain bounded cleanup debt: generated output and strict input validation have independent tests; no current correctness failure was demonstrated. A shared codec extraction is deferred from this repair. |
| C18 | Dead official coverage paths / decoder factory | Removed unused factory and metadata-only official coverage branch/descriptor after checking all consumers. The public cache hook now explicitly declines official qualification; MapView continues to route official checks to the native current-view controller. |

The review's already-refuted zoom rounding, nested SQLite reads, map-ref timing,
resize invalidation and passing static/unit checks are not re-raised as defects.

## Evidence and completion gate

Renderer baseline: five genuine failing mounted-hook tests. Tilt-message baseline:
one failed / 22 passed. Updated renderer controls pass. Final synthetic Chromium
run after coverage-path cleanup passes six flows (27.8 seconds); failed-rebuild
and recovered screenshots were inspected. Final stable source results and
independent review are recorded below; fresh CI remains pending.
All native claims remain limited to synthetic Node/SQLite tests until source-bound
Linux packaged evidence is refreshed. Prior crash, failed attempts, unattributed
diagnostics, skipped strict/scale/soak/archive qualifications and release HOLD remain.

Independent review of the working changes against `3ecb7b8a` found no remaining
renderer race or native integration correctness defect. A proposed persisted-map
startup issue was withdrawn after checking effect ordering and the settings-load
rerender. Both reviewers identified inaccurate LRU wording; implementation and
test now describe bounded insertion-order eviction. This changes no safety claim.

The native settings/WAL red-to-green runs were observed in agent terminal output
(not retained as standalone raw logs): ordinary saves decoded again before repair;
WAL inspection created sidecars before preflight; mutation callback stayed unused
before conditional guard integration. Root's main IPC red is retained separately.
The final native/IPC/renderer focused run passes 122 tests across six files, with
the inspector selected separately because its filename differs from the first
command. Final full-suite and CI results will be recorded before readiness.

The first full correctness run completed with 467 files passing and one file
failing: 4,955 tests passed, one failed, six existing qualification skips. The
single failure expected the retired generic MBTiles message; the actual specific
decoder rejection is required by C02. Its invalid status, empty metadata and
Not ready safety assertions remain unchanged. The expectation was corrected,
the five freshness controls pass, and a clean full run is required.

Evidence is retained under [claude-review](../../evidence/war-11-map/claude-review/):
`renderer-red.log`, `pitch-red.log`, `main-save-red.log`, the first
`full-correctness.log`, and `freshness-message-red.log` retain the observed
failures. `renderer-green.log` is an intermediate failed run despite its old
filename; `root-lint.log` likewise retains two test-fixture lint failures, fixed
by publishing the hook result in an effect and removing an unused argument.
Final focused logs, project typecheck, lint and `browser-cleanup-final.log` are
separate. The two reconstruction screenshots show unavailable/blank imagery
after injected failure and the new synthetic raster after explicit recovery.

Final local verification: `npm run test:correctness -- --no-file-parallelism`
passes 468 files / 4,956 tests / six existing qualification skips in 488.54 seconds.
The final inspector selection adds 11 passing tests to the 122-test focused run.
TypeScript project build-mode checking (no emit), targeted ESLint and diff checks
pass. No application build or local Electron was run. Fresh CI remains required;
the historical CI receipts are not relabelled as proof of these repairs.

Post-push C10 follow-up: a synthetic same-path provider-file replacement changed
persisted service availability/status without entering the mutation guard. The
source path comparison alone was insufficient. CI34819550032 at `220366e5` was
cancelled as superseded; it is not a passing repair receipt. Source-only metadata
must be normalized and compared inside the serialized save before deciding the
guard, while package inspection stays inside the guarded operation. The synthetic
red is retained in `c10-source-metadata-red.log`; a clean follow-up pass is required.

Follow-up independent review accepts the serialized snapshot/guard placement.
Its fingerprint covers the persisted safe provider metadata, not provider passwords
or service URLs. Those non-persisted values are read again when a network tile is
requested, but same-path edits to them alone are not proven to evict resident
renderer tiles. No provider/credential freshness claim is made; that separate
qualification remains a release limitation, rather than adding secret-derived
state or expanding the licensed-provider boundary in this offline-map repair.

Final C10 follow-up verification: 27 settings tests pass after the retained
one-failure/26-pass red. Clean full correctness passes 468 files / 4,957 tests /
six existing skips in 498.41 seconds. Syntax, targeted lint, diff check and
independent review pass. Renderer source is unchanged, so the six-flow Chromium
evidence remains applicable; fresh CI will repeat it against the committed tree.
