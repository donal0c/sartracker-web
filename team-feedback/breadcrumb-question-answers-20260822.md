# Breadcrumb Questions And Team Answers — Raw Transcript

Received from Donal: 2026-08-22

Status: **Verbatim source record.** Wording, ordering, spelling, and the repeated
four-question block are intentionally preserved. Interpretations and programme
cross-references belong in
`docs/breadcrumb-team-question-and-answer-ledger.md`, not in this file.

---

1. Does “all fixes on the map” literally mean every dot simultaneously, or does it mean every person’s complete route must remain visible with no missing sections?

All breadcrumbs should be shown for each device for current mission to date with the ability to omit previous periods data points selectively per device per day.


2. During a live search, what matters most: current positions, searched ground, gaps in coverage, or inspecting a particular fix and time?

The most important is current position so the coordinators are fully aware of each position for safety of all involved. This followed closely by area searched.


3. Should “All days” be the normal view, with optional day filters? Does a day mean midnight-to-midnight or a particular outing/deployment?

a. Default View:- All mission data shown to date, with day filters etc. as per answer 1. above.



4. How should other rescue teams appear—live Traccar devices, imported GPX afterwards, or both?

Both


5. What is the real maximum: people, tracker interval, hours per outing, days per mission and outside teams?

People:             100
Tracker Interval:   25 metres  interval between data points (breadcrumbs).
Hours per Outing:   12 hours
Days per Mission:   12
Outside Teams:      These are determined by the 'Groups' created in Traccar. There are approximately 12 separate SAR groups in the country.


6. How should late or corrected tracker positions be handled? Must both the original and correction remain visible in the audit history?

There should be no corrected positions.


7. What would they expect to produce after an incident: raw fixes, named tracks, timestamps, accuracy, map image, audit history, or all of those?

All of those with the added ability to open and display the saved mission on a time line.


8. Would it be acceptable for older tracks to fill in progressively over a few seconds, provided current locations remain immediate and no coverage is omitted?

Yes including a progress bar.


9. Can they walk us through one anonymised real multi-day search and show exactly what decisions they need the map to support?


Multi-day search, example for KMRT only.

Location, breadcrumb trail for each device, search area, clue info vital for each day.

Day 1    25 searchers for 5 hrs, 2 search areas created.

Day 2    35 searchers for 12 hrs, 5 new search areas created. Multiple clues entered.

Day 3    34 searchers for 12 hrs, 6 new search areas. Multiple clues entered.

Day 4    20 searchers for 4 hrs, 1 new search area.  Multiple clues entered.

Day 5   18 searchers for 4 hrs, 1 new search area.  Multiple clues entered.

Day 6   32 searchers for 12 hrs, 5 new search areas. Multiple clues entered.

Day 7  35 searchers for 11 hrs, 6 new search areas. Multiple clues entered.

Day 8  22 searchers for 4 hrs, 1 new search area. Multiple clues entered.

Day 9  21 searchers for 4 hrs, 2 new search areas. Multiple clues entered

Other teams searched different locations which should also be recorded.
A large number of search areas were required.
Some areas can be relatively small and overlap.
Same search area may be fully or partially searched more than once.


1. Does “day” mean a calendar date, or an operational outing that might cross midnight?

Outing

2. Is 100 the total number of simultaneous trackers including outside teams, or 100 KMRT trackers plus outside teams?

The 100 would be the number of active devices registered in Traccar, divided into Groups (teams).

3. Does the 25-metre interval mean the tracker sends only after moving 25 metres, or are there additional timed/stationary reports?

In some circumstances the 25 metres might be changed to suit local conditions.
If a device does not send distance induced data for a set time (presently 20 mins) location data is sent. This is a safety check - if the data sent indicates the searcher has not moved for 2 or more data points it would be desireable for Sartracker to highlight this to the operator.


4. “There should be no corrected positions” probably means operators must not edit breadcrumb locations. But if Traccar later sends different data for the same source fix, should SAR Tracker preserve the original as primary, or display the newer version while retaining both in the audit record?

The operator must not be able to change the data.
As the Traccar data is held in a database it should not change


1. Does “day” mean a calendar date, or an operational outing that might cross midnight?

Outing

2. Is 100 the total number of simultaneous trackers including outside teams, or 100 KMRT trackers plus outside teams?

The 100 would be the number of active devices registered in Traccar, divided into Groups (teams).

3. Does the 25-metre interval mean the tracker sends only after moving 25 metres, or are there additional timed/stationary reports?

In some circumstances the 25 metres might be changed to suit local conditions.
If a device does not send distance induced data for a set time (presently 20 mins) location data is sent. This is a safety check - if the data sent indicates the searcher has not moved for 2 or more data points it would be desireable for Sartracker to highlight this to the operator.


4. “There should be no corrected positions” probably means operators must not edit breadcrumb locations. But if Traccar later sends different data for the same source fix, should SAR Tracker preserve the original as primary, or display the newer version while retaining both in the audit record?

The operator must not be able to change the data.
As the Traccar data is held in a database it should not change
1. Is an outing one mission-wide period started and ended by the coordinator,

yes


even when individual searchers join or leave at different times? Can two outings overlap?

They should not overlap


2. At mission start, should the coordinator select the participating Traccar groups/devices,

Yes

or should every device registered on the server automatically be recorded?

Not by Sartracker.


I recommend explicit group/device selection with the ability to add participants later.

Yes, by the coordinator.



3. Should the stationary warning appear after two positions roughly 20 minutes apart show no meaningful movement, or only after two complete stationary intervals—roughly 40 minutes? I recommend warning after the first confirmed 20-minute interval, with acknowledgement available but the warning remaining visible until movement resumes.

Yes, 20 mins.



4. When the mission timeline is moved to a particular time, should it reconstruct the mission data known at that time—tracks, positions, clues and search areas—rather than reproduce the exact map zoom, filters and screen layout the coordinator happened to be using? I recommend data-state replay.

Yes, as recommended.



5. For repeated searches of the same area, should the coordinator explicitly record each pass as fully searched, partially searched or aborted? I recommend yes; breadcrumb-derived coverage should advise and warn, but never decide that an area was completed.

Coordinator decides.


6. If an imported GPX file has no timestamps, should it appear as static evidence assigned to an outing but be excluded from precise timeline replay? I recommend yes—never invent timestamps.

Never invent timestamp.


7. After a mission is finalized, should it become read-only, with mistakes handled through visible revisions rather than deletion? Also, what retention period or existing evidence procedure must we follow? I recommend no automatic deletion of operational evidence and a self-contained archive with a cryptographic hash manifest.

Yes to read-only, with revisions.
Retention of finalised mission - indefinite. No deletion.
Encrypt yes when finalised, archived and locked.

---

Field follow-up supplied after the original answer rounds. The wording below is preserved verbatim; no receipt date is inferred.

SAR Tracker showed raw 2026-08-22T15:10:17.000Z while Traccar Replay showed 22/08/2026 16:10:17 during Irish summer time.

“Showing 10,000 exact fixes of 37,479.”

“current fixes were slow to come in.”

Following discussion with Sean we believe the breadcrumb fixed time should be taken from Traccar server and not from any other time.
