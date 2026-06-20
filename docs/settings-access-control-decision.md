# DON-199 Settings And Coordinator Access Control Decision

Date: 2026-06-20

Source: `team-feedback/install-tests/Install_Tests.extracted.md`

## Current Behavior

Settings is directly reachable from the command mast. Mission Defaults include the coordinator roster and admin roster. The finalized-mission unlock dialog loads the current admin roster from Settings, requires an admin name and a reason, and records the unlock in the mission audit trail.

That is an audit and workflow guard. It is not an authentication boundary.

## Decision

DON-199 should be closed as design and split-ticket work. The team feedback is valid, but it should not be solved by adding superficial password prompts without a locked access model. This app is currently deployed on trusted team machines with local desktop settings; a local-only guard can reduce accidental or casual misuse, but it must not be described as strong identity security.

## Protected Surfaces

Future access-control work should protect these surfaces first:

- editing coordinator and admin rosters
- changing mission roots, autosave, official-map package settings, and tracking provider settings
- unlocking finalized missions
- advanced repair/support actions once they become active

Normal map operation, mission review, diagnostics export, and emergency mission continuation must remain reachable enough that a guard cannot strand an operator during an incident.

## Beta Scope

For beta.8, the recommended direction is a lightweight local privileged-settings guard, not a full role/auth system:

- Make protected Settings sections require an explicit privileged mode before editing.
- Keep read-only Settings inspection available where practical.
- Record protected-setting changes in an audit-friendly way where the storage model supports it.
- Clearly label this as a local operational guard, not cloud identity or cryptographic access control.

Full multi-user identity, remote authorization, and cross-machine roles are out of scope until the team decides whether SAR Tracker will own shared mission state.

## Unlock Authority

Mission unlock should not depend only on the live mutable Settings roster. Future work should define a mission-scoped unlock authority model, such as a roster snapshot captured at mission finalization or another explicit governance authority record.

The design must include recovery behavior. A locked-out operational machine needs a documented recovery route that is safer than editing JSON by hand during an incident.

## Follow-Up Tickets

- `DON-219` Privileged Settings Mode: protect mission-affecting settings locally.
- `DON-220` Mission Unlock Authority: stop relying only on the live mutable Settings roster.
- `DON-221` Access Recovery: define documented recovery behavior for lost privileged access.
