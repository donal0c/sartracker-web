# DON-267 production repair review receipts

**Historical reviews, superseded by Claude's findings at `7fc4aa08`.** These reviews
missed the cache/live merge defects and did not establish timer-guard mutation
coverage. See [remediation](claude-review-remediation.md) for current dispositions.

2026-09-13. Two separate, non-production-author Codex GPT-5.6 Luna x-high agents
inspected the accumulated working diff within the same author-controlled Codex
run. Root authored all production changes and dispositioned the findings. These
are agent self-review receipts, not third-party approval, native execution proof
or GitHub approval. Base HEAD `deedab27483ad4fe1ca998a4d68afd555f4e2337`, tree
`54ecab87fbfa3a7921cdc14bb209b52b7eac928e`.

## Concurrency, cache and custody reviewer

Agent `/root/concurrency_review` inspected timer/context ownership, cache
admission/serialization, deferred participant scope, runtime replacement and
accepted evidence settlement. Initial findings were the stale-generation shared
queue's silent fulfillment and recovery cache replacement during hydration.
Recheck found the equivalent active-cache race. Root reproduced each before
repair; raw failing assertions are in the repair evidence directory.

Final disposition: all three are fixed. The queue rejects through the existing
durable loss marker; the separate mission cache survives active/recovery loading
and merges with live rows winning per device; contextless adapters retain their
construction mission without inventing evidence admission. Explicit idle remains
null. No further regression found in the reviewed mission/timer/custody scope.

Final tracked diff SHA-256:
`6b41c0cf94c62bb766a2cdc0bd87848c661ff5c0b84f9a37543c92da7a90aafd`.
Review included visual inspection of both controlled browser captures: only live
B at `52.01000, -9.70000`, one active device, no A or old stationary attention.
At source review, the reviewer had not run tests or assessed the native smoke.

Subsequent independent artifact review inspected `docs/evidence/war-06-repair/native/final/`
including the receipt, stderr, SQLite assertions and A-offline/B-rejected/B-fresh
screenshots. Disposition: scoped native mission-cache proof passes; all five exits
are clean, package ASAR matches, and the earlier missing-device fixture warning is
absent. Coverage-worker and listener warnings remain explicitly retained. This is
artifact review of root's execution, not an independent rerun or release approval.

The mutable provider cache adapter closure is a pre-existing provider-identity
follow-up, explicitly not repaired here. This patch binds mission identity, not
provider identity. A provider change during pending serialization needs its own
captured-provider/adapter contract and regression before claiming that boundary.

## Broad safety and state-machine reviewer

Agent `/root/safety_review` independently checked mission state, participant trust,
current availability, cache age, accepted custody and stationary projection.
The delayed-cache health/expiry issue was confirmed fixed. The reviewer identified
the optional adapter context being filled from the current mission; root added
construction-time capture with explicit-null preservation and no implicit evidence
admission. Final delta disposition: **PASS, no remaining actionable WAR-06 safety
finding**. Reviewer confirmed captured fallback, explicit null, contextless
no-evidence behavior, unified pending cache and publication-time TTL checking;
`git diff --check` passed. This is bounded source review only, with no packaged,
CI, field, release or timing claim.

## Production inputs at final review stage

Root-recorded SHA-256 file fingerprints (before packaging):

| File | SHA-256 |
| --- | --- |
| `src/features/tracking/start-tracking-runtime.ts` | `04aa3e45ad1111557c22daffc5ba5c640aba14c44b8b3f18129897732d290de2` |
| `src/features/tracking/polling-manager.ts` | `6670f95931556e627432597864e029b0d468cd2612ea01f89f769bab7e5b5640` |
| `src/features/tracking/tracking-cache-payload.ts` | `0077b1c6160f8ff1ffedb5e1316209f6535ca15c6863e24e1dd24b4a81f41351` |

Documentation and explicit-admission test fixture corrections after a review do
not imply fresh runtime evidence. Later executable changes require a scoped
recheck and an updated fingerprint here.
