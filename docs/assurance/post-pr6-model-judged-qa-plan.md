# Post-PR6 model-judged QA and release-qualification plan

**Status:** implementation-ready plan only. It does not authorize harness implementation, a qualification run, a pull request, merge, release, or contact with the SAR team.

**Planning source base:** `origin/master` and this planning worktree at `3d0d36b3874947d3d620bdb5262d9cd2d7233fcf` on 2026-08-30.

**Naming:** “PR6” throughout this document means the sixth Breadcrumb Programme change, the archive-lifecycle rewrite now under implementation. It does not mean the already merged GitHub PR #6 for WAR-01. “PR8” means GitHub PR #8 for the WAR-04 audit.

**Mutable work explicitly excluded from proof:** the active PR6 worktree at `/Users/donalocallaghan/.codex/worktrees/47de/sartracker-web` was inspected read-only while based at `eec92812b783a795c093f37268b295dd2179a3af`. It contained thousands of uncommitted archive-lifecycle lines across new and modified files. It is useful design evidence, not a candidate, exact-head review result, or qualification result.

**Other live state at planning time:** GitHub PR #8 (WAR-04) was open and mergeable at `3a2278ee8804a9ded0f2fd26626c4c00743c05a6` against `3d0d36b...`. Its exact-head reviews and Linux workflow were clean, but its nine platform-services probes are intentionally red and identify defects for WAR-11. The green workflow does not turn those findings green.

**Mandatory refresh:** every candidate, contract, oracle, fixture, package and evidence claim in this plan must be refreshed against the exact merged PR6/PR8 descendant and then against the exact release-candidate artifact. No result from the current mutable PR6 worktree, the current base, or an earlier package may be inherited as final proof.

## 1. Viability verdict and required adaptations

### Verdict

The Craft `validate-change` pattern is a sound basis for SAR Tracker's post-rewrite QA, but only as a **validation control plane**. It is not a sufficient SAR test architecture by itself and must not be copied mechanically.

Its strongest ideas are directly useful:

- freeze an exact claim, contract, candidate, validator, fixture, actor, action and attempt before mutation;
- fail closed in preflight when identity, capability, isolation, cleanup or observability is not proven;
- correlate semantic actions, runtime observations, authoritative state and media to one attempt;
- let deterministic gates decide factual correctness and forbidden side effects;
- give a fresh model judge only a copy-only, oracle-blind, redacted visible-evidence view;
- preserve every retry as a new attempt, hash every retained artifact, seal the bundle and re-verify the verdict from the sealed inputs;
- keep the validator and retained seal outside the candidate's own trust boundary.

The reference is proven more narrowly than SAR needs. The exact Craft reference at `c5b20686e405e7a2872da0f6a50576e3b8f47966` has 77 executable tests, a 17-case hostile synthetic matrix with 2 intended passes and 15 deterministic failures, crash/tamper/cross-run-media verification, and one narrow redacted Dev fixture journey. It explicitly does **not** prove production, whole-application regression freedom, judge calibration or human acceptance. Its local judge sandbox is not an OS-level read-isolation boundary. Its concrete contract also assumes Craft projects, workspaces, tRPC routes, hosted Dev, reviewer auth state, reversible lifecycle moves and sentinel resources. Those assumptions do not transfer to a local Electron mission system.

SAR therefore needs these adaptations:

| Craft pattern | SAR adaptation |
| --- | --- |
| One feature journey | A campaign of independently scoped contracts with explicit requirement/hazard/change coverage; no single journey establishes coverage. |
| Hosted Dev build and workspace identity | Exact source tree, CI run, installer hash, installed-file receipt, runtime build identity, user-data lease and machine/runtime receipt. |
| Project/API state oracle | Controller-owned SQLite/filesystem/process/network/source-server oracles taken from pinned snapshots and immutable source logs, never renderer claims. |
| Reversible shared fixture | Synthetic copy-on-test mission fixtures, exclusive profile/archive/map leases, a before manifest, append-only mutation log and verified cleanup/quarantine. |
| Browser-only capture | Three separate evidence modes: browser harness, packaged AppImage/unpacked Electron, and genuinely installed `.deb`; a browser result never proves Electron and an AppImage result never proves an installed package. |
| One stateful mutation shape | Read-only, stateful, destructive-on-disposable-fixture, crash/restart, long-running, scale and field-observation contract families. |
| Candidate-aware visible checks | Judge packets that contain only operator-visible evidence and controller-authored neutral step labels; no oracle values, expected counts, gate results or candidate-supplied instructions. |
| Local seal | Externally retained campaign index/seal, protected validator identity and independent recomputation before a release decision. |
| Platform-specific closeout | Repository evidence, Linear regression provenance, WAR hazard disposition, BCP-17 coverage and DON-255 draft-release controls. No Work Memory dependency. |

### Relationship to BCP-17 and WAR-12

Build one reusable SAR validation subsystem, but keep two qualification profiles:

1. **`bcp17-final`** qualifies the first exact post-PR6 breadcrumb/mission-history candidate under DON-254. It covers PR1-PR6, the five WAR-01 absolute blockers, the full existing release matrix, exact AppImage and installed `.deb`, archive/restore/custody and the declared whole-application smoke. It is the only profile that can feed a DON-255 publication decision.
2. **`war12-hardening`** is the later whole-application hardening-candidate campaign after the WAR-11 repair trains. It reuses the same contracts, fixtures, oracles and runner, but adds/repeats the whole WAR catalogue against the later exact candidate. It must not be represented as already completed by BCP-17, and BCP-17 evidence cannot be inherited if the application or proof boundary changes.

This preserves the current programme sequencing while avoiding two harnesses. An exact sealed attempt may be referenced by both campaign reports only when candidate, artifact, validator, contract, fixture, platform and evidence hashes are identical and both profiles declare that row applicable. Referencing is not rerunning; a different candidate means a new attempt.

### Beta 13 controlled-team-testing claim boundary — 2026-09-23

The first post-PR6 candidate claim is limited to controlled team testing with
synthetic, replayed or disposable data and an independent primary source. This
scope does not change product behavior or certify live-data, field, map-package
administration, or general-use readiness. The prepared private MBTiles route
remains the map path for this beta; raw licensed-source packaging and map
administration stay in the next-release work.

DON-249, DON-250 and DON-251 remain unimplemented, separate product capabilities
and are explicitly `NOT_CLAIMED`. Their PST-003/PST-004/PST-005 and IPC-003
hazards stay open. All C00-C29 contracts and applicable C19/C24 probes remain
required. Passing those applicable probes while retaining these capability
residuals may produce `SCOPE_LIMITED`, never `PASS` or `QUALIFIED`; any actual
failure, absent receipt, invalid evidence, remaining absolute blocker, or other
hold retains its existing blocking disposition. This bounded claim does not waive
the five WAR-01 absolute blockers, C17 coverage residuals, C01/C11, DON-264,
PKG-001, C29, C27, C00, or any live-input/host prerequisite required by the
selected evidence. `bcp17-final` remains the first release qualification;
`war12-hardening` remains later after WAR-11 and is not a Beta 13 prerequisite
unless the exact candidate exposes a concrete blocking finding.

## 2. Principles and proof boundaries

### Non-negotiable rules

1. **Facts are deterministic.** Exact source-fix identity, SQLite rows/counts/digests, mission/outing attribution, current-position latency, replay completeness, evidence health, archive identity/integrity, recovery state, persistence and forbidden side effects are decided by controller-owned gates.
2. **The judge is advisory.** It may assess visible state communication, warning/action clarity, control/map coherence and adjacent visible defects. It cannot attest to backend state, security, performance, completeness, custody or data integrity.
3. **A judge pass cannot rescue a deterministic fail, invalid attempt or missing environment.** A judge concern routes human review and may hold release governance; it does not rewrite facts.
4. **The same attempt owns all evidence.** Candidate, artifact, runtime, fixture lease, source-server transcript, deterministic clock, actions, snapshots, process samples, captures and judge view share one `campaignId`, `attemptGroupId`, `attemptId` and nonce.
5. **Coverage is declared, not inferred.** Every requirement, hazard, PR1-PR6 change and major existing workflow has explicit contract rows. Missing, external and not-applicable rows remain visible.
6. **Current position keeps priority.** History, coverage, replay, export, integrity, archive, verification, restore, cleanup, diagnostics and map work may fail or run slowly without hiding or materially delaying current fixes beyond the locked budget.
7. **Evidence is immutable and minimal.** Raw sensitive evidence stays local/private; judge and repository views are derived, redacted, hashed copies. Operational databases, profiles, secrets and private maps are not routine model or repository inputs.
8. **Retries do not erase failures.** Each retry is a new attempt linked to its predecessor and reason. A new candidate artifact starts a new attempt group. Unexplained flakes block release.
9. **No proof-tier inflation.** Browser harness is rendered synthetic proof, local packages are local package proof, exact CI artifacts are exact-artifact proof, and team/live-provider/long-duration observations retain their own limits.
10. **Expected-red is still red.** WAR-04 probes and future red-first mutants are development evidence. An expected failure is never counted as a release pass; a release campaign must point to the repair and a green replacement contract or remain blocked.

### Verdict lattice

Each attempt ends in exactly one machine-readable state:

- `PASS`: every required deterministic gate passed, bundle verification passed, cleanup passed, and any required judge completed without a concern.
- `FAIL`: one or more valid deterministic product, state, safety, performance, privacy or forbidden-effect gates failed.
- `INVALID_EVIDENCE`: identity/correlation/evidence/structure/seal is missing, inconsistent or unverifiable.
- `ENVIRONMENT_BLOCKED`: a required environment or capability was not available or was unsafe to use. This is not a product fail, but it blocks a release profile that requires that environment.
- `NEEDS_HUMAN_DECISION`: deterministic gates passed but the required advisory judge errored, detected injection, or raised an operator-visible concern; or an adjacent observation requires scoped human classification.
- `ABORTED_SAFE`: the attempt stopped before its factual outcome and cleanup/quarantine is proven. It is reported separately but is release-equivalent to incomplete evidence.
- `CLEANUP_BLOCKED`: the fixture/profile/archive lease could not be restored or safely quarantined. The resource remains fenced and the campaign stops.

Campaign status is computed from required rows, not majority vote. It is `QUALIFIED` only when every required row is `PASS`, all coverage and release-integrity gates pass, and every blocking residual is closed. Optional/external gaps remain explicit and constrain the claim.

### Proof modes

| Mode | What it can prove | What it cannot prove |
| --- | --- | --- |
| Pure/unit/property/mutation | Domain rules, parsers, schema and oracle behavior | Rendered UI, Electron, packaged/installed behavior |
| Browser harness | React/MapLibre/operator flow using explicit synthetic adapters | Desktop IPC, native SQLite module, filesystem custody, package/install behavior |
| Local unpacked/package | Electron main/preload/renderer and local native modules | Exact CI artifact or another host/distro |
| Exact CI AppImage | The hashed AppImage on the declared Ubuntu runtime/profile | Installed `.deb`, Mint, Windows, field behavior |
| Exact installed `.deb` | Installed files, desktop launch and behavior on that declared host | AppImage path or another distro/profile |
| Live provider / field / long duration | Only the exact server, roster, artifact, host, profile, duration and workflow observed | General production safety or unexercised conditions |

Windows and unavailable real Mint hardware remain explicit external gaps. The current release lane is Linux x86-64 only. No contract may manufacture a Windows or Mint pass from Ubuntu, containers, Xvfb or historical reports.

## 3. Proposed harness architecture and artifact/evidence model

### 3.1 Components

The harness should be a repository-owned Node/TypeScript controller outside the application runtime, with small explicit adapters:

```text
coverage registry + campaign profile
            |
       contract loader
            |
    capability preflight ---- candidate/artifact/install identity
            |
      fixture lease manager ---- deterministic clock / Traccar / fault controller
            |
  journey adapter (browser | AppImage | installed .deb)
            |
 capture: actions/media/DOM/ARIA/runtime/network/process
            |
 controller-owned oracle adapters: SQLite | files | source server | release | timing
            |
 deterministic gate engine ---- adjacent-observation classifier
            |
 redaction + oracle-blind judge packet ---- fresh advisory judge
            |
 attempt seal + independent verifier ---- campaign coverage/report/Linear closeout
```

The candidate must not expose a magic “pass” endpoint. Test-only hooks may provide deterministic input and bounded observability, but the controller must independently read the resulting SQLite/files/process/source truth. Production behavior should be driven through the real operator boundary wherever the contract is intended to prove an operator flow.

### 3.2 SAR validation contract schema

Store reviewed contracts under a dedicated assurance path such as `tools/assurance/contracts/`. JSON Schema validates them before execution. A contract should have this conceptual shape:

```yaml
schemaVersion: 1
contractId: sar.<area>.<claim>.v1
contractVersion: 1
status: active | calibration | retired
riskTier: critical | high | medium
claim:
  summary: operator-visible and factual claim
  requirementIds: [SAR-QA-002, DON-267]
  hazardIds: [TRK-001]
  programmeChanges: [PR1, PR4]
  absoluteBlockers: [current-position]
scope:
  campaignProfiles: [bcp17-final, war12-hardening]
  proofModes: [browser, appimage, installed-deb]
  platforms: [linux-x86_64]
  fixtureTiers: [small, ci]
  dataClassification: synthetic
preflight:
  capabilities: [sqlite-read-snapshot, process-sampler, playwright]
  candidateIdentityPolicy: exact
  fixtureLeasePolicy: exclusive-copy-on-test
  freeSpacePolicy: { minimumBytes: ..., reserveBytes: ... }
  cleanupPolicy: verify-or-quarantine
journey:
  timeoutMs: ...
  steps: [{ stepId, actorIntent, adapterAction, checkpointIds }]
checkpoints:
  - { checkpointId, trigger, requiredChannels, oracleSnapshotIds }
oracles:
  - { oracleId, adapter, queryOrProbeRef, operator, expectedRef, tolerance }
performanceBudgets:
  - { metric, percentileOrMaximum, thresholdMs, sampleMinimum, warmupPolicy }
allowedEffects:
  - { authority, resource, operation, cardinality, phase }
forbiddenOutcomes:
  - { code, authority, predicateRef, severity }
evidence:
  requiredChannels: [actions, screenshot, dom, aria, sqlite, process]
  rawRetention: private-local
  judgeView: redacted-synthetic-only
judge:
  required: true
  rubricRef: operator-warning-v1
  visibleCheckpointIds: [...]
  allowedCitationGlobs: [...]
  factualTopicsDenied: [sqlite-counts, archive-integrity, latency-pass]
variants:
  axes: { package: [...], fault: [...], scale: [...] }
  pairwisePolicy: ...
attemptPolicy:
  maximumRetries: 1
  retryableClasses: [ENVIRONMENT_BLOCKED]
  sameCandidateRequired: true
cleanup:
  postconditions: [...]
  evidenceDisposition: seal-before-delete
```

