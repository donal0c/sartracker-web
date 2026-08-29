# Internal Controlled / Shadow-Use Beta Protocol

Status: **Required protocol for any future SAR Tracker internal shadow-use beta.**

This is an operating protocol, not evidence that SAR Tracker is safe for sole
operational use. It does not qualify an artifact, close a residual risk, replace
the final release matrix, or authorize publication. The release note for the
exact candidate must link this protocol and complete its session-specific fields.

The archive-lifecycle issue set (`DON-248`, `DON-252`, and `DON-253`) is not
implemented at the time this protocol is written. Archive, restore, custody,
and archive-backed review therefore remain unqualified and must not be relied
upon during shadow use.

## 1. What shadow use means

In plain operator terms, shadow use means:

- SAR Tracker may run beside the team's normal operational system during a
  planned exercise or a tightly controlled observation session.
- The independent primary operational source/process remains authoritative for
  locations, tasking, search decisions, incident records, and team safety.
- A named primary-system operator keeps that source live and usable without
  depending on SAR Tracker.
- SAR Tracker output is advisory comparison evidence. No action is based only
  on SAR Tracker while the candidate remains in shadow use.
- Stopping SAR Tracker must not interrupt the primary operation.

The existing primary source/process must be named before the first session. The
repository does not decide whether that is the legacy QGIS workflow, Traccar's
own web interface, or another existing team procedure. Donal and the team need
only record the smallest deployment confirmation in section 4; this is not a new
breadcrumb-domain question.

## 2. Permitted and prohibited use

### Permitted

- Training with synthetic, replayed, or deliberately disposable mission data.
- A planned field exercise on the exact admitted candidate where the primary
  operational process is fully live.
- Passive comparison during a real incident only when the session lead has
  explicitly authorized it, the primary process remains fully staffed, and SAR
  Tracker has no sole operational responsibility.
- Testing documented workflows on the exact identified candidate, platform, and
  profile.
- Recording both successful comparisons and failures for WAR-13B.

### Prohibited

- Using SAR Tracker as the sole source for current position, searched ground,
  tasking, casualty/clue evidence, mission history, or incident decisions.
- Allowing the SAR Tracker operator to become the only operator of the primary
  source or to copy a SAR Tracker-only conclusion into the primary record as
  verified truth.
- Treating a calm screen, passing exercise, `Complete`, or `100%` as proof of
  operational safety.
- Relying on archive creation, restore, archive-backed review, or custody until
  `DON-248`, `DON-252`, and `DON-253` and their exact-candidate qualification
  are complete.
- Using an unidentified build, an unverified checksum, an unqualified platform,
  or a profile containing unexplained state from another candidate.
- Updating or changing the candidate, package type, runtime flags, or profile in
  the middle of a session and counting both halves as one exercise.
- Uploading raw mission databases, profile archives, precise locations,
  credentials, private map data, or unreviewed screenshots as ordinary feedback.
- Treating hosted browser testing as desktop shadow-use evidence.

### Field admission gate

A field exercise or real-incident comparison may use only the exact candidate
that has:

1. implemented and qualified the `DON-248`, `DON-252`, and `DON-253` archive
   lifecycle;
2. passed BCP-17 and final exact-candidate qualification under `DON-254`; and
3. received deliberate guarded-publication approval under `DON-255`; and
4. completed guarded publication, with its exact release identity and published
   state recorded before the session.

Before that gate is complete, a build may be used only with synthetic, replayed,
or deliberately disposable training data. Those sessions do not count toward
the WAR-13B field scorecard, even if they are otherwise useful engineering
evidence.

## 3. Named session roles

One person may hold more than one role only if the primary process still has an
independent operator. Record names or agreed team identifiers before the session.

