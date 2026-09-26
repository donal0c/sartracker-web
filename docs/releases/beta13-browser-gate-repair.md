# Beta13.1 rejected Chromium gate — DON-254

Release remains HOLD. Tag `electron-v0.1.0-beta.13.1` is unchanged at
`2ff4d5742649da016a52c0e682f404d17df8c5dd`. Release run
[36225417118 attempt 1](https://github.com/donal0c/sartracker-web/actions/runs/36225417118)
passed serial correctness, strict responsiveness and build, then failed five of
225 Chromium tests (220 passed). Packaging never started; no draft or artifact
was produced. All five reproduced locally on unchanged source with `CI=1`, one
worker, zero retries and tracing enabled. Original logs and local traces/screenshots
are retained in the source owner's ignored `tmp/beta131-browser-rejection/`.
The failed GitHub run uploaded no trace artifacts; remote traces are unavailable.

| Failure | Confirmed cause / category | Repair | Verification |
| --- | --- | --- | --- |
| Expanded layer tree scroll, layer-panel:120 | Product CSS: `min-h-fit` lets the wrapper grow beyond the workspace, leaving the inner tree with no scroll range. | Restore bounded flex child with `min-h-0`. | Original positive-scroll/refresh assertions pass; added real-wheel outer-scroll and >96px viewport intersection proof, screenshot at 1280x720. |
| Concurrent map alerts, map:328 | Test fixture: injected real overlay IDs are cleared by successful asynchronous overlay recovery. | Isolate presentation fixtures with test-owned warning IDs. | All visibility, geometry, wheel, focus, keyboard and final-card assertions pass; top/bottom screenshots reviewed. |
| Offline diagnostics, settings:100 | Browser adapter: request persistence method absent, runtime correctly refuses history HTTP before admission. Fixture also used stale July telemetry. | Session-backed request/batch adapter; current fixture timestamp. | Original history-window, HTTP 503 and secret-redaction assertions pass. |
| Subsecond history cursor, settings:144 | Same absent adapter prevents history requests entirely. | Same adapter. | Original request-count and subsecond-fix assertions pass. |
| Large hosted history, settings:245 | Same absent adapter leaves only two current positions. | Same adapter through existing retention cap. | Original exact 2,000-row assertion passes. |

## Contract and safety boundaries

Source tracing locates the sidebar constraint in `51acca120`, the mandatory
request-persistence gate in `42f9f3057`, and the warning stress fixture in
`abf55127b`. These identify the relevant edits, not a bisected last-good candidate.
The first jointly confirmed bad artifact is the rejected Beta13.1 source above;
no last-good complete Chromium run has been established in this investigation.
Ordinary source CI runs selected browser gates and omitted these three spec files;
the release-only full suite exposed the gaps. Source CI now replaces its
coverage-only Chromium step with the same full Chromium command as release CI;
only the diagnostic output directory differs. Coverage remains included once,
alongside all other standard cases; specialized browser configurations remain.
Both source and release jobs always retain browser failure artifacts. Two new
workflow contracts failed before this change and pass after it. Exact-final-head
Linux full-suite success is required before recommending merge or a new tag.
The new adapter unit regressions also provide an earlier gate; all original
end-to-end assertions remain.
This is browser/source evidence only, not packaged or deployed behavior proof.

The existing [hosted testing plan](../hosted-browser-testing-plan.md) and
[team feedback guide](../team-testing-feedback-loop.md) define session storage,
capped histories and limited browser recovery. This repair does not make the
browser an operational persistence system. The adapter records request targets
and the last acknowledged chunk as **transport receipts**, not completeness
frontiers. It never exposes `listTrackingHistoryCheckpoints`; after runtime restart
history is fetched again from its authorized start, rather than skipping evicted
rows using a misleading saved cursor. Native persistence and fail-visible request
admission remain unchanged. No coordinate transformation or native database change.

Candidate state is written atomically to session storage before memory changes or
acknowledgement. The existing 2,000-row cap and 500-row emergency quota retry remain;
failure of both writes rejects admission. Receipt metadata is bounded to one row
per mission/device and contains no credentials. The original UI assertions, timeouts,
20-second correctness limit and strict 200 ms thresholds remain unchanged.

Five new adapter regressions failed before implementation, then 46 focused
adapter/store tests passed. Independent review prompted strict timestamp reuse
(three invalid-time cases red, then green), an emergency-quota success case and
same-store memory assertions; final affected unit suites pass 50 tests. All five
browser cases pass together, first attempt, on final code (25.0 seconds).
The final local macOS Chromium run passed all 225 tests in 6.4 minutes, with no
failures or retries, under the release Playwright configuration (`CI=1`). This
does not substitute for the pending Linux source-CI preflight. Adapter and
rendered visual reviews accepted the final change.
Final serial correctness passed 583 files / 6,043 tests, with 26 existing skips
(`npm run test:correctness -- --no-file-parallelism`, 592.34 seconds).
`npm run lint` and `npm run build` passed, including types and bundle budgets.
Exact-head Linux checks remain pending. This is a bounded PR repair;
no next tag until required checks pass. The previous Beta13 correctness rejection is separately preserved
in the Beta13.1 release note. Neither rejected tag may be moved or reused.

## Release-path audit disposition — 2026-09-26

Donal authorized these bounded additions and coordinator-arranged independent
Claude review on the stable exact head. The original local audit is retained at
`/Users/donalocallaghan/workspace/vibes/sartracker-web/tmp/claude-release-path-audit-findings.md`.

| Finding | Disposition and evidence boundary |
| --- | --- |
| F1: Debian version mismatch | Strictly map candidate `0.1.0-beta.13.2` to Debian `0.1.0~beta.13.2` in all four comparisons. Inspect real control Version before extraction. Retained Beta13 control metadata confirms builder tilde encoding; this is not final-candidate installation proof. Positive retained identity failed before correction; wrong-beta and unsupported-format regressions reject. |
| F2: C27 controls | No control or acceptance mutation. C27 stays unattempted until its prerequisites pass. Review/check/scanning/push-protection gaps require Donal's decision; an enforced independent approval requires an eligible distinct GitHub reviewer. Local reviews do not satisfy that approval. |
| F3: artifact lifetime | Release installers now retain for 90 days, matching browser evidence. Final admission must still inspect actual `expires_at` and sufficient remaining campaign margin. |
| F4: pre-tag validation | After reviewed merge, require the full Linux validation workflow_dispatch on that exact source: responsiveness, tracking soak, 960k, archive lifecycle and launch, before creating the next immutable tag. |
| F5: retained C27 attempts | No contract change. NEEDS_HUMAN_DECISION prevents technical handover; later PASS cannot erase it. Acceptance/key inputs are frozen at compile; live controls can be freshly re-observed. Choose the path before sealing. |
| F6: flaky-pass release | Both full Chromium commands add `--fail-on-flaky-tests`; existing diagnostic retries and workloads remain. A controlled synthetic first-fail/retry-pass probe returned exit 1 with one flaky test, proving enforcement. |

The combined focused audit suites passed 119 tests. Independent native review found
no blocking F1/F3/F6 issue; it did not itself run tests. Direct subprocess call-order
coverage for real Debian inspection is not added here; strict mapping and retained
identity regressions cover version admission, and final real package inspection
remains mandatory on Linux. Final correctness/lint/build passed as recorded above;
exact-head Linux 225-test success remains pending. No authentication transport redesign is included:
public metadata is accessible without credentials, while archive/draft access needs
supported authentication. Ubuntu OAuth was canceled before approval; see the owned
Ubuntu report for the bounded endpoint probe and current prerequisite state.

Unresolved F2 adapter defect: a reproduced effective-rule array with the existing
zero-approval `pull_request` entry before a qualifying one-approval/resolved-thread
entry still reports missing review enforcement, because the assessor uses the
first match. A hypothetical second ruleset is therefore not a verified solution.
CoS explicitly excluded aggregation changes from this repair. Current controls
remain unmet; no campaign compilation or C27 attempt follows. The write-permitted
collaborators are technically eligible reviewers, but their availability is unknown.
Any no-bypass PR gate would supersede the direct-master exception. Controls and
auth decisions do not block completion of this repair PR.
