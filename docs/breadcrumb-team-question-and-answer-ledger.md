# Breadcrumb Team Question And Answer Ledger

Date established: 2026-08-22

Status: **Canonical source for questions put to the SAR team and the answers received.**

## Purpose

This ledger preserves the team's actual words before they are converted into
architecture, Linear issues, implementation plans, or tests. It exists because
summaries alone allowed an already-answered Traccar database question to be
asked again in a different technical form.

For the Breadcrumb and Mission-History Programme, authority is:

1. the exact team answer in this ledger;
2. a later team answer that explicitly clarifies or supersedes it;
3. the derived architecture decision, which must cite the relevant ledger IDs;
4. implementation plans and code.

An interpretation must never silently broaden a team answer. If the team says
a Traccar position is an immutable database record, repeated SAR Tracker reads
of that record are not new source observations.

## Recording Rules

- Preserve every question sent and every answer received, including apparent
  duplicates. Use the cross-reference field to show how a later answer
  clarifies an earlier one.
- Preserve the supplied wording. Formatting may be cleaned up, but meaning may
  not be rewritten inside the quoted question or answer.
- Derived meaning is labelled separately from the raw answer.
- Never delete or overwrite an entry. Add a later entry and mark the earlier
  interpretation superseded when the team clarifies it.
- Before drafting any new team question, search this ledger and identify the
  related IDs. A new question may be sent only when its `Why not already
  answered` field states a genuine unresolved operational choice.
- Engineering mechanics—deduplication, idempotency, retries, database
  transactions, transport acknowledgements, and defensive impossible-state
  handling—are not sent to the team when an existing answer already fixes the
  domain meaning.
- Every Fable/OxAlpha task and every implementation brief must cite the exact
  ledger IDs it relies on. The coordinator must reject advice that conflicts
  with them.

## Source Note

The untouched source transcript supplied by Donal is retained at
`team-feedback/breadcrumb-question-answers-20260822.md`. Entries below index
and cross-reference that source without replacing it. The screenshot did not
expose a calendar date, so none is invented. The structured answer rounds were
supplied on 2026-08-22.

---

## Field Report And Scale Context

### SAR-FIELD-001 — Long-running search scale and all-fixes need

**Team message:**

> Hi Donal, test running now with over 26k fixes. Earlier and later working but
> not ideal solution. In a search, at min need to display 50 pax for 20km/day
> so 50 x 20000/25=40k fixes round up to 50k fixes /day. Co-ordinators need to
> see all fixes on one map. Understood, you were going to update the new data on
> map only, is this happening? How will this work for multi-day searches, is
> creating layers for each day a solution? Probably should have a chat about
> this if your free sometime.

**Further team context:**

> on searches, which is the primary use for this software of which we had 2
> large one's in the last 18 months. Both over multiple days with 30 plus
> members out each day, majority covered 20 km/day. For one of them, we were
> out 9 times, mostly evenings for 4-5 hrs. 4 full days. For both of these
> searches, we also had large numbers of other rescue teams. ideally they
> should also be included, was looking at gpx trackers for this. it needs
> discussion. For rescue missions, could have 28 pax for max 8 hrs 12 Km, this
> exceeds the 10K limit. Stretcher carry from CU, 28 pax X 4Km X 6hrs, approx 5
> k fixes. For the smaller missions is ok but severely limiting for large
> searches.

**Derived meaning:** Large, multi-outing searches are the primary design case.
The normal operator map needs complete coverage, not only a 10,000-fix window.
Other teams must be representable.

**Programme trace:** BCP-06, BCP-07, BCP-08, BCP-09, BCP-10, BCP-17.

---

## Answer Round 1 — Operational Requirements

### SAR-QA-001 — Meaning of all breadcrumbs

**Question:**

> Does “all fixes on the map” literally mean every dot simultaneously, or does
> it mean every person’s complete route must remain visible with no missing
> sections?

**Team answer:**

> All breadcrumbs should be shown for each device for current mission to date
> with the ability to omit previous periods data points selectively per device
> per day.

**Derived meaning:** Default history is complete for the mission to date.
Omission is a reversible display selection, never evidence deletion. The later
outing answers (`SAR-QA-010`, `SAR-QA-014`) replace calendar day as the
canonical period.

**Programme trace:** BCP-08, BCP-09, BCP-10.

### SAR-QA-002 — Operational priority