| Role | Responsibility |
| --- | --- |
| Session lead | Authorizes the session, confirms the primary process, calls `STOP SHADOW`, and decides whether the session may resume. |
| Primary-system operator | Keeps the independent primary source live, makes operational decisions from it, confirms primary-only operation after a stop, and invokes the team's named existing contingency if that source fails. |
| SAR Tracker operator | Runs only the declared candidate and reports warnings, divergence, uncertainty, or non-interactivity immediately. |
| Evidence custodian | Records candidate/session identity, preserves proportionate sanitized evidence, and prevents unnecessary sharing of sensitive data. |
| Triage owner | Routes the record to the existing Linear/regression owner and ensures urgent findings are not downgraded to ordinary feedback. |

Every role may call `STOP SHADOW`. Resuming requires the session lead and
primary-system operator to agree that the primary process is healthy and that
the stop trigger is understood or safely excluded from the resumed scope.

## 4. Required deployment and session identity

### One-time deployment confirmation

Complete this before the first shadow session for a deployment group:

```text
Primary operational source/process:
Primary-system owner/operator role:
Existing team contingency if that source degrades or fails:
Contingency owner and how an authoritative primary path is declared restored:
How primary-only operation is declared:
Fallback drill date and measured switch time:
Confirmed by:
Confirmation date:
```

If the team uses more than one existing source, name which one is authoritative
for each operational workflow. Do not leave "QGIS and/or Traccar" unresolved in
a live session record.

### Exact candidate and session identity

Every exercise record must contain:

```text
Session ID:
Session purpose and scenario:
Start/end in UTC and local timezone/offset:
Release version and tag:
Guarded publication URL/status and published-at time in UTC:
Git commit SHA:
CI workflow/run:
Artifact filename:
Artifact SHA-256:
Package/install type:
Platform, architecture, OS/distro, kernel, and desktop session:
Non-sensitive machine identifier:
Profile identifier and whether fresh, copied, or previously used:
Runtime flags and map-package status:
Provider/source mode (synthetic, replay, or controlled live):
Primary operational source/process and version if known:
Named session roles:
Relevant residual-risk register version:
```

Do not aggregate evidence across different SHAs, artifacts, package types,
platforms, profiles, flags, or primary-source configurations without preserving
each identity separately.

## 5. Rehearsed stop, fallback, and revert path

The fallback is not "restart SAR Tracker." The fallback is to remove SAR
Tracker from the session and continue on the independent primary process.

Before the session, rehearse the change from shadow comparison to primary-only
operation. The target is no more than 60 seconds from the stop call to the
primary-system operator confirming primary-only control. Record the measured
time; missing the target is a failed drill and blocks the session until the
fallback is workable.

### Stop triggers

Call `STOP SHADOW` immediately for any of these:

- unexplained current-position difference, delay, absence, time uncertainty, or
  disagreement about which position is current;
- missing, extra, retimed, cross-mission, or otherwise unexplained evidence;
- an evidence-loss warning or inability to preserve accepted evidence;
- `Complete` or `100%` when the primary source, exact counts, visible layers, or
  operator observation do not support that claim;
- suspected corruption, wrong schema, failed migration, or data that changes
  unexpectedly after restart;
- archive/restore/custody uncertainty, any reliance on an unqualified archive,
  or a restore result that cannot be independently reconciled;
- crash, repeated error, frozen/non-interactive controls, delayed operator
  action, or a moving clock while controls do not respond;
- persistent map/overlay uncertainty, including source records that do not
  agree with what the map shows;
- candidate, checksum, platform, profile, runtime flag, or session identity that
  cannot be confirmed;
- primary operational source degradation or loss;
- suspected credential, path, location, casualty, or private-map disclosure;
- any situation in which an operator feels unable to explain what the display
  means.

### Stop and fallback actions

1. The session lead says `STOP SHADOW` and records the local/UTC time.
2. If the primary process is healthy, the primary-system operator confirms that
   all operational decisions and recording are continuing from it alone. If the
   stop trigger is loss or degradation of that process, the session lead ends
   the SAR Tracker shadow session and the named contingency owner invokes the
   team's predeclared existing contingency. SAR Tracker must not be promoted to
   primary or used to bridge the gap.
