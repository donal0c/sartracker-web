# Areas To Investigate

> **Not an active queue.** The active planning path is `docs/two-track-execution-workplan.md`.

This file is retained only as a guardrail for broad improvement investigations. It must not become a second backlog.

## Rule

If an investigation finds work worth doing, fold it into `docs/two-track-execution-workplan.md` as one of:

- Track A: hosted team testing
- Track B: Electron operational readiness
- Shared foundation
- Verification
- Deferred / decision-gated

Then create or update the relevant Linear issue if the work is substantial, safety-critical, or likely to span sessions.

## Improvement-Mode Prompt

Use this operating prompt in spirit when asked to look for improvements:

`Deeply analyze the codebase and identify 3 to 5 bounded improvements that would make a real difference to the system. For each, give an impact, complexity, and risk score from 1 to 5. Choose the best improvement by highest impact and lowest complexity/risk. Before implementing, fold the chosen improvement into docs/two-track-execution-workplan.md unless it already exists there. Implement only that one. Verify it deeply with the right mix of unit tests, integration tests, and browser checks. Use Playwright or Chrome DevTools only when explicitly requested. Then update the relevant Linear issue and handoff/HANDOFF.md.`

## Historical Investigation

The 2026-05-13 hardening investigation is historical evidence, not a task board:

- Report: `docs/reports/deep-hardening-investigation-2026-05-13.md`
- Former open items T06-T13 have been folded into `docs/two-track-execution-workplan.md`.
- Former completed items T01-T05 are recorded in `handoff/HANDOFF.md` history and the report.
