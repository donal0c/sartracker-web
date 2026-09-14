# HANDOFF.md — Current state

Updated 2026-09-14. Read after `CLAUDE.md`.

## Baseline and active lane

Current `origin/master` is `6abde36e1e293f8731784fe3fab293f11ce5e7eb` with tree
`302e684ec4c60ad66a0afb45898e2a552e3cf974` (PR31 merged). This branch starts
from that clean exact head and contains the bounded follow-up for DON-254 / Train
D's packaged participant-progress observation. Earlier PR31/native-runtime and
Train D failures remain historical evidence in the linked assurance records.

The repair is deliberately narrow: when tracking durably advances a participant
backfill checkpoint, it refreshes the participant projection for the same still-
active mission. It does not alter participant completeness, Finish refusal,
provider scheduling, diagnostics, the strict `<200 ms` gate, release, or field
acceptance.

## Verification and next action

Manual exact-master workflow `34860711436` (head
`6abde36e1e293f8731784fe3fab293f11ce5e7eb`) reproduced the original failure at
packaged AUD-08: the native store was `1/2`, but the renderer remained `2/2`;
AUD-09 and restart were not reached. A red unit regression reproduced the same
refresh seam, then passed after the callback repair.

Local repaired macOS arm64 package evidence (`/tmp/sar-train-d-local-666c`)
shows `aud08=pass` and `aud09=pass`, including the visible `complete for 1/1`
state and Search Operations backup proof. Restart is **NOT_PROVEN** because the
existing diagnostic custody gate rejected deliberate provider-503/retry and
close-time transport warnings before restart. No diagnostic allowlist or gate was
relaxed; the full receipt remains retained.

Source checks: focused tracking runtime 94/94, participant/runtime wiring 60/60,
TypeScript build, changed-file lint, and package build pass. Full source tests
were 5,069/5,070; one unrelated `<200 ms` assertion measured 226.0 ms under
parallel local contention and passed in isolation at 47.2 ms. The gate remains
unchanged. CI run `34866228521` passed through correctness, responsiveness,
browser, build, and replay gates, then failed before Train D at the unrelated
packaged native-runtime diagnostic gate on two launch-time Vulkan stderr entries;
the exact clean package and source identity passed, and Train D was skipped.
The exact-head Train D scenario and complete restart path therefore remain
**NOT_PROVEN**. Donal owns merge; no merge, release, deployment, or team contact
is authorized by this handoff.

## Limits

DON-254 remains In Progress; release HOLD. Strict `<200 ms`, 960k replay,
tracking soak, archive lifecycle, installer/field acceptance and official-map
distribution are outside this lane. Pre-attachment renderer diagnostics remain
unobserved; capture timestamps are not event-origin timestamps.
The historical 204.046 ms concurrent read, incomplete 239.509 ms attribution,
baseline settings/browser gaps, and WAR-11 macOS/CI failures remain retained.
No credentials or licensed map bytes were read.

Follow the [two-track queue](../docs/two-track-execution-workplan.md),
[coordinated ledger](../docs/assurance/coordinated-work-ledger.md), and
[testing cadence](../docs/testing-and-review-cadence.md).
Older history: [pre-Train C archive](archive/pre-train-c-20260914.md) and
[earlier archive](archive/pre-war06-repair-20260913.md).
