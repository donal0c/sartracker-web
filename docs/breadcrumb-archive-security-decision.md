# Breadcrumb Archive Security Decision

**Status:** Binding PR6 engineering decision

**Date:** 2026-08-29
**Scope:** DON-248 / BCP-14, DON-252 / BCP-15, DON-253 / BCP-16

This decision defines the security and custody envelope for finalized SAR
mission archives. It does not change the SAR team's domain decisions. The raw
answers remain authoritative, in particular SAR-QA-007, SAR-QA-017,
SAR-QA-019, SAR-QA-020, SAR-QA-021, SAR-QA-006 and SAR-QA-013.

## Locked operator meaning

- A saved mission remains reviewable indefinitely on its timeline.
- Review reconstructs the data known at the selected time; it does not record
  or recreate transient screen state.
- Traccar `fixTime` remains the sole breadcrumb evidence clock. Receipt time
  and provenance-known-at time remain separate evidence.
- GPX timestamps are never invented.
- Finalized mission evidence is read-only. A later correction is a visible
  supplemental revision and a new chained archive; earlier archive bytes are
  never changed.
- Sealing the finalized archive locks the mission read-only. Independent
  verification then proves whether those sealed bytes are complete and safe to
  review. If creation or verification fails, the finalized live evidence stays
  intact and the archive remains explicitly incomplete or sealed-and-retryable.
- Repeated reads of the same immutable Traccar position remain idempotent.
- Archive, verification, restore and cleanup work never delays the live
  current-position path.

The open operational custody tabletop — who physically holds the team
passphrase and the written recovery copy — does not change this mechanism and
does not block implementation. This decision does not guess those human roles.

## Threat model and honest claims

The deployment context is an offline or intermittently connected trusted-team
computer. Archives may later be copied to removable media, a shared drive or a
different team computer and can contain sensitive casualty and location
evidence retained indefinitely.

| Threat | Control | Claim |
| --- | --- | --- |
| Archive copied from lost, stolen or disposed storage | Payload mission content and entry names are encrypted with a random per-archive AES-256-GCM mission archive key; the bounded canonical custody header listed below remains visible | Payload confidentiality against a person who has the file but none of its slot secrets; mission/custody header metadata is not confidential |
| Bit rot, truncation, reordering or splicing | Authenticated frames, an encrypted exhaustive manifest and a separately recorded whole-file SHA-256 | Corruption or substitution is detected; a partial prefix is never accepted |
| Archive substituted for another mission or finalization | Authenticated header fields bind mission ID, finalization epoch, schema and supplement predecessor | The wrong mission or epoch fails closed |
| Wrong passphrase or recovery code | Each key slot wraps the archive key independently with AES-256-GCM | Wrong credentials fail during slot unwrap before payload output |
| Creating-machine loss | Every archive created by PR6 has a mandatory passphrase slot and its own mandatory recovery code slot | Archive access does not depend on the creating computer |
| Crash, process kill or disk-full during archive work | Permission-restricted staging, durable atomic publish, restart sweeps, evidence fences and a cleanup journal | Create/verify/restore failure is explicit and preserves operational live evidence; interrupted cleanup preserves the verified archive and stub and resumes from its durable cursor without evidence loss |
| Correction after finalization | A new archive authenticates the prior archive hash and the registry records a visible supplement | Prior bytes remain immutable and before/after states remain reviewable |

The repository-owned format is named `SARARCH2`. It uses standard primitives,
but `SARARCH2` itself is not described as a standard format. AES-GCM
authenticity is relative to possession of a key. The separately recorded
whole-file hash is a key-independent identity check only where the comparison
record is itself trusted. PR6 provides no digital signature, external
notarisation or third-party proof. Operator text must say **tamper-evident**,
never tamper-proof.

Out of scope are an attacker executing code on the unlocked coordinator
computer, forensic recovery from SSD media, side-channel resistance,
multi-party signatures and nation-state forensics. The live working database
remains plaintext while the application is operating.

## Key custody

Every archive receives a freshly generated 256-bit mission archive key (MAK).
The MAK exists unwrapped only in the archive worker's memory while it is needed,
is overwritten where Node permits, and is never persisted unwrapped. PR6 wraps
it independently into exactly:

1. a mandatory passphrase slot;
2. a mandatory recovery slot using a newly generated code belonging only to
   that archive.

The versioned format parser permits at most one future machine slot so it can
reject malformed or duplicate slot sets deterministically. PR6 has no machine-
slot creation or unlock path and does not use Electron `safeStorage` for archive
custody.

The recovery code contains 200 random bits rendered as eight groups of five
Crockford Base32 characters. It is shown once and must be confirmed before the
archive can be sealed. PR6 does not assign a human holder or assume a custody
role.

Passphrase and recovery slots use the versioned scrypt profile below. Readers
validate every field before starting the KDF and reject unknown profiles,
weaker values and values above the supported resource ceiling. They never
silently reduce a setting.

