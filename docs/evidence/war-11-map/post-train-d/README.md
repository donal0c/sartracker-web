# PR27 integration evidence

PR28 rebased onto merged PR27 `2ab581e0` on 2026-09-14. The receipt binds unchanged
map blobs to reviewed pre-rebase `e2a31ed6`, plus 126 affected tests / four browser
flows and independent integration review. Main/preload/CI compose both lanes;
only the handoff conflicted. Historical failure artifacts are unchanged.

Default actionlint timed out and is NOT passing evidence. Its workflow-only pass
and serial standalone ShellCheck across 32 shell steps are separate checks. No
workflow alteration bypassed the tool issue. The pre-rebase source-bound Linux
evidence remains historical; fresh integrated CI is required. No local Electron,
merge or release occurred. See the remediation record for retained limits.