Expected values are resolved from a separately frozen oracle bundle. They are not embedded in judge prompts or taken from candidate text. Every contract compiles to an executable variant list and a coverage list. An unresolved reference makes the contract non-executable.

### 3.3 Preflight and receipt

Preflight is controller-owned and mutation-free. It writes a signed/hash-bound receipt with one of `READY`, `SETUP_BLOCKED`, `CAPABILITY_UNAVAILABLE`, `ENVIRONMENT_BLOCKED` or `POLICY_BLOCKED`.

Required checks:

- full 40-character candidate SHA, tree hash, dirty-state policy and expected PR6/PR8 ancestry;
- validator commit/tree and per-module hashes from a protected, separately reviewed ref;
- contract, oracle bundle, coverage registry, fixture generator and fault plan hashes;
- host OS, distro, kernel, architecture, session type, CPU/memory/disk, filesystem and clock source;
- required binaries and versions: Node, Electron, Chromium/Playwright, SQLite/native module inspection, `ffmpeg`/`ffprobe`, hashing and process tools;
- free space for source, working copy, WAL, archive, restore scratch, evidence and safety reserve, with no optimistic sparse-file assumption for the final large path;
- exclusive profile, fixture, archive root, ports, display and installed-package lease;
- starting process inventory and duplicate-instance absence;
- fixture manifest/digest/schema/integrity, synthetic marker, baseline counts and cleanup target;
- simulated Traccar capability and source-log baseline, or read-only live-provider scope;
- capture channels, process heartbeat and controller-to-runtime correlation probe;
- judge egress policy and redaction capability, without opening a model session;
- cleanup/quarantine capability tested on a disposable canary;
- package-mode-specific identity checks below.

The receipt expires if the candidate, artifact, install, contract, fixture, host capability, auth/credential state, profile, source server or cleanup baseline changes. Execution rechecks the critical subset immediately before the first action.

### 3.4 Exact source, artifact and runtime binding

**Browser harness receipt** must record source SHA/tree, production build hash, generated build ID, Vite asset manifest hashes, harness schema/version, URL/origin, browser build/executable, synthetic session-storage baseline and a statement that Electron/native/filesystem proof is absent.

**AppImage receipt** must start from a downloaded CI artifact, not a local rebuild. Record CI workflow/run/job, tag/commit, filename, size, SHA-256, `SHA256SUMS` agreement, GitHub asset metadata digest, ELF/native `better_sqlite3.node` inspection, runtime-reported full or uniquely bound commit, launch flags, profile lease and process executable identity. Extraction or `linux-unpacked` may support diagnostics but cannot replace the AppImage run.

**Installed `.deb` receipt** must additionally record `.deb` hash, raw `apt`/`dpkg` logs, package name/version/architecture, `dpkg -s`, `dpkg -V`, installed file list/digests, desktop/executable path, runtime build ID, dependencies and pre-existing package-manager errors. A successful AppImage is not evidence for this row.

Every capture checkpoint records the runtime PID tree and executable identity. A restarted attempt rebinds the new PID tree to the same immutable artifact and profile lease. If runtime identity cannot be tied to the artifact, the attempt is `INVALID_EVIDENCE`.

### 3.5 Fixture lease, baseline, mutation log and cleanup

Each attempt receives a UUID lease over explicit paths and ports. The source fixture is read-only/cacheable; the working database, WAL/SHM, attachments, archives, maps, settings and profile are fresh copies or fresh synthetic outputs. The lease manifest includes inode/file identity where supported, hashes, allocated/physical bytes, schema, SQLite page/checksum facts, row counts/digests, synthetic marker and permitted paths.

The controller writes an append-only mutation log before and after every action/fault. It records intent, exact target, action token, process/PID, start/end monotonic time, filesystem/SQLite/source-server observations and result. Secrets and raw coordinates are represented by stable attempt-local pseudonyms/hashes in shareable views.

Cleanup is a gate, not a `finally` footnote:

1. stop candidate and simulated services through bounded graceful shutdown;
2. kill only lease-owned remaining PIDs after identity recheck;
3. close SQLite/file handles and verify no live holder remains;
4. compare external resources and forbidden paths to baseline;
5. preserve/seal required evidence;
6. remove only explicit disposable attempt paths, or move the entire lease to a named quarantine if any postcondition fails;
7. verify ports, installed-package state and profile ownership are restored.

The final large fixture cache is retained read-only and never regenerated per attempt. Working copies may use reflink/copy-on-write only when allocated-space and disk-full tests explicitly account for it. No cleanup deletes an operational or unknown database.

### 3.6 Evidence bundle and sealing

Recommended layout:

```text
campaigns/<campaignId>/
  campaign-definition.json
  coverage-before.json
  campaign-index.json
  external-anchor.json
  attempts/<attemptId>/
    frozen/{contract,oracle,fixture,preflight,candidate,validator}.json
    actions/semantic-actions.json
    runtime/{console,network,ipc,process,heartbeat,events}.jsonl
    authoritative/{sqlite,source-server,filesystem,release,timing}/...
    media/{screenshots,video,trace,dom,aria}/...
    privacy/{redaction-report,judge-egress-manifest}.json
    judge-view/...
    judge-result.json
    gate-results.json
    adjacent-observations.json
    cleanup-receipt.json
    evidence-manifest.json
    ledger.json
    attempt-receipt.json
    run-seal.json
  coverage-after.json
  campaign-verdict.json
  linear-closeout.md
```

Every file is listed with SHA-256, byte size, producer, trust class, attempt ID and correlation nonce. The ledger is hash-chained. The seal binds frozen inputs, evidence manifest, gate implementation hashes, gate results, judge identity/result, cleanup, verdict and ledger head. An independent verifier recomputes semantic gates and rejects unlisted files, symlinks, unsafe paths, missing tools, cross-attempt media, changed bundles and local resealing that does not match the externally retained anchor.

Large raw traces and databases may be stored outside Git with content-addressed private references. The repository receives only bounded reports, hashes, redacted excerpts and durable locations/custody. A missing private object makes the attempt unverifiable; its hash alone is not proof of contents.

### 3.7 What to reuse, generalize, keep separate and retire

**Reuse with tests:** deterministic mission-store fixture generator; 960k/2m qualification; five-/fourteen-day and field-scale caches; packaged tracking soak and source truth digests; 36-hour mock Traccar/fault proof; storage kill probe; GPX `SIGKILL` probes; official-map offline smoke; bad-secret/newer-schema release smokes; Playwright operator suites; visual screenshot manifest; release draft/hash/publisher guards.

**Generalize:** fixture manifests into leases; release-smoke evidence into contract receipts; current visual entries into event-aligned judge packets; soak truth functions into controller-owned oracle adapters; disparate report JSON into one attempt/campaign schema; existing action timing into correlated semantic actions.

**Keep separate:** browser, AppImage and installed `.deb` adapters; PR6 archive semantic/ciphertext verification and general mission-store integrity; live-provider GET-only confirmation and simulated adversarial Traccar; WAR red probes and release-green contracts; judge output and deterministic verdict; raw/private evidence and redacted judge/repository views.

**Retire only after replacement parity is proven:** unbound manual evidence directories; release-note claims without machine-readable attempt IDs; model screenshot review that can see only one uncorrelated screenshot and return a release verdict; duplicate fixture generators; “expected red” output treated as a passing CI job; locally rebuilt substitutes for CI artifacts. The existing visual-review runner remains available for cheap routine checks until the new judge packet path has calibration and exact replacement coverage.

## 4. Exhaustive functional and hazard coverage matrix

### 4.1 Contract key

| ID | Area |
| --- | --- |
| `C00` | candidate, validator, build, artifact and install identity |
| `C01` | startup, boot faults, newer/corrupt schema and oversized-store admission |
| `C02` | mission lifecycle, close/reload/crash/restart and recovery |
| `C03` | outings, teams, groups and participant scope |
| `C04` | current-position priority, cadence and visibility |
| `C05` | canonical fix-time ingest, duplicate/reorder/delay and evidence health |
| `C06` | stationary attention, stale, disconnected and recovery states |
| `C07` | complete breadcrumbs, paging and device/outing filters |
| `C08` | coverage build/invalidation/progress and honest Complete |
| `C09` | timed/untimed/revised GPX ingest and custody |
| `C10` | data-known-at-time Replay and timeline filtering |
| `C11` | clues, search areas, assignments and repeated pass outcomes |
| `C12` | markers, casualty/hazard/clue evidence and attachments |
| `C13` | coordinates, grid references, bearings, distance and measurements |
| `C14` | map/layer/overlay visibility, focus, hit testing and auxiliary panels |
| `C15` | official offline maps, package readiness, replacement and failure |
| `C16` | settings, provider credentials and safe bootstrap |
| `C17` | diagnostics, support/incident export privacy and warnings |
| `C18` | SQLite atomicity, WAL, backup, abrupt loss and recovery |
| `C19` | migrations, integrity assurance, retention and legacy-store recovery |
| `C20` | streamed archive creation and exhaustive verification, including >2 GiB |
| `C21` | archive keys, corruption/authenticity/custody and hostile bytes |
| `C22` | archive review, restore, revisions, cleanup and legacy compatibility |
| `C23` | preload/IPC containment, action cardinality and forbidden side effects |
| `C24` | current-position/event-loop responsiveness under competing work/faults |
| `C25` | 100-device, 12-day, five-/fourteen-day and field-scale resource bounds |
| `C26` | AppImage/installed `.deb` parity, native deps and duplicate launch |
| `C27` | tag/draft/checksum/fresh-download/release integrity and rollback |
| `C28` | composite whole-operator mission journey |
| `C29` | pre-release original-machine training acceptance and fallback evidence |

### 4.2 WAR-01 hazard coverage

No row is closed by this plan. The table defines the required future proof and keeps current gaps visible.

