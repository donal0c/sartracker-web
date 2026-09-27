# SAR Tracker Electron 0.1.0-beta.13.3 — preparation draft

**HOLD — NOT APPROVED FOR PUBLICATION OR DISTRIBUTION.**

- Version: `0.1.0-beta.13.3`
- Intended tag: `electron-v0.1.0-beta.13.3`
- Linear: DON-254 qualification; DON-255 publication decision
- Release-use classification: `ENGINEERING/TRAINING — NON-COUNTED`
- Candidate commit, release run, installer hashes and Ubuntu qualification: PENDING
- Target: Linux x86-64 AppImage and genuinely installed Debian package.
- Scope: synthetic, replayed or disposable-data testing; not sole-source
  operational software. No Windows/macOS qualification claim.

## What changed

The qualification runner reads public GitHub run, artifact and required job
metadata directly over HTTPS, without requiring GitHub authentication on Ubuntu.
It retains fresh metadata checks, the exact provenance validator, original ZIP
digest, member inventory, installer hashes, installed payload and fixture checks.
The transport permits only constructed endpoints in the fixed repository, refuses
redirects and HTTP errors, and bounds time, streamed bytes and job pagination.
It neither reads credentials nor accepts cached JSON as current GitHub proof.

This new version preserves one source for the package and its qualification
runner. Beta13.2's tag, draft and evidence remain unchanged. Application logic,
persistence, coordinates and operator workflows are unchanged. No manual change
is required. Authenticated draft/C27 work remains a separate later requirement;
this transport does not change its proof model or publication authority.

## Regression provenance

- Record: DON-254 and [retained Ubuntu evidence](../assurance/beta13-ubuntu-execution-20260925.md).
- Trigger: Ubuntu's qualification preflight invoked authenticated `gh api` for
  public metadata even though direct unauthenticated GitHub reads succeed.
- Affected surface: qualification admission, not SAR operator functionality.
- Root cause: the CI inspector coupled public provenance reads to the GitHub CLI
  authentication prerequisite. Existing tests checked metadata validation but
  did not exercise the archive inspector without authenticated CLI access.
- Repair: bounded direct public HTTPS metadata transport; all provenance and
  local byte checks retained. Red integration test records the old CLI failure;
  new controls cover no-auth success, metadata mismatches, HTTP errors, redirects,
  malformed/oversized responses, deadline propagation and complete job history.
- Verification: pre-tag focused and full-source results go in the canonical
  handoff/Linear record; this candidate requires its own green release workflow.
- Earlier regressions: the [beta13.2 note](sartracker-electron-0.1.0-beta.13.2.md)
  and [browser repair ledger](beta13-browser-gate-repair.md) retain their evidence.
  C10 paging, C02 recovery semantics, the field archive timeout, strict archive
  201ms breach, C26 findings and invalid C28 attempts remain unresolved/retained.
  This transport change does not claim to fix them.

## Qualification and handover

The original205-binding programme remains mandatory on the exact new candidate.
All formal rows are pending; prior-source passes are historical evidence only.
Fresh release CI must pass correctness, strict responsiveness (<200ms), browser
and packaged gates before its unpublished draft is used. Then verify original
CI ZIP, both installers, genuine installation and the full Ubuntu programme.
No changed workloads, retry policy, safety thresholds or two-source admission.

Technical approval precedes controlled team handover and original-machine C29
acceptance. C27 controls and public-byte checks retain their real prerequisites.
Complete TEMPLATE.md's final matrix, hashes, install instructions and warnings
from verified evidence before separately authorized guarded publication.
Beta12.11 remains the rollback reference; verify disposable-profile compatibility.
