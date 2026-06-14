# Team Testing Feedback Loop

> Supporting tester instructions. The active queue and triage decisions live in `docs/two-track-execution-workplan.md`; fold any new work there before implementation.

## Quick Start For Testers

Use this hosted browser lane for training and feedback only. It is not the
installed field app and it does not provide durable incident persistence.

1. Open the hosted app:

```text
https://sartracker-web.vercel.app/?missionHarness=1
```

2. Confirm the amber **Browser testing mode** banner is visible.
3. Open **Settings** -> **Data Sources**.
4. Configure Traccar with:

```text
Provider base URL: https://sartracker-web.vercel.app
Auth mode: Basic
Email: apiuser
Password: apiuser
```

5. Use **Test Connection**. It should authenticate and find the team device roster.
6. Use **Save, Connect & Close**.
7. Start a mission from **Mission Control**.
8. If breadcrumbs look empty, start another test mission with **Start Offset** set to
   24 or 48 hours. The team test server sometimes has no movement in the last few
   hours even when current device fixes exist.

## URL Rules

```text
Hosted app URL: https://sartracker-web.vercel.app/?missionHarness=1
Hosted Traccar provider base URL: https://sartracker-web.vercel.app
Desktop/Electron direct Traccar URL: http://kmrtsar.eu:8082
Legacy/direct fallback URL: http://kmrtsar.ddns.net:8082
```

Do not enter the direct HTTP Traccar URL in the hosted browser app. Browsers
block HTTPS pages from calling HTTP services directly; the Vercel URL is the
HTTPS proxy. Settings warns on direct `http://` provider URLs in hosted browser
mode and offers the hosted proxy as the safe default.

The direct HTTP URL is still valid in the installed desktop app because the
browser mixed-content rule does not apply there. Use the Traccar web/API port
(`8082` for the team test server). Do not use tracker/device listener ports
such as `5055` in SAR Tracker settings; those ports are for devices sending
positions to Traccar and will fail the app connection test.

## What We Want The Team To Test Now

- Can they start a mission without confusion?
- Can they connect tracking and see devices?
- Are tracked devices readable on the map?
- Can they see breadcrumb tracks after using a suitable Start Offset? The hosted app now allows 0-48 hours; use a larger offset when the test server has no movement in the last few hours.
- Do layers hide/show exactly what they expect?
- Do Devices, Layers, Settings, and Diagnostics make sense?
- Are the mission controls in the right place?
- Are labels, colors, and statuses understandable?
- What UI layout changes would make this calmer under pressure?

## Current Tracking Test Notes

- The live team Traccar server can return current device records even when recent breadcrumb history is empty.
- If tracks do not appear, first try a larger mission Start Offset such as 24 or 48 hours.
- Hosted browser mode stores mission data in session storage for testing. Very large tracker-history imports are capped for persisted browser storage so session storage quota is not exceeded; the live map still draws the loaded tracker snapshot during the current session.

## What We Are Not Asking Them To Validate Yet

- Long-term mission persistence.
- Offline field use.
- High-definition proprietary map packages.
- Desktop installation.
- File import/watch reliability.
- Browser use for live incidents.

## Bug Report Template

```md
## What were you trying to do?


## What did you expect?


## What happened instead?


## Where and when did it happen?

- URL:
- Mission name:
- Mission start time or Start Offset:
- Browser:
- Machine / operating system:
- Settings/provider state:

## Evidence

- Screenshot/video:
- Console or network screenshot if available:

## Impact

- Blocks testing
- Confusing but workaround exists
- UI preference
- Nice-to-have
```

Use one report per issue. If several people hit the same problem, add their
browser/machine details to the same issue rather than creating separate copies.

## Triage Buckets

| Bucket | Meaning | Typical action |
| --- | --- | --- |
| Hosted-only | Only happens on Vercel/browser mode, especially session storage, HTTPS proxy, or browser restrictions | Track/Fix in hosted lane, then decide whether browser hardening is worth it |
| Critical hosted blocker | They cannot start mission, connect tracking, see map, or continue testing | Fix immediately, redeploy Vercel |
| Shared app bug | Real bug likely affects browser and Electron | Fix with tests, deploy Vercel, later verify desktop |
| UI/wording/layout feedback | The app works but feels confusing or awkward | Batch into focused UI iterations |
| Desktop-runtime candidate | Persistence, recovery, filesystem, diagnostics, GPX watch, map packages | Route to Phase 1/2 Electron work |
| Future hardening | IndexedDB, browser operational mode, shared missions | Defer until explicit browser-hardening decision |

## Response Cadence

- Fix critical hosted blockers as soon as possible.
- Batch UI changes where possible so testers are not chasing a moving layout every hour.
- Keep a short changelog for each Vercel update.
- Promote only coherent, tested batches to Electron beta.