**Question:**

> During a live search, what matters most: current positions, searched ground,
> gaps in coverage, or inspecting a particular fix and time?

**Team answer:**

> The most important is current position so the coordinators are fully aware
> of each position for safety of all involved. This followed closely by area
> searched.

**Derived meaning:** Current positions are the highest-priority path and never
wait for history, evidence bookkeeping, coverage, archive, or replay work.

**Programme trace:** BCP-01, BCP-05, BCP-08, BCP-09.

### SAR-QA-003 — Default all-mission view and period meaning

**Question:**

> Should “All days” be the normal view, with optional day filters? Does a day
> mean midnight-to-midnight or a particular outing/deployment?

**Team answer:**

> a. Default View:- All mission data shown to date, with day filters etc. as
> per answer 1. above.

**Derived meaning:** All mission data is the default. The period ambiguity was
later resolved as outing, not calendar date (`SAR-QA-010`, `SAR-QA-014`).

**Programme trace:** BCP-03, BCP-08, BCP-09.

### SAR-QA-004 — Other rescue teams

**Question:**

> How should other rescue teams appear—live Traccar devices, imported GPX
> afterwards, or both?

**Team answer:**

> Both

**Derived meaning:** Support live Traccar groups/devices and imported GPX,
while retaining their different provenance and freshness semantics.

**Programme trace:** BCP-04, BCP-11.

### SAR-QA-005 — Supported operating envelope

**Question:**

> What is the real maximum: people, tracker interval, hours per outing, days
> per mission and outside teams?

**Team answer:**

> People: 100
>
> Tracker Interval: 25 metres interval between data points (breadcrumbs).
>
> Hours per Outing: 12 hours
>
> Days per Mission: 12
>
> Outside Teams: These are determined by the 'Groups' created in Traccar.
> There are approximately 12 separate SAR groups in the country.

**Derived meaning:** Qualification fixtures must cover 100 active devices,
12 outings of up to 12 hours, and group/team structure. `SAR-QA-011` clarifies
that 100 is the total active Traccar-device population, not 100 plus outside
teams.

**Programme trace:** BCP-04, BCP-06, BCP-07, BCP-08, BCP-17.

### SAR-QA-006 — Corrected positions

**Question:**

> How should late or corrected tracker positions be handled? Must both the
> original and correction remain visible in the audit history?

**Team answer:**

> There should be no corrected positions.

**Derived meaning:** A Traccar source position is treated as immutable source
data, not an operator-editable record. `SAR-QA-013` explicitly confirms the
database basis. Re-reading the same source row is idempotent and is not a new
breadcrumb or a new evidentiary observation. A same-ID/different-content case
is defensive impossible-state handling owned by engineering, not a normal
team workflow.

**Programme trace:** BCP-02, BCP-10.

### SAR-QA-007 — Incident review output

**Question:**

> What would they expect to produce after an incident: raw fixes, named
> tracks, timestamps, accuracy, map image, audit history, or all of those?

**Team answer:**

> All of those with the added ability to open and display the saved mission on
> a time line.

**Derived meaning:** Saved mission evidence must support exact review/export
and data-state timeline replay.

**Programme trace:** BCP-10, BCP-12, BCP-15, BCP-16.

### SAR-QA-008 — Progressive historical loading

**Question:**

> Would it be acceptable for older tracks to fill in progressively over a few
> seconds, provided current locations remain immediate and no coverage is
> omitted?

**Team answer:**

> Yes including a progress bar.

**Derived meaning:** Progressive loading is acceptable only with immediate
current positions, no omitted accepted history, and an honest database-backed
progress indicator.

**Programme trace:** BCP-08, BCP-09.

### SAR-QA-009 — Representative multi-day search

**Question:**

> Can they walk us through one anonymised real multi-day search and show
> exactly what decisions they need the map to support?

**Team answer:**