3. The SAR Tracker operator stops using its output. Leave the app and profile
   unchanged when safe so evidence is not destroyed. For a Linux non-interactive
   process, follow the Mint hang runbook before closing or force-killing it.
4. The evidence custodian captures only the evidence tier justified by section
   8. Preserve sensitive files in place; do not distribute them by default.
5. The triage owner applies the decision tree in section 9.

### Revert and resume

- The primary operation never needs a SAR Tracker rollback because it never
  transferred authority to the beta.
- After evidence capture, the beta may be quit. A previous candidate may be
  installed only for a separate declared comparison using a separate disposable
  profile; do not point two candidates at the same live profile concurrently.
- Do not resume the stopped candidate merely because a restart appears to fix
  the symptom. Resume only as a new session or a clearly marked second segment
  after the session lead and primary-system operator approve the reduced scope.
- If the primary process degraded or failed, resumption also requires the named
  contingency owner to confirm that an authoritative primary path is restored.
- Preserve the failed artifact, profile, and identity until triage says they are
  no longer needed. Never delete suspected mission evidence to make a rerun pass.

## 6. Pre-session checks

The session lead reads each item aloud or confirms it with the named owner.

- [ ] The permitted scenario and non-goals are written down.
- [ ] Any field or real-incident session uses the exact candidate admitted
      through `DON-248`/`DON-252`/`DON-253`, BCP-17, `DON-254`, and `DON-255`;
      earlier builds are restricted to non-counted synthetic/replay/disposable
      training.
- [ ] The independent primary process is named, live, independently staffed,
      and able to continue without SAR Tracker; its existing contingency and
      contingency owner are also named.
- [ ] The primary-only fallback drill passed within 60 seconds and its time is
      recorded.
- [ ] All five roles are named and every person knows they may call `STOP SHADOW`.
- [ ] Version, tag, exact SHA, CI run, artifact filename, and SHA-256 match the
      release note and `SHA256SUMS`.
- [ ] Platform, install type, machine/profile, runtime flags, provider/source,
      and map-package status match the session declaration.
- [ ] No auto-update or mid-session candidate change can occur.
- [ ] The current residual-risk register has been read; its detection and
      fallback steps are available to operators.
- [ ] There are zero open confirmed P1/P2 findings and zero confirmed defects
      capable of corrupting, losing, or silently mis-scoping persisted mission
      evidence.
- [ ] Current positions, time/offset, mission phase, tracking source, layers,
      and map readiness agree with the primary source at the opening checkpoint.
- [ ] Sufficient local storage is available and the app has no unexplained
      startup, autosave, evidence-health, or diagnostics warning.
- [ ] Archive/restore is explicitly out of reliance scope unless the release
      note contains later exact-candidate qualification for `DON-248`,
      `DON-252`, and `DON-253`.
- [ ] The evidence custodian has a private storage destination and knows what
      must not be shared.

Any unchecked item blocks the shadow session. It does not block the team's
independent primary operation.

## 7. During-session and post-session checks

### During the session

- Keep the primary process visible, current, and independently operated.
- At the opening, each planned scenario transition, after any warning/recovery,
  and at close, compare the primary source with SAR Tracker for current position,
  relevant evidence count/scope, mission phase, time, and visible layers.
- Record successful checkpoints as well as divergences. A result of "no
  difference observed" is evidence only for that candidate, machine, profile,
  time, and exercised workflow.
- Record every warning, retry, restart, recovery action, and operator workaround.
- Do not dismiss an unexplained discrepancy as display lag. Stop first; classify
  later.
- Keep ordinary UI preferences separate from safety or evidence findings.

### After the session

- [ ] The primary-system operator confirms the primary record is complete and
      was never dependent on SAR Tracker.
- [ ] End time, duration, identities, exercised workflows, and all comparison
      checkpoints are recorded.
- [ ] The record states whether the exercise passed, stopped, or completed with
      allowed predeclared divergences.
