# Team Testing Feedback Loop

> Use this while the team is testing the hosted browser build.

## Testing URL

Open:

```text
https://sartracker-web.vercel.app/?missionHarness=1
```

In hosted browser mode, Traccar settings should use:

```text
Provider base URL: https://sartracker-web.vercel.app
Auth mode: Basic
Email: apiuser
Password: apiuser
```

Do not enter the direct HTTP Traccar URL in the hosted browser app. Browsers block HTTPS pages from calling HTTP services directly; the Vercel URL is the HTTPS proxy.

## What We Want The Team To Test Now

- Can they start a mission without confusion?
- Can they connect tracking and see devices?
- Are tracked devices readable on the map?
- Do layers hide/show exactly what they expect?
- Do Devices, Layers, Settings, and Diagnostics make sense?
- Are the mission controls in the right place?
- Are labels, colors, and statuses understandable?
- What UI layout changes would make this calmer under pressure?

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


## Where were you?

- URL:
- Mission name:
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

## Triage Buckets

| Bucket | Meaning | Typical action |
| --- | --- | --- |
| Critical hosted blocker | They cannot start mission, connect tracking, see map, or continue testing | Fix immediately, redeploy Vercel |
| Shared app bug | Real bug likely affects browser and Tauri | Fix with tests, deploy Vercel, later verify desktop |
| UI/wording/layout feedback | The app works but feels confusing or awkward | Batch into focused UI iterations |
| Desktop-runtime candidate | Persistence, recovery, filesystem, diagnostics, GPX watch, map packages | Route to Phase 1/2 Tauri work |
| Future hardening | IndexedDB, browser operational mode, shared missions | Defer until explicit browser-hardening decision |

## Response Cadence

- Fix critical hosted blockers as soon as possible.
- Batch UI changes where possible so testers are not chasing a moving layout every hour.
- Keep a short changelog for each Vercel update.
- Promote only coherent, tested batches to Tauri beta.