> Multi-day search, example for KMRT only.
>
> Location, breadcrumb trail for each device, search area, clue info vital for
> each day.
>
> Day 1 25 searchers for 5 hrs, 2 search areas created.
>
> Day 2 35 searchers for 12 hrs, 5 new search areas created. Multiple clues
> entered.
>
> Day 3 34 searchers for 12 hrs, 6 new search areas. Multiple clues entered.
>
> Day 4 20 searchers for 4 hrs, 1 new search area. Multiple clues entered.
>
> Day 5 18 searchers for 4 hrs, 1 new search area. Multiple clues entered.
>
> Day 6 32 searchers for 12 hrs, 5 new search areas. Multiple clues entered.
>
> Day 7 35 searchers for 11 hrs, 6 new search areas. Multiple clues entered.
>
> Day 8 22 searchers for 4 hrs, 1 new search area. Multiple clues entered.
>
> Day 9 21 searchers for 4 hrs, 2 new search areas. Multiple clues entered
>
> Other teams searched different locations which should also be recorded.
> A large number of search areas were required.
> Some areas can be relatively small and overlap.
> Same search area may be fully or partially searched more than once.

**Derived meaning:** Fixtures and workflows must cover nine-outing searches,
changing rosters, long days, many overlapping/revisited areas, clues, and
outside-team evidence.

**Programme trace:** BCP-03, BCP-04, BCP-06, BCP-08, BCP-09, BCP-12,
BCP-13, BCP-17.

---

## Answer Round 2 — Traccar And Period Clarifications

### SAR-QA-010 — Day means outing

**Question:**

> Does “day” mean a calendar date, or an operational outing that might cross
> midnight?

**Team answer:**

> Outing

**Derived meaning:** Outing is canonical; calendar date is display-only.

**Programme trace:** BCP-03, BCP-08, BCP-09, BCP-12.

### SAR-QA-011 — Meaning of 100 devices

**Question:**

> Is 100 the total number of simultaneous trackers including outside teams,
> or 100 KMRT trackers plus outside teams?

**Team answer:**

> The 100 would be the number of active devices registered in Traccar, divided
> into Groups (teams).

**Derived meaning:** The Traccar qualification envelope is 100 active devices
total, partitioned by groups.

**Programme trace:** BCP-04, BCP-06, BCP-17.

### SAR-QA-012 — Distance and stationary reports

**Question:**

> Does the 25-metre interval mean the tracker sends only after moving 25
> metres, or are there additional timed/stationary reports?

**Team answer:**

> In some circumstances the 25 metres might be changed to suit local
> conditions.
> If a device does not send distance induced data for a set time (presently 20
> mins) location data is sent. This is a safety check - if the data sent
> indicates the searcher has not moved for 2 or more data points it would be
> desireable for Sartracker to highlight this to the operator.

**Derived meaning:** Distance is configurable. Stationary attention uses
accepted fixes and the current approximately-20-minute heartbeat; it is an
operator attention state, not a claim that the source record is wrong.

**Programme trace:** BCP-01, BCP-05, BCP-06.

### SAR-QA-013 — Traccar database immutability

**Question:**

> “There should be no corrected positions” probably means operators must not
> edit breadcrumb locations. But if Traccar later sends different data for the
> same source fix, should SAR Tracker preserve the original as primary, or
> display the newer version while retaining both in the audit record?

**Team answer:**

> The operator must not be able to change the data.
> As the Traccar data is held in a database it should not change

**Derived meaning:** This categorically answers source semantics. One Traccar
database row is one immutable source fix. Identical repeated reads are one
record, not multiple observations. Any same-ID/different-content response is
an engineering integrity alarm; preserve it defensively but do not ask the
team to invent normal workflow semantics for it.

**Programme trace:** BCP-02, BCP-10.

### SAR-REPEAT-001 — Verbatim resubmission of `SAR-QA-010` through `SAR-QA-013`

The source transcript contains the four-question clarification block twice,
word for word. It is retained twice in the raw file. It introduces no changed
answer and therefore does not receive four new semantic requirement IDs.

**Cross-reference:** `SAR-QA-010`, `SAR-QA-011`, `SAR-QA-012`, `SAR-QA-013`.

---

## Answer Round 3 — Mission Governance Clarifications

### SAR-QA-014 — Outing ownership and overlap

**Question:**

> Is an outing one mission-wide period started and ended by the coordinator,
> even when individual searchers join or leave at different times? Can two
> outings overlap?

**Team answer:**

> yes
>
> They should not overlap

**Derived meaning:** One coordinator-owned mission-wide outing may cross
midnight and contain changing participant windows. Outings do not overlap.

**Programme trace:** BCP-03, BCP-04, BCP-12.

### SAR-QA-015 — Participant selection

**Question:**

> At mission start, should the coordinator select the participating Traccar
> groups/devices, or should every device registered on the server automatically
> be recorded? I recommend explicit group/device selection with the ability to
> add participants later.