| Hazard | Required contracts | Deciding proof and variants | Required tier / retained gap |
| --- | --- | --- | --- |
| `TRK-001` current position delayed/hidden | C01, C04, C24, C25, C28 | independent source arrival-to-SQLite/current-map timing while startup, scope, history, coverage, archive, restore and diagnostics are held/failing | exact AppImage + installed `.deb`; startup-before-renderer limits and real provider remain separately measured |
| `TRK-002` non-authoritative time | C05, C10, C28 | source-log `fixTime` identity/digest, unverified-current exclusion and replay provenance | simulated exhaustive + bounded live GET-only |
| `TRK-003` skipped incremental history | C05, C07, C25, C28 | immutable source sequence versus SQLite/page/filter digests under overlap, delay, reorder and retry | 100-device synthetic; live provider corpus limited to observed server |
| `TRK-004` stationary alert late/noisy | C06, C28 | deterministic clock, distance/accuracy oracle, attention/clear state | browser/package synthetic; real GPS distribution remains field evidence |
| `MIS-001` lifecycle/recovery continuity | C02, C18, C28 | transactional state/audit oracle across graceful close, SIGKILL and power-loss proxy | both Linux packages; real power loss remains controlled-host evidence |
| `MIS-002` outing misattribution | C03, C10, C28 | half-open non-overlap oracle, midnight boundaries, late fixes, revised static GPX | 12 outings/12 days and package flow |
| `MIS-003` participant mis-scope | C03, C07, C08, C28 | group/device known-at-fix-time source truth, backfill checkpoint and excluded-device zero-row gates | 100 devices/12 groups |
| `PST-001` partial write/unsafe migration | C18, C19, C22 | SQLite integrity/schema/digest, kill point matrix, original-file preservation | CI + field-scale package; every supported schema |
| `PST-002` bad rolling backup | C18, C19 | pinned source/WAL snapshot, backup digest/open/query, good-mirror preservation | small fault matrix + field-scale Ubuntu |
| `PST-003` integrity re-freeze/absence | C19, C24, C25 | corruption detection plus main/event-loop/I/O budgets and cancellation | background/local large + final field scale; DON-249 remains separate from PR6 and `NOT_CLAIMED` for Beta 13; hazard remains open even if applicable probes support `SCOPE_LIMITED` |
| `PST-004` unbounded growth | C19, C24, C25 | declared table retention, row/byte slopes, query plans, RSS/disk/event-loop ceilings | five-/14-day and 3.7 GB; operational history never purged; DON-251 is `NOT_CLAIMED` for Beta 13 and the hazard remains open |
| `PST-005` oversized startup | C01, C19, C25 | bounded preflight/classification, no automatic rename/delete/vacuum, original-set digest | >2 GiB and 3.7 GB Ubuntu; DON-250 remains separate and `NOT_CLAIMED` for Beta 13; hazard remains open |
| `RPL-001` false Complete/100% | C08, C28 | independent selected-chunk inventory/revisions/digests, incomplete/fault mutants | 960k + 2m headroom, package/UI judge advisory only |
| `RPL-002` present-state Replay | C10, C22, C28 | transaction-time versions and known-at-T oracle across writes/revisions/late fixes | 960k/2m + archive-restored replay |
| `RPL-003` invented/lost GPX time | C09, C10, C22 | exact bytes/digest, explicit timed/untimed classification, no invented timestamps | 8 MiB boundary, malformed corpus, kill/restart |
| `RPL-004` archive failure/disclosure/unbounded work | C20, C21, C22, C24, C27 | exact ciphertext/source/restored counts/digests, authenticity, key, cleanup and latency gates | PR6 proof + >2 GiB + installed package + later cross-machine/custody gaps |
| `RPL-005` search outcome/overwrite | C11, C28 | immutable pass identity, full/partial/aborted coordinator outcome, repeated-overlap preservation | browser + package composite |
| `IPC-001` untrusted renderer capability | C23 | preload allowlist/projection, malformed/oversized input zero-invoke, sender/session checks | unit/integration + packaged negative probes |
| `IPC-002` drain race/duplicate instance | C02, C18, C23, C26 | action/request cardinality, durable drain/outbox/finalization receipt, process and profile identity | AppImage + installed `.deb`, graceful/SIGKILL/duplicate launch |
| `IPC-003` mission-size work on main | C04, C20, C22, C24, C25 | main-isolate heartbeat hard gate under every O(n) operation/fault | 200 ms hard limit, package/field scale |
| `GEO-001` coordinate transform wrong | C13, C28 | production golden fixtures, invalid/out-of-range rejection, WGS84/ITM/TM65 round trips | deterministic + package UI; no stale spike oracle |
| `GEO-002` unsafe bearing/distance | C13, C28 | geodesic/magnetic/bounds oracle and malformed input corpus | unit/property + rendered flow |
| `MAP-001` false Field ready | C15, C28 | file identity/freshness, required-view presence/decodability, no-serve or visible degraded state | exact package/private map on controlled host; WAR04-MAP-01..03 must turn green |
| `MAP-002` no safe licensed-map path | C15, C26, C29 | package import/read/offline behavior and operator procedure | Linux only; private package and external team path remain controlled evidence |
| `EVD-001` stored/map divergence | C05, C07, C10, C12, C14, C28 | source-to-SQLite-to-read-model-to-GeoJSON/render identity/digest | browser plus package/source oracle |
| `EVD-002` visibility changes evidence | C07, C08, C12, C14, C28 | display-only filter/visibility with unchanged SQLite/files and reversible visible state | browser + package |
| `EVD-003` overlay failure console-only | C14, C17, C28 | injected persistent failure, family-bound bounded warning, recovery-based clear; retain the failure streak when a hook re-registers for the same map and registration ID | DON-264 is rebased on current master `a81dd4a388196d241a48205ad45e961c1ab26c9b`; post-rebase full correctness, lint, Chromium/visual warning recovery, build/package and local C14 smoke passed. C14 smoke reported `releaseEligible:false`; exact-head CI/review and exact-candidate qualification remain separate |
| `EVD-004` accepted evidence silently lost | C02, C05, C18, C28 | accepted-source ledger, durable outbox/health block, lifecycle drain and zero-loss count | SIGKILL/restart/package |
| `EVD-005` attachment identity loss | C12, C20, C22 | immutable version-to-byte digest, same-name/superseded/deleted cases, archive/restore equality | package + archive scale |
| `SEC-001` bad settings/credentials break startup | C01, C16, C17, C26 | normal shell or actionable bounded fault/recovery export; clean pair persistence | AppImage + installed `.deb`; WAR04-SET-01..03 must turn green |
| `SEC-002` local plaintext credentials | C16, C17, C29 | separation, permissions, no export, clear/re-entry | accepted trusted-machine residual; no invented encryption claim |
| `SEC-003` export leaks sensitive data | C17, C20, C21, C22, C29 | recursive structured redaction plus adversarial representation corpus and human preview | synthetic package; operational evidence remains private; WAR04-PRV-01..03 green required |
| `SEC-004` roster mistaken for authentication | C02, C11, C21, C22, C29 | visible/audited local authority limits, mission-scoped actor/reason, no auth claim | accepted trusted-machine residual; team custody procedures later |
| `PKG-001` package noninteractive over time | C24, C25, C26, C29 | trusted click delivery, React state, main IPC, memory/event-loop/disk and hang evidence | Ubuntu plus external same-profile Mint A/B; DON-247 stays open until settled |
| `PKG-002` platform claims overreach | C00, C26, C27 | artifact allowlist and declared supported-host matrix | Linux x86-64 only; Windows and unavailable Mint evidence explicit gaps |
| `REL-001` published bytes differ | C00, C27 | tag/commit/asset/SHA256SUMS/metadata/fresh-download identity | exact draft and public bytes |
| `REL-002` dependency/native mismatch | C00, C26, C27 | lockfile/native ELF/install dependencies and reachability review receipt | exact Linux artifacts; no unsupported platform inference |
| `REL-003` unsigned/rollback misuse | C27, C29 | unsigned warning, no auto-update, retained prior artifact, quiet-period/fallback | accepted internal-beta residual with Donal sign-off |
| `REL-004` repo controls bypassed | C00, C27 | live branch/ruleset/check/review/secret-control receipt | external GitHub control; must be checked at decision time |
| `OPS-001` demo mistaken for readiness | C14, C15, C17, C28, C29 | explicit mode/build warnings, degraded-state visibility and training/fallback record | human training acceptance cannot be replaced by model/browser evidence or counted as WAR-13B field shadow |

### 4.3 PR1-PR6 and unchanged-surface accounting

| Programme/surface | Required contracts | Coverage requirement |
| --- | --- | --- |
| PR1 trustworthy ingest/live safety | C04, C05, C18, C23, C24, C25 | current independence, source-exact persistence, rejection evidence, lifecycle drain, main responsiveness |
| PR2 outings/participants/fixtures | C03, C07, C28 | 12 outings, 100 devices/groups, known-at-fix-time scope, backfill and restart |
| PR3 complete coverage | C07, C08, C24, C25, C28 | exact inventory/revisions, stale/dirty/failed builds, honest progress, 960k/2m and current priority |
| PR4 field-feedback bridge | C04, C05, C07, C25, C28 | sole `fixTime`, unverified current labeling, independent current cadence, progressive history and 37,479-style paging |
| PR5 mission evidence/Replay | C09-C12, C18, C23, C24, C28 | immutable versions, GPX bytes, assignments/passes, known-at-T replay, retained error states, pre-IPC bounds, attachments |
| PR6 archive lifecycle | C18, C20-C24, C25, C28 | SARARCH2 final design after merge, keys/custody, mission-scoped stream, exhaustive verification, review/revisions, cleanup and legacy |
| Existing mission shell/lifecycle | C01, C02, C28 | start/pause/resume/recover/finish/finalize, warnings, elapsed time, read-only final state |
| Markers/drawings/measurements/coordinates | C12-C14, C28 | all marker kinds, edit/delete/version/attachment, drawing tools, LPB, hit testing, safe coordinates |
| Layers/maps/focus/helicopter/weather | C14, C15, C28 | visibility and base-map switches do not alter evidence; overlays remain live; auxiliary links/panels remain coherent |
| Settings/diagnostics/privacy | C16, C17, C28 | atomic provider configuration, safe boot, maps/settings, bounded sanitized exports and visible failures |
| Persistence/scale/platform/release | C18-C19, C24-C27 | migrations, WAL/backups, field-scale responsiveness, package/install parity and exact published bytes |

The coverage compiler must emit a row for every referenced Linear requirement, `SAR-QA-*`/`SAR-FIELD-*` answer, WAR hazard, PR change and release-matrix gate with `planned`, `implemented`, `executed`, `passed`, `failed`, `blocked`, `external-gap`, `accepted-residual` or `not-applicable-with-reason`. Empty or multiply claimed rows fail the campaign preflight.

## 5. Contract catalogue

Every catalogue entry below is a contract family. Its compiled variants are individually sealed attempts; the family cannot pass because one representative variant passed. Pairwise reduction is allowed only for non-critical cosmetic axes. Every safety, persistence, archive, package and fault axis named as mandatory is exhaustive.

### C00 — Candidate, validator, artifact and install identity

- **Goal:** prove the tested runtime is the exact candidate and the validator is the reviewed validator.
- **Authoritative oracle:** Git objects/tree, CI API/workflow receipt, SHA-256, release asset metadata, runtime build ID, executable/native-module identity, `dpkg` database and validator source hashes.
- **Journey:** preflight only, plus runtime identity recheck at launch/restart and fresh-download recheck.
- **Variants:** browser build; CI AppImage; installed `.deb`; draft and fresh-public bytes.
- **Release phase (approved 2026-09-19):** source/runtime/draft identity is prepublication evidence. Fresh public-byte verification is separately mandatory immediately after controlled prerelease publication and before any team distribution or rollout approval. Authenticated draft downloads never count as public-byte proof. A mismatch blocks rollout and requires withdrawal or rollback under the release protocol; publication alone is not release completion.
- **Forbidden outcomes:** dirty/ambiguous SHA, local substitute, moved tag, extra installer, mismatched runtime, unlisted validator file, self-retained-only seal.
- **Evidence:** source/validator bundles, CI receipt, hash manifests, install logs, runtime/process facts and external anchor.
- **Judge rubric:** none; identity is never model-judged.
- **Environment/tier:** every tier; release decision requires exact CI/draft/public artifact tiers.
- **Cleanup:** no candidate mutation; remove leased install only when the install contract explicitly owns it and verify package state.

### C01 — Startup, boot faults and store admission

- **Goal:** reach a usable normal shell or a calm actionable fault/recovery state without unbounded startup work or data loss.
- **Authoritative oracle:** process/window timing, runtime boot phase, bounded SQLite metadata/schema, original database/WAL/backup digests, current-provider request log.
- **Journey:** launch fresh, launch active/recoverable, launch corrupt/newer/oversized/permission-fault profiles; inspect warning/recovery/export; restart.
- **Variants:** absent/valid/corrupt/newer schema; held diagnostics/crash/store gate; 8 MiB through 3.7 GB; permission/disk faults.
- **Forbidden outcomes:** indefinite blank/held window, automatic rename/delete/migration/vacuum, false normal state, lost original, current polling silently unavailable.
- **Evidence:** launch video/screenshot, phase/heartbeat/process, bounded metadata, profile/file manifest, DOM/ARIA and warning actions.
- **Judge rubric:** boot/fault state is visible, plain, actionable and does not imply data loss or readiness.
- **Environment/tier:** browser for visible states; AppImage and installed `.deb` for factual release proof; field-scale Ubuntu for oversized admission.
- **Cleanup:** preserve original profile set; delete only attempt copy or quarantine it.

### C02 — Mission lifecycle, shutdown and recovery

- **Goal:** preserve one mission's audited start/pause/resume/recover/finish/finalize state through closure and failure.
- **Authoritative oracle:** SQLite mission/audit/finalization rows, elapsed-time calculation, evidence-drain/outbox/custody receipts and process lifecycle.
- **Journey:** create mission; operate; pause/resume; close/reopen; SIGKILL at named boundaries; recover; finish; finalize; verify read-only state.
- **Variants:** graceful window close, reload, renderer crash, main SIGKILL, power-loss proxy, duplicate instance, pending evidence/GPX/attachment/archive work.
- **Forbidden outcomes:** two active missions, silent force-close, post-finish ordinary write, lost/duplicated audit, recovery with invented phase, finalization through an unsettled fence.
- **Evidence:** actions, SQLite snapshots/digests, PID timeline, recovery UI, trace/video and drain receipts.
- **Judge rubric:** lifecycle state, critical warning and next action are unmistakable; finalized mission looks read-only.
- **Environment/tier:** CI small; exact AppImage and installed `.deb`; composite release journey.
- **Cleanup:** finish or discard only the synthetic leased mission as predeclared; verify no active mission/profile leak.

### C03 — Outings, groups and participant scope

- **Goal:** attribute evidence to coordinator-defined non-overlapping outings and known-at-fix-time device/group participation.
- **Authoritative oracle:** deterministic outing/team/participant source manifest and SQLite membership/position joins.
- **Journey:** create 12 outings across a 12-day mission, including midnight crossings; select groups/direct devices; add/remove/re-add; ingest boundary and late fixes; filter.
- **Variants:** 1/8/32/100 devices, 1/12 groups, explicit/group overlap, incomplete backfill, legacy unassigned, 12-hour maximum outings.
- **Forbidden outcomes:** overlap, invented/forced closure, boundary in wrong outing, excluded evidence persisted, selected evidence missing, Finish/Complete before backfill.
- **Evidence:** source and SQLite digests/counts, action log, filter screenshots/DOM and backfill health.
- **Judge rubric:** outing/participant scope and Unassigned/backfill limitations are visible and coherent.
- **Environment/tier:** small/CI, 960k, 2m and package composite.
- **Cleanup:** delete only synthetic lease; group/server baseline unchanged.

### C04 — Current-position priority and visibility

- **Goal:** show the newest accepted current fix within one normal polling cycle while slow/failing historical work remains isolated.
- **Authoritative oracle:** simulated/live source arrival monotonic time, request transcript, normalized current snapshot, renderer map feature identity and controller timing.
- **Journey:** start tracking; inject current fixes while holding history, participant hydration, coverage, replay, archive, restore, export, cache and diagnostics; explicitly hide/show current position.
- **Variants:** roster slow/error, settings reload, pause/recovery, cached/no-cache, online/offline/reconnect, 100 devices, older history arrival.
- **Forbidden outcomes:** current waits on history/worker/archive, older fix overwrites, blank map presented as absence, hidden without explicit action, stale snapshot looks current.
- **Evidence:** source/server log, request/action timestamps, SQLite/current snapshot, map feature dump, video/DOM/ARIA and main/renderer timing.
- **Judge rubric:** current/stale/paused/offline state and explicit visibility control are unmistakable.
- **Environment/tier:** browser stress; exact AppImage and installed `.deb`; bounded live provider.
- **Cleanup:** stop leased server/poller and restore settings/profile.