- [ ] Successful outcomes include observed comparison counts, fallback drill
      time, recoveries attempted, and any unexercised scope.
- [ ] Every unexpected result has an intake classification and existing owner.
- [ ] Sensitive evidence is retained privately, minimized, and shared only with
      the people needed to investigate it.
- [ ] The residual-risk register and WAR-13B scorecard are updated without
      changing the candidate's qualification or release state automatically.

## 8. Proportionate evidence capture

Exact candidate/session identity is required at every level. Capture more only
when it materially helps diagnosis.

| Level | Use | Minimum evidence | Do not collect by default |
| --- | --- | --- | --- |
| `E0 — ordinary feedback or clean exercise` | Wording, layout, usability, an expected successful exercise, or a low-value observation | Session ID, exact candidate identity, workflow/checkpoint, expected and observed result, pass/feedback note; optional cropped/redacted screenshot | Support/incident bundle, raw profile, mission database, full-screen operational image |
| `E1 — reproducible functional issue` | Repeatable behavior with no immediate safety consequence or evidence uncertainty | E0 plus precise steps, local/UTC time, frequency, sanitized screenshot/video if useful, and a support bundle only when its contents are relevant | Whole profile, raw mission store, broad incident bundle unrelated to the failure |
| `E2 — urgent safety or regression evidence` | Any stop trigger, demonstrable non-cosmetic or safety-relevant released-build regression, unexplained divergence, evidence loss/corruption, false completeness, non-interactivity, or archive/restore uncertainty | E1 plus incident-time bundle when it covers the event, relevant sanitized logs, and the packaged Linux hang collector for a live hang; preserve the profile/store in place pending scoped instruction | Public upload, routine transfer of a raw database/profile, unreviewed screenshots, credentials/private maps |

An incident bundle is not the default answer to wording or layout feedback. A
raw mission database or profile is never a routine attachment. When it may be
needed for an E2 investigation, preserve it unchanged and obtain a scoped
privacy/custody decision before copying or sharing it.

## 9. Field-intake decision tree

```text
Observation received
|
+-- Is current position uncertain, evidence lost/corrupt/mis-scoped, Complete/100%
|   false, the app non-interactive, archive/restore uncertain, the primary source
|   unavailable, or sensitive data possibly exposed?
|     |
|     +-- YES -> STOP SHADOW -> primary-only operation when healthy; if the
|     |          primary is unavailable, invoke its named existing contingency.
|     |          SAR Tracker never bridges the gap. Use E2 capture and urgent
|     |          safety/regression triage under the existing Linear owner.
|     |
|     +-- NO
|
+-- Is it wording, layout, discoverability, or preference feedback that does not
|   change a workflow result?
|     |
|     +-- YES -> E0 short feedback record; no bundle by default; batch with the
|     |          existing UI/feedback lane.
|     |
|     +-- NO
|
+-- Is it a demonstrable non-cosmetic or safety-relevant regression from an
|   earlier distributed build?
|     |
|     +-- YES -> E2 capture -> Regression/Performance closeout under the
|     |          existing Linear owner.
|     |
|     +-- NO
|
+-- Does it change a workflow result, or is it a non-cosmetic functional issue
|   that reliably reproduces on the exact candidate?
|     |
|     +-- YES -> E1 capture -> route to the existing product/reliability owner;
|     |          if later comparison proves a regression, reclassify it as E2.
|     |
|     +-- NO -> record as an observation/hypothesis with the missing evidence.
|                Do not create a defect claim or new issue from plausibility alone.
```

Routing examples:

- `DON-247` retains long-duration Linux non-interactivity evidence.
- `DON-264` retains persistent overlay-synchronization warning work.
- `DON-254` owns final exact-candidate qualification.
- `DON-255` owns the guarded internal release decision.
- `DON-6` remains the final QGIS retirement/parity acceptance gate.

Do not create a separate WAR-13A issue merely to duplicate these owners.

## 10. Residual-risk record

Use one record per risk. All fields are mandatory. `Not known` is acceptable
only when the evidence gap and next action are explicit.