**Team answer:**

> Yes
>
> Not by Sartracker.
>
> Yes, by the coordinator.

**Derived meaning:** The coordinator explicitly selects participants and may
add them later. SAR Tracker never auto-enrols the whole server.

**Programme trace:** BCP-04.

### SAR-QA-016 — Stationary warning timing

**Question:**

> Should the stationary warning appear after two positions roughly 20 minutes
> apart show no meaningful movement, or only after two complete stationary
> intervals—roughly 40 minutes? I recommend warning after the first confirmed
> 20-minute interval, with acknowledgement available but the warning remaining
> visible until movement resumes.

**Team answer:**

> Yes, 20 mins.

**Derived meaning:** Two accepted positions approximately 20 minutes apart are
sufficient for accuracy-aware stationary attention.

**Programme trace:** BCP-05.

### SAR-QA-017 — Timeline semantics

**Question:**

> When the mission timeline is moved to a particular time, should it
> reconstruct the mission data known at that time—tracks, positions, clues and
> search areas—rather than reproduce the exact map zoom, filters and screen
> layout the coordinator happened to be using? I recommend data-state replay.

**Team answer:**

> Yes, as recommended.

**Derived meaning:** Timeline replay reconstructs mission data state, not
transient screen state.

**Programme trace:** BCP-12.

### SAR-QA-018 — Repeated search passes

**Question:**

> For repeated searches of the same area, should the coordinator explicitly
> record each pass as fully searched, partially searched or aborted? I
> recommend yes; breadcrumb-derived coverage should advise and warn, but never
> decide that an area was completed.

**Team answer:**

> Coordinator decides.

**Derived meaning:** Each pass is explicit and operator-declared. Geometry is
advisory only.

**Programme trace:** BCP-13.

### SAR-QA-019 — GPX files without timestamps

**Question:**

> If an imported GPX file has no timestamps, should it appear as static
> evidence assigned to an outing but be excluded from precise timeline replay?
> I recommend yes—never invent timestamps.

**Team answer:**

> Never invent timestamp.

**Derived meaning:** Undated GPX may be static outing evidence but cannot
participate in precise time replay.

**Programme trace:** BCP-11, BCP-12.

### SAR-QA-020 — Finalization, retention, and archive protection

**Question:**

> After a mission is finalized, should it become read-only, with mistakes
> handled through visible revisions rather than deletion? Also, what retention
> period or existing evidence procedure must we follow? I recommend no
> automatic deletion of operational evidence and a self-contained archive with
> a cryptographic hash manifest.

**Team answer:**

> Yes to read-only, with revisions.
> Retention of finalised mission - indefinite. No deletion.
> Encrypt yes when finalised, archived and locked.

**Derived meaning:** Finalized missions are read-only; revisions remain
visible; retention is indefinite; there is no deletion path; finalized
archives are encrypted and locked. The cryptographic hash-manifest detail is
an engineering integrity requirement and was not explicitly confirmed by this
answer.

**Programme trace:** BCP-12, BCP-14, BCP-15, BCP-16, BCP-17.

---

## Closed Duplicate — Do Not Send

### SAR-DUP-001 — Repeated receipt timestamps for one Traccar row

**Proposed question, withdrawn before sending:**

> If SAR Tracker receives the exact same rejected Traccar record repeatedly,
> must it retain a separate timestamp for every time it was received, or is
> retaining the exact record once—with first seen, last seen, and number of
> times seen—sufficient?

**Why it must not be sent:** `SAR-QA-006` and especially `SAR-QA-013` already
establish that the source fix is an immutable Traccar database record. Polling
the same row repeatedly does not create multiple source fixes. Deduplication
and transport provenance are engineering mechanics, not a new operator
decision.

**Decision:** Persist one unique source record. Identical deliveries are
idempotent. Optional first/last/count fields describe SAR Tracker transport
behaviour only.

**Programme trace:** BCP-02.

---

## New-Question Gate

Every proposed team question must be added here as a draft before it is sent:

```text
Proposed ID:
Question:
Related prior IDs:
Why the prior answers do not resolve it:
Operational decision owner:
Implementation blocked if unanswered: yes/no
```

If `Why the prior answers do not resolve it` cannot be stated in ordinary
operational language, the question is not sent. It is either already answered
or is an engineering decision the project must make itself.
