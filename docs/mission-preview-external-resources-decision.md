# DON-198 Mission Preview, Map Sharing, And External Resources Decision

Date: 2026-06-20

Source: `team-feedback/install-tests/Install_Tests.extracted.md`

## Decision

DON-198 is a decision and split-ticket item, not a beta.8 implementation item. The tester notes ask for mission preview, map sharing, non-team resource handling, evacuation/gear logs, and multi-day grouping, but several of those choices affect operational workflow and data ownership. They should not be silently bundled into low-level UI polish.

## Mission Preview

Future mission preview should be a read-only map view of mission context, not an editing surface. The preview should reuse the operational overlay stack where possible:

- markers and marker labels
- drawings, search areas, range rings, sectors, bearings, and text labels
- GPX imports
- helicopter slots if relevant to the mission
- tracking current positions and breadcrumbs when mission data is available
- layer visibility and basemap context where safely recoverable

The preview must not allow marker, drawing, tracking, GPX, or mission lifecycle mutation. Editing remains in active mission workflows. Multi-day layer grouping is not solved here; `DON-100` remains the canonical issue for day/date grouping.

## Map Image Sharing

Map sharing should not be WhatsApp-specific inside SAR Tracker. The safer product boundary is a local export/print workflow:

- SAR Tracker creates a sanitized map snapshot or printable file.
- The operator chooses how to send it using normal OS/team channels.
- The app should make the export provenance clear enough that recipients know the mission, timestamp, map extent, and whether live tracking data may be stale.

This does not belong in the current beta.8 implementation batch unless explicitly re-prioritized. It should be a separate implementation ticket because it touches canvas/map export, filesystem behavior, privacy, and operator evidence expectations.

## External And Non-Team Resources

For beta.8, the low-risk workflow for external resources is imported evidence, especially GPX files, plus clear naming and Layer Tree visibility. SAR Tracker should not manage temporary Traccar groups for Galway, SEMRA, drone-derived tracks, or other external resources until the team decides the ownership and lifecycle model.

Future work should define an explicit external-resource model. It must decide whether each resource is:

- live tracked through Traccar
- imported as GPX or another file artifact
- manually recorded as operational context
- grouped by team, day, search area, or tasking

The model also needs deletion/retention rules and audit behavior before implementation.

## Evacuation And Gear Logs

Evacuation and gear logs should not be absorbed into marker details or map layers by default. They are operational/admin workflows with different retention, audit, and handover expectations. They need a separate workflow decision before any UI or persistence work.

## Follow-Up Tickets

DON-198 should be closed after this decision is recorded and follow-up tickets are linked:

- `DON-215` Mission Preview: read-only map context view.
- `DON-216` Map Export/Print: local snapshot/shareable map evidence.
- `DON-217` External Resources: model non-team live/imported resources.
- `DON-218` Evacuation/Gear Logs: decide whether SAR Tracker owns this workflow.