### C05 — Canonical fix-time ingest and evidence health

- **Goal:** admit only valid `fixTime` rows as exact breadcrumb evidence while keeping unverified current data visibly separate.
- **Authoritative oracle:** immutable source-server row log keyed by full source identity/content, acceptance/rejection/anomaly ledger, SQLite canonical row digest.
- **Journey:** deliver normal, delayed, reordered, duplicate, conflicting same-ID, missing/malformed/future/out-of-range time and coordinate payloads; restart and reconcile.
- **Variants:** provider delay, duplication, 503/retry, pagination overlap, equal-now/late fixes, source heartbeat; 25 m movement and ~20-minute stationary heartbeat source patterns.
- **Forbidden outcomes:** substituted time in exact evidence, duplicate row, conflict overwrite, cursor advance past rejected data, accepted row without durable health ownership.
- **Evidence:** source/request logs, normalized decisions, SQLite digest/counts, evidence-health UI and diagnostics.
- **Judge rubric:** unverified/rejected/degraded status is prominent and not confused with exact history.
- **Environment/tier:** exhaustive simulated server; CI/package; bounded live GET-only confirmation.
- **Cleanup:** server fixture immutable; attempt profile removed/quarantined.

### C06 — Stationary, stale and disconnected attention

- **Goal:** raise accuracy-aware stationary attention at roughly 20 minutes, clear on meaningful movement and communicate stale/disconnected status.
- **Authoritative oracle:** deterministic clock and geodesic/accuracy rule over source fixes.
- **Journey:** two accepted stationary fixes, slow walker, GPS jitter, teleport outlier, stale device, disconnect/reconnect and acknowledgement.
- **Variants:** accuracy radii, threshold edges, delayed/reordered fixes, current-only unverified fixes.
- **Forbidden outcomes:** jitter alert, outlier clear, missed qualified alert, stale shown live, alert alters persisted evidence.
- **Evidence:** source clock/fixes, computed oracle, UI state, screenshot/DOM/ARIA and diagnostics.
- **Judge rubric:** attention versus stale/disconnected is visually distinct and gives an actionable response.
- **Environment/tier:** deterministic/browser and package composite; field GPS behavior remains a declared gap.
- **Cleanup:** restore synthetic acknowledgement state.

### C07 — Breadcrumb completeness, paging and filters

- **Goal:** retain all mission breadcrumbs and selectively display device/outing subsets without changing records while current positions remain immediate.
- **Authoritative oracle:** source-log and SQLite full/keyset/range digests and map feature identities.
- **Journey:** ingest progressive history, page beyond 10,000 rows, switch all/device/outing filters, hide/show lines/dots, restart and accept late fixes.
- **Variants:** empty/small/37,479/960k/2m; 100 devices; 12 outings; late inserts and continuation invalidation.
- **Forbidden outcomes:** silent truncation, filter deletion, stale continuation omission, current delay, count/identity mismatch, all-history default omitted.
- **Evidence:** source/SQLite/read-model/render digests, page receipts, timing, screenshots/video and action log.
- **Judge rubric:** selected scope, total/partial state and current-versus-history distinction are coherent.
- **Environment/tier:** CI, 960k, 2m, AppImage/deb and long scale.
- **Cleanup:** copy-on-test profile; retained source fixture unchanged.

### C08 — Coverage, invalidation and honest completion

- **Goal:** build complete coverage from the exact selected breadcrumb inventory without ever showing false Complete or 100%.
- **Authoritative oracle:** independent SQLite snapshot of canonical chunk inventory, revisions, counts, content digests, selection predicates and delivered ledger.
- **Journey:** start coverage, observe partial, change participants/outings/fixes, force worker result faults/timeouts/restarts, finish build and filter/revisit.
- **Variants:** overlapping/revisited tracks, retained/rebuilt chunks, late writes, 960k normal and 2m headroom rejection, malformed/forged worker mutants.
- **Forbidden outcomes:** Complete on missing/stale/forged chunk, 100% after final-claim failure, visible coverage removed before replacement, current position blocked, worker result self-attests.
- **Evidence:** independent inventory/claim reports, worker/main event ledger, map render feature dump, progress UI and timing.
- **Judge rubric:** Partial/building/failed/Complete wording and map/progress relationship are honest and legible.
- **Environment/tier:** deterministic/mutation, browser/visual, package 960k and headroom.
- **Cleanup:** terminate worker generation, remove stage/lease and verify no live-store mutation beyond declared ledger.

### C09 — GPX ingest, provenance and custody

- **Goal:** preserve exact timed/untimed GPX bytes and provenance without inventing time or losing receipts/revisions.
- **Authoritative oracle:** input byte hash/size, parser output, immutable source receipt, object/version rows and managed file digest.
- **Journey:** import timestamped and untimestamped GPX; assign/revise static outing; search/filter/replay; SIGKILL at receipt/copy/commit points; restart/recover.
- **Variants:** valid/malformed/XML attacks, empty, duplicate filename, same-name replacement, 8 MiB exact boundary/over, 50,000 points, concurrent current writes.
- **Forbidden outcomes:** invented timestamps, byte overwrite, partial receipt, unsafe path/entity expansion, stale cursor, finalized mutation.
- **Evidence:** source/file/SQLite digests, parser/rejection receipt, kill timeline, UI scope and warnings.
- **Judge rubric:** timed/untimed/static limitations, revision identity and failure/retry action are visible.
- **Environment/tier:** CI, browser and package kill probes; archive round trip in C22.
- **Cleanup:** remove attempt-managed GPX only after sealed receipt; source remains read-only.

### C10 — Data-known-at-time Replay

- **Goal:** reconstruct the data known at time T, not today's edited state, with deterministic pagination and explicit limitations.
- **Authoritative oracle:** transaction-time/version history and pinned SQLite replay snapshot, including source-time provenance and stable generation.
- **Journey:** create/edit/retire evidence around T; seek, page/filter, pause live mission, accept late fixes, refresh/fail/retry, return live.
- **Variants:** DST/local display, equal timestamps/rowid ties, 201+ outings, retained stale snapshot, concurrent writes, archive-restored source.
- **Forbidden outcomes:** present-state leakage, stale page overwrite, filter unreachable, late row silently inserted into old generation, draft time reset by live controls.
- **Evidence:** query inputs/generation, SQLite oracle, results/digests, actions, DOM/ARIA, video and timing.
- **Judge rubric:** Replay scope/time, stale/failed state, draft versus accepted filters and Return to Live are clear.
- **Environment/tier:** small/browser, 960k/2m, package and archive-restored.
- **Cleanup:** cancel reads and prove no durable mutation.

### C11 — Clues, search areas, assignments and passes

- **Goal:** preserve coordinator-owned search intent and every full/partial/aborted pass without inferring operational completion.
- **Authoritative oracle:** immutable object/version, assignment and pass rows with geometry/outing/actor/reason.
- **Journey:** create overlapping areas and clues; assign; record repeated full/partial/aborted passes; edit/retire evidence; search and Replay.
- **Variants:** overlaps, revisits, same area/multiple outings, malformed/out-of-window geometry, 50,000-pass paging.
- **Forbidden outcomes:** coverage declares pass outcome, later pass overwrites earlier, pass outside assignment outing, finalized ordinary edit, wrong retained control scope.
- **Evidence:** SQLite versions/digests, geometry oracle, search pages, actions and visible cards/map.
- **Judge rubric:** operator can distinguish assignment, evidence, pass outcome and coverage; repeated outcomes remain visible.
- **Environment/tier:** unit/integration, browser/visual, package composite.
- **Cleanup:** remove leased evidence/profile only.

### C12 — Markers, casualties, hazards, clues and attachments

- **Goal:** preserve marker identity, coordinates, attributes, revisions and all referenced attachment bytes through finalization/archive.
- **Authoritative oracle:** SQLite current/version/audit rows and attachment byte hashes/custody manifest.
- **Journey:** create/edit/retire each marker kind, add same-name/superseded attachments, finish/finalize, review, archive/restore.
- **Variants:** coordinate boundary, missing/corrupt file, concurrent Finish, duplicate name, large-but-bounded file, retained historical version.
- **Forbidden outcomes:** map/storage divergence, attachment overwrite/delete, write after finalization, missing archive byte, ambiguous casualty/hazard display.
- **Evidence:** SQLite/files/map-feature digests, action log, screenshots/DOM/ARIA and archive inventory.
- **Judge rubric:** marker kind/severity/location/revision/attachment state is visually coherent and safety warnings prominent.
- **Environment/tier:** browser/visual, package and archive paths.
- **Cleanup:** verified deletion of only attempt-managed bytes after seal.

### C13 — Coordinates, bearings, distance and measurements

- **Goal:** reject unsafe input and display correct WGS84/ITM/TM65/grid, distance, bearing and magnetic conversion.
- **Authoritative oracle:** production golden fixtures and independent formula/reference vectors, never historical spike output.
- **Journey:** enter coordinates, place marker, inspect converter/map cursor, draw/measure/LPB, convert true/magnetic.
- **Variants:** NaN/Infinity/out of range, rounding/boundaries, Irish reference points, antimeridian non-applicable reason, declination -4.5°.
- **Forbidden outcomes:** accepted invalid coordinate, wrong CRS/sign, wrong map placement, unlabelled rounding or true/magnetic confusion.
- **Evidence:** input/output vectors, map feature coordinates, DOM/ARIA, screenshots and deterministic results.
- **Judge rubric:** coordinate format/CRS, error and bearing labels are readable and unambiguous.
- **Environment/tier:** unit/property, browser/visual and package composite.
- **Cleanup:** no persistence unless the contract explicitly creates a disposable marker/drawing.

### C14 — Maps, layers, overlays and auxiliary operator surfaces

- **Goal:** keep tracking/markers/drawings/GPX/coverage/measurement/helicopter layers coherent through basemap/focus/visibility changes and surface persistent sync failure.
- **Authoritative oracle:** SQLite/read-model identities, MapLibre source/layer feature dump, visibility state and diagnostic warning state.
- **Journey:** toggle every layer/group/item, switch basemap/focus, pan/hit-test, hold tiles, inject sync failures/recovery, use helicopter/weather panels.
- **Variants:** overlapping features, style reload, pending/degraded tiles, multiple overlay-family failures, hidden history with current visible.
- **Forbidden outcomes:** display toggle changes records, current overlay waits for tiles, wrong hit target, console-only persistent failure, warning clears before verified sync.
- **Evidence:** map source/style snapshot, SQLite unchanged proof, DOM/ARIA, screenshots/video, console/network/diagnostics.
- **Judge rubric:** layer visibility, degraded basemap versus operational overlays and persistent warning/recovery are coherent.
- **Environment/tier:** browser/visual; AppImage/deb composite; DON-264 now has local browser and packaged macOS C14 evidence, but remains open until exact-candidate qualification supplies the required evidence.
- **Cleanup:** restore visibility/settings and remove synthetic map state.

### C15 — Official offline maps and Field ready

- **Goal:** declare Field ready only for the exact readable, fresh package with decodable required-view coverage and fail visibly offline.
- **Authoritative oracle:** file identity/hash/metadata, SQLite tile queries, independent image decode and network-block transcript.
- **Journey:** import/register/save/check coverage/use map; remove, corrupt, replace same path, omit tile, use invalid bytes, go offline and recheck.
- **Variants:** valid/private package on controlled host; synthetic MBTiles; missing/schema/content/permission faults; cache invalidation.
- **Forbidden outcomes:** stale `Field ready`, old inode served, invalid bytes accepted, online fallback hidden, private map copied to evidence/release.
- **Evidence:** bounded package facts/hash (not private bytes), decode result, proxy/network log, checklist DOM/ARIA/video and settings receipt.
- **Judge rubric:** ready/degraded/no-coverage/offline state and operator next action are clear without exposing private map detail.
- **Environment/tier:** synthetic CI; exact packages with private map under custody; field workflow remains scoped.
- **Cleanup:** delete only imported synthetic/private test copy per custodian instruction; no release upload.

### C16 — Settings, credentials and safe bootstrap

- **Goal:** publish one coherent provider/settings generation, reject credential-bearing URLs and degrade unreadable secrets to tracking-off without losing the shell.
- **Authoritative oracle:** settings/credential file generation and permissions, runtime config, request destination/auth pseudonym and clean-profile baseline.
- **Journey:** save/clear/re-enter; inject concurrent saves and failure after each boundary; launch with missing/corrupt/unreadable secret/settings.
- **Variants:** URL userinfo/query/fragment encodings, disk-full/permission, temp collision, two simultaneous complete drafts, legacy secret.
- **Forbidden outcomes:** cross-paired URL/secret, partial persistence after rejection, credential in URL/output, bootstrap abort for secret read, silent defaults for malformed settings.
- **Evidence:** redacted file structure/generation, action/result log, runtime request destination hash, UI warnings and recovery.
- **Judge rubric:** tracking-disabled/fault state and recovery action are explicit; no secret is visible.
- **Environment/tier:** isolated unit/integration, browser; AppImage and installed `.deb` bad-secret/concurrency paths.
- **Cleanup:** securely remove disposable credentials/profile; verify no secret in evidence.

### C17 — Diagnostics, warnings and privacy

- **Goal:** retain bounded actionable evidence while recursively excluding credentials, precise coordinates, private paths/maps, mission/device/casualty data outside approved allowlists.
- **Authoritative oracle:** structured input corpus with canary tokens/coordinates/paths, byte-level output scan and bounded event/size policy.
- **Journey:** create renderer/main/crash/storage/settings/map/tracking faults; Copy Report; export support/incident; inspect startup-fault export and human-preview receipt.
- **Variants:** nested/double-encoded/JSON/URL/UNC/case/Unicode representations; corrupt settings; direct-main coordinates; huge fields and repeated events.
- **Forbidden outcomes:** any canary survives, export re-enters failing settings path, unbounded output, missing required diagnostic, model egress before redaction.
- **Evidence:** input canary manifest, output hashes/scanner report, size/counts, UI actions and redaction receipt; raw private only.
- **Judge rubric:** warning is visible/actionable and export status is clear; judge never receives raw diagnostic text.
- **Environment/tier:** deterministic corpus, browser and both Linux packages; human preview for any non-synthetic evidence.
- **Cleanup:** destroy synthetic reports after seal; preserve real incident evidence in place under protocol.

