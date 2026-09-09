# Complete external review reconciliation [DON-252] [DON-253]

Source: https://claude.ai/code/artifact/a1d8e3ac-aa7d-4dc1-be67-8eba66443e38
Read 2026-09-09. Review source c69b0c23; reconciliation starts at a3d3b596
(implementation 10f39913). The updated artifact now lists all 95 findings:
15 High, 4 Medium-High, 55 Medium, 21 Low. Earlier selected-list counts are
superseded. Prior IDs refer to breadcrumb-pr6-review-remediation.md.

Prior IDs link to the earlier source assessments. Every expanded claim now has
a disposition below. No merge or release is authorized. Use focused regressions
and proportionate smokes.

## Verification snapshot

- Full serial source suite: 4,137 tests / 396 files pass, 462.10 seconds.
  Local log: `/tmp/pr6-expanded-review-unit-final-20260909.log`.
- Production build, TypeScript, bundle budgets and ESLint pass. Main application
  chunk is 467.63 kB against the unchanged 500 kB limit.
- The first broad run intentionally caught the newly added restore-handle
  regression (descriptor remained open); the fixed test passes. Its other 16
  failures were localhost sandbox denial (`listen EPERM`) or dependent timeouts.
  The final run above had localhost access and no failures or unhandled errors.
- Four Chromium operator flows and three visual flows pass (39.0 seconds).
  All four screenshot reviews pass, with no failures/errors. The cleanup image
  is byte-identical to the current operator manual image.
- Clean implementation `76ef77c145aa7fcc8cb013d6830177135ae87e50`, tree
  `43dc3fbab5930a1976c23c838473f886c6a4b215`, passes the macOS arm64 packaged
  lifecycle smoke: two launches, 4,096 fixes, matching Review before/after 5,516
  live-row removals, interrupted restore/restart recovery, and complete teardown.
  Main/current/frame maxima are 51.407/59/18.5 ms against the unchanged 200 ms
  gate. Zero exact secret matches and final plaintext residue. Canonical receipt
  validation returns valid/passed true:
  `docs/evidence/pr6/expanded-review-76ef77c1-macos-20260909.json`.
- Final-head ordinary Linux CI must be green before author-side completion;
  its live result and downloaded-receipt validation are maintained in PR #10
  and DON-252/253. Prior full field-scale and 32-case interruption results remain
  historical; no fresh claim is made here.

## High and Medium-High

| ID | Prior disposition / remaining assessment |
| --- | --- |
| H1 | T-1 |
| H2 | T-2 |
| H3 | A-1 |
| H4 | A-2 |
| H5 | A-3 |
| H6 | B-5 |
| H7 | A-4 plus ENOENT race fixed: an entry disappearing during startup inspection/removal is already clean. Other identity failures remain closed. Red real-file race regression; 43 session tests pass. |
| H8 | A-6 |
| H9 | A-5 |
| H10 | A-11 |
| H11 | A-7 |
| H12 | A-8 |
| H13 | A-9 |
| H14 | A-10 |
| H15 | B-2 |
| B1 | B-1 |
| B2 | B-3 |
| B3 | M-15 |
| B4 | A-12 |

## Medium

