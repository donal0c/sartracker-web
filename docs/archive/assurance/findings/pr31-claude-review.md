# PR31 Claude review disposition — DON-254

The user-supplied [review](../../evidence/pr31-review/claude-review.txt) supersedes
the earlier READY judgment. Remediation begins at `ce265677`, rebased on merged
PR30/master `58c65641`. Earlier CI34834365325 and CI34845492157 remain historical
green runs; neither closes the newly confirmed findings. No merge or release.

## Safety contract

A coverage manifest is an exact worker snapshot with revision-bound summaries,
not a promise that live ingest stopped. Ordinary accepted fixes may advance the
ledger while it loads. Existing revision authorization and a current database
claim still decide completeness. Structural inventory changes must not publish
obsolete keys or cache obsolete manifest evidence. No position scans move to the
main thread; no completeness, timing, coordinate or persistence gate is relaxed.

Cancellation must reach every owned operation and retain physical SQLite worker
ownership. A failure to exit must become a bounded, visible error, not a false
clean shutdown. Diagnostic bytes must be decoded, assembled, sanitized and fully
drained before a terminal passing receipt is written.

## Findings and dispositions

| Review finding | Disposition and evidence |
| --- | --- |
| Global sequence fence rejects normal tracking | Confirmed. Replaced the test that enshrined failure with live-fix and continuous-ingest controls. Removed the global throw; existing ledger `snapshotMoved` handling leaves unbuilt chunks pending. Manifests retain their exact snapshot revisions; current claims prevent false Complete. |
| Lifecycle fanout stops after one throw | Confirmed by a synthetic EventEmitter reproduction. Callback failures are isolated and reported with bounded sanitized diagnostics. Sibling cancellations continue; rejected callback promises are also observed. |
| Worker-local cardinality guard unprotected | Confirmed test gap, not an invalid original reproduction. New tests inspect raw messages from the actual worker with controlled oversized query outputs, bypassing all parent normalizers. Removing the local guard fails three controls. Moving limits outside the transaction fails the separate WAL snapshot control. |
| Parent dynamic limits race with shrink/drain | Confirmed with a second real manifest read draining the same invalidation before the first result returns. Parent normalization now applies transport ceilings only. Worker transaction-local limits remain mandatory. Already-drained rows are no-ops inside the publication transaction. |
| Structural snapshot changes | A moved enumeration is not published when its current key set differs; it remains not enumerated. A structurally obsolete manifest produces a known `coverage-revision-moved:` partial outcome before caching. Same-sequence malformed metadata and storage errors still fail. Tests cover next-read recovery. |
| Subscribing after renderer process loss | Confirmed. Retired process identity prevents queued work from resubscribing to a dead generation; Electron crash state is checked. A verifiably new process may subscribe after recovery. |
| Subscription failure skips stage cleanup | Confirmed. Subscription failure abandons and settles the sender's retained stages, with cleanup failures reported and retained for retry. |
| Unbounded physical worker join | The original review overstated shutdown: `prepareClose` already had a five-second default deadline and refused unsafe close. The request error join was unbounded. It now has a bounded fault, retains actual exits separately, refuses new workers, and rejects queued reads without releasing the running SQLite worker's slot. Tests prove both bounded errors and continued custody. |
| UTF-8 split | Confirmed byte corruption; the claimed ASCII-key secret leak was not reproduced. A streaming UTF-8 decoder now preserves Buffer boundaries before line assembly/redaction. |
| Missing stderr and exit/drain race | Confirmed. Both harnesses require the owned stream and await readable end. Missing, errored, truncated/early-close and timed-out streams fail. A late fatal line reaches the diagnostic gate before receipt validation. |
| Same-sender release ordering | Added overlapping-settlement controls: one release cannot remove the listener pair while another request remains owned. |
| AbortError name lost over IPC | Cancellation now has a stable `coverage-cancelled:` message marker. Renderer classification and tile delivery recognize a plain Error carrying that marker; cancellation does not become a delivery failure. |
| Supplied owner lifecycle overwritten / TDZ | The supplied lifecycle is preserved with `??`; catalog release is initialized before the callback can run. |
| Dead resultLimits plumbing | Removed the unused runner/worker input path and redundant outer worker check. The parent hard transport ceiling and transaction-local canonical worker bound have distinct tests. |
| Unclassified movement/unavailable errors | Removed `coverage-snapshot-changed`; benign current-revision movement remains partial and resumes on the next update, periodic refresh or Retry, without adding a tight error retry loop. Cancellation survives IPC via its message marker. |
| CI provenance wording | Earlier run/head/tree identities remain historical. New exact-head checks and the latest PR receipt control readiness; old green evidence is not relabelled combined-candidate proof. |
| Service-worker smoke and manual | The guard's unit regression verifies registration is not called on file/data/about and remains called on HTTP(S). The native receipt now records unavailable registration inspection as null, not a manufactured zero. The manual explicitly excludes public fallback tile caching in Electron; local official MBTiles are separate. |

## Verification

Red/green and mutation logs are retained under `tmp/native-runtime-repair/claude-*`
and copied into the evidence directory at closeout. Current affected suite:
172 passing tests across nine files. Coverage browser suite: seven passed on a
dedicated local port1439, including partial/Retry recovery, visibility, delayed
history, reload, map reattachment and feature-disabled behavior. The first browser
attempt accidentally reused another worktree's port1420 and is not candidate
evidence; it remains retained. That server was not stopped or changed.

Full correctness passed 476 files / 5,045 tests / six existing qualification skips.
The final bounded lifecycle logging edit landed during that run; its full 19-test
suite and final lint passed afterward. Build/package and workflow lint passed.
Independent broad re-review found no introduced P1/P2 blocker. Both browser
partial/recovered screenshots were visually inspected and show the expected text.

The rebuilt macOS native control passed on ASAR
`ebd6cd7ecdf5a3f222455d8bbbe210a941983c1bf1c0b998bcc262034737cf35`.
Independent validation checked the terminal receipt, actual ASAR digest, five
packaged module hashes and all harness hashes against the working source.
This is dirty working-tree evidence based at `ce265677`, not clean CI proof.
New exact-head Linux CI remains required; PR31's checks and evidence comment own
that live result. The expanded native control also requires live-ingest
snapshot progress and observes cancellation after physical exit without making
the injected harness await exit for the store. It remains a separate synthetic
packaged-store control, not field or whole-application shutdown qualification.

The earlier full Train D roster attempt remains FAILED (expected one pending,
observed2/2); AUD09/restart were NOT RUN. Strict <200ms, 960k replay, soak/archive,
official-map distribution and field acceptance remain separate. DON-254 stays
In Progress and release stays HOLD.