### C18 — SQLite, WAL, backup and abrupt recovery

- **Goal:** keep atomic recoverable mission evidence and one safe mirror through writes, backup and abrupt termination.
- **Authoritative oracle:** SQLite integrity/foreign keys/schema, table digests/counts, WAL/checkpoint facts, source-versus-backup/reopen equality and filesystem identity.
- **Journey:** write across mission workflows; autosave/backup; SIGKILL/power-loss proxy at prepared checkpoints; reopen/recover/retry.
- **Variants:** disk-full/permission, corrupt/truncated temp, busy WAL, concurrent current writes, backup worker crash, stale/good mirror.
- **Forbidden outcomes:** partial committed domain operation, good backup replaced by bad, main freeze, silent failure, lost accepted evidence, original deletion.
- **Evidence:** pinned snapshot/digests, worker/process timeline, filesystem mutation log, recovery UI and diagnostics.
- **Judge rubric:** backup/recovery failure and safe next action are visible; integrity is not judged visually.
- **Environment/tier:** small exhaustive kills, CI, 1 GiB and field-scale Ubuntu/package.
- **Cleanup:** close handles, retain source/cache, remove only leased copies and temp files after verification.

### C19 — Migrations, integrity, retention and oversized legacy recovery

- **Goal:** migrate every supported schema safely, detect corruption without freezing, retain all operational evidence and handle large legacy stores explicitly.
- **Authoritative oracle:** before/after schema and whole-table digests, query plans, retained/deleted category inventory, original file-set identity, I/O/event-loop metrics.
- **Journey:** open/migrate/restart/interrupt each schema; run bounded integrity/retention; classify active/finished/finalized/disposable/unknown legacy cases.
- **Variants:** small/1 GiB/3.7 GB, low disk, battery/resource arbitration proxy, stale check, corrupt metadata, newer schema, index/retention kill points.
- **Forbidden outcomes:** startup O(n) work, operational evidence purge, automatic unknown-store replacement, 2x disk without preflight, stale success, partial migration.
- **Evidence:** schema/table/query-plan reports, file hashes, process/I/O timing, UI classification and diagnostics.
- **Judge rubric:** large/corrupt/newer store state and permitted recovery actions are calm and explicit.
- **Environment/tier:** unit/CI; local large; exact Ubuntu field-scale. DON-249/250/251 remain separate owners.
- **Cleanup:** original file set immutable; working/result copies verified or quarantined.

### C20 — Streamed archive creation and verification

- **Goal:** create a mission-scoped encrypted archive without whole-file buffering and prove every declared entry/table/artifact from the same pinned source snapshot.
- **Authoritative oracle:** source snapshot inventory/counts/digests, ciphertext hash/length, authenticated header/trailer/entry inventory, exhaustive restored table/byte digests and replay proof.
- **Journey:** finalize; create archive while current tracking and another mission continue; verify; reopen; inspect registry; repeat with supplement/recovery where final design requires.
- **Variants:** small/CI, >2 GiB, 3.5-3.7 GB Ubuntu; every current-schema table/artifact; low disk; worker cancel/SIGKILL/restart; concurrent writes.
- **Forbidden outcomes:** Buffer path, unrelated mission data, main stall, plaintext temp/residue, incomplete inventory, cleanup eligibility before verified restore/replay, current delay.
- **Evidence:** pinned source receipt, inventory/digests, worker/process/timing, ciphertext identity, plaintext sweep and UI progress/warnings.
- **Judge rubric:** archive progress, failure, verification and continued current operation are coherent; judge cannot attest integrity.
- **Environment/tier:** PR6 deterministic/reference proof; exact AppImage and installed `.deb`; final >2 GiB Ubuntu path.
- **Cleanup:** secret zeroing, scratch/plaintext sweep, staging recovery and lease-only archive retention/quarantine.

### C21 — Archive keys, authenticity and hostile bytes

- **Goal:** fail closed for wrong/unavailable keys and any archive/manifest replacement, corruption or structural attack while preserving custody privacy and recovery access.
- **Authoritative oracle:** authenticated encryption/frame parser, exact registered ciphertext identity, slot/custody journal, cryptographic manifest and same-open-file identity.
- **Journey:** unlock by permitted passphrase/recovery/machine slot; wrong key; lose/change slot; flip/truncate/reorder/splice/append bytes; swap mission/epoch/registry/archive; restart.
- **Variants:** every frame/entry boundary, duplicate/missing slot, replacement during verify/restore, recovery-code custody and legacy archive.
- **Forbidden outcomes:** partial plaintext presented, oracle/format error leaks secret, mutable verified bytes, archive+manifest replacement accepted, secret in IPC/workerData/log/judge.
- **Evidence:** attack plan/result codes, ciphertext/registry hashes, secret-canary scan, process/IPC projection, visible generic errors and custody receipt.
- **Judge rubric:** unlock/failure/recovery guidance is clear without exposing whether a guessed secret was close or valid.
- **Environment/tier:** deterministic mutation corpus, package and later custody tabletop/cross-machine rows.
- **Cleanup:** zero secrets, remove scratch, quarantine hostile archives; preserve original encrypted test source.

### C22 — Archive review, restore, revisions and cleanup

- **Goal:** open only a verified archive into read-only review, replay exact evidence, show immutable supplements/revisions and clean live detail only after supported recovery is proven.
- **Authoritative oracle:** registered archive/ciphertext identity, restored SQLite/file digests, source-versus-restored read models/replay, supplement chain and cleanup journal.
- **Journey:** unlock/review/search/replay; attempt edit; add authorized visible supplement; restore; cleanup; restart/SIGKILL each phase; reopen archived and legacy missions.
- **Variants:** wrong key, missing/corrupt archive, multi-mission isolation, superseded epochs, newer schema, cleanup conflict, cross-machine later.
- **Forbidden outcomes:** ordinary edit, invisible revision, archive mutation, cleanup before proof, unrecoverable partial live store, plaintext residue, wrong mission/epoch review.
- **Evidence:** source/restored digests, review query results, cleanup/custody journal, filesystem sweep, UI/video and action log.
- **Judge rubric:** archive-backed/read-only state, revision provenance, unlock/restore/failure and no-delete semantics are unmistakable.
- **Environment/tier:** CI/browser, package, multi-GB Ubuntu; cross-machine/tabletop retained in DON-254.
- **Cleanup:** close review session, verify scratch removal and keep encrypted archive/custody record.

### C23 — Preload/IPC containment and forbidden side effects

- **Goal:** admit only closed bounded requests from the owning renderer/session and correlate exactly the intended effects.
- **Authoritative oracle:** preload invoke spy, main validation, sender/session registry, controller network/files/SQLite diff and request/event cardinality.
- **Journey:** perform normal operator actions, then wrong-typed/unknown/oversized/replayed/cross-window/cancel-after-close attacks.
- **Variants:** every public bridge method, 32/64 MiB fields, destroyed sender, duplicate request, delayed response, action-token reuse.
- **Forbidden outcomes:** invalid invoke reaches IPC, more/fewer effects than declared, external message/process/network side effect, another mission/profile mutation.
- **Evidence:** semantic actions, invoke/request/event log, closed-world state/files/network diff and process trace.
- **Judge rubric:** only for visible consequence of rejected/failed action; judge does not decide authorization.
- **Environment/tier:** unit/integration; browser harness cannot prove Electron IPC; package probes required.
- **Cleanup:** invalidate tokens/sessions and verify zero out-of-lease effects.

### C24 — Responsiveness under competing work and faults

- **Goal:** keep Electron main below the hard 200 ms bound and current/operator interactions responsive while mission-size/background operations run or fail.
- **Authoritative oracle:** monotonic main/renderer heartbeat, trusted click-to-React and renderer-to-main IPC timing, source-to-current latency, operation I/O/CPU and process tree.
- **Journey:** repeat representative operator actions during history, coverage, Replay, GPX, diagnostics, integrity, archive, verify, restore, export, cleanup, backup and map faults.
- **Variants:** operation start/steady/cancel/fail/cleanup; cold/warm; 960k/2m/1 GiB/3.7 GB; 100 devices; AppImage/deb.
- **Forbidden outcomes:** main sample >=200 ms, renderer/operator threshold breach, missed heartbeat/current deadline, blocked close, unbounded queue/memory.
- **Evidence:** controller timing samples/distributions, process/RSS/I/O, action recorder, source log and screenshots on failure.
- **Judge rubric:** visible busy/progress/cancel state is calm and current controls remain usable.
- **Environment/tier:** CI smoke, local background and exact Ubuntu packages/scale.
- **Cleanup:** cancel/settle operations, stop sampler and verify no workers/processes remain.

### C25 — Long-duration and field-scale resource qualification

- **Goal:** sustain the locked operational envelope without data drift, growth surprise or loss of interactivity.
- **Authoritative oracle:** deterministic source truth, SQLite full/page/range digests, row/byte slopes, WAL/integrity, restart receipts, RSS/process/event-loop/operator metrics.
- **Journey:** run accelerated 5-day and 14-day profiles; 12-day/100-device/12-outing BCP scenario; restart checkpoints; archive cycles; final operator audit.
- **Variants:** existing five-/fourteen-day, 960k, 2m, local 1 GiB and field 3.7 GB; moving/stationary/stale devices; archive success/failure.
- **Forbidden outcomes:** count/digest mismatch, redundant telemetry slope, >2 GiB RSS ceiling, main/interaction breach, restart loss, current delay, unexplained flake.
- **Evidence:** source/SQLite exact proof, resource series, action audits, profile/artifact facts and sealed reports.
- **Judge rubric:** sampled key checkpoints only; visible long-run totals/status/warnings coherent. The judge does not review millions of rows.
- **Environment/tier:** nightly subsets; final exact AppImage and installed `.deb`; same-profile Mint remains external.
- **Cleanup:** stop at checkpoints, preserve cache/source, verify leased profile/archive cleanup.

### C26 — AppImage, installed `.deb` and duplicate-launch parity

- **Goal:** prove both qualified Linux delivery forms run the same candidate and critical workflows without profile/process divergence.
- **Authoritative oracle:** C00 identity, installed files, process executable, shared scenario/source/SQLite digests, package-specific logs and single-instance state.
- **Journey:** fresh launch, settings, lifecycle/recovery, tracking, archive/review, diagnostics, maps and duplicate launch on isolated but equivalent profiles.
- **Variants:** AppImage and genuinely installed `.deb`; X11/Wayland where available; clean/retained profile; missing dependency/bad secret.
- **Forbidden outcomes:** one package-only failure, wrong executable, dirty install, second writer/profile corruption, package-specific data drift.
- **Evidence:** install/launch/process receipts, paired contract results and cross-profile source/SQLite identity comparison.
- **Judge rubric:** visible behavior differences are concerns; factual parity remains deterministic.
- **Environment/tier:** reference Ubuntu exact artifacts; real Mint unavailable and not inferred.
- **Cleanup:** uninstall only lease-owned package version, restore prior package if predeclared, preserve evidence and profiles until digests sealed.

### C27 — Release bytes, draft, publication and rollback

- **Release phase (approved 2026-09-19):** mandatory prepublication gate while the release remains draft. Verify exact candidate/artifact identity, metadata, checksums, rollback readiness and all other safely prepublication conditions. Controlled prerelease publication follows every prepublication gate and the existing Donal approval boundary. C00 then independently verifies fresh public downloads before team distribution; neither gate can be omitted or relabelled.
- **Goal:** ensure the exact reviewed/smoked bytes are the only publishable assets and retain a safe prior qualified rollback.
- **Authoritative oracle:** remote tag object, gated commit, workflow run, draft state/body, asset metadata/digests, SHA256SUMS, fresh downloads and guarded-publisher validation.
- **Journey:** create/inspect draft in dry-run or release task; download; hash; bind qualification; verify regression provenance; guarded publication only after Donal approval.
- **Variants:** moved tag, extra/missing/mutated assets, stale/pending evidence, non-draft release, regression/non-regression note.
- **Forbidden outcomes:** local artifact substitution, unsmoked byte, publication with pending row, clobber published release, Windows/macOS extra artifact, no rollback.
- **Evidence:** API/workflow/download hashes, release body parser results, live repository-control receipt and approval reference.
- **Judge rubric:** none for release identity; optional clarity review of operator release note only.
- **Environment/tier:** exact remote/draft/public; no release action is authorized by this plan.
- **Cleanup:** dry runs leave no release; real release task follows guarded path and never deletes prior qualified assets.

### C28 — Composite whole-operator mission

- **Goal:** prove the major application surfaces work together without a seam defect hidden by isolated tests.
- **Authoritative oracle:** a composite deterministic mission source manifest joined to SQLite/files/map/replay/archive counts/digests and performance budgets.
- **Journey:** settings/maps; start mission; teams/outings; live current/history; timed/untimed GPX; markers/clues/areas; overlapping repeated passes; coverage; pause/restart; Replay; finish/finalize; archive/verify/review/restore; sanitized diagnostics.
- **Variants:** small routine flow for CI and one release-candidate 100-device/12-outing field-scale flow; injected failure at each major phase in separate attempts.
- **Forbidden outcomes:** any cross-surface state drift, hidden warning, false completion, blocked current position, evidence loss, archive/restore mismatch or privacy leak.
- **Evidence:** all controller oracles plus event-aligned screenshots/video/trace/DOM/ARIA/actions and campaign-level timeline.
- **Judge rubric:** a fresh judge assesses coherent state, warnings, controls, map evidence and adjacent visible defects at predeclared checkpoints only.
- **Environment/tier:** browser CI; exact AppImage and installed `.deb` release candidate.
- **Cleanup:** complete lease cleanup/quarantine; no composite run uses real incident data.