| Lane / ID | Finding | Disposition |
| --- | --- | --- |
| dialogs M1 | Synchronous start outside try | Fixed, red regression then 13 cleanup tests pass |
| dialogs M2 | OR/AND terminal contradiction | Fixed: both durable storage state and completion marker required; red regression |
| dialogs M3 | Cross-mission binding error too benign | Fixed: explicit custody fault and support guidance; red regression |
| dialogs M4 | Non-startable state lacks explanation | Fixed: close/refresh guidance even without blockers; red regression |
| dialogs M5 | Wrong credential retry guidance | Added close/reopen and passphrase/recovery retry guidance |
| dialogs M6 | Cancellation hides progress | Fixed: matching ordered progress remains visible during settlement; red regression |
| dialogs M7 | Progress counter asserts durable seal | Fixed: counters remain sealing; red regression then 11 custody tests pass |
| dialogs M8 | Cancellation shown as unknown | Retained accurate distinction: only backend retryable/reconciled terminal cancellation says cancelled. A cancellation request cannot override STATUS_UNKNOWN; existing tests explicitly cover both outcomes. |
| dialogs M9 | Close ref stays latched | Fixed: release latch on both callback outcomes, restore actionable state if still mounted; red regression |
| dialogs M10 | Unused duplicate secret refs | Removed unused refs; custody suite passes |
| dialogs M11 | Unbounded credential inputs | Fixed: 1024 code-unit admission and HTML limit; red regression |
| dialogs M12 | Finalize result mission not checked | Fixed: both mission identities and finalized state required; red regression |
| verify M1 | Swallowed truncate/fsync errors | Fixed: failed truncate, sync or close rejects cleanup proof; all remaining descriptors and key buffers still settle. Two injected real-descriptor regressions. Follow-on real v2 restore regression proves that a settlement failure also closes the separately opened database handle rather than transferring ownership through a rejected result. |
| verify M2 | Manifest entries / extraction descriptors unbounded | Bounded at 10,000 declared entries with shared creator/verifier limits, in addition to 4 MiB manifest. OS descriptor exhaustion returns a closed resource error and cleanup; pinned handles remain until settlement to retain inode ownership. Red encrypted-manifest regression. |
| verify M3 | Journal transaction ownership | Prior B-4 |
| verify M4 | Reconcile fast-path transaction race | Fixed: registry rechecked inside immediate terminalization transaction; injected interleaving regression, 25 journal tests pass |
| verify M5 | Duplicated table count | Retained deliberate v13 admission contract. New schema versions require reviewed inventory/proof changes; failing closed is intended, not automatic acceptance of a future table set. |
| verify M6 | Legacy availability existence-only | Prior A-7: ticket now requires recorded SHA256/size and restore rehashes the exact source; availability alone cannot admit replacement bytes. |
| restore M1 | Hash/native cancellation | Prior M-10 |
| restore M2 | Legacy handle close skips ownership cleanup | Fixed: source close precedes output ownership transfer; failure still settles outputs and database handle. Real close-fault regression proves extracted DB is absent. |
| restore M3 | Legacy migration disk budget | Fixed: before database extraction, old schemas reserve two extra database sizes plus 64 MiB for rewrite/WAL/backup work. Admission headroom is not a guarantee against concurrent disk use. Red v12 regression; 45 legacy restore tests pass. |
| restore M4 | Atomic live rehydrate blocks writes | Prior M-9 |
| restore M5 | DETACH masks error | Fixed: preserve primary refusal/rollback failure and attach detach cause; standalone detach failure is closed cleanup-required. Real rollback/DETACH fault regression. |
| restore M6 | Interpolated mission ID | Changed to bound prepared statements. Prior escaping already prevented quoted SQL injection; existing genuine rehydrate tests pass. |
| crypto F1 | Credential strings | Prior M-2 |
| crypto F2 | Authentication/provider errors | Prior M-1 |
| crypto F3 | Uncleared temporary key/frame material | Prior M-3 plus frame candidate/final buffers cleared on success and authentication failure. Injected provisional-plaintext regression; 40 crypto tests pass. Provider setup failures remain distinct. |
| crypto F4 | Unauthenticated preamble contract | Added explicit API contract: preamble parsing alone is not authenticated proof. Existing verification binds header and complete authenticated stream before admission. |
| crypto F5 | Streaming bytes before completeness | Added explicit provisional-callback contract: only successful completion including final frame and EOF establishes completeness. Callers retain private staging ownership until that boundary; wire format unchanged. |
| review F3 | Windows unsupported | Prior M-13 |
| review F5 | Read concurrency | Prior M-16 |
| review F6 | Denied mutation audit storm | Prior M-16 |
| review F7 | Live Review budget / error wording | Neutralized misleading archive-only error wording and points to paged Replay. Retained 8 MiB IPC limit; silently truncating evidence or introducing a new fallback representation would weaken the read contract. |
| review F8 | Creation crash plaintext scratch | Retained permission-restricted staging architecture and documented it in manual. Creation snapshots use private directories/0600 files, plaintext is removed before sealed publication, and interrupted custody recovery removes owned staging on restart. The live mission is already plaintext under the same account. No removal while the process is dead, full-disk encryption, or forensic erasure claim. |
| ipc M-1 | Result key deny-list misses paths | Added all three identified private path keys recursively; red regressions, 14 IPC tests pass. Source readers still own domain-specific projections; this is a supplementary screen. |
| ipc M-2 | v2 path basename binding | Not reproducible: normalizeReviewTicket requires exactly `${archiveId}.sararch`, and archiveId is a validated UUID from the closed request envelope. No separator is admissible. |
| ipc M-3 | Recovery issuance cap/error closure | Fixed: maximum eight pending missions per sender, same-mission replacement remains available, provider errors closed. Red regressions, 48 archive IPC tests pass. |
| ipc M-4 | createMission control characters | Fixed: date fields reject all controls; notes preserve normal tabs/newlines but reject other control bytes. Red main IPC regression. |
| ipc M-5 | Absolute archive path projection | Retained operator-visible ciphertext location for archive custody/recovery. It is not decrypted data; prior B-3 closes the external-opener bypass independently. |
| tracking F3 | Poll cadence clamp | Prior M-4 causal follow-up |
| tracking F4 | Restart display cap documentation | Prior M-5 |
| tracking F5 | Coalesced loss reason/count | Added a sanitized diagnostic for every discarded payload with reason and count 1, independently of the coalesced durable health marker. Red two-overflow regression. Counts describe payloads, not unique GPS fixes or a durable accounting ledger. |
| tracking F6 | Shutdown settle spin | Impossible pending-without-active state now throws an explicit invariant error instead of spinning. Existing cache-lane/runtime tests pass. |
| tracking F7 | Stop barrier causes connection error | Not reproducible in current ordering: poller.stop is awaited before queue settleForStop closes acceptance; discardSupersededPoll also discards stopped/lifecycle-obsolete failures before connection failure accounting. |
| correction F3 | Failure residue hashing cancellation | Added checks for already-received cancellation before each failure-path inspection/revalidation, matching recovery. Synchronous hashing cannot receive a new cancel message mid-loop; each file is bounded at 25 MiB and the parent enforces a two-second cancellation grace before utility-process termination. The durable recovery gate remains; a cancelled recovery is not claimed complete. |
| correction F4 | Uncommitted residue reclamation | Prior M-11 |
| correction F5 | Dead duplicate commit callback | Removed unused main-store callback; the utility process owns the atomic correction commit. Existing real restore/correction tests pass. |
| correction F6 | Local administrator authority audit | Prior M-12 |
| cleanup F1 | Custody/COMMIT external race | Accepted/documented: an external unlink/unmount can occur after the last custody check and before COMMIT. At most one bounded page is exposed; SQLite cannot atomically commit with an independent filesystem. Operator retention/backup remains necessary. No false two-resource atomicity claim. |
| cleanup F2 | Global rowid paging | Prior M-6 retained rationale |
| cleanup F3 | Completed projection changes offline | Prior M-7 |
| store F3 | Rollback failure | Prior M-8 |
| store F4 | Legacy seal global invalidation | Fixed: preparation and admission use the same target-mission generation reader. Legacy schemas lacking generations retain global fallback. Real second-connection regression permits other-mission commits and rejects target-mission changes; seven scan tests pass. |
| orchestrator F-O1 | Descriptor close interlock | Prior M-14 |
| orchestrator F-O2 | Direct coverage | Prior G1-G5 |