| Field | Required content |
| --- | --- |
| Risk | Stable ID and plain statement of what can go wrong and its consequence. |
| Affected workflow | Exact operator workflow, candidate/platform/profile scope, and what is not affected. |
| Detection | What an operator, test, diagnostic, comparison, or reviewer can observe; include known detection gaps. |
| Mitigation / fallback | Immediate operator action, primary-source fallback, recovery limits, and what must not be inferred. |
| Evidence tier | `T0` authority/source inspection; `T1` deterministic unit/static; `T2` integration/rendered browser; `T3` local package or independently inspected visual; `T4` exact CI artifact and declared matrix; `T5` controlled field/live-provider/long-duration. State the exact artifact/workload limit. |
| Owner | Existing Linear issue and named decision owner. |
| Status | `open-blocking`, `open-shadow-only`, `accepted-residual`, or `closed`. Only Donal may approve `open-shadow-only` or `accepted-residual`; neither means operationally safe. |
| Exit evidence | Predeclared observation/test/artifact/field evidence required to change status; never merely "more testing". |

Copy this exact template:

```text
Risk:
Affected workflow:
Detection:
Mitigation / fallback:
Evidence tier:
Owner:
Status:
Exit evidence:
```

`open-blocking` prevents the candidate entering or continuing shadow use.
`open-shadow-only` requires Donal's explicit approval before a session and
permits only the bounded candidate, platform/profile, and scenario described in
the record. It cannot be assigned ad hoc during a stopped session.
`accepted-residual` requires Donal's explicit sign-off and a working fallback.
`closed` requires the recorded exit evidence on the exact affected scope; a
passing lower-tier test cannot close a field or platform risk.

Every confirmed P1/P2 finding, and every confirmed defect capable of corrupting,
losing, or silently mis-scoping persisted mission evidence, is
`open-blocking`. It cannot be changed to `open-shadow-only` or
`accepted-residual`; the release and pre-session gates require it to be absent.

## 11. WAR-13B exit scorecard declaration

Complete the targets before the first counted exercise. Results may fill in
over time, but targets cannot be weakened after observing failures without an
explicit dated decision and reason.

| Field | Predeclared target | Actual / evidence |
| --- | --- | --- |
| Candidate identity | Exact version, tag, SHA, artifact names and hashes | |
| Exercises | Number, scenario mix, and mandatory workflows | |
| Cumulative hours | Total shadow hours and minimum duration per long-running scenario | |
| Machine diversity | Minimum distinct physical machines | |
| Profile diversity | Fresh, upgraded, copied field-like, and long-lived profiles required | |
| Platform diversity | Exact OS/distro/kernel/session/package/install-type combinations; unsupported combinations are excluded, not silently counted | |
| Allowed divergences | Exact predeclared cosmetic/non-safety differences and per-type limit | |
| Forbidden divergences | Zero unexplained current-position/evidence/completeness/corruption/archive divergence | |
| Fallback expectation | Primary-only switch target (maximum 60 seconds), number of drills, and required pass rate | |
| Recovery expectation | Allowed restart/recovery scenarios; zero unrecovered crashes or evidence uncertainty | |
| Finding closure | Required disposition of field P1/P2, regressions, and open residuals | |
| Decision owner/date | Donal plus team input; date of explicit go/no-go decision | |

Passing the scorecard does not publish, merge, tag, release, retire QGIS, or
make SAR Tracker operationally safe. It is evidence for a later human decision.
DON-254 qualification, DON-255 release controls, DON-6 parity/retirement, open
field regressions, and every residual risk remain separate gates.

## 12. Protocol proof limit

This document can make shadow testing more disciplined and less likely to be
misrepresented. It cannot prevent unknown software defects, qualify an
artifact, prove a team understood the procedure, prove a fallback drill was
performed, settle the Mint non-interactivity report, implement archive/restore,
or establish field safety. Those claims require exact-candidate technical and
field evidence recorded under their existing owners.