### C29 — Pre-release original-machine training acceptance

- **Goal:** collect named human acceptance on the original machine before release, using synthetic, replayed or deliberately disposable training data. SAR Tracker remains advisory and an independent training reference stays authoritative. Donal approved this separation from post-publication WAR-13B field shadow on 2026-09-19.
- **Authoritative oracle:** session/candidate identity, primary-source comparison checkpoints, stop/fallback timing and the frozen residual-risk record—not model opinion.
- **Journey:** named authorization and exact candidate/original-machine binding; training pre-session gate; fallback drill; bounded training scenarios; compare at opening/transitions/warnings/close; stop on any trigger.
- **Variants:** E0 ordinary feedback, E1 reproducible issue, E2 safety/regression within training only. Field/real-incident shadow is a separate post-publication activity and cannot substitute for this receipt.
- **Forbidden outcomes:** primary handover, use before admission, >60-second fallback, unreviewed sensitive evidence sharing, automatic qualification/release status change.
- **Evidence:** externally supplied human acceptance, protocol record, exact artifact/profile and original-machine identity, comparison counts, fallback time and proportionate redacted evidence. Explicitly label the session pre-release training and non-counted for WAR-13B; neither a valid signature nor a model summary proves an unobserved session.
- **Judge rubric:** no automatic judge. Human team feedback is the authority for comprehension/usability; models may summarize only redacted, approved material later.
- **Environment/tier:** external-human acceptance on the exact candidate installed on the original machine, after named training authorization. No live operational use is admitted. Missing original-machine or human evidence remains an external gap and cannot be replaced by browser/source evidence.
- **Cleanup:** follow protocol; preserve E2 evidence in place, remove disposable fixtures, never reset a profile before scoped custody decision.

## 6. Fixture, server and fault-injection strategy

### 6.1 Fixture tiers

| Tier | Existing basis | Planned use | Required additions |
| --- | --- | --- | --- |
| Micro | hand-built unit/property fixtures | parsers, oracles, mutation tests, every kill boundary with tiny data | stable seed/oracle manifest and mutant label |
| Small deterministic | existing `small`, about 8 MiB | per-change browser/Electron contracts and exhaustive functional variants | lease manifest, full table/file digests, synthetic watermark |
| CI | existing `ci`, about 128 MiB | PR/background package smokes, selected fault variants | bounded runtime target and cache identity |
| BCP normal | existing `bcp-960k`, 100 devices/12 groups/12 outings/12 days | PR1-PR6 deterministic and browser/package qualification | archive source/restored oracle and composite journey data |
| BCP headroom | existing `bcp-2m` | renderer rejection/headroom, paging, coverage and current isolation | explicit expected non-render state; never a false “normal envelope” pass |
| Local large | existing `local`, 1 GiB | developer background performance, integrity/migration/archive rehearsal | allocated-byte/free-space receipt |
| Duration | existing `mission-5d` and `mission-14d` | exact long-run prefixes, restart, growth and responsiveness | archive cycles and post-PR6 source/restored digests |
| Field scale | existing `field`, about 3.7 GB; historical 3.704 GB data shape | final Ubuntu migration/recovery/archive/restore/package proof | copy-on-test lease, no sparse shortcut, source fixture hash/custody |
| Archive boundary | >2 GiB and 3.5-3.7 GB encrypted output/input | mandatory Node Buffer regression and installed Ubuntu path | final PR6 container/schema-aware generator and disk reserve model |

All generated fixtures must use the current production schema and APIs or a reviewed fixture-only loader whose output is independently checked. Existing caches are reused only when generator version, schema, manifest, file hash and intended contract all match. A PR6 schema change invalidates cached manifests until regenerated/verified; it does not require blindly regenerating multi-GB data.

The fixture model must include:

- 100 active devices across about 12 groups, with direct and group-derived participation and membership changes;
- 12 coordinator-defined, non-overlapping outings of up to 12 hours across a 12-day mission, including midnight crossings;
- all breadcrumbs retained, 25 m movement-shaped fixes and ~20-minute stationary heartbeats, late/reordered/duplicate/conflicting/rejected rows;
- moving, stationary-attention, slow-walker, jitter, teleport, stale and disconnected cases;
- timed and untimed GPX, revised static outing assignment and malformed/oversize inputs;
- clues, all marker classes, same-name/historical attachments, overlapping areas and repeated full/partial/aborted passes;
- transaction-time versions and replay points before/after each important mutation;
- a finalized read-only mission, supplements/revisions, legacy archive material and multi-mission isolation;
- explicit synthetic labels in every database, manifest, mission name and shareable screenshot.

### 6.2 Simulated Traccar

Extend the current mock and packaged soak source into a controller-owned deterministic server rather than creating another unrelated simulator. It needs:

- an immutable, content-addressed source log for devices, groups, positions and request responses;
- a deterministic monotonic/UTC clock with pause, step, jump-for-test and replay controls; application-visible local-time/DST checks remain separate;
- exact 100-device/12-group rosters and smaller projections from the same source definition;
- independently configurable current and historical endpoints so history can be delayed, paged, failed or reordered while current remains available;
- fault scripts for latency, timeout, 401/403, 429, 500/503, connection reset, malformed JSON, partial pages, duplicated pages, overlapping cursors, roster lag, delay/reorder/duplication/conflict and recovery;
- a server transcript that records request identity, query, response source rows and monotonic times without storing live credentials;
- source generation shaped like ~25 m movement fixes and ~20-minute stationary heartbeats, while clearly distinguishing provider behavior from application acceptance behavior;
- a read-only live-provider adapter for bounded final confirmation. It must never mutate the team server and cannot claim a 100-device live roster unless one exists.

### 6.3 Deterministic time

Use three clocks explicitly:

1. **Source event time** (`fixTime`) in fixtures/server, the only exact tracking evidence time.
2. **Application transaction time** controlled through an existing/reviewed clock port where available, used for data-known-at-T versions, retries and mission state.
3. **Controller monotonic time** outside the candidate, used for latency, ordering and timeout gates.

Do not globally monkey-patch Electron/Node time in release proof. Contracts that cannot inject application time use bounded real wall time and record the limitation. Clock jumps, DST and timezone changes run in isolated profiles/processes.

### 6.4 Fault injection

Fault plans are declarative and checkpoint-named. A controller arms one fault and proves it fired; absence of the fault makes the attempt invalid rather than pass.

- **Process:** renderer crash, worker termination, main `SIGKILL`, whole process tree kill, duplicate instance, close/reload races and restart.
- **Filesystem:** exact write/rename/fsync/open/read failure; disk-full with bounded loopback/quota or injectable adapter; permission denied; directory-in-place-of-file; same-path replacement; corruption/truncation/bit flip; low-space preflight.
- **SQLite:** busy/locked WAL, corrupted copy, unsupported/newer schema, migration kill points, backup temp corruption, stale read snapshot and concurrent writer.
- **Archive:** flip/truncate/reorder/splice/append/swap, wrong mission/epoch/slot, registry mismatch, scratch/staging/custody conflict, cleanup interruption and plaintext-canary sweep.
- **Network/provider:** latency, dropped connection, 503, malformed/paginated/duplicate/reordered source, offline map/network block.
- **Resource:** CPU/disk contention that is explicitly bounded and isolated, with main/current-position gates retained. Resource pressure must not endanger the host or other work.

Real power removal is reserved for a controlled disposable host/session after deterministic `SIGKILL` and filesystem-fault coverage. It is not required on every PR. A synthetic permission or disk-full result is labelled as such; packaged Ubuntu proof uses the strongest safe OS-level mechanism available.

## 7. Model-judge isolation, calibration, security and redaction

### 7.1 Judge authority

The judge answers only: “Does the captured operator-visible interface clearly and coherently communicate the state that the deterministic run says was exercised, and is there an adjacent visible defect?” It never sees or decides the deterministic answer.

Allowed topics:

- visible current/stale/disconnected/paused/failed/read-only state;
- warning prominence, plain language and actionable next step;
- whether controls, cards, totals, map evidence and selected scope visibly agree;
- whether a loading/progress/failure state looks misleading;
- obvious clipping, overlap, unreadability or adjacent visible defect.

Denied topics:

- SQLite/source counts or digests, archive authenticity/integrity, key validity, cleanup, privacy scanner result, latency/resource budgets, release/artifact identity, forbidden side effects and overall release qualification.

### 7.2 Fresh oracle-blind packet

For every judged attempt, build a new temporary read-only packet after deterministic capture but before the judge is started. It contains:

- controller-authored neutral goal and numbered visible rubric;
- event-aligned screenshots and selected redacted video frames;
- redacted DOM/ARIA excerpts where they help assess visibility/accessibility;
- controller-authored action labels (`step-04`, `operator selected outing filter`) and timestamps;
- allowed citation paths and per-file hashes;
- display viewport/platform metadata needed to interpret layout.

It excludes oracle bundles, expected counts/values, gate results, verdicts, raw SQLite/files/network logs, source truth, candidate-derived instructions, test names such as `known-bad`, secret/private evidence and free-form candidate text. Candidate strings in screenshots/DOM are untrusted content; prompts explicitly tell the judge never to follow embedded instructions.

The judge runs in a fresh non-persistent session with an explicit immutable model reference, only read access to the copy-only packet directory, no shell/network/write tools and no access to the repository or raw run directory. Until an OS-level sandbox is proven, only synthetic or approved redacted evidence may leave the host.

### 7.3 Citation and verdict schema

The reply is strict JSON:

```json
{
  "schemaVersion": 1,
  "attemptId": "...",
  "judgeModel": "explicit-model-ref",
  "status": "completed",
  "visibleVerdict": "pass|concern|unreadable|injection",
  "checkResults": [
    {
      "checkId": "warning-visible",
      "result": "pass|concern|not-observable",
      "severity": "critical|high|medium",
      "citations": ["screenshots/checkpoint-fault.png"],
      "observation": "bounded description"
    }
  ],
  "adjacentObservations": [],
  "confidence": 0.0
}
```

Every citation must resolve to an allowlisted packet file and, for video, a frame/time. Missing/extra checks, invented paths, factual-oracle claims, invalid JSON, prompt injection or a model mismatch produce `NEEDS_HUMAN_DECISION`. Confidence is retained for calibration; it never changes release logic.

### 7.4 Disagreement handling

- Deterministic fail + judge pass = `FAIL`; record the useful disagreement.
- Deterministic pass + judge concern = `NEEDS_HUMAN_DECISION`; a human inspects the cited visible evidence. If confirmed, create/follow the existing issue and decide whether the contract or a new adjacent contract owns it.
- Deterministic pass + judge unreadable/error = `NEEDS_HUMAN_DECISION` when judging is required; rerun is a new attempt only for a predeclared environment/model failure.
- Judge claims a factual backend error = discard that check as out of scope and flag calibration/prompt failure.
- Human and judge disagree = retain both, cite the evidence, and use the human release decision without rewriting the judge result.

### 7.5 Calibration and mutants

Maintain separate development, calibration and protected holdout partitions. Known-good images are exact captures from deterministic passing synthetic attempts. Known-bad images come from controlled mutants, not fabricated prose: hidden/low-contrast warning, stale label, wrong selected scope, false 100%, disabled/occluded control, current marker hidden by history, read-only mission appearing editable, archive failure shown as success, clipped dialog and injected instruction text.

Calibration records confusion matrix, false-pass/false-concern rates by rubric/severity, Brier score, model/prompt/version lineage and 95% intervals. Recommended admission rule for a judge configuration:

- zero critical known-bad false passes in the protected holdout;
- every injection mutant returns `injection` or `concern`;
- no missing citation/check is accepted;
- known-good false concerns are measured and low enough for the planned human-review budget;
- the exact model/prompt/parser is frozen after holdout evaluation.

Because zero observed misses does not prove zero risk, report the confidence bound and keep the judge advisory. Any model/prompt/parser change invalidates calibration. Routine PR runs use only affected judged checkpoints; the protected holdout runs before a release campaign and is never used to tune the prompt.

### 7.6 Redaction and privacy

Use structured, recursive redaction before text rendering plus a byte/text/image egress scan. Synthetic identities and coordinates are preferred. Where a screenshot necessarily contains map positions, use synthetic fixtures. Real field evidence is not sent to a model by default.

The egress manifest proves:

- every output derives from an allowlisted raw artifact;
- secrets, auth data, provider URLs, precise operational coordinates, casualty details, mission/device names, user/profile/host paths and private map details are absent or replaced with stable attempt-local pseudonyms;
- screenshots/video frames are cropped/masked where required and manually previewed before any non-synthetic egress;
- raw and redacted hashes are both sealed, but only the redacted copy enters the judge packet;
- redaction failure is `POLICY_BLOCKED`, never a request to weaken privacy.

The WAR04-PRV red probes become mandatory known-bad privacy tests for the future redaction path. They must not be replaced by a model's opinion that a screenshot “looks anonymous.”

## 8. Tiered execution schedule

The schedule controls time and Codex/model spend by running the smallest proof that can fail the changed seam early, while reserving whole-candidate and multi-GB work for deliberate gates.

### Tier A — per-change / cheap

**Trigger:** every implementation commit/PR affecting the harness or application.

**Scope:** schema/static checks; affected unit/property/mutation tests; contract compilation; fixture canary; affected browser journey at small tier; affected deterministic oracle; evidence/seal verifier self-tests. Run one or a few judged screenshots only when visible behavior or the judge pipeline changed.

**Target budget:** normally 5-20 minutes, no large fixture generation, no model call for backend-only changes, no packaging unless the changed seam is package/preload/main/native.

**Output:** developer attempt bundles marked `development-only`; they cannot qualify a release.

### Tier B — PR CI / background

**Trigger:** review-ready head or scheduled background run.