| Field | Profile v1 |
| --- | ---: |
| `N` | 131072 (`2^17`) |
| `r` | 8 |
| `p` | 1 |
| derived bytes | 32 |
| salt bytes | 32 |
| `maxmem` | 268435456 (256 MiB) |

The supported macOS and Ubuntu hosts must be measured with this exact profile
before release evidence is accepted. A host that cannot run it fails with an
actionable compatibility error; lowering the profile requires a new reviewed
format decision.

JavaScript strings cannot be reliably erased. Renderer secrets are bounded,
never logged or placed in diagnostics, and retained only for the operation.
Worker-owned `Buffer` copies and derived keys are overwritten in `finally`
blocks where Node permits. Documentation and UI must not claim perfect secret
erasure from managed runtime memory.

## `SARARCH2` container v2

The binary layout is versioned and streaming:

```text
magic "SARARCH2"
uint32be canonical-header-byte-length
canonical UTF-8 JSON header
uint32be canonical-key-slot-block-byte-length
canonical UTF-8 JSON key-slot block
zero or more authenticated data frame records
one authenticated zero-length final frame record
fixed trailer "SARTRLR2" + uint64be frame-count + final-flag echo
```

The canonical header records only custody metadata needed without decrypting:
container version, cipher and framing identifiers, frame size, nonce prefix,
mission ID, creation-operation ID, request-event ID and rowid, protected
finalization epoch, creation time, schema version, inventory version, prior
archive SHA-256 or `null`, and key-slot count. The protected finalization epoch
is nullable: PR6 v2 finalization and supplemental creation record `null`; a
positive value is reserved and validated for a protected finalized-recovery
archive. Mission content, entry names, manifest details, operator names and
correction reasons remain encrypted.

The key-slot block records slot type, slot version, KDF profile and salt, wrap
nonce, wrapped MAK and GCM tag. It contains no passphrase, recovery code,
machine wrapping key or plaintext MAK. Each slot wrap authenticates the
canonical header digest plus the slot identity and parameters.

Each frame record contains a monotonic unsigned 64-bit index, final flag,
declared plaintext length, ciphertext and 16-byte GCM tag. Its 96-bit nonce is
the header's random four-byte prefix followed by the frame index as unsigned
64-bit big-endian. A writer rejects counter reuse or overflow. Frame AAD binds:

```text
SHA256(canonical header) || uint64be(index) || uint8(final) || uint32be(plaintext length)
```

Readers require index zero followed by exact increments, exactly one final
frame, no data after it, a matching trailer count and end-of-file immediately
after the trailer. Header mutation, truncation, reordering, duplicate frames
and cross-archive splicing therefore fail authentication or framing checks.

The encrypted logical stream is a sequence of length-declared entries. The
first entry is `manifest.json`; the remaining entries include
`mission.json`, `mission-store.sqlite`, `inventory.json` and collision-safe
attachment entries. The manifest exhaustively records every non-manifest
entry's byte length and SHA-256, every declared table's row count and content
digest, attachment identities and hashes, every GPX custody record, the
inventory-decision digest, mission ID, request/operation identity, protected
finalization epoch and schema version. Exact retained GPX source bytes are
content-digested. Legacy evidence that retains only a hash, or for which source
bytes are unavailable, remains explicitly classified; consequently the
reported `exactSourceCustodyComplete` value may truthfully be `false`.
Completeness never depends on a Replay sample.

The writer computes SHA-256 over every byte of the completed container while
streaming it to the staging file. That digest and exact size are recorded in
the live registry and seal event only after durable atomic publish. The digest
is not embedded recursively in the file.

Unknown magic, container versions newer than 2, unknown cipher/KDF/framing
identifiers, invalid resource parameters and archive schemas newer than the
running application fail closed. Existing v1 ZIP archives remain readable and
are explicitly labelled unencrypted; they are never rewritten.

## Completeness and restore proof

Archive creation pins one read-only SQLite/WAL snapshot, extracts only the
requested mission into a permission-restricted scratch database in bounded
batches, and streams that file and its attachments. No whole database, mission
database or attachment is loaded into one `Buffer`. The declarative archive
inventory classifies every user table as mission rows, referenced global rows,
derived/rebuildable state or excluded machine-local operational state. Both
tests and runtime reconciliation fail if a schema table is undeclared or a
declaration names no table.

An archive becomes `verified` only after a new sealed-file read independently:

1. matches the registry's exact ciphertext size and SHA-256;
2. authenticates the header, both mandatory key slots, their agreement on the
   same archive key, every frame, final frame and trailer;
3. reconstructs exactly the declared entry set and matches every entry length
   and digest;
4. opens the restored SQLite scratch database read-only and passes
   `integrity_check`, schema and mission/epoch checks;
5. reconciles the archived inventory and exhaustively matches every table row
   count and deterministic content digest;
6. matches every attachment digest and reconciles every GPX custody record,
   digesting exact retained bytes where available while preserving explicit
   legacy hash-only and unavailable classes; and