## Low

| Lane / ID | Finding | Disposition |
| --- | --- | --- |
| crypto F6 | Frame domain/bounds | Retained v2 format: unique archive key, header digest, frame counter/AAD and bounded nonce counter bind frames. No demonstrated cross-domain collision; changing framing would require format/version review rather than a cosmetic patch. |
| crypto F7 | Duplicated header digest | Retained independently checked canonical-JSON/SHA256 computation at creator/writer boundaries. Shared canonical serialization and existing format vectors prevent drift; no format rewrite. |
| crypto F8 | Ambiguous recovery characters | Retained strict canonical alphabet and exact type-back. Generator excludes ambiguous characters; guessing replacements is not part of the credential contract. Manual already requires exact transcription. |
| cleanup F4 | Teardown masks work error | Teardown corruption retains the original work error as cause. Red bypass-row removal regression; nine membership tests pass. |
| cleanup F5 | Close error after completion | Retained closed failure if the worker cannot close cleanly. Durable completed projection permits refresh/reconciliation; physical worker settlement is not inferred from a prior commit. |
| verify L1 | Registry mutator input closure | Internal trusted mutators explicitly project validated persisted fields. Extra input fields are not persisted or forwarded; style inconsistency alone does not warrant broad API churn. Renderer envelopes remain closed independently. |
| verify L2 | Dead digest | Harmless extra digest for manifest entry retained; manifest bytes are separately parsed and authenticated by framing. It is not used as proof or an admission condition. Removing this small redundant computation is optional cleanup, not a correctness fix. |
| ipc L-1 | Progress listener cap | Added maximum 32 listeners and idempotent unsubscribe accounting; red preload regression. |
| ipc L-2 | Credential throttling | Retained bounded KDF/operation ownership without account lockout. A local ciphertext holder can perform offline attempts independently; app lockout would impair operator recovery without establishing an offline security boundary. |
| dialogs L1 | Resume admission guards | Added synchronous operation-ref admission guards to start/resume, plus required failure state for resume. |
| dialogs L2 | Backdrop cancellation | Retained backdrop as equivalent to Cancel; it requests cancellation and follows the same bounded settlement/recovery state. It neither erases the archive nor asserts completion. |
| dialogs L3 | Initial keyboard focus | Focus the ready cleanup credential selector, a non-destructive control. Red focus regression. |
| correction F7 | Fabricated residue source path | Retained shared pair envelope: residue proof/revalidation use cwd-relative target/peer and never open sourcePath. The placeholder satisfies shared validation but supplies no authority. Splitting the internal envelope is optional structural cleanup. |
| correction F8 | Authority check after staging | Staging comes from an already authorized read-only Review session. Administrator authority is checked before live mutation; staging grants no additional plaintext read access. Retained separate read and mutation boundaries. |
| restore L1 | Snapshot copy capacity/error | Added private-copy capacity preflight (source size plus 64 MiB), preserved root cause, and explicit space error. Red capacity regression. |
| restore L2 | Custody containment direction | Reject both archive-inside-review and review-inside-archive root arrangements. |
| restore L3 | Pre-abort rejected promise | Attach an internal rejection observer while returning the original rejecting completion; physical exit remains settled. |
| restore L4 | Unused session cleanup return | Removed unused created flag and corrected ownership documentation. |
| restore L5 | SQLite untrusted schema hardening | Added trusted_schema=OFF to restored read-only and legacy-migration connections. No unsupported native SQLITE_DBCONFIG_DEFENSIVE binding is claimed. Existing legacy/rehydrate tests pass. |
| tracking F8 | Loss marker retry | Later poll flush requests retry a failed sticky marker through the existing in-flight guard; red retry regression, 13 queue tests pass. |
| tracking F9 | Anomaly admission during correction | Retained explicit refusal before admission while the correction mutation gate owns the mission. Caller retains rejected delivery responsibility; this is distinct from silently dropping already accepted evidence. |
