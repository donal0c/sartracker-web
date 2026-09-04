# Breadcrumb PR6 Archive Lifecycle Evidence

This record binds `DON-248` / BCP-14, `DON-252` / BCP-15 and `DON-253` /
BCP-16 to one pull request. It is pre-merge engineering qualification, not
production, release, live-Traccar, original-field-machine, SAR-team custody-
tabletop or forensic-erasure proof. Opening a PR or reaching a candidate head
is intermediate. Donal retains approval and merge authority.

> This document is part of the PR #10 recovery candidate. Once source is frozen
> and the pending gates complete, its exact final commit/tree, post-freeze gate
> results, four independent review verdicts, Linux packaged report, and field
> receipt must be recorded in PR #10 and `DON-248`/`DON-252`/`DON-253` so that
> recording them does not create a different source head.
>
> Exact head `caf9e5e480fcd02cc44d68c8397efcd6ae78f2cd` / tree
> `81a8ef3e3639f6e8e7cd048691a87b8488a4d998` is rejected. Its Ubuntu run
> produced and verified a `5,243,848,931`-byte archive but ended
> `UNCLASSIFIED_INTERNAL_FAILURE` at `teardown:incomplete`; disposable-profile
> cleanup completed. A `Math.max(...samples)` argument overflow over roughly
> 200,000 samples caused that misleading teardown classification, but the run
> independently breached the hard liveness gate: create `1826.63 ms`, restore
> `2070.74 ms`, cleanup `1033.56 ms`, and durable latency `1029.43 ms`. The
> sub-millisecond “current position” figures measured only an in-process `Map`,
> not the packaged renderer path.
>
> The diagnosed stalls came from roughly 9.7 million retained high-volume
> `mission_events` plus repeated finalization/history scans. The recovery uses
> deterministic finalization-boundary lookups, preserves fail-closed cleanup,
> and restricts `mission_events` deletion to a declared telemetry allowlist
> while retaining operational, finalization, custody, cleanup, supplement, and
> unknown future audit events.
>
> Exact recovery head `49523dc8b460a2080c5fbbd3bc11c961296f481d` is also
> rejected. Linux run `33908771732` passed its source, lint, 3,685-test, build,
> package, Replay, native-module, llvmpipe, and tracking-soak gates, then failed
> packaged archive lifecycle with `current_fix_continuity_gate_breached`.
> A faithful macOS package reproduction failed with
> `current_fix_not_observed_before_gate`. Neither run emitted a failure receipt,
> so neither generic label proved a product stall or identified its phase.
>
> Source retrace reproduced the harness defects: timing began before its
> observer/source attribution was armed; phase handoff split exact-fix, main,
> and renderer-frame continuity; operation close preceded the final ledger
> drain; the terminal restore phase was re-armed across unrelated closeout; and
> teardown retained the old renderer-frame phase. Failed process shutdown could
> also remove the still-owned profile, success publication was not atomic, and
> failure-receipt publication was optional. The red-first replacement keeps one
> exact-identity timeline across active phase handoffs, drains observations at
> the operation boundary, ends timing before terminal closeout, pauses renderer
> attribution before teardown, retains a profile while any owned process may
> survive, and enforces exactly one atomic sanitized terminal artifact. The
> strict `<200 ms` gate is unchanged.
>
> Exact local head `81e47973714ff5cbbd908329559009c281b352fe` / tree
> `4d3f561969090808ed1e4abfad0fc050f764a622` is a third rejected diagnostic.
> Its clean macOS arm64 package reached the new failure receipt, which recorded
> `renderer_frame_sample_invalid` in `create` before any archive operation
> began (`operationCount: 0`). Source retrace proved a measurement-clock defect:
> phase arming used `performance.now()`, while the first queued animation-frame
> callback supplied a timestamp from before arming. The renderer probe now
> measures both endpoints with `performance.now()`. Re-reporting the same
> primary probe fault during teardown is no longer counted as a cleanup failure,
> while a genuinely new stop failure remains distinct and fail-closed. The
> strict gate remains unchanged.
>
> Exact local head `74bdd95ca3bbd09f775ba111d53f6313e76769d6` / tree
> `3bef9c115d5fadeb4ae9427532f27be80a8177ce` is also rejected. Its clean
> package produced one healthy exact create-phase sample with every measured
> gap below `34 ms`, then failed `source_identity_left_pending_at_operation_start`
> before any operation began. The renderer and source ledgers were cut at
> different instants while 50 ms polling remained active, so a normal in-flight
> identity was treated as an immediate error rather than remaining governed by
> its original strict 200 ms deadline. This is a measurement-boundary defect,
> not product- or host-stall evidence. Its unexplained cleanup count also exposed
> that the receipt omitted secondary cleanup-failure attribution.
>
> A separate red-first regression preserves live Review after cleanup → archive
> correction restore → re-finalization → ordinary Admin Unlock, including
> repeated cycles and current/intermediate recovery archives. Unlocks now have
> deterministic archive-owned audit identities, and supplements carry their
> exact id, rowid, and time. Lineage verification therefore uses only existing
> unique-id and integer-rowid point reads; it creates no startup index and scans
> or sorts no mission history. Broken ancestry, identity, chronology, or status
> fails closed.
>
> For the replacement candidate, cheap exact-head gates, four reviews, the Linux
> packaged liveness report, and exactly one fresh controlled Ubuntu
> greater-than-2-GiB qualification remain pending. No merge, release, field
> acceptance, or final review result is claimed here. Donal retains approval
> and merge authority.

## 2026-09-04 superseded first-candidate pre-freeze verification

Before `49523dc8` was frozen, its dirty-tree predecessor passed the combined affected gate (`28` files /
`680` tests), the full deterministic serial unit gate (`375` files / `3,685`
tests), ESLint, TypeScript/production build, bundle budgets, Node syntax, and
diff checks. The legacy backend passed `58` tests with one platform-specific
keychain test ignored. Full Chromium passed `173/173`; full visual Playwright
passed `62/62`. The refreshed 15-check cleanup frame then passed an uncached
independent critical visual review and replaced the operator-manual image.

Unsigned macOS arm64 directory packaging passed. The packaged lifecycle runner
correctly rejected the still-dirty pre-commit tree, so this rehearsal supplies
no packaged-liveness proof. Clean exact-head package/lifecycle, physical
SIGKILL, Linux, four-review, and single fresh field gates remained pending. This
is superseded first-candidate evidence, not proof for the replacement source.

## 2026-09-04 rejected `49523dc8` packaged-liveness candidate