7. independently opens a new read-only, immutable-request-bound live-store
   snapshot (including the protected epoch when present), then exhausts every
   track, object and outing-filter continuation page at up to five deterministic
   Replay comparison times and compares those sampled semantic results with the
   restored archive.

The creation snapshot is extracted under the durable immutable request and
finalization fence. Verification does not assume that fence row still exists.
It independently opens a new read-only live-store snapshot and revalidates the
immutable request identity; when a protected epoch is present, it revalidates
that epoch in the snapshot. Retry orchestration checks the current finalized/
protected epoch before launch, and every verification commit atomically
rechecks it. Step 7 corroborates Replay semantics at the deterministic sampled
times. It
does not prove every possible Replay result and is never used to claim
completeness in place of steps 1–6. Verification failure leaves the registry
sealed and retryable. It does not mutate operational mission evidence or
status; it records only the explicit failure audit.

## Plaintext scratch and review sessions

App-owned creation staging, verification `.verification` scratch and Review-
session files are created with owner-only permissions. Creation and verification
scratch is swept on every applicable success, failure or cancellation path;
Review-session plaintext is swept on close; and startup/shutdown sweeps cover
interrupted app-owned staging, verification and session files. A sweep failure
stays explicit and retryable; it is not represented as clean. Here, **no
plaintext residue** means no application-addressable staging, verification or
archive-session file remains when the applicable cleanup reports success. It is
not a forensic secure-erasure claim.

Opening an archive for review necessarily creates a permission-restricted
temporary plaintext session. The UI names that residual explicitly while the
session is open. The session is read-only, has no mutation methods, is separate
from the active live mission namespace, and is swept on close, shutdown and
restart. Current tracking continues through its existing live path.

## Supplements and cleanup

Unlocking and correcting a finalized mission uses existing versioned evidence
and audit paths. Re-finalization creates a new archive whose authenticated
header contains the prior archive's ciphertext SHA-256. The registry marks the
prior archive superseded and records the supplement sequence, authority,
reason and audit event without modifying or deleting the prior file.

Live evidence cleanup is operator-initiated and is eligible only when all of
these are true at the same commit boundary:

- the latest archive is verified by the exhaustive proof above;
- its finalization epoch is still current and no later supplement is pending;
- registry, audit event and exact on-disk file size/hash agree;
- a fresh unwrap using this archive's existing passphrase or recovery slot
  succeeds;
- no archive creation, verification, restore, finalization or evidence
  backfill is active; and
- the operator completes the explicit mission-name confirmation.

Cleanup is bounded, journalled and resumable after process kill. It preserves
the mission/archive registry, supplement chain, cleanup journal, custody/audit
events and a compact mission stub. Any failed precondition denies cleanup.
Archive/live-store failure is surfaced explicitly and never damages the live
mission.

## Frozen module interfaces for PR6

The independent implementation lanes must stay behind these CommonJS
boundaries. Changing a signature requires root integration review before work
continues.

- `archive-crypto.cjs`: pure key generation, recovery-code codec, strict
  scrypt-profile validation/derivation, slot wrap/unwrap, monotonic nonce/AAD
  derivation and single-frame encrypt/decrypt. No filesystem or SQLite.
- `archive-container.cjs`: framed encode/decode over Node readable/writable
  streams; canonical header/slot codecs; ordered logical-entry codec; complete
  byte/hash accounting. It accepts an already-unwrapped MAK and has no mission
  or registry semantics.
- `archive-inventory.cjs`: immutable inventory declaration, schema
  reconciliation, canonical inventory document/digest, and deterministic
  table-row content digest helpers. It does not migrate or mutate schema.
- worker runners: validated bounded envelopes, cancellation and progress only;
  workers own all size-proportional I/O and SQLite work.
- `mission-store.cjs`: sole owner of schema v13 migration, PR5 fences and
  epochs, orchestration tails, registry state machines, supplement commits and
  cleanup eligibility/commit decisions.
- main/preload: explicit closed projection for every new request. Secrets are
  bounded before IPC; a hostile 64 MiB value must be rejected without invoking
  main.

## Acceptance boundary

This decision is implemented only when wrong-key, mutation, corruption,
truncation/reorder/splice, wrong-mission/epoch, disk-full, kill-at-every-phase,
schema-drift, registry/disk mismatch, cleanup denial, archive-review mutation,
newer-format, hostile-preload-input, concurrent-ingest, heartbeat, plaintext
session sweep and privacy/secret tests pass. The Ubuntu greater-than-2 GiB
proof must use the exact frozen implementation candidate and record memory,
heartbeat and current-position cadence separately from deterministic and
packaged proof. If the later reviewed head changes only base reconciliation,
documentation, manual or assurance inputs, that candidate proof may carry
forward only with an explicit blob-by-blob attestation that every PR6
implementation and qualifier-harness input is identical, plus proportionate
final-head static/package/Linux rechecks. Any implementation or qualifier-
harness change requires the Ubuntu proof to run again.