**Scope:** full deterministic suite, all standard Chromium E2E, affected visual project and judge subset, CI 128 MiB fixtures, contract/mutant matrix, validator integrity, one packaged CI tracking soak when Electron/main/preload/storage/tracking changed. The existing Linux validation workflow remains the package-build/native/AppImage-launch lane, augmented later by machine-readable contract receipts rather than replaced with a monolithic matrix.

**Target budget:** 30-90 minutes. Model concurrency and entries are capped; unchanged cached known-good visuals are not re-billed, but release calibration bypasses cache.

**Output:** exact-head PR evidence. It is code-review support, not release qualification.

### Tier C — nightly or explicit background

**Trigger:** nightly when relevant code changed, or an explicit background qualification rehearsal.

**Scope:** 960k fixture, selected 2m headroom, migration matrix subsets, simulated 100-device Traccar faults, coverage/replay/archive controller oracles, small exhaustive kill/fault matrix, package CI profile, wider visual/judge sampling and seal recomputation.

**Target budget:** 1-4 hours with a hard stop and retained partial/aborted receipt. No final 3.7 GB or installed-host mutation by default.

**Output:** trend/regression evidence. A nightly pass never substitutes for the final artifact.

### Tier D — release-candidate deterministic campaign

**Trigger:** PR6 and required repair/harness changes merged; exact candidate frozen; DON-254 owner admits the campaign.

**Scope:** `bcp17-final` coverage compiler; all critical deterministic contract variants through the strongest pre-package tier; every supported schema migration; 960k normal and 2m headroom; full simulated Traccar adversarial suite; small exhaustive filesystem/process/archive attacks; judge protected holdout; full browser/visual composite; exact validator and candidate seals.

**Target budget:** roughly half to one day of serialized/parallel-safe compute. Stop immediately on a release-blocking deterministic failure or contaminated fixture; do not burn model or scale credits downstream of a known invalid candidate.

**Output:** candidate admission or rejection for packaged qualification, never publication.

### Tier E — packaged Ubuntu campaign

**Trigger:** Tier D admitted and the tag-driven workflow produced draft artifacts.

**Scope:** exact downloaded AppImage and genuinely installed `.deb`; checksums/native/install receipts; C00-C28 required package variants; lifecycle/restart/finalize/archive/restore; bad/corrupt credential and settings; coordinate rejection; diagnostics/privacy; private offline map under custody; duplicate launch; 100-device/current/history/coverage/replay; package cross-profile exact comparison. Run installed `.deb` independently; do not reuse AppImage results.

**Target budget:** one controlled Ubuntu qualification day, with raw `apt`/`dpkg` evidence retained. Xvfb CI launch is an early gate; native X11/Wayland package runs supply the declared final environment evidence where available.

**Output:** exact-artifact package receipts. Windows and unavailable Mint hardware remain external gaps.

### Tier F — long-running and scale

**Trigger:** exact package candidate passes functional package gates.

**Scope:** five-day and fourteen-day accelerated exact-source soaks; 12-day/100-device scenario; 1 GiB and field 3.7 GB mission stores; >2 GiB/3.5-3.7 GB streamed archive/verify/restore/cleanup; archive cycles during current tracking; sustained RSS/disk/WAL/main/renderer/current/operator metrics; predeclared restarts/faults. Preserve the existing three-consecutive-pass requirement where DON-247's same-workload comparison applies, but do not mechanically triple every unrelated huge contract.

**Target budget:** 8-24 hours elapsed depending on package/fault profiles. Run once per exact release candidate, not per small PR. If the candidate changes, rerun affected and dependency-invalidated rows; broad shared-state changes restart the full campaign.

**Output:** field-scale/long-duration exact-candidate evidence. It does not close the contradictory PCLinuxOS AppImage versus Mint `.deb` report without the same-profile Mint comparison.

### Tier G — post-publication WAR-13B field shadow

**Trigger:** only after the repository shadow protocol's admission gates, BCP-17/DON-254, Donal's DON-255 decision and any required publication. Engineering/training may occur earlier only under its non-counted restrictions.

**Scope:** separately authorized WAR-13B field shadow, team-led; this is not a prerequisite for completing pre-release C29. C29 requires original-machine training acceptance before qualification can complete, and that evidence never counts toward the field scorecard. Use the independent primary process, rehearsed <=60-second fallback, exact published candidate/session identity and proportional E0/E1/E2 capture. Bind both activities to the same artifact when applicable; a changed artifact invalidates any assumed continuity. The first field sessions should be intentionally narrow: current positions and warnings before evidence/replay/archive, with each later surface admitted only after prior sessions remain clean.

**Spend:** model judging is normally off. Team time is the scarce resource; collect concise comparison checkpoints and stop on uncertainty.

**Output:** WAR-13B/shadow evidence for the exact session. It does not automatically change release, hazard or residual-risk status.

### Rerun and lineage policy

- `attemptGroupId` binds one candidate/contract/variant/fixture/environment definition.
- `attemptId` is unique per execution. A rerun points to `predecessorAttemptId`, `rerunReason` and whether candidate/validator/fixture/environment changed.
- Only `ENVIRONMENT_BLOCKED` or an explicitly classified transient harness/model failure may use the one default retry without a code change. Product failures are not “retried green”; diagnose/fix and start a new candidate group.
- An affected-row rerun is permitted only when dependency analysis proves the change cannot invalidate other rows. Changes to mission schema, evidence spine, lifecycle/finalization, preload/IPC, source normalization, archive format, validator gates or shared fixture generation restart every dependent row.
- Campaign reports list all attempts, including failed, invalid and superseded; the latest pass never hides earlier evidence.

### Durable repository and Linear closeout

For a real implementation/qualification cycle, the controller should generate a bounded `linear-closeout.md` containing exact candidate/artifact/attempt IDs, commands, required rows, failures, proof tiers, residuals and evidence locations. A human/agent reviews it before updating Linear. The final durable record must reconcile:

- DON-254 qualification rows and PR6's DON-248/DON-252/DON-253 boundary;
- DON-247 field/package uncertainty, DON-249/250/251 separately owned storage work and DON-264 separately owned warning work;
- every WAR hazard gap/status and WAR-04/WAR-11/WAR-12 relationship;
- release-note regression provenance, manual, workplan and `handoff/HANDOFF.md`;
- exact CI/draft/fresh-public artifact identities and the frozen residual-risk register.

Generated text is evidence preparation, not authority to close an issue. An issue is not Done from a lower-tier pass or a judge pass.

## 9. Release-blocking decision rules and residual-risk register

### 9.1 Hard release blockers

A candidate is not qualified if any of the following is true:

1. Any of the five WAR-01 absolute blockers is open: delayed/hidden current position, silent evidence loss, false Complete/100%, corrupted evidence, or unbounded mission-size work on Electron main.
2. A required deterministic gate is `FAIL`, required evidence is invalid, cleanup is unproven, or a required environment is blocked.
3. Required coverage has no executable contract, no exact-candidate attempt, a stale/superseded attempt, or an unratified `not-applicable` row.
4. An accepted P1/P2 or regression remains open on the candidate, including a WAR-04 red defect whose claimed release surface is affected. The intentional red probe is not a pass.
5. Current-position source-to-visible latency, the 200 ms main hard gate, locked replay/coverage budgets or declared resource ceilings fail. Budget amendment requires repository/Linear authority before execution; it cannot be invented after a miss.
6. Source-to-SQLite-to-read-model/render/export/replay/archive/restore identity, count or digest diverges.
7. Archive verification, wrong-key/corruption handling, plaintext sweep, restore/replay or cleanup eligibility is uncertain.
8. AppImage and installed `.deb` identities or required results diverge, native/install verification fails, or the tested bytes differ from the draft assets.
9. An unexplained flake, judge injection, model error on a required visible row, adjacent critical concern or privacy/redaction uncertainty remains unresolved.
10. Release notes, regression provenance, manual, workplan, handoff, Linear, coverage report, draft body or SHA256SUMS are stale/inconsistent.
11. Live GitHub tag/release/repository controls do not meet the frozen release decision, or publication would include an unqualified/extra artifact.
12. Donal has not explicitly admitted the candidate to DON-255 publication.

An advisory judge concern can hold the campaign for human classification; a judge pass cannot remove any blocker. A required external environment that is unavailable yields an explicit scope limitation only if that platform/workflow is not claimed and repository authority permits the limitation. It cannot be silently waived.

### 9.2 Adjacent-defect handling

An adjacent observation is recorded separately with `observationId`, attempt/checkpoint, evidence citations, possible hazard/issue owner, severity hypothesis and contamination assessment.

- If it does not affect the original contract's declared facts/evidence, finish that contract from its own gates and route the adjacent observation independently.
- If it makes the evidence ambiguous, changes fixture/runtime state, triggers an absolute blocker or shows a shared-boundary defect, mark the original attempt `INVALID_EVIDENCE` or `FAIL` as appropriate and stop dependent rows.
- Do not widen the contract after seeing the result, downgrade the original fail because the defect is “adjacent,” or create a duplicate Linear issue before checking existing owners.
- A model-raised adjacent observation needs human/source retrace before it becomes a finding. Preserve the raw judge result even if the observation is disproved.

### 9.3 Initial residual-risk register for campaign planning

These are planning dispositions, not Donal's frozen candidate register. The real register must use the eight mandatory fields from the shadow protocol and exact candidate evidence.

| Risk | Current status for planning | Required exit/decision |
| --- | --- | --- |
| Contradictory long-duration package field result: PCLinuxOS AppImage responsive ~218 h; Mint `.deb` noninteractive ~182 h | `open-blocking` for any claim that the affected Mint/profile is qualified; DON-247 remains In Progress | same Mint host/profile/workload AppImage versus `.deb`, hang collector/support evidence before reset, explained outcome or bounded Donal decision consistent with field-admission rules |
| WAR-04 nine confirmed map/settings/privacy defects | `open-blocking` for the affected whole-app/release claims; PR #8 only records investigation | WAR-11 red-to-green production repair with normal regression coverage and later WAR-12 exact-candidate package proof |
| DON-264 persistent overlay sync warning | Linear issue remains In Progress; implementation is on `codex/don-264-overlay-warning`, rebased onto current master with a regression for failure streaks across re-registration. Local browser/visual and packaged macOS C14 evidence pass; the packaged receipt explicitly reports `releaseEligible:false`. | Complete exact PR-head CI and fresh independent review; prove visible bounded warning/recovery in applicable exact-candidate C14/C24 qualification. Local branch/package evidence does not satisfy OPS-001 field readiness. |
| Windows unavailable/currently unbuilt | `external-gap`, not a Linux release blocker because no Windows artifact is claimed | separate build and complete platform qualification before any Windows support claim |
| Real Mint hardware unavailable to this planning task | `external-gap`; no fabricated pass | execute same-profile evidence when access exists; constrain claims meanwhile |
| Live team Traccar may not have 100 devices | `external-gap` for live scale; deterministic synthetic 100-device qualification still required | bounded GET-only live confirmation of actual roster plus explicit synthetic-scale statement |
| Licensed Discovery map data cannot enter normal CI/model evidence | controlled evidence gap, not permission to skip map proof | private-host custody run with hash/bounds/decoding/network evidence and redacted report |
| Cross-machine archive portability and recovery-code custody/tabletop | `open-blocking` for field archive reliance under DON-254 | exact archive cross-machine restore/replay and team custody tabletop; no new domain question required now |
| Local roster is not strong authentication | `accepted-residual` only within trusted-team-machine threat model | explicit candidate register, off-app/two-person procedure and existing DON-199/219/220/221 ownership; broader deployment requires stronger controls |
| Unsigned Linux artifacts/no auto-update | potential `accepted-residual` for internal beta only | exact hashes, quiet-period install, retained rollback, explicit release warning and Donal sign-off |
| Branch/ruleset/secret-scanning controls historically absent | `open-blocking` for C27 readiness unless separately accepted by Donal (policy approved 2026-09-19) | fresh before/after GitHub evidence; unmet safeguards require signed exact-candidate REL-004 risk acceptance with each observed gap, rationale, compensating controls and expiry; policy approval itself is not risk acceptance or publication authority |
| Current PR6 implementation is unmerged and mutable | `open-blocking` by definition | merged exact PR6 head, accepted reviews, CI/reference proof and full refresh in section 11 |

## 10. Implementation roadmap

This is an eight-slice implementation programme. Each slice is independently executable after its dependencies and should normally be one reviewable PR. That recommendation is not branch/PR authorization: before implementation, Donal must confirm that the breadcrumb-programme branch exception or a successor assurance programme covers these PRs. Do not fold all eight slices into PR6 or one unreviewable harness change.

“Ultra” below means the highest reasoning allocation is worth the additional credits for the owning implementation/review task. It does not mean running the expensive qualification matrix.

### Slice 1 — Contract schema and coverage registry

- **Deliverable:** JSON Schema/types/compiler for contracts, campaign profiles and coverage rows; initial C00-C29 declarative skeletons; validation/mutation tests; generated coverage report with missing/duplicate ownership failures.
- **Dependencies:** section 11 refresh and final PR6 public interfaces/schema inventory.
- **Complexity:** 7/10.
- **Recommended Codex:** GPT-5.6 Sol, high effort. **Ultra:** no for implementation; yes for the final schema/coverage challenge if the compiler grows.
- **Expected PR boundary:** assurance tooling/docs/tests only; no production or final matrix.
- **Review depth:** one broad exact-head assurance review plus one focused requirements/hazard coverage review. Validate deliberately missing/misbound contracts red-first.

### Slice 2 — Candidate preflight, fixture lease and exact identity

- **Deliverable:** C00 identity adapters, source/artifact/install/validator receipts, host capability preflight, free-space policy, profile/fixture/archive/port/process leases, baseline/mutation log and verify-or-quarantine cleanup.
- **Dependencies:** Slice 1.
- **Complexity:** 9/10.
- **Recommended Codex:** GPT-5.6 Sol, xhigh effort. **Ultra:** yes.
- **Expected PR boundary:** controller tooling and synthetic tests; package/install adapters may be stubs until Slice 5; no release mutation.
- **Review depth:** broad + filesystem/process safety + release identity/security exact-head reviews. Attack wrong path, broad cleanup target, PID reuse, moved tag, dirty fixture and low-space arithmetic.