The first clean recovery candidate was committed and pushed at
`49523dc8b460a2080c5fbbd3bc11c961296f481d` / tree
`fa0de2f87281412232a04c5aaf35456d8a37c34c`. Linux run
[`33908771732`](https://github.com/donal0c/sartracker-web/actions/runs/33908771732)
passed every gate through packaged tracking soak, then stopped at packaged
archive lifecycle after roughly ten seconds. Its only terminal detail was
`current_fix_continuity_gate_breached`; the always-upload artifact contained no
lifecycle report because that runner wrote success evidence only. A clean
macOS package of the same exact head reproduced the evidence gap while failing
with `current_fix_not_observed_before_gate`.

The four independent head reviews are diagnostic only because the source must
change. Broad review found no correctness break and one optional P3 trigger-
coverage gap. Persistence review's apparent multi-mission lease mismatch was
disproved: the session manager deliberately owns one global Review/plaintext
lane, and the existing two-mission test holds that global lease across the
sequential recovery batch. Its journal CAS and escaped SQL consistency notes
were also not correctness defects. Concurrency and renderer reviews reproduced
the liveness accounting defects above; renderer review additionally found the
valid repeated-correction lineage stranded as `cleanup_in_progress`.

Red-first remediation is green across the root integration gate (`12` files /
`266` tests) and the full deterministic serial suite (`375` files / `3,707`
tests), plus full ESLint, TypeScript/production build, bundle budgets, focused
syntax, diff checks, and the legacy backend (`58` passed / `1` platform-specific
ignored). These are dirty-tree implementation checks, not exact-head package or
Linux proof. A replacement commit, exact package, browser/visual, physical-kill,
Linux, four-review, and field gates remain open.

## 2026-09-04 rejected `81e47973` renderer-clock candidate

The next local candidate was committed at
`81e47973714ff5cbbd908329559009c281b352fe` / tree
`4d3f561969090808ed1e4abfad0fc050f764a622`. Its clean macOS arm64 package
completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`baf77ea65a944aa9eee0c996b8c91d8ce23123949264138464f64ba20f04001a`.
The exact packaged lifecycle then rejected it after `3,931 ms` with one
0600 failure receipt, SHA-256
`918d83542d14cfeaec085ea6099d7c01dd96f5a016f28f4ad31025c1202ec7b8`.

That receipt recorded only `renderer_frame_sample_invalid`, active phase
`create`, one launch, zero operations, and no current-fix timeout or continuity
breach. Owned process and profile cleanup both completed. The negative first
frame came from mixing the queued animation-frame callback timestamp with the
later `performance.now()` phase-arm timestamp, so this was a harness
measurement rejection before product work, not archive-stall evidence. The
red-first repair uses one monotonic clock for both samples, adds one bounded
`phase`/`gapMs`/`gapType` invalid-frame diagnostic, and preserves a distinct
new stop-time failure even when its error kind matches the primary fault. A
pre-freeze audit additionally found that this fresh failure could escape before
the external watchdog settled; its red-first regression now proves unconditional
watchdog stop, released launch ownership, and successful replacement attachment.
Focused liveness/smoke verification is `3` files / `129` tests green. The full
deterministic serial suite is `375` files / `3,712` tests green; full ESLint,
TypeScript/production build, bundle budgets, focused Node syntax, diff checks,
and the legacy backend (`58` passed / `1` ignored) are green. Exact-package and
later candidate gates remain pending on the replacement commit.

## 2026-09-04 rejected `74bdd95` operation-boundary candidate

The renderer-clock and watchdog-settlement repair was committed at
`74bdd95ca3bbd09f775ba111d53f6313e76769d6` / tree
`3bef9c115d5fadeb4ae9427532f27be80a8177ce`. Its exact clean macOS arm64
package completed with executable SHA-256
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`
and ASAR SHA-256
`f15d9284fed1e926e6d32b17d3a7f0c65c868ffbf320f3bc86d2bc4d752fe416`.
The one packaged lifecycle attempt then wrote a 0600 failure receipt, SHA-256
`2e55a78add58b79d24476084690d17440207586169f56be3d212734d904e1c6f`.

The receipt recorded one exact create-phase sample, `3 ms` source-to-renderer
and request-to-renderer maxima, `12.68 ms` main and `8.9 ms` renderer-frame
maxima, no current-fix timeout or continuity breach, and zero operations. A
second source identity was emitted between the renderer observation cut and the
source-ledger cut. The old start assertion rejected that ordinary
join state immediately, even though unmatched identities already have a strict
per-source `>=200 ms` expiry. During teardown that same identity reached its
real deadline and created a distinct secondary liveness error; cleanup counted
it but the receipt retained only the primary error details.

The replacement must use causal operation fences: a pre-start identity remains
global liveness evidence but cannot satisfy fresh-operation proof, only sources
inside the exclusive-start/inclusive-end source window may count, and finite
in-window pending identities settle only to their original deadline. Renderer
collection/delivery must be serialized so a concurrent watchdog cannot hide a
valid observation across a checkpoint boundary. No polling pause, global-empty
wait, continuity reset, or deadline extension is permitted. Secondary cleanup
failures must remain fail-closed and appear as bounded sanitized receipt detail.
Head `74bdd95` will not be rerun unchanged.

The red-first replacement now implements those fences against the mock source's
monotonic sequence and serializes renderer drain plus source correlation across
explicit and watchdog collection. A periodic drain that completes after
watchdog stop begins is discarded inside that serialized commit boundary; the
final cleanup drain is still recorded. A timed-out drain poisons later
collection, cannot commit late exact-fix evidence, and cannot start another raw
drain. Start-pending and post-end sources retain their global liveness duty but
cannot satisfy operation freshness, while only the finite in-window set is
settled at completion. The strict per-source `>=200 ms` rejection is unchanged.

Cleanup now attributes each genuinely new failure to one stable bounded step,
including profile removal, while ignoring only an exact primary error replayed
by liveness stop. Count/detail disagreement fails closed. Terminal projection is
allow-listed, secret/path-redacted, depth/array/global-node bounded, and total
for nullish rejections, hostile getters/proxies, cycles, and malformed messages,
so those inputs cannot be misreported as success or suppress the required
receipt. Two independent implementation audits exposed and drove the watchdog
commit-boundary and hostile-receipt corrections. The combined focused gate is
`4` files / `157` tests green and the expanded affected gate is `5` files /
`196` tests green. The full deterministic serial suite is `375` files / `3,737`
tests green, alongside full ESLint, TypeScript/production build, bundle budgets,
focused Node syntax, diff checks, and the legacy backend (`58` passed / `1`
platform-specific ignored). These remain pre-freeze local checks, not exact-head
package, Linux, or field proof.

## 2026-09-03 cancelled-cleanup fence remediation

The exact-head broad, persistence and concurrency reviews at `b30ebeb2…`
reproduced a P2: cleanup cancellation rejected before the dedicated SQLite
worker physically exited, releasing the archive-family and Review fences during
the worker's termination grace. The red-first regression keeps the cleanup
promise and mission Review blocked until `workerExited`; the fix is pushed at
`561ffcb96960ba3bd62dcede1c616b74a79b22a7` / tree
`afbd3b3940d9908edea9d661c24078e471bf63a1`.

The qualification-safe run-identity fix is `b30ebeb2…`; cleanup moved off the
Electron main loop at `92c87f01…` after the first >2 GiB attempt measured
multi-second main heartbeat/current-position gaps. Those earlier receipts are
prior-head diagnostics only. Final Ubuntu, Linux, package, browser, visual,
documentation and review evidence must bind to one exact head.

## 2026-09-03 latest remediation

The post-remediation exact-head broad review found three P2s and all three were
fixed red-first in `5ce12514…`: Mission Review now receives a durable
`correctionAuthorized` signal from the same bounded SQLite read snapshot rather
than inferring authorization from the newest 500 audit rows; browser validation
persists only sanitized secret verifiers so an archive can be reopened after a
session reload; and browser corrections require the current archive predecessor,
supersede the predecessor, and retain the audited supplement authority, reason,
timestamp and chain metadata. Fresh broad, persistence and concurrency reviews
at the exact source head are clean, with no P1/P2/P3 findings.

The narrow crypto-only review then found one P2 assurance mismatch: recovery
credentials were being converted to immutable JavaScript strings in four worker
paths while the evidence claim said they were not. The remediation is committed
at `c5a2c354cd954df600ab1e73a1b7e0f44384e3f5`: recovery-code canonicalization
now stays in mutable bytes, create/verify/restore/cleanup pass those buffers
directly, and the lifetime regression covers every path. Crypto/lifetime tests
are `39/39` green and the evidence claim is now bounded to the truthful
no-worker-string invariant.

## Candidate proof wave (2026-09-03)

Source remediation is committed and pushed at `5ce12514056d9adef51a763bb0a0672095d6e805`
/ tree `0a94e503dc7c4d8b2535d5a41d19ae863069cf36`. The affected deterministic
suite is `281/281` green, archive-review and mission-review Chromium flows are
`17/17` green, and archive visual Playwright is `3/3` green. The exact-head
review wave was clean for three of the four final charters: broad life-safety,
persistence/completeness and concurrency/finalization. Renderer/input
containment remained required on the final documentation head. The narrow
crypto-only check was remediation evidence, not a fifth final-review charter.
Full serial unit, package, kill-matrix, Ubuntu >2 GiB, Linux workflow and final
documentation-head proof remain open until their raw reports are bound to the
final head. The
source-head full serial unit gate is now `368/368` files and `3,524/3,524` tests
green; the four generated archive visual manifests also passed independent
visual review (`4 pass / 0 fail / 0 error`).

The current P1/P2 remediation is red-first tested at `53269409…`; no prior-head
review or proof is promoted automatically. The correction restore now rejects a
same-size staged snapshot mutation using the authenticated SHA-256 and pinned
regular-file identity. The correction runner validates and carries those fields
without exposing them in the completion envelope. The outbox write and renderer
incident paths recheck the durable recovery fence immediately before each
mutation. The exact-head broad, persistence and concurrency reviews are pending;
no prior-head approval or proof is promoted automatically.

At `53269409…`, the correction snapshot worker now accepts a completion only
after a successful worker exit, while archive-backed rehydration validates the
projected finalization event rather than registry tables intentionally absent
from the archived snapshot. Mission Store records the global attachment-custody
recovery blocker only when an attachment journal remains, so no-attachment
failures cannot strand unrelated missions. These changes are covered by
red-first completion/exit, abort-window, archive-review snapshot, and
no-residue-fence tests. Fresh exact-head reviews remain the release gate.

At `22d5089e…`, the review close registry accepts the existing correction
restore reason, IPC always reports a successful correction envelope, and the
renderer keeps a durable attachment-custody failure visible while returning to
the live read-only source. A real archive-review → cleanup → snapshot → restore
integration test now proves both plaintext sweeps and the correction close audit.
The fresh exact-head review wave is the release gate.

At `6d666a86…`, IPC now treats a committed correction with a clean live-store
state as successful even if the worker exits abnormally after its durable
transaction; committed custody failures retain their explicit failure envelope
without a second session close. Cleanup retries reopen renderer evidence only
after plaintext cleanup succeeds, operator banners preserve the safe custody
cause, governance refreshes in a finally path, and the writer-lane admission is
applied through all database-backed mutation helpers. Red-first regressions
cover the post-commit exit, close ownership, cleanup retry, browser legacy
envelope, UI cause, and held-worker mutation cases. Fresh exact-head reviews
remain the release gate.

The affected review wave at `26238179…` found a P1/P2 path-swap window in
correction rehydration and a P2 replay mutation during custody recovery. At
`64c5143d…`, rehydration copies and authenticates the snapshot through a pinned
descriptor into a private read-only restore file, while replay pauses on the
recovery code without adding a false ledger failure. At `4291a49…`, the paused
replay schedules a bounded retry and resumes after the fence clears, and
cancellation cannot mask a post-commit custody-cleanup failure. Custody recovery
writes a durable `completed` marker before removing its final journal directory,
so a restart can clear only a worker-proven completion. These fixes are covered
by red-first path-swap, replay-fence, retry-resume, cancellation-race and
completion-order tests; the fresh exact-head reviews are the release gate.

The broad and persistence reviews at `84424c08…` found the mission-name and
recovery-write P2s. Both were fixed red-first and pushed at `e9d7bd51…`; no
prior-head review is promoted as final evidence. A broad-review P3 about sweeping
pre-commit rejected-restore snapshots remains outside the frozen P2 remediation
scope because the renderer-owned session close already performs that sweep.

The final concurrency review at `d28a82d…` found a post-commit correction
attachment-journal removal failure that was being reported as generic rehydrate
failure. The worker now classifies any unproven post-commit journal removal as
`ARCHIVE_REHYDRATE_CLEANUP_REQUIRED`; Mission Store persists the durable recovery
blocker before reconciling the committed unlock, and the red-first attachment
restore regression proves later correction work is fenced. This fix is pushed at
`84424c08a9d2e8c3c8ed408367226372b7ab1631` / tree
`818115351f9d90cf3ecc939e5faa23d066a5d0b9`.

## 2026-09-03 exact-head remediation ledger

The concurrency and renderer rechecks found two P2 defects at `739560cb…`: a
shared SQLite busy timeout could still block the Electron main loop before the
retry delay, and the correction snapshot runner did not subscribe to its
AbortSignal after startup. The red-first fixes are pushed at
`0bc9563978bfb34455b5c04e62e3c36ccba3d0c4` / tree
`19744f2498219c8b81dbe40f2dcf1cc1ec9baf8e`; the follow-up cleanup-admission
P2 is fixed and pushed at `d28a82d7690d3e184efbadd98bfb330c9aca5fac` / tree
`c212d1cd0d89d5572965ad4958518f2ed7507e3b`:

- cleanup transaction boundaries temporarily set the connection busy timeout
  to zero, then retry asynchronously at 25 ms, so lock contention cannot stall
  current-position/UI work;
- correction cancellation is joined through IPC, the review snapshot worker,
  mission-store admission, and the archive correction worker; and
- the exact 40-character source head is embedded in packaged operator-visible
  version text.

The local full serial gate passed at `d28a82d…`: `368/368` files and
`3,487/3,487` tests.
The 32-case local SIGKILL matrix is qualified, and the archive-review/
mission-review Chromium operator slice is `17/17` green. The standalone
coverage suite is `1/4` because three pre-existing DON-275 checks still report
“Participant history is still being added”; this is recorded as a browser-proof
limitation, not silently treated as PR6 coverage. The Ubuntu field-scale run
was restarted after the host reboot but is bound to the prior code head and is
not final proof; rerun it against the final exact documentation head.

## 2026-09-03 correction-custody remediation

The exact-head review wave found one further P2 in the new attachment recovery
path: startup recovery queried a non-existent `missions.storage_state` column.
The fix now reads the durable `mission_cleanup_journal` state and has two focused
restart tests proving that uncommitted attachment residue is removed while bytes
from an already-committed correction are preserved. This remediation is pushed at
`d410df0c8fd1ffc421d824496a6a24e40dc438fb` / tree
`f21a3df774e81913dfa6b9d541443674ea859f0c`.

The candidate also includes the prior fixes for authenticated same-size snapshot
mutation rejection, session-keyed correction authority, cooperative correction
worker cancellation, streamed bounded attachment reads/copies, and post-commit
live-source recovery classification. The next review wave must be run against
this exact head; no prior-head proof is promoted automatically.

## 2026-09-02 remediation ledger

The previous exact-head broad/persistence reviews exposed two lifecycle gaps.
The candidate fixes are now source-backed and red-first tested:

- Finalized archives project the post-seal `finalized` mission status and
  deterministic `mission_finalized` (plus supplement) audit events into the
  sealed SQLite snapshot. Restored Mission Review therefore retains the
  terminal lifecycle history instead of presenting a `finished` snapshot.
- Interrupted cleanup remains a durable `cleanup_in_progress` blocker and now
  has an explicit operator Resume cleanup action. The request is mission/archive
  bound, uses a fresh bounded operation identity, and crosses the explicit
  main/preload handler; the browser harness and IPC containment tests cover the
  route. Expected shutdown cancellation of the startup registry sweep is not
  persisted as a false failure marker.

Focused remediation evidence: archive review/lifecycle/cleanup/IPC tests
`84/84` green; full deterministic unit suite `359` files / `3,433` tests green;
lint, TypeScript, Node syntax and diff checks green. The candidate was pushed as
`537fcc9462336e0e1c6cc9916a0aa7f3172b51e1` / tree
`337a0bd9aea1a02a6a36270bd0363076c430db57`. Independent exact-head review and
reference-host/package/browser proof are not implied by these local checks.

The next exact-head review wave found and closed two additional P2 gaps:

- Cleanup recovery is now reachable from both Mission Control and Saved Mission
  Archives while the durable storage state is `cleanup_in_progress`; start and
  cancellation failures preserve the Resume cleanup action.
- Retained archive reads are serialized and skipped on the docked active/paused
  live-position path, so opening Review cannot fan out unbounded archive IPC.
  Create/verify/restore/cleanup workers carry credentials as transferred
  mutable byte buffers. Recovery-code canonicalization stays in mutable bytes,
  and the workers scrub those buffers at their final KDF/unwrap boundary; no
  worker reconstructs an immutable credential string.

Those are historical candidate claims. The recovered operator surface keeps
the entry action neutral and offers Resume only after eligibility proves an
intact, explicitly in-progress cleanup journal; invalid recovery state and
membership drift remain non-resumable blockers.

The previous resulting candidate was `358370abd39c7ac708164d7adf2d1f564cc00bf8`
/ tree `29b3c37d755681cf41dc7ef4f9773fc6994e86f4`; its full deterministic gate
was `360` files / `3,439` tests green. That evidence remains prior-head only;
no earlier proof is silently promoted to this head.

The next exact-head review wave found and closed one correction-lifecycle P2 and
one renderer-safety P2. Rehydration and the final unlock event now run through a
worker-owned transaction, with a rollback/retry fault-injection test. Correction
snapshot deletion is an explicit terminal failure when sweeping cannot be
confirmed. The operator only sees correction for the current verified v2 archive;
if a failed restore cannot confirm plaintext cleanup, the active session remains
visible in `plaintext_cleanup` recovery. Hostile 64 MiB and unknown-field restore
inputs are rejected before collaborators are invoked. These fixes are committed
at `fec8be41704fb8d112483f108bcf5b4113e43faa`; fresh exact-head reviews remain
the release gate.

## Execution identity

| Item | Exact value |
| --- | --- |
| Branch | `codex/breadcrumb-pr6-archive-lifecycle` |
| Pull request | [#10](https://github.com/donal0c/sartracker-web/pull/10), draft until the immutable exact-head review ledger is clean |
| Exact base and initial `origin/master` | `eec92812b783a795c093f37268b295dd2179a3af` |
| First frozen implementation candidate | `60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95` |
| First candidate tree | `0fdbc3d4812d83feecdf4151688fc317381719c6` |
| First replacement candidate | `d60059d9267d4391ffeaa158ae0adec1dad57a2a` |
| First replacement tree | `1e92fd45d701bbcc57a53a2d86ce5031b1879467` |
| Second replacement candidate | `e975ff1c64f914d582efe2aedb09d29f4df19ca2` |
| Second replacement tree | `1b01df864dbe3299bd05279524fdb926332fc8ae` |
| Pre-visual candidate | `136000ff4b4489e5ff5c57fd10e1a7bda658a2e7` |
| Pre-visual candidate tree | `8a0b30c9fb3e2b81a72e5f76fbf60bcc69293e65` |
| Superseded pre-retry candidate | `618f9c8b7f3c818aab25787c926b1394d2282297` |
| Superseded pre-retry tree | `87aea9263d5634e76608cd8096a7b3996741b2ca` |
| Frozen code candidate | `3b148e532bd5a98b3d2fa24466fc8501a111efdd` |
| Frozen code candidate tree | `4be6f73d00de9cf9a4315c133ddfe51295c3e344` |
| Post-candidate base reconciliation | `af745dc0c4027e25f8f306f38aa603026c3f2277` / tree `13d75423584d6a6f73501168b5cf4d9f5a547af3`, merging `origin/master` `0ca331ff816800e83134142cb109903e5d2c2992` |
| Exact qualification-harness remediation head | `53164028f72254c4e17fcc0b4b845f7601fee153` / tree `5c347d30691f291164dc65ed25c2bc437f906e55` |
| Previous archive-lifecycle remediation head (superseded) | `f220f59650ba96231f06a4f45015791223934300` / tree `9b5bf3a24da9a4ba6e98e8ee3e21d7ba236e6538` |
| Previous archive-lifecycle remediation head | `bd14adb5c4f41797c975089bb3d52dc22da95d1a` / tree `41225f06694b53e0230e446eaf5881f82c699d69` |
| Superseded code/qualification head | `661305694d43682a6e4aa0e0fafeeb962affc7ea` / tree `0854dfd72b0b1c04c3e6fda0827ca9761060c6f5` |
| Remediation candidate (pushed) | `537fcc9462336e0e1c6cc9916a0aa7f3172b51e1` / tree `337a0bd9aea1a02a6a36270bd0363076c430db57` |
| Superseded correction-worker candidate | `fec8be41704fb8d112483f108bcf5b4113e43faa` / tree `0365f9be98ddcf217306c6b904dca439e6b9e8f0` |
| Superseded correction-custody candidate (pushed) | `d410df0c8fd1ffc421d824496a6a24e40dc438fb` / tree `f21a3df774e81913dfa6b9d541443674ea859f0c` |
| Cleanup-admission remediation candidate (pushed) | `d28a82d7690d3e184efbadd98bfb330c9aca5fac` / tree `c212d1cd0d89d5572965ad4958518f2ed7507e3b` |
| Post-commit custody-fence remediation candidate (pushed) | `84424c08a9d2e8c3c8ed408367226372b7ab1631` / tree `818115351f9d90cf3ecc939e5faa23d066a5d0b9` |
| Superseded source candidate (pushed) | `0d6f1bf1ed6f2c0ab9b804229a8ffde536577e3c` / tree `e86f1b5037ca91e4de50d012ac2051c530498c88` |
| Superseded source candidate (pushed) | `5326940948ee62d97b7ada91017275c65ef5a9a8` / tree `6db7275ba5f3aea30f596f47518fa2b466bf1ccd` |
| Superseded source candidate (pushed) | `5ce12514056d9adef51a763bb0a0672095d6e805` / tree `0a94e503dc7c4d8b2535d5a41d19ae863069cf36` |
| Superseded pre-recovery packaged candidate | `0f0723d4b1ec7e78d4f6c166abad049188660ca6` / tree `b53474dc93069930a0c284ed6507510bd6a87d94` |
| Prior-head packaged macOS archive-lifecycle smoke (superseded) | `0f0723d4…`; report SHA-256 `e30b9c9d3a12b2ae02a36193b3c64e1c2a046a268cb37c28d4c4bbcddf191bbe`; passed its then-current gates but predates the recovery and is not final-head proof |
| Rejected field-diagnostic head | `caf9e5e480fcd02cc44d68c8397efcd6ae78f2cd` / tree `81a8ef3e3639f6e8e7cd048691a87b8488a4d998`; its failed receipt is diagnosis, not qualification |
| Recovery candidate and final proof | Pending. Once source is frozen and every gate completes, the exact immutable head/tree and results must be recorded in the PR #10 and Linear ledger |
| Immutable final documentation/review head | Pending. It must be recorded after this evidence freeze in the [PR #10 exact-head ledger](https://github.com/donal0c/sartracker-web/pull/10) and Linear; any later repository mutation requires affected re-review |
| Scope | one PR6 containing all three internal strict-TDD checkpoints |

Historical carry-forward note: before the `caf9e5e…` field run, a read-only
merge-tree check and blob manifest bound selected earlier application proof
across a master reconciliation. The recorded path-list and manifest digests
apply only to those named prior heads. This recovery changes finalization,
cleanup, qualification, and packaged-liveness inputs, so none of those old
manifests is current or mandatory for the final tree. The affected proof must be
rerun on the new immutable candidate rather than carried forward by ancestry or
partial blob equivalence.

The first candidate was committed only after the staged tree was clean, the focused
qualification and kill harnesses were independently rechecked, and the local
unit/static gate passed. It was then pushed before external exact-head proof.
The first local packaged run found that CSS uppercased the visible hexadecimal
head while the smoke harness compared it case-sensitively to the lowercase Git
value. Manual CDP inspection and `app.asar` both contained the exact full
40-character head, but the harness failed before lifecycle execution. This is
a confirmed P2 proof-integrity defect. The first head is retained as prior-head
evidence only. A red test reproduced the CSS-uppercased full head failure; the
replacement accepts hexadecimal case only while still requiring one exact
bounded 40-character token and rejecting prefixes/longer tokens. The focused
replacement gate passed `30/30`, ESLint, TypeScript, Node syntax and diff
checks before commit. Once that gate passed, the packaged run reached mission
seeding and exposed a second smoke-only P2: the runner expected an internal
acknowledgement object even though the locked public `addPositionsBulk` bridge
correctly returns `Position[]`. The replacement now requires an array with
exactly the requested bounded batch length and separately verifies the
persisted total. It rejects acknowledgement objects, short and overlong arrays.
A bounded source retrace compared every other smoke-consumed result with the
public bridge types, main projection and store implementation and found no
other mismatch. The red/green focused gate finished at `31/31` plus ESLint,
TypeScript, Node syntax and diff checks.

The next disposable package traversal found two further harness-only P2s before
any final candidate was accepted. Restore interruption called `input.page` even
though the closed launch owner is `input.launch.page`, so the intended physical
decrypt-phase kill could not be armed. A red test now fixes both calls to the
owned launch page. Once the lifecycle reached terminal cleanup, its whole-result
comparison correctly reported that two independently opened Review sessions
were not byte-identical. Exact sorted payload diffing proved one and only one
session-transport field changed: `review.workerThreadId` (`5` to `7`). The
closed comparison excludes exactly that path, rejects missing or additional
Review-result fields, and retains the complete mission, audit, breadcrumb and
Replay objects. Negative tests mutate mission revisions, immutable audit
content, breadcrumb counts, Replay rows, row order and totals and require every
mutation to change the comparison digest. Focused tests are `39/39`; ESLint,
TypeScript, Node syntax and diff checks pass. A synthetic disposable package
then traversed create, independent verify, read-only Review, audited mutation
denial, physical decrypt-phase `SIGKILL`, restart sweep, credential-gated
cleanup and residue/secret scans to terminal green. That run was deliberately
unbound and is not final exact-head proof.

The next independent audit found that this traversal checked only the first
bounded Replay page. Red-first remediation now fixes one generation and
exhausts every track, object and outing-filter continuation page, rejecting
cycles, partial pages, empty non-terminal pages, invalid cursors, duplicates,
order changes, total changes and scope changes. The physical fixture now uses
the public preload bridge to create 4,096 breadcrumbs, 101 marker objects and
101 distinct GPX outings, and requires all `4,096` / `202` / `101` projected
rows or choices to match before and after cleanup. A fresh independent audit of
the remediated pagination proof was clean.

The Ubuntu diagnostic also exposed a product C5 performance defect: a legacy
registry pending check could synchronously scan 9.7 million mission events.
The frozen candidate records a fixed durable backfill target, reads pending
state from canonical metadata only, scans at most 1,000 raw rows and processes
at most 50 archive events per asynchronous turn, and advances registry changes
and cursor metadata atomically. Malformed or regressed boundaries fail closed.
A fresh independent C5 source audit was clean. The qualifier separately replaces
an arbitrary total-duration limit with a 120-second no-durable-semantic-progress
watchdog; immediate durable failures and the 200 ms liveness gates remain hard
failures.

Exact-head visual qualification then found one stale PR5 test route: the
finalized Search Operations visual clicked the removed plaintext
`mission-finalize-confirm` control even though the product correctly presented
the encrypted custody dialog. The failure repeated in isolation. Red-first
remediation drives the real passphrase, one-time recovery-code issuance,
type-back and create/seal/verify route. Its file passed `2/2`, the full visual
DOM suite passed `61/61`, and the corrected critical screenshot passed a fresh
independent visual review. No product behavior was changed. That candidate
later became prior-head evidence when the sealed-verification retry audit found
that an operator could not retry independent verification with the original
passphrase and recovery code and that a newly sealed custody row could remain
unavailable until restart. Red-first remediation added the bounded,
single-flight retry dialog, immutable archive-identity checks, authoritative
timeline reconciliation and serialized off-main custody recovery. A fresh
independent focused review found no remaining substantiated P1/P2. That
candidate is retained as historical prior-head evidence only; it is superseded
by the current remediation head recorded above.

## Authority and requirement trace

The raw transcript in
`team-feedback/breadcrumb-question-answers-20260822.md` outranks summaries,
the ADR and model output. PR6 does not add a team answer or assign a human
custody role.

| Authority | Locked meaning retained by PR6 | Main proof surfaces |
| --- | --- | --- |
| `SAR-QA-007` | Raw fixes, named tracks, timestamps, accuracy, the map image, audit history and the saved timeline remain reviewable | mission-scoped inventory/content proof, archive Replay and read-only Mission Review |
| `SAR-QA-017` | Replay reconstructs evidence known at T, not historical screen state | every page exhausted at up to five deterministic comparison times against the restored archive and a new immutable-request-bound live snapshot (including the protected epoch when present), with store-level current-epoch checks before retry and at commit |
| `SAR-QA-019` | GPX timestamps are never invented; undated GPX remains explicit static evidence outside precise Replay | GPX custody ledger plus the engineering exact-byte/hash-only/unavailable classifications and verification attacks |
| `SAR-QA-020` | Finalized evidence is read-only and corrections remain visible | finalized write fences, immutable supplement chain and revision timeline |
| `SAR-QA-021` | Traccar `fixTime` remains the breadcrumb evidence clock | inherited PR5 Replay/finalization contracts and archive semantic proof |
| `SAR-QA-006`, `SAR-QA-013` | Re-reading the same immutable Traccar position must not duplicate or overwrite source evidence | inherited idempotent position persistence and immutable source-row proof |

The non-blocking custody-tabletop confirmation was not sent from this task.
The one-recovery-code-per-archive rule and the decision not to assign a holder
are engineering custody controls from the binding PR6 packet, not answers
attributed to `SAR-QA-006` or `SAR-QA-013`.

## Delivered operator outcome

- Finalizing creates one self-contained mission-scoped encrypted archive. It
  does not copy unrelated missions or load a whole multi-gigabyte database into
  one JavaScript buffer.
- A newly sealed file is independently reopened, decrypted and restored into
  permission-restricted scratch space. `verified` requires exact ciphertext,
  frame, entry, schema, inventory, row-count, content-digest, attachment, GPX
  and Replay-semantic checks. A Replay sample never substitutes for exhaustive
  completeness.
- Creation, verification and restore failure is explicit and leaves
  operational mission evidence intact. Cleanup is an intentional, bounded
  deletion of archived mission rows, rebuildable derived projections, and the
  four settled operational tables `gpx_import_source_receipts`,
  `ingest_anomaly_deliveries`, `participant_backfill_checkpoints`, and
  `tracking_history_checkpoints`. The mission rows are represented in the
  verified archive; the derived and operational exclusions are not claimed as
  archive evidence. Within `mission_events`, only `device_updated`,
  `position_recorded`, and `mission_backup_synced` telemetry is cleanable.
  Interruption preserves the verified archive, mission stub, archive/supplement
  registry, every non-telemetry mission audit event, and unknown future audit
  event type. Resume is offered only when an intact journal explicitly proves
  cleanup is in progress. Invalid recovery state fails closed, and live-row
  membership changed after finalization requires re-finalization; ordinary live
  Review stays blocked until storage state is consistent. A sealed-but-
  unverified archive is not represented as complete.
- Sealing/finalization locks the mission read-only. Independent verification
  establishes archive completeness and Review eligibility; it does not perform
  the lock.
- Saved missions and every archive revision remain indefinitely visible on the
  timeline. Verified v2 revisions and superseded v2 revisions with prior
  verification open read-only using one of that archive's original credentials.
  Supported sealed/superseded v1 revisions open read-only without a credential
  and stay visibly labelled unencrypted. Sealed-unverified v2 revisions remain
  visible but are retry-only until exhaustive verification succeeds.
- A correction produces a new visible supplemental revision chained to the
  preceding ciphertext hash. Earlier archive bytes are never mutated or
  deleted.
- Removing eligible mission-scoped live data after archival is a separate,
  explicit, credential-gated and journalled action. It is resumable only when
  the validated journal proves an interrupted cleanup; an invalid journal or
  guard remains non-resumable, and membership drift requires re-finalization.
  Cleanup is never automatic and never deletes the verified archive or mission
  timeline stub. This is logical SQLite deletion: freed pages may be reused
  without shrinking the database file.
- Current-position independence during archive create, verify, restore, Review,
  and cleanup is a hard invariant. Its candidate-specific proof must come from
  the pending exact-head packaged external-watchdog report; it is not asserted
  from unit or in-process timing alone.

## Security decision and truthful claims

The binding engineering decision is
`docs/breadcrumb-archive-security-decision.md`. `SARARCH2` is a repository-
owned format that uses standard primitives; this record does not call the
format itself a standard.

- Each archive has a fresh random AES-256-GCM mission archive key.
- Mandatory passphrase and per-archive recovery-code slots wrap the same key.
- Scrypt profile v1 is `N=131072`, `r=8`, `p=1`, 32-byte output, 32-byte salt,
  and `maxmem=268435456`. Readers validate the version and every parameter and
  never silently weaken them.
- Frame nonces are a random four-byte prefix plus a monotonic unsigned 64-bit
  index. AAD binds the canonical header digest, index, final flag and declared
  plaintext length.
- Exact frame ordering, one final frame, trailer count and end-of-file are
  required. Wrong keys, mutation, truncation, reorder and splice fail closed.
- Newer/unknown container, cipher, framing, KDF or schema versions fail closed.
- Existing version-1 ZIP archives remain readable, explicitly labelled
  unencrypted and immutable; the operator finalization route creates v2.

Here, **no plaintext residue** means no application-addressable creation
staging, verification scratch or archive-review session file remains after the
applicable success, failure, cancellation, close or startup cleanup reports
success. A failed sweep remains explicit and retryable rather than being
represented as clean. An open Review session necessarily contains a visible,
permission-restricted temporary plaintext working copy. This is not a claim of forensic SSD secure erasure.
JavaScript string erasure is not claimed either; secrets are bounded, excluded
from logs/diagnostics and cleared at the earliest ownership boundary, while
worker-owned buffers/keys are overwritten where Node permits.

## Implementation boundaries

- `electron/archive-crypto.cjs`: KDF/slot, nonce/AAD and single-frame crypto.
- `electron/archive-container.cjs`: canonical streaming `SARARCH2` framing and
  logical-entry encoding.
- `electron/archive-inventory.cjs`: schema-v13 declaration, drift gate and
  deterministic table content proof.
- `electron/mission-archive-worker.cjs` and runner: pinned mission-only
  extraction, scratch construction, attachment proof and streaming create.
- `electron/archive-verify-worker.cjs` and runner: independent sealed-file
  restore and exhaustive verification.
- archive custody journal/operation/reconciliation modules: durable filesystem
  intent, exact publish/identity, restart recovery and conflict blocking.
- archive Review modules: permission-restricted read-only sessions, bounded
  projection workers, attachment opening and startup/close sweeps.
- cleanup coordinator/credential worker: current eligibility, a fresh unwrap
  using the archive's existing passphrase or recovery slot, exact custody re-
  witness, bounded transactions and durable cursor resume.
- `electron/mission-store.cjs`: schema v13, PR5 fence/epoch preservation,
  registry/supplement/finalization and cleanup state machines.
- main/preload and renderer adapters: closed bounded envelopes; no renderer
  direct database/filesystem access.

## Strict-TDD and deterministic proof

Every behavior checkpoint began with a failing test. Red tests and rejected
review heads were not counted as proof. The superseded pre-remediation
candidate passed the following local gates; these results are historical and
must not be presented as exact-final-head proof:

| Gate | Historical superseded-candidate result |
| --- | --- |
| Full unit/integration | `354` files / `3,360` tests passed on the identical staged candidate tree before commit |
| ESLint | passed |
| TypeScript project build | `npx tsc -b --pretty false` passed |
| Staged whitespace/merge-marker/secret candidate scan | passed; no generated evidence or unstaged file committed |
| Frozen-candidate sealed-retry regression bundle | `7` files / `127` tests passed; fresh independent focused review clean |
| PR6 qualification validator | `14/14` focused tests passed; semantic no-progress and monitor-ownership audit clean |
| Legacy archive registry | `22/22` focused tests passed; independent C5 audit clean |
| Packaged lifecycle helper/workflow contracts | `70/70` focused tests passed; fresh independent pagination audit clean |
| Physical-process kill helper | `19/19` adversarial tests passed |

After the Ubuntu field-harness P2, the qualification code/test tree passed the
red-first qualifier script/library bundle `68/68`, targeted ESLint, TypeScript
and diff checks. The preceding f111 code head passed the local serial full
deterministic gate at `359` files / `3,416` tests, with lint, TypeScript, Node
syntax and `git diff --check` green. The 3885 head added the queue-time,
bounded-shutdown and exit-fault red-first qualification checks. The current
6613 head adds deferred cleanup boundaries, finite retry of transient
`SQLITE_BUSY*` conflicts and a 500-position default page, with a six-second
concurrent-WAL-writer regression. Its full local serial result is recorded in
the candidate section below. Every final claim is re-bound after the
documentation commit.

| Physical-process gate | Result |
| --- | --- |
| Physical-process phase matrix before freeze | `32/32`, zero failures; honestly `matrix_pass_unbound` because the implementation tree was dirty while being assembled |
| Superseded-head physical-process phase matrix | `32/32`, zero failures; `qualified` on `618f9c8b…` / `87aea926…`; report SHA-256 `84ee328c526ada367bbb4a574a88ddc3445d7aba151b4ea782dd00744f86d92e`; retained as prior-head harness evidence only |
| Frozen-candidate physical-process phase matrix | `32/32`, all requested `SIGKILL`s observed; `qualified` on `3b148e532…` / `4be6f73…`; report SHA-256 `a50f0d1f3b48f591075b77ec9fc234be6ea9b52b8f4a4704d7ac0c685b0538a7` |
| Pre-commit candidate integrity audit | clean after a schema-v13 PR5-fixture compatibility P2 was fixed red-first |

The pre-freeze kill report is support for the harness, not final exact-head
qualification. Its final independent affected recheck found no P1/P2 after the
following forged-proof attacks were closed:

- cleanup row claims contradicting the observed 49-table inventory;
- fabricated, duplicate or incomplete schema/cleanup declarations;
- hidden unregistered `.sararch` bytes;
- runtime omitted from the report digest;
- report creation after the final repository capture;
- lexical report paths whose physical parent aliases the repository or the
  disposable work root.

## Required adversarial coverage

| Attack/failure | Durable coverage |
| --- | --- |
| Wrong passphrase and wrong recovery code | crypto slot vectors; verifier, Review and cleanup wrong-key integration |
| Bit flip, truncated frame boundaries, reorder, duplicate and splice | container known-answer/adversarial suite and verifier attacks |
| Wrong mission, archive request or finalization epoch | authenticated header/manifest and store/registry fence attacks |
| Disk full during create/verify/restore | worker failure injection; live mission and sealed archive state assertions |
| `SIGKILL` at every create/verify/restore/cleanup phase | real child processes plus parent-owned restart inspection and residue/custody checks |
| Undeclared, fabricated, duplicate or missing tables | schema inventory drift gate and qualification/kill-report forgery attacks |
| Restored row or attachment mutation | exhaustive table/entry/attachment digest attacks |
| Registry/disk mismatch, hidden orphan or same-size substitution | pinned file identity, whole-file digest and startup reconciliation attacks |
| Every cleanup precondition withheld | eligibility matrix; wrong key; active work/Review; stale epoch; custody mismatch; newer supplement; evidence health |
| Archive-review mutation | source facade has no mutation API; preload denial and browser/packaged attempts |
| Superseded-epoch recovery | supplement/finalization/registry restart attacks |
| Newer container/schema | closed parser and timeline availability failures |
| Wrong-typed or hostile 64 MiB renderer inputs | preload normalization rejects before IPC/main work and retains current-position priority |
| Concurrent live ingest/current reads | pinned extraction and per-phase liveness tests; exact host proof below |
| Plaintext and secret/privacy residue | three application-owned roots, exact secret scan, diagnostics/support/incident sanitizer tests |

## Browser and visual proof

On superseded clean candidate `618f9c8b…`, the full visual DOM suite passed `61/61`
and generated 73 registered frames. A fresh uncached Opus review passed all
`73/73` frames with zero fail/error at the critical gate. The isolated
canonical report SHA-256 is
`623b474d99fa7c798bf13a750b14e41a91c6640e2b1400330423abfed6af876f`.
An independent audit matched all 73 entry/PNG/result triads and every aggregate
result to its manifest identity. Its canonical manifest uses bytewise-sorted
root-relative POSIX paths and lines of `<file SHA-256><two spaces><path><LF>`;
the resulting 220-file tree digest is
`535375257255f8347f3f9f71571975f22edd2b2af7d9c960ff564830b2f48f03`.
An earlier undocumented producer aggregate was discarded because it could not
be reproduced from the unchanged tree.
A separate exact-head root repeat also passed `73/73` (report SHA-256
`4249cc23d80d4bff927a7abf6c031337ac22acd9a5913dd754522627707697cc`).
This covers the rendered operator surface, including encrypted custody,
read-only Review and its temporary-residual warning, the complete cleanup
checklist, retained archived timeline, and visible search-evidence read-only
state. It does not by itself prove desktop persistence or cryptography.

The targeted archive operator flow passed `2/2`; that head's full Chromium
suite passed `171/171`. These artifacts remain prior-head evidence only because
the subsequent retry P2 changed operator archive behavior.

On exact frozen candidate `3b148e532…` / `4be6f73…`, the full Chromium suite
passed `172/172`; the visual DOM suite passed `62/62` and produced 74 manifest
entries. A fresh Opus review passed `74/74` with zero failure/error at the
critical gate. Its aggregate report SHA-256 is
`6687d06328bddc6c019bfff3427e9f78447357bb090d72ee6d5eb04dc59efbae`.
An independent read-only audit recomputed every screenshot cache key, matched
all 74 unique manifests/PNGs/individual results to the aggregate and confirmed
the preserved/source trees are byte-identical. The complete visual-evidence
tree digest is
`8c9267d6a89271e748a6fcb635e1e5dc427c6c729eee3087c5078d4d63b9eaeb`;
the screenshot-set digest is
`9eb114bbb0719510a7f5421f86c6df20b18a311cedb4770367049ddda6a06277`.
Four exact synthetic browser-validation frames from that set are retained in
the operator manual. Their SHA-256 values are
`3985eae4d05f65bc9ac213c3026ac52c4ba666e6fdc8992a1cee42f3fca92f9d`
(one-time test recovery code),
`e8297ed026f7d9ba45b5f2780d2a6bb94708ddfa5e48fda66238ad87d128f693`
(sealed verification retry),
`425c3f4cb85c477d661d1dd2370dcaf6d76f45426e2864e9c61297f54d9f7fa0`
(read-only Review warning), and
`55e5095c0a3664381c94ff01b33f04a8a9f74ee8fc294c2c853125afd3c6f6ca`
(cleanup checklist). They are UI examples, not desktop cryptographic or field
proof; the displayed recovery code is synthetic test data.
The visual run overwrote Playwright's single `.last-run`, so the retained
filesystem independently proves the `62/62` visual run and exact Chromium
suite inventory (`172` tests in 30 files), while the original closed execution
transcript is the retained evidence that all `172/172` Chromium tests passed.

## Local macOS arm64 package proof

An unsigned macOS arm64 package built from superseded clean candidate `618f9c8b…`
after TypeScript, Vite, bundle-budget and native-rebuild gates. The packaged
`app.asar` SHA-256 is
`185d3dd8d1e01d525d9c8e8f95ef02f7afdfc355433d43dd6d3ffd73739b7ba3`;
the executable SHA-256 is
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`.
This is package qualification, not a signed or published release.
The disposable package was swept after qualification, so the two binary hashes
are producer-recorded in the closed lifecycle report; the later evidence audit
rehashed the preserved reports and visual tree, not removed transient binaries.

The packaged lifecycle CI wrapper passed with report SHA-256
`dfdfe6ec85fa5a3be5d673417c4a37cb456ac68ead40fb87a3fccd16ff86694d`.
The report binds the expected/before/after head and tree, clean worktree and
visible packaged build identity. Both launches exited under observation. It
proved v2 create plus independent verify; `4,096` Replay tracks, `202` objects
and `101` outing-filter choices on both complete Review reads; identical
pre/post-cleanup semantic digest
`87c9a81de9239b87f1d482c7e80653278d63aa78a27a436ebf5b26159e4d6620`;
preload mutation denial and audit; a real decrypt-phase `SIGKILL` after material
plaintext was observed; restart sweep from two residual entries to zero; cleanup
after a fresh check of an original archive credential, moving 5,517 rows with
zero live breadcrumb rows left; zero exact-secret matches across 57 scanned
files; and zero final plaintext residue entries. The legacy Rust backend passed
58 tests with its one intentional
keychain test ignored.

A fresh read-only audit of those preserved local, visual and kill artifacts found
no P1/P2 proof-integrity issue. It independently rehashed the copied reports,
recomputed the kill structural digest, round-tripped its closed report builder,
and checked all 49-table facts in every one of the 32 canonical phase records.

This package is prior-head evidence only.

The exact frozen candidate then built and packaged successfully as an unsigned
macOS arm64 Electron application with bundle budgets enforced. Its `app.asar`
SHA-256 is
`4ea85d02d1a776c127e8c720ba5e9ccdb0844bd01b042a0e99fcdab703ae9b0a`
and its Electron executable SHA-256 is
`f5212ea9181df95040385dfd04f512e983ed95394a96fb7c4b8ee838ea433caf`.
The exact package lifecycle report passed and has SHA-256
`566e040dfed157e6b17daaaeb4d11725aba0e99b237e1c082aa3ddf6c5df6389`.
It binds a clean/stable exact head/tree and two observed launches; v2 create and
independent verify; `4,096` Replay tracks, `202` objects and `101` outing-filter
choices before and after cleanup; identical content digest
`d5d357a0a1fe6dfda1fd8c29638418160a1ce56ff1bbb9f8b7558333e5b5fdd5`;
read-only mutation denial plus audit; a real decrypt-phase `SIGKILL`; restart
sweep from two residual entries to zero; credential-gated cleanup moving
`5,517` rows with zero live breadcrumb rows left; zero exact-secret matches in
57 scanned files; and zero terminal plaintext-residue entries.

The exact physical-process kill matrix passed all `32/32` canonical create,
verify, restore and cleanup cases, with all 32 requested `SIGKILL`s observed.
Its report SHA-256 is
`a50f0d1f3b48f591075b77ec9fc234be6ea9b52b8f4a4704d7ac0c685b0538a7`
and its closed structural digest is
`3b081d614dfecf8554f58ad94e065638841041c1600c81934594f34723e99b48`.
Repository identity stayed clean/stable and terminal residue/secret counts were
zero. Local qualification validators passed `156/156`; the legacy Rust backend
passed 58 tests with its one intentional real-keychain test ignored.

The producer's first package invocation used a 12-character build tag and was
correctly rejected by exact-head binding. It rebuilt with the workflow's full
`EXPECTED_SOURCE_SHA`; no rejected artifact is counted above. A fresh
independent read-only audit was clean: it rebuilt the kill report byte-for-byte,
proved all 32 canonical phases/49-table inventories, matched all 129 packaged
`electron/`/`shared/` sources and 58 generated `dist/` files to the checkout,
and confirmed the rejected directory was empty. Its full `.app` tree digest is
`722d20500d1b07b68cede82a164bf5d1107c21bafb957c4e812e099d6be7b876`.
This is an unsigned unpacked validation bundle, not signing/notarisation or
distribution proof. Disposable profiles/ciphertext were intentionally swept,
so their retained proof is the closed report plus source-retraced scan path,
not post-hoc access to removed plaintext.

## Exact-head Linux workflow

Workflow-dispatch run
[`33324463800`](https://github.com/donal0c/sartracker-web/actions/runs/33324463800)
was dispatched on branch `codex/breadcrumb-pr6-archive-lifecycle` with
`head_sha=60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95`, then intentionally cancelled
after the packaged-smoke P2 invalidated that head. It had reached only source
binding, dependency installation and lint; package/lifecycle proof had not run.
It is not accepted evidence. First replacement workflow-dispatch run
[`33324881333`](https://github.com/donal0c/sartracker-web/actions/runs/33324881333)
was bound to `d60059d9267d4391ffeaa158ae0adec1dad57a2a` and tree
`1e92fd45d701bbcc57a53a2d86ce5031b1879467`, then cancelled during the full
unit gate after the second smoke P2 invalidated that head; no package work had
started. Final replacement workflow-dispatch run
[`33325220201`](https://github.com/donal0c/sartracker-web/actions/runs/33325220201)
is bound to `e975ff1c64f914d582efe2aedb09d29f4df19ca2` and tree
`1b01df864dbe3299bd05279524fdb926332fc8ae`, then was intentionally
cancelled during deterministic units when the local packaged harness invalidated
that head. Package and lifecycle work had not started. It is not accepted
evidence.

Earlier-candidate workflow-dispatch run
[`33327665270`](https://github.com/donal0c/sartracker-web/actions/runs/33327665270)
was dispatched from branch `codex/breadcrumb-pr6-archive-lifecycle` at exact
head `136000ff4b4489e5ff5c57fd10e1a7bda658a2e7` and tree
`8a0b30c9fb3e2b81a72e5f76fbf60bcc69293e65`.

That prior-head run failed in its serialized unit gate with six correlated
timing/load signatures and no value or state mismatch, then was cancelled after
the visual P2 invalidated the head. It is not accepted proof. Superseded-
candidate workflow-dispatch run
[`33328312924`](https://github.com/donal0c/sartracker-web/actions/runs/33328312924)
completed green on attempt 1 in 17m38s. Downloaded source-binding SHA-256
`460925a78c166b177d0ee2b27d7e1711f9bf344fa9a1cfc28a903b9dbfd73b46`
records exact head `618f9c8b7f3c818aab25787c926b1394d2282297`, tree
`87aea9263d5634e76608cd8096a7b3996741b2ca` and `dirty=false`.

All workflow gates passed: lint; `353` files / `3,340` tests; production
web build and bundle budgets; AppImage and `.deb` packaging; clean source-tree
restore; PR5 960k Replay qualification (42 ms maximum event-loop delay and
1.95/2.16 ms live reads); x86-64 native `better-sqlite3`; Mesa llvmpipe;
tracking soak (`6/6`, `8,664/8,664`, 26.7 ms main maximum); packaged PR6
lifecycle; AppImage launch/graceful close; and both artifact uploads.

The downloaded AppImage is 152,326,996 bytes with SHA-256
`b7a2ae9340c558560a19bce37bc6b9a9e6fd92866f862022a7d521ce34bf2512`;
the `.deb` is 102,180,654 bytes with SHA-256
`71967259f959716966f8e209a88dd4f92ed740fa80019fc33c7c8be6d6063140`.
Both match the uploaded `SHA256SUMS`. The package ZIP API digest is
`sha256:f19cec4a179eb03669bb0ed77f3159be28a013bbcae7804066eed96379684113`;
the evidence ZIP digest is
`sha256:9674cf00296d149dffbb3fc7afa27670b50f0e2958f1b4b7ee1398d5288b1bfa`.
Downloaded report SHA-256 values are
`259b4f650be57fa5095538ab27fbf128782786b16ab04a797450350ff981a39a`
(960k),
`d256ac604a3499389e8a98915d901d17e69ceec158ec1c13a7b0c150b1fee25f`
(tracking) and
`c4f21d06630303897f98a3fee659fd766a09a520b04ac25a91196595dec925aa`
(packaged lifecycle).
The lifecycle report repeats v2 verification, identical pre/post-cleanup
read-only content, mutation denial/audit, real restore SIGKILL with zero restart
residue, 5,517-row cleanup to zero live breadcrumbs, zero exact-secret matches
across 66 files and zero terminal plaintext residue. The only workflow annotation
is GitHub's generic Node-action deprecation notice; no safety gate was failed,
skipped or neutralized. This is CI/package proof, not release or publication.

The sealed-verification retry P2 invalidated that head as final evidence.

Current frozen-candidate run
[`33331382152`](https://github.com/donal0c/sartracker-web/actions/runs/33331382152)
was dispatched only after the remote branch resolved to exact head
`3b148e532bd5a98b3d2fa24466fc8501a111efdd`. Attempt 1 completed green in
15m12s; downloaded source binding SHA-256
`28d9cd7af066f0caaa78cc786dc78c60ec5f3db69aa38a00fae060ba839c8bfe`
records the same head, tree `4be6f73d00de9cf9a4315c133ddfe51295c3e344`
and `dirty=false`.

Every workflow gate passed: lint; `354` files / `3,360` tests; production build
and bundle budgets; Linux packages and x86-64 native `better-sqlite3`; Mesa
llvmpipe; tracking soak; packaged archive lifecycle; AppImage visible-window
launch and graceful close; and both artifact uploads. The 765,808,640-byte
normal-envelope Replay fixture contained 960,000 positions and projected
1,012,902 total tracks; seek was 178.56 ms, a late page 127.7 ms, live reads
1.17/1.95 ms and maximum event-loop delay 75.26 ms, with restart first-page
equality. This is not the separate >2 GiB proof. Tracking stored exactly
8,664/8,664 positions with SQLite integrity `ok`, zero redundant-telemetry
slope, zero renderer crashes/heartbeat errors and a 110.842 ms main-process
maximum against the 200 ms threshold.

The packaged lifecycle repeated exact v2 create/verify, immutable read-only
Review before and after cleanup, mutation denial/audit, decrypt-phase
`SIGKILL` plus restart sweep to zero, credential-gated 5,517-row cleanup to
zero live breadcrumbs, zero secret matches in 65 files and zero final plaintext
residue. Downloaded report SHA-256 values are
`3c4621490f0e0b45c4eff3d548fccc7b1f42dee9dc6efe9acddd64c9c74ab64d`
(Replay),
`752dc081f9ac511195d96d8d34f08fdd330162c330955e59a8ed044df8fc5951`
(tracking) and
`c8feaa5125752d84a0ac9feae9b22f487d20cde8aa780431169148e33c0d1567`
(archive lifecycle).

The 152,331,453-byte AppImage SHA-256 is
`418f577f5bf9700add62271b40095666df2c79de27e063b8de9399fad17fb88c`;
the 102,165,994-byte `.deb` SHA-256 is
`aae7bced9f1a808a8b69e07024a900540326e3c3dc32c121a1dc3ea77e414cfa`.
Downloaded artifact ZIP bytes exactly match the GitHub API digests:
`sha256:2460446a057cfabb52a7592ed8a86b7061e976bef6644004b5081e631bc1a29d`
for validation evidence and
`sha256:1d2121a907d2dd6ae758f3c7fbe75b05ed002c28e128f9f6b5345844bea6e877`
for packages. GitHub's only workflow warning says v4 actions were forced from
deprecated Node 20 to Node 24; no gate failed, skipped or neutralized. This is
exact-candidate CI/package evidence, not release or publication.

A fresh independent artifact audit returned no substantiated P1/P2. It
independently downloaded both ZIPs and matched their GitHub-recorded digests,
confirmed the package source binding and full candidate build tag, identified
the bundled `better_sqlite3.node` as Linux x86-64 ELF, revalidated the lifecycle
report and recomputed the tracking verdict from raw fields. Embedded executable,
`app.asar` and `better_sqlite3.node` SHA-256 values are respectively
`6344ae1d9044fedc54779e8bacaddc032fdcc0f55e146fc3623756eafa0bbaf8`,
`dc7bf0a0f828c3265bdde6b632143303cfb33fbad73ec100669288f7466ae6a4`
and `c6dd5b3806e9fdc0e48e5ac18e0f7fac1db4b265f6a010afd275983efac159cd`.
The audit classified the forced action-runtime Node 24 annotation as advisory
and proof-neutral: application commands still ran under Node 22.23.2. Visible
AppImage execution remains workflow/screenshot evidence; it was not rerun on
the auditing Mac.

## Ubuntu greater-than-2 GiB reference-host proof

The runner rejected the 3.704 GB `field-v2` source because it had a non-empty
SQLite `-shm` sidecar. That is a correct closed-fixture failure, not a proof
failure or a reason to weaken the gate. The isolated run instead uses the
synthetic closed `mission-14d-v2` fixture: `3,514,122,240` bytes, source
SHA-256 `1d4890aa…22d00`, regular file with link count one and no sidecars. The
source is schema v4, so it is not passed proof input by itself. The exact-head
run first derives and closes a schema-v12 copy under the exact PR5 base, proves
that derived fixture's integrity and absence of sidecars, and only then gives a
second disposable copy to the PR6 qualifier. Host RAM, disk and load must be
reconfirmed immediately before the expensive proof; older availability figures
are not passed proof.

The prior-head run on `60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95`
failed safely before archive creation after the qualifier's fixed 30-minute
total maintenance deadline expired. Schema-v13 background reconstruction was
still making progress over the fixture's 9,717,159 captured legacy mission
events; the source fixture remained byte- and inode-identical, no JSON proof
was written and the disposable profile was swept. This is not passed scale
proof. It exposed a harness-only defect: a fixed total wall clock is wrong for
finite, durable forward progress, and the migration heartbeat interval was not
owned by failure cleanup. Red-first remediation replaces it with a fixed
lack-of-durable-cursor-progress watchdog while preserving immediate failure
markers and every 200 ms/RSS/completeness gate, and makes monitor shutdown
idempotent and failure-owned. Central retrace then found and fixed the separate
product C5 synchronous-scan defect described above. Frozen-candidate scale
qualification remains required. A later base/docs-only final descendant may
carry that proof only with explicit blob-by-blob PR6 implementation/harness
equivalence and proportionate final-head rechecks; any such input change
requires a rerun.

The first production attempt from exact implementation candidate `3b148e532…`
failed closed before archive creation or evidence write. The qualifier's real
maintenance reader correctly derived `archiveProgress.pending`, but its settled
predicate referenced an undeclared `legacyArchivePending`, causing a
`ReferenceError`. The input fixture, original source, repository and SQLite
sidecar/inode state stayed unchanged. A real settled schema-v13 SQLite
execution regression reproduced the exact failure red-first; the one-line fix
uses `archiveProgress.pending === 0`. Qualification script/library tests passed
`68/68`, with targeted ESLint, TypeScript and diff checks green, before commit
and push at exact qualification head
`53164028f72254c4e17fcc0b4b845f7601fee153`. A fresh independent focused review
of that exact head found no P1/P2 and confirmed the real reader path, exact
value use and unchanged fail-closed bounds. A fresh preflight on that clean
pushed head revalidated repository identity, source/derived/qualifier hashes,
distinct inodes, absent sidecars, available RAM/disk and host load before the
unchanged production command was relaunched. The failed attempt is not proof.

The subsequent exact `646ce768…` attempt completed the 4.16 GB copy, produced a
`5,243,848,930`-byte streamed archive and entered independent verification, but
the qualification-only durable-ingest worker exhausted its finite SQLite-busy
retry while lifecycle cleanup was active. It failed closed with
`SQLITE_BUSY`; no qualification JSON was emitted and the disposable profile was
swept. Its bounded receipt recorded `121,865` queued writes, `121,808`
acknowledged, `57` rejected, `62` busy retries, and a maximum durable latency of
`18,199.53 ms`; archive verification had completed and cleanup teardown was
incomplete. The receipt is diagnostic evidence, not qualification proof. The
new red-first regression holds a writer lock for six seconds and proves that a
cleanup boundary retries safely; the implementation now uses deferred
read-then-write pages, finite `SQLITE_BUSY*` boundary retries and 500-position
pages. The focused bundle is green on `66130569…`; the controlled >2 GiB rerun
is still pending.

## Candidate proof wave (2026-09-02)

This historical code head was `661305694d43682a6e4aa0e0fafeeb962affc7ea` / tree
`0854dfd72b0b1c04c3e6fda0827ca9761060c6f5`. It includes the qualification-only
durable-ingest worker, worker-exit safe shutdown, crypto buffer cleanup, the
correction-predecessor reconciliation/pinning/single-flight fixes, the
red-first liveness-lane remediation, and the cleanup/live-ingest contention
fix. The qualifier measures a pure
main-event-loop heartbeat and in-memory current-position publication separately
from worker-thread durable ingest, records durable latency/contention, verifies
the latest-position projection after settlement, and enforces a bounded
120-second durable settlement deadline. The 200 ms heartbeat/current gates,
full-sync pragmas, zero-loss requirements and current-position priority are
unchanged. The local archive/lifecycle/qualification regression bundle is
`71/71`; the exact local serial deterministic gate is `359/3,431` tests.
ESLint, TypeScript, Node syntax and `git diff --check` were green. This wave is
superseded and supplies no current-candidate proof.

The prior local browser and visual gates are bound to 3885, not this candidate:
Chromium `172/172`, visual Playwright `62/62`, and uncached visual review
`74 pass / 0 fail / 0 error` (report SHA-256
`9ef14c76e60dd68c626d2a9d5ed8785c1927503434868889367de092371e8581`). They
are historical prior-head evidence and cannot be carried forward through this
recovery; exact-candidate reruns are required. They are not production or field
proof.

The exact-head unsigned macOS arm64 package/lifecycle smoke was rerun from a
clean 3885 checkout. It passed source clean before/after, full packaged
build-head binding, Archive Review/Replay, interrupted-restore startup sweep,
credential-gated cleanup and zero plaintext or secret residue. The report binds
head `3885e6f24159a4aef18fad3f1172bea76db26c03` / tree
`85c773fba7751c836d5565474260cc529eb8b9d4`; its SHA-256 is
`5a9d22a5c4d20b05efe1fc61f3df2bfa5f358d484bf1d1ba2dd7c8e5464b0200`.
The smoke seeded `4,096` tracks, `202` replay objects and `101` outing choices,
verified both pre/post-cleanup Replay parity, denied a mutation with durable
audit, swept a decrypt-phase SIGKILL restore residual on restart, and ended
with zero exact-secret matches and zero plaintext residue. This is unsigned
package proof, not release or publication.

The real 32-case physical SIGKILL matrix also passed on the clean 3885 checkout:
verdict `qualified`, all `32` cases, protocol self-test `false`, source clean
and stable at the same head/tree. Report SHA-256 is
`f9698e24c194fc1637e79072237e0b6ca3182129c194f0df21a8119a82bae460`.

The prior GitHub Electron Linux workflow run
[`33509882673`](https://github.com/donal0c/sartracker-web/actions/runs/33509882673)
passed every gate against the preceding a913 code head: `359/3,416` deterministic
tests, production build/budgets, Linux packages/native SQLite, 960k Replay,
Mesa llvmpipe attestation, tracking soak, packaged archive lifecycle and
AppImage launch/close. The source binding records head
`a9134e3b3643060caacd357f3ef8405040bb989f`, tree
`931181203ea1b41c4330b7b9a0317c67ee7eaa1a` and `dirty=false`; its SHA-256 is
`4b0aa72d32f81f509da35e4af43d1d3fa26e7967cde1dd9f24f01bd96acbf792`.
Downloaded exact reports are `bcp-960k.json` SHA-256
`c5c541ad9a7e6b0e236a7c00a5746d92c8f2841db5b2b998c8166297cc7b6129`, tracking
soak SHA-256 `e3d0f3e9cc75a71bf84ba935564b0cf1cf51ed75002316a5531e437bd04af1b3`,
packaged lifecycle SHA-256
`750576337c5ebd8b80201aba91cd3fd04261a3d7d0d5dce48f7a36cd5a8e3270`, and
`SHA256SUMS` SHA-256
`b0b0568d7a33c1b3c04ddd228a9978d5b654de48341128f0e735160db6a426d0`.
The normal-envelope fixture contained 960,000 positions; replay seek was
`232.54 ms`, late-page seek `159.78 ms`, and the packaged tracking soak stored
exactly `8,664/8,664` positions with SQLite integrity `ok`. The AppImage is
`153,090,019` bytes (`2ef57f20129894762ca4a2a2d377e941b11a4cfc9b3dbb81dbd19c9c8e33517d`)
and the `.deb` is `102,919,648` bytes
(`ecc09db98a6496cc330460a72a76cb1ff037c65738f66eb6366d8e3c1143e55e`). The
packaged lifecycle independently verified `4,096` tracks, `202` objects,
`101` outing choices, credential-gated cleanup of `5,517` rows to zero live
breadcrumbs, zero secret matches across 65 files and zero terminal plaintext
residue. This is historical prior-head CI/package proof, not current-candidate,
release, or publication proof.

The superseded code-head GitHub Electron Linux workflow
[`33552060716`](https://github.com/donal0c/sartracker-web/actions/runs/33552060716)
also passed every step against `3885e6f24159a4aef18fad3f1172bea76db26c03` /
tree `85c773fba7751c836d5565474260cc529eb8b9d4`, with clean source binding.
The normal-envelope Replay fixture contained `960,000` positions; its total
track count was `1,012,851`, first-page seek `207.34 ms`, late-page seek
`166.95 ms`, and the 200 ms event-loop gate passed at `59.47 ms`. The packaged
tracking soak stored exactly `8,664/8,664` positions with SQLite integrity
`ok`; the packaged archive lifecycle independently verified `4,096` tracks,
`202` objects, `101` outing choices, cleanup of `5,517` rows, decrypt-phase
SIGKILL restart sweep and zero terminal plaintext residue. The exact downloaded
report hashes are source binding `7e08367ff2e5186220ae2c3daef9248efce21f9d4b94aa457ef2c0292e4a7113`,
`SHA256SUMS` `8058c1df75ddd96bc73545729bef23ce71e830f02cb5747e2acfea648172d8f7`,
normal-envelope `66bb5905ea1ef81fc85771ad695107cda7342157bdf615aca4408d32b2cf2ee5`,
tracking soak `bac7067dd8aff03d668ac18e49fb97acdf7fe4e6a11bdb9f81f212fda78f7c0a`,
and packaged lifecycle `a64281ce06e0255a3976543ed3ffda13a5af24b1d59340762a4a9f22de458229`.
This is historical prior-head CI/package evidence. The recovery changes its
inputs, so the final candidate requires a fresh exact-head workflow run.

### 2026-09-04 rejected caf9 run and recovery proof contract

The exact `caf9e5e…` reference-host attempt is a failed diagnostic. It created
and independently verified a `5,243,848,931`-byte encrypted archive, but its
bounded failure receipt ended `UNCLASSIFIED_INTERNAL_FAILURE` at
`teardown:incomplete`. The disposable profile was removed. The apparent
teardown failure came from spreading roughly 200,000 samples into `Math.max`,
but removing that harness defect cannot turn the run into a pass: create,
restore, cleanup, and durable-write measurements separately exceeded the
strict 200 ms gate. The written recovery hypothesis attributes those stalls to
roughly 9.7 million retained telemetry audit rows and repeated finalization /
acknowledgement history scans. Only one new controlled field run is permitted
after the cheap prerequisites; the caf9 receipt is never qualification proof.

The replacement liveness contract uses a loopback synthetic Traccar server that
emits unique source-position IDs with canonical timestamps. The packaged Linux
Electron path carries each fix through Traccar HTTP, the main/preload boundary,
React tracking state, and the real MapLibre tracking source. A watchdog outside
the app correlates the exact IDs and timestamps and checks phase/operation start
to first fix, consecutive fixes, operation and phase tails, request-to-renderer,
source-to-renderer, main-inspector, and renderer-frame gaps across create,
verify, restore, and cleanup. Every value must be strictly less than 200 ms;
`200` fails. The 50 ms poll is time-compressed validation, not production
cadence. Source and renderer ledgers are bounded, and any overflow fails closed.

The pending raw packaged-report SHA-256 and canonical-evidence SHA-256 must be
recorded distinctly, pinned, and bound to exact source head/tree and packaged
build. The separate greater-than-2-GiB qualifier measures Node/SQLite scale
contention; it must not be described as packaged renderer proof. Both exact-head
receipts are required as complementary evidence. Even if they pass, they do not
prove live Traccar, the original field machine, production, or a packaged
renderer running the multi-GiB workload itself.

## Independent review gate

All code, tests, documentation and proof claims freeze on one immutable final
head before review. Recording a verdict in this file afterward would create a
new unreviewed head, so the exact SHA/tree, four verdicts, central source
retrace and any remediation/rechecks must be recorded externally in the
[PR #10 exact-head ledger](https://github.com/donal0c/sartracker-web/pull/10)
and the three Linear issues. PR #10 must remain draft until every required row
is clean; a later repository mutation invalidates that ledger and requires the
affected review procedure again.

| Independent charter | Required immutable verdict record |
| --- | --- |
| Broad life-safety / end-to-end | PR #10 exact-head ledger and Linear |
| Persistence / completeness | PR #10 exact-head ledger and Linear |
| Concurrency / finalization / liveness | PR #10 exact-head ledger and Linear |
| Renderer / input containment / operator surface | PR #10 exact-head ledger and Linear |

Remediation rechecks are conditional follow-up evidence, not a fifth charter.
If a final-head finding is accepted, its fresh broad and affected focused
rechecks must also be recorded in the PR #10 and Linear ledger before closeout.

No task agent self-approves. Every finding is centrally source-retraced. P1/P2
blocks completion. Tests or CI cannot overrule a confirmed finding.

The sustained-contention remediation received a focused independent persistence
audit on exact code head `a9134e3b…` / tree `93118120…`: CLEAN, with no P1/P2/P3.
The auditor confirmed worker-local retry isolation, transaction rollback before
retry, main-thread publication ordering and exact durable-write draining. This
is remediation evidence only; the full four-charter ledger is still required
on the final documentation head.

## Evidence tiers and deferred work

- Deterministic unit/integration proof covers controlled code paths and attacks.
- Browser/visual proof covers the synthetic operator surface, not desktop
  persistence or real cryptographic custody.
- Packaged proof covers the built Electron bundle on the named host/platform.
- Reference-host proof covers one synthetic >2 GiB workload on one Ubuntu
  machine, not all hardware or production incidents.
- GitHub Linux workflow covers its exact CI runner/artifacts, not publication.
- Physical SQLite compaction is not part of PR #10. Logical cleanup may leave
  the file size unchanged while SQLite reuses freed pages. Safe oversized-store
  recovery, physical compaction, standing retention, and measured index work
  remain explicitly deferred to `DON-250` / `DON-251`; no in-process multi-GB
  `VACUUM` is authorized.

BCP-17/final release qualification, live Traccar, the original field machine,
multi-machine custody, the team tabletop, installer fleet coverage, release,
publication and field acceptance remain outside PR6. `DON-249`, `DON-250`,
`DON-251` and `DON-254` remain separate. No tag, release, merge, publication or
SAR-team contact occurred in this task.
