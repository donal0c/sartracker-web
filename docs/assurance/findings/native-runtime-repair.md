# DON-254 native-runtime repair

Bounded repair from master `cda87aa03f27eb69532ae9506aa9e719cef7e364`.
Baseline Linux run 34826211836 is independently confirmed green. This record
does not supersede the historical Train D failure or qualify a release.

## Contract and scope

Coverage results must use bounds consistent with their SQLite snapshot, remain
globally bounded, and pass current canonical inventory/outing/change-sequence
attestation before publication. SQLite/WAL, coordinates, audit and mission
completeness remain unchanged. Renderer persistence still goes through IPC.
One lifecycle listener pair owns concurrent coverage work per renderer; staged
catalog cleanup and sender isolation must survive normal settlement and death.
Shutdown must join physical coverage worker exit after cancellation.
Browser service workers register only in HTTP(S) contexts; desktop `file:` is
unsupported. Diagnostic capture must distinguish identity, source and capture
timing without inferring a cause or allowing teardown failures through gates.

Strict `<200 ms`, 960k replay, tracking soak, archive qualification, map rendering,
official-map distribution and field acceptance are excluded. DON-254 remains
In Progress and release remains HOLD. No merge, deployment or team contact.

## Reproduction and repair

- `initial-red.log`: real mission-store/worker interleaving creates an outing
  after baseline parent bound capture and before real worker creation/snapshot.
  Baseline rejects two canonical
  chunks using a bound of one: `Coverage enumeration result is invalid: item
  list is invalid.` Three unsupported protocol controls also fail. The worker
  now derives cardinality in its read transaction; parent normalization uses
  current metadata and retains inventory/sequence attestation and hard caps.
- `listener-red.log`: 24 simultaneous mixed coverage/tile reads create 24
  listeners per owner event. Shared owner subscriptions reduce this to one
  pair, retain stage ownership, and cancel once per request on renderer loss.
  This proves concurrent pressure, not a historical persistent listener leak.
- `exit-red.log`: a controlled worker rejects cancellation before its physical
  exit; `prepareClose` incorrectly settles early. Request ownership now joins
  physical exit before propagating that failure, preserving the original error.
- `diagnostic-red.log`: the extracted existing page collector loses error
  identity/stack and failed-request type. Capture now preserves sanitized
  identity/stack, page context and request type/method. Monotonic elapsed capture
  time and the close-request timestamp supplement existing source/phase/sequence.
  Generic script-fetch errors and close-time AbortErrors remain unexpected.

Raw local logs: `tmp/native-runtime-repair/`. These are synthetic/local proofs,
not evidence of a repaired historical packaged run. Earliest events before
Playwright attaches remain unobserved; capture time is not event-origin time.

## Verification and review

Focused snapshot/protocol/result validation: 44 passed. Expanded native/store,
IPC and diagnostic suite: 71 passed. Lint and build/typecheck/bundle budgets pass.
Full serial correctness passes 469 files / 4,969 tests / six unchanged
qualification-only skips. Seven subsequently added native receipt validator
controls pass separately. Lint, app build/typecheck/bundle budgets, focused strict
test types and actionlint (without external shellcheck/pyflakes) pass. Final broad
review is clear; exact-head Linux CI remains pending, so PR readiness is pending.

### Review dispositions

Persistence review confirmed a same-inventory sequence race: a real worker
manifest followed by a canonical position write was returned stale because a
zero-insert result also represented a rejected sequence. `sequence-red.log`
retains the reproduction. Current-sequence fences now run within serialized
publication and before caching; a moved snapshot fails with an actionable Retry
message, and the fresh control sees all three fixes. The reviewer rechecked clear.
Its two forged-worker findings were withdrawn: they required arbitrary injected
worker results, with no identified production path or introduced defect.

Diagnostic review's privacy finding was accepted: the old inline sanitizer was
insufficient for stacks/URLs. The canonical application sanitizer now owns those
fields. Synthetic userinfo, local path, bearer and API-key controls are red/green.
Elapsed capture time, explicitly labelled `collector-receipt`, and nullable close
start are validated. Terminal Train D receipts require ordered close-request,
observed-exit and stderr-drained times. Helper hashes are retained; clean CI tree
binding is stronger than standalone dirty-source custody. No event-origin or
teardown-cause claim is inferred. IPC lifecycle and diagnostic rechecks are clear.
Broad review also found split-chunk stderr could evade redaction. Both harnesses
now assemble raw lines within an 8192-character bound before canonical sanitizing
and the 2000-character output cap. Oversized lines are omitted with an explicit
unexpected diagnostic. Split password/userinfo and oversized-line controls failed
first and pass after repair; the affected diagnostic/receipt suite passes 35 tests.
The scoped native control passes again on the same ASAR with this final collector.
Final broad recheck is clear. Its snapshot-reproduction objection was withdrawn:
the baseline captures the old parent bound before invoking the injected runner,
which writes the outing before starting the real worker transaction. This is the
actual failing causal order; no operating-system thread barrier is needed.

### Packaged evidence and retained failures

One unsigned macOS arm64 package was built. ASAR SHA256:
`a5e09019a973c9a93c5fe027848974d0b92e57ad07e01e47e13ed597a91d139d`.

The full Train D attempt **failed**: its roster expected one pending member but
the renderer stayed at 2/2 pending. It captured provider HTTP503 warnings, the
new explicit moved-snapshot rejection, and inspector disconnect lines. There
were no captured page errors, service-worker registration warning or listener
threshold warning. The child exited gracefully with code0. AUD09/restart did not
run. This result does not diagnose the roster failure's production root cause;
it is separate DON-254/Train D follow-up and is not relabelled passing.

The narrower native control passes on the **same ASAR**: 24 actual preload/IPC
manifest reads; `file:` context with zero registered service workers; separately
injected packaged-store snapshot growth (outing plus unassigned, exact one fix)
and real runner cancellation/physical exit; graceful code0 with no unexpected
captured diagnostics. Expected blocked-map events and exact inspector transport
disconnect lines are retained separately. The existing Train D diagnostic gate
was not changed. The narrow control does not prove default-app cancellation,
startup events before Playwright attachment, roster backfill, restart or release.
Its independent terminal validator has seven passing positive/negative controls;
ordinary PR CI now runs this additional bounded native control.

The narrow harness's first attempt omitted its separate fixture directory; the
second attempted a renderer reload and hit Playwright's `No dialog is showing`
beforeunload race. Both failures remain retained; no owned app process remained
after the second. The reload was removed from this native-runtime control, and
no reload qualification is claimed. Final metadata/validator confirmation passes.

Raw compact evidence is retained in
[`docs/evidence/native-runtime-repair`](../../evidence/native-runtime-repair).
The first full source sweep was interrupted when review remediation began and
is not acceptance evidence. The final source sweep passes as recorded above.
`source-bindings.json` binds every changed executable/test/config input; the
saved native receipt's harness and implicated package hashes match current
source. Generated build metadata was restored to its committed blob after
packaging without changing the tested package.