### Slice 3 — Evidence capture, sealing and independent verification

- **Deliverable:** append-only attempt layout/ledger, artifact index, correlation IDs/action tokens, run seal, external-anchor interface, semantic verifier, rerun lineage, aborted/cleanup-blocked receipts and tamper/cross-attempt tests.
- **Dependencies:** Slices 1-2.
- **Complexity:** 9/10.
- **Recommended Codex:** GPT-5.6 Sol, xhigh effort. **Ultra:** yes.
- **Expected PR boundary:** generic controller evidence layer; no application behavior change.
- **Review depth:** broad + evidence-integrity/cryptographic-boundary + adversarial verifier reviews. Mutate, delete, swap and locally reseal every evidence class.

### Slice 4 — Authoritative oracle and fault-control library

- **Deliverable:** read-only/pinned SQLite oracle adapters, full/keyset/range digests, filesystem/source-server/release/process oracles, performance gates, closed-world side-effect diff, deterministic fault plans and mutant corpus.
- **Dependencies:** Slices 1-3; exact merged PR6 schema/archive interfaces.
- **Complexity:** 10/10.
- **Recommended Codex:** GPT-5.6 Sol, max effort. **Ultra:** yes, strongly.
- **Expected PR boundary:** assurance libraries/tests and only narrowly justified test observability ports; production changes require separate red-first scope and Linear ownership.
- **Review depth:** broad + persistence/completeness + concurrency/fault + archive/security exact-head reviews. Independent recomputation must not import candidate-produced “expected” values.

### Slice 5 — Runtime adapters, deterministic Traccar and package control

- **Deliverable:** browser/Playwright, Electron/AppImage and installed `.deb` journey adapters; event-aligned screenshot/video/trace/DOM/ARIA/runtime/network capture; extended 100-device deterministic Traccar; clocks; process/I/O/current-position sampling; package install/cleanup receipts.
- **Dependencies:** Slices 1-4.
- **Complexity:** 10/10.
- **Recommended Codex:** GPT-5.6 Sol, max effort. **Ultra:** yes, strongly.
- **Expected PR boundary:** runtime harness and source server; keep browser, AppImage and installed-package adapters separate. No broad application rewrite.
- **Review depth:** broad + renderer/input containment + packaging/platform + current-position/performance + destructive-test safety reviews. Run only small/CI smoke during development.

### Slice 6 — Oracle-blind judge, redaction and calibration

- **Deliverable:** copy-only judge packet builder, structured redaction/egress manifest, explicit model runner, citation/verdict parser, injection handling, known-good/known-bad partitions, protected holdout and calibration report.
- **Dependencies:** Slice 3 capture format; representative Slice 5 evidence; WAR-04 privacy corpus.
- **Complexity:** 9/10.
- **Recommended Codex:** GPT-5.6 Sol, xhigh effort. **Ultra:** yes for threat-model and calibration review; high is enough for routine parser implementation.
- **Expected PR boundary:** model/advisory tooling only; no deterministic verdict authority and no operational-data egress.
- **Review depth:** broad + privacy/security + judge-isolation/prompt-injection + statistical-calibration reviews. Include a real judge false-pass disagreement mutant.

### Slice 7 — Contract implementation and existing-harness migration

- **Deliverable:** executable C00-C29 variants; migrate/reuse visual, fixture, soak, release-smoke, archive and fault machinery; BCP-17/WAR-12 profiles; machine-readable campaign/coverage reports; explicitly deprecated old paths only after parity.
- **Dependencies:** Slices 1-6 and merged PR6; relevant WAR-11 repairs for contracts expected to pass.
- **Complexity:** 10/10.
- **Recommended Codex:** GPT-5.6 Sol, max effort. **Ultra:** yes.
- **Expected PR boundary:** split by stable seams if diff becomes broad: (a) tracking/mission/replay, (b) archive/persistence, (c) platform/release. The logical slice remains one outcome but may require up to three PRs rather than one giant PR.
- **Review depth:** one broad plus persistence/completeness, concurrency/finalization/archive and renderer/input/platform focused exact-head reviews for each executable boundary. Run CI/960k subsets, not the final huge matrix.

### Slice 8 — Campaign orchestration, WAR/Linear/release integration and dry rehearsal

- **Deliverable:** campaign scheduler/stop rules, exact coverage gate, residual-risk template, release-note/Linear closeout generator, external-anchor retention, dry/small rehearsal, operator runbook and manual integration. No release action in the implementation PR.
- **Dependencies:** Slices 1-7 and current WAR/DON authority.
- **Complexity:** 8/10.
- **Recommended Codex:** GPT-5.6 Sol, xhigh effort. **Ultra:** yes for final end-to-end review and failure rehearsal.
- **Expected PR boundary:** orchestration/docs/release guards only; guarded publisher remains separate and unchanged unless a red-first release-integrity issue authorizes a change.
- **Review depth:** broad life-safety + release integrity + operational evidence/privacy reviews, followed by an independent small-campaign seal verification. Only after merge does DON-254 authorize the real campaign.

### Implementation completion versus qualification

The eight slices are complete when their tests, small/CI rehearsals, exact-head reviews, docs/manual, handoff and relevant Linear updates are green. That does **not** qualify SAR Tracker. The first real `bcp17-final` campaign is a separate DON-254 execution task on the then-exact candidate and artifacts. WAR-12 is another later exact-candidate campaign after WAR-11.

## 11. Exact refresh checklist after PR6 and PR8 merge

Do this before editing the plan into executable contracts or running any qualification row.

### Repository and merge identity

- [ ] Fetch `origin` and record the full new `origin/master` SHA and tree. Verify the worktree is clean and no local PR6 files are being treated as merged.
- [ ] Record GitHub PR6's final source head, merge commit, review heads, accepted findings/remediation and exact CI/reference-host evidence. Distinguish prior-head reviews from exact final-head reviews.
- [ ] Record PR #8's merge commit and final head. Confirm its shipping-code/test-tree boundary, exact red probes, nine findings and WAR-11 owners. Do not mark the red probes fixed merely because PR #8 merged.
- [ ] Compare the final master ancestry with dispatch base `3d0d36b...`, PR5 merge `eec92812...`, PR6 source head and PR8 head. Record any intervening changes.
- [ ] Re-read current `CLAUDE.md`, handoff, two-track workplan, assurance charter/register, shadow protocol, breadcrumb policy/workflow/ADR/Q&A ledger/raw transcript and PR5/PR6 evidence.

### Final PR6 architecture inventory

- [ ] Inventory the final archive container/version/magic, schema version, registry, custody journal, slot types, archive kinds, supplement/revision model, review/restore/cleanup state machine and legacy-read support from merged code—not the planning packet.
- [ ] List every archived table/artifact and every explicit exclusion. Verify schema completeness fails when a future table has no decision.
- [ ] Trace the exact pinned source snapshot, streaming/framing/encryption, ciphertext digest, exhaustive verification, restore/replay proof, live-cleanup eligibility and same-open-file identity.
- [ ] Trace every secret path. Confirm secrets never enter renderer evidence, logs, diagnostics, judge packets or `workerData`; record actual final behavior.
- [ ] Trace all main/preload/renderer IPC and worker envelopes, bounds, cancellation, restart/reconciliation and progress/failure states.
- [ ] Inspect final tests and evidence for wrong key, byte attacks, >2 GiB, disk-full, SIGKILL, concurrent writes/current tracking, plaintext sweep, restore/review and cleanup. Record what PR6 proves versus what DON-254 retains.
- [ ] Reconcile hazard `RPL-004` and every PR6-touched WAR row; remove `rewrite-pending` only where exact merged proof supports it.

### Current external authority

- [ ] Re-fetch Linear descriptions/comments/statuses for DON-241, DON-247, DON-248-255, DON-264 and any new PR6/WAR-11 children. Preserve separate ownership of DON-249/250/251/264.
- [ ] Recheck Q&A ledger/raw transcript for new answer IDs or clarifications. Do not derive product rules from chat summaries or PR implementation.
- [ ] Recheck live GitHub branch/ruleset, required-check/review and secret-scanning/push-protection state for REL-004.
- [ ] Recheck supported platform/release policy, current Linux workflow, artifact allowlist and draft publisher.
- [ ] Recheck DON-247/Mint and live-provider/field-machine evidence. Record unavailable hardware as external, not passed.

### Fixtures, tools and coverage

- [ ] Run only cheap fixture manifest verification first. Record generator/schema versions and invalidate stale caches without deleting them.
- [ ] Map merged PR6 rows/interfaces into C20-C22 oracle adapters and update C00-C29 coverage. Add any newly exposed workflow/hazard; never silently overload a contract.
- [ ] Reconcile existing Playwright/visual tests, fixture presets, soaks, kill probes, package smokes and release gates against the final code. Mark reuse, wrapper, replacement or retirement with parity evidence.
- [ ] Freeze the validator ref and independent-verifier/external-anchor location before candidate execution. The release candidate cannot certify itself.
- [ ] Compile contracts and coverage in dry/preflight mode. Require every critical row to resolve before any fixture mutation or model call.

### Exact release candidate and artifact

- [ ] After all required application/harness/WAR-11 changes are merged, freeze the full candidate SHA/tree and validator SHA/tree. A later code/doc change is a new candidate unless exact-tree policy proves it cannot affect the campaign.
- [ ] Create the release candidate only through the tag-driven workflow. Record run/job/commit/version and download exact draft AppImage, `.deb` and `SHA256SUMS`.
- [ ] Complete C00 AppImage and installed `.deb` preflights on the reference Ubuntu host before Tier D/E/F spending. Confirm free space for the >2 GiB/3.7 GB source, working, archive, restore and evidence copies.
- [ ] Generate/freeze campaign and attempt IDs, coverage-before report, residual-risk draft and stop rules. DON-254 owner explicitly admits the campaign.
- [ ] If any identity/preflight row fails, stop. Do not rebuild locally, reuse an earlier package or skip to a cheaper judge/visual run.

## 12. Decisions and questions still required

The repository-backed Q&A ledger and raw transcript already answer the domain questions about 100 devices, groups, 25 m movement fixes, ~20-minute stationary heartbeat, 12-hour outings, 12-day missions, non-overlap, all-history retention/filtering, current-position priority, GPX time semantics, repeated pass ownership, data-known-at-T Replay, finalized read-only evidence, revisions and indefinite retention. Do not ask the team those questions again.

### Decisions for Donal before implementation

1. **Programme authority for the eight slices.** Confirm whether they remain inside the BCP-17 branch/PR exception or receive a separate assurance-programme exception. Recommended: eight logical slices with the PR boundaries above; do not add them to mutable PR6.
2. **Validator trust boundary.** Approve a protected validator ref and an external location/actor that retains the campaign seal before local bundles can be changed. Recommended: CI/protected repository artifact plus a separately retained hash in the DON-254 record.
3. **Judge model and egress budget.** Approve the explicit model, synthetic/redacted-only policy, protected-holdout size and maximum release-campaign calls. Recommended: affected-only per PR, wider nightly sampling, fresh no-cache holdout/full visible sweep once per exact release candidate.
4. **BCP-17 versus WAR-12 sequencing — resolved 2026-09-23.** `bcp17-final` is the first post-PR6 release qualification; `war12-hardening` is later after WAR-11 and does not retroactively qualify the earlier candidate. The broad WAR catalogue is not a blanket prerequisite; an exact-candidate concrete P1/P2 or absolute blocker still stops qualification.
5. **DON-264 disposition — resolved 2026-09-23.** The candidate scope does not waive DON-264 or its existing C14 warning predicate. Retain the applicable failure as a separate gate; do not convert the console-only warning into a pass or candidate limitation.
6. **Required host claims.** Confirm that the release claim remains Linux x86-64 AppImage plus installed `.deb`, with Windows unclaimed and real Mint evidence external until available. Recommended: do not widen the support claim.
7. **Large-fixture host/storage allocation.** Name the reference Ubuntu host and private storage budget for source cache, working copy, >2 GiB/3.7 GB archive, restore scratch and evidence. This is capacity authorization, not permission to run the campaign now.
8. **Live-provider scope.** Approve the exact read-only GET-only final confirmation and credential custody. Synthetic 100-device proof remains mandatory and must be labelled synthetic if the live roster is smaller.

### Later team confirmations already required by authority

These are execution-time confirmations, not new product questions and should not be sent now:

- the DON-248 recovery-code/custody tabletop and named key/custodian roles;
- the exact primary operational source/process, its operator, contingency and <=60-second primary-only fallback drill for each field deployment group;
- access to the original/representative Mint or field machine for the DON-247 same-profile comparison;
- human comprehension/usability observations during authorized C29 original-machine training sessions.

No additional SAR team question is justified by this planning pass. If implementation exposes a genuinely new domain ambiguity, search and cite all related `SAR-QA-*`/`SAR-FIELD-*` answer IDs first, explain why they do not resolve it, and stop before coding through it.

## Planning conclusion

Adapt `validate-change`; do not copy it. The correct SAR design is a deterministic, controller-owned, multi-contract qualification system with separately bound browser, AppImage and installed `.deb` modes, exhaustive source/SQLite/files/archive oracles, immutable evidence lineage and a narrow oracle-blind visual judge. Its value is not that a model can bless a journey. Its value is that the programme makes every claim, omission, artifact, attempt, fault, residual and visible concern inspectable—and refuses to turn uncertainty into release evidence.

The recommended first move after PR6 and PR8 merge is **Slice 1: freeze the final merged requirement/hazard/change coverage registry and SAR contract schema**, after completing the section 11 refresh. Do not start with a model runner or a giant end-to-end journey; both depend on knowing exactly what deterministic facts and proof modes each contract owns.
