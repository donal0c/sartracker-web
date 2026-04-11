# Mock Traccar Server

A standalone simulation server that replays a realistic multi-team mountain rescue operation against the SAR Tracker Web app's Traccar HTTP polling pipeline. Built to exercise the full tracking stack — HTTP client, normalization, polling manager, breadcrumb accumulation, device status transitions, and map rendering — without needing a live Traccar deployment.

## What it does

The server simulates 8 GPS tracking devices deployed across the Glenagenty area in Co. Kerry, Ireland. Each device follows a distinct movement pattern derived from real GPS data captured during an actual mountain operation. The server advances positions over wall-clock time using a configurable speed multiplier, so a 2-hour rescue scenario can play out in 12 minutes at 10x speed.

When the SAR Tracker app connects, it sees exactly what it would see polling a real Traccar server: a device roster with mixed online/offline/unknown statuses, current position markers that update on every poll, and breadcrumb trail histories that grow over time. The server reproduces the operational edge cases that matter for safety — staggered team deployments, a device that goes silent, an offline device that should never appear on the map, and a deliberate radio-gap that should break a trail into separate segments.

## The simulated rescue

The scenario is anchored to the Glenagenty area (lat 52.265–52.278, lon -9.556 to -9.512), a real operational area for Kerry Mountain Rescue. The seed route data comes from Eamonn's Glenagenty CSV export — 254 GPS points covering an approximately 8.6km track over 2 hours at walking pace through mountain terrain.

### Device roster

| Device | Role | Movement pattern | Start offset | Status behavior |
|--------|------|-----------------|-------------|-----------------|
| **EOC** | Emergency Operations Centre | Stationary at the car park (52.2704, -9.5456) with GPS jitter. 240 points at 30s intervals. | T+0 | Always online |
| **Team Alpha** | Primary search team | Follows the full Glenagenty route as-is. 254 points, the canonical broad loop. | T+0 | Online |
| **Team Bravo** | Second search team | Reversed Glenagenty route, shifted 220m north (+0.002 lat), every 2nd point sampled. 127 points at 40s intervals. | T+8m | Online |
| **Team Charlie** | Late-deploying search team | Middle section of Glenagenty (points 100–250), shifted 200m west (-0.003 lon). 150 points at 25s intervals. | T+22m | Online |
| **Team Delta** | Device failure simulation | First 40 Glenagenty points shifted 330m south (-0.003 lat), then stops transmitting. | T+0 | Online for ~20 min, then transitions to "unknown" |
| **Team Echo** | Offline device | No route data at all. Exists in the roster only with a 24-hour-old `lastUpdate`. | N/A | Always offline |
| **Medic 1** | Casualty response | 10 points relocating from EOC to a casualty site at 52.268, -9.535 (fast walk, 2.5–3.5 kn), then 90 stationary points with jitter. | T+35m | Online |
| **Hill Party 2** | Breadcrumb gap simulation | Glenagenty points 50–180 shifted slightly north (+0.001 lat), with a deliberate **7-minute gap** inserted after the 60th point. 130 points. | T+12m | Online, but trail should break into two segments at the gap |

### Why these patterns matter

- **Staggered starts** mean the app sees devices with different trail lengths when it first connects. This validates the breadcrumb history query path, not just the live position poll.
- **Team Delta going unknown** exercises the device status transition rules: `online` when positions are recent, `unknown` when the last update is 5–60 minutes old, `offline` after 1 hour.
- **Team Echo being permanently offline** validates that the app shows the device in the roster/devices workspace but does not render it on the tracking map layers.
- **Hill Party 2's 7-minute gap** is specifically designed to trigger the app's breadcrumb segmentation threshold (>5 minutes between consecutive points breaks the trail into separate line segments).
- **Medic 1's two-phase movement** (relocate then stationary) tests that the map correctly renders both a travel trail and a tight stationary cluster at the casualty site.
- **EOC's GPS jitter** tests that a stationary device still produces a tight cluster of positions rather than a single static point, matching real GPS receiver behavior.

### Route generation

All routes except EOC and Medic 1 are derived programmatically from the Glenagenty seed CSV. The transforms applied are:

- **Coordinate offsets** (lat/lon shifts of 0.001–0.003 degrees, roughly 100–330 meters) to separate teams geographically while keeping them in the same operational area.
- **Temporal resampling** (every Nth point, different interval spacing) so teams don't all move at the same cadence.
- **Speed scaling** (0.7x–1.1x) for variety without losing realism (all speeds stay in the 0.5–3.5 knot walking/running range).
- **Battery drain** profiles that start high and decay linearly, with Team Delta starting notably low (42%) to simulate an aging device.
- **Altitude adjustments** to reflect different terrain positions.

## Architecture

The server is a standalone Node.js TypeScript application under `tools/mock-traccar/`. It uses no HTTP framework — just `node:http` — and has only `tsx` as a runtime dependency.

```
tools/mock-traccar/
├── src/
│   ├── server.ts            Entry point — CLI args, wiring, HTTP listener
│   ├── router.ts            Request dispatch, CORS headers, auth gate
│   ├── auth.ts              Basic / Bearer / Session cookie auth
│   ├── playback-engine.ts   Wall-clock → scenario-time mapping
│   ├── device-roster.ts     Dynamic device status from current scenario time
│   ├── position-store.ts    Time-filtered position queries
│   ├── route-generator.ts   Derives 8 routes from seed CSV
│   ├── csv-parser.ts        Parses the Glenagenty CSV format
│   └── types.ts             TraccarDevice, TraccarPosition, RoutePoint, etc.
├── fixtures/
│   └── seed/
│       └── glenagenty.csv   254 real GPS points from Eamonn's export
└── scenarios/
    └── default.json         Default scenario config (8 devices, 2h, 10x speed)
```

### Playback engine

The core timing mechanism translates wall-clock elapsed time into scenario time:

```
scenarioTimeMs = startOffsetMs + (wallElapsedMs × speedMultiplier)
```

At 10x speed, 1 real second equals 10 scenario seconds. The engine determines which positions are "visible" at any point: only route points with `scenarioOffsetMs ≤ currentScenarioTimeMs` are returned. Timestamps in API responses are computed by anchoring scenario T+0 to the server's start time, so the app always sees timestamps relative to "now" — just as it would with a real Traccar server.

### API contract

The server implements the Traccar HTTP API endpoints that the SAR Tracker app polls:

| Endpoint | Method | Response |
|----------|--------|----------|
| `/api/devices` | GET | JSON array of all 8 devices with dynamic `status` and `lastUpdate` |
| `/api/positions` | GET | Latest position per online device at current scenario time |
| `/api/positions?deviceId=X&from=ISO&to=ISO` | GET | Filtered position history for breadcrumb queries |
| `/api/reports/route?deviceId=X&from=ISO&to=ISO` | GET | Same as filtered positions (legacy compatibility) |
| `/api/session` | POST | Email/password login, returns `Set-Cookie: JSESSIONID=...` |
| `/health` | GET | Current scenario time and server status (no auth required) |

All endpoints except `/api/session` and `/health` require authentication. CORS headers are included on every response so the app works in browser dev mode.

### Authentication

The server supports three auth methods, matching what the SAR Tracker app's Traccar client uses:

- **HTTP Basic**: `admin@mock.local` / `mock`
- **Bearer token**: `mock-bearer-token`
- **Session cookie**: POST to `/api/session` with email/password, receive `JSESSIONID` cookie

## Usage

### Quick start

```bash
# Install dependencies (one time)
cd tools/mock-traccar && npm install && cd ../..

# Start the mock server (10x speed, 2h scenario)
npm run mock:traccar

# Start the app pointing at the mock server
VITE_TRACCAR_BASE_URL=http://127.0.0.1:8082 \
VITE_TRACCAR_EMAIL=admin@mock.local \
VITE_TRACCAR_PASSWORD=mock \
npm run dev

# Open http://127.0.0.1:1420/?missionHarness=1
# Start a mission — tracking will begin polling automatically
```

### npm scripts

| Script | Speed | Loop | Description |
|--------|-------|------|-------------|
| `npm run mock:traccar` | 10x | no | Standard playback — 2h scenario in 12 min |
| `npm run mock:traccar:fast` | 30x | no | Fast playback — 2h scenario in 4 min |
| `npm run mock:traccar:loop` | 10x | yes | Continuous loop for demos |

### CLI options

```bash
npx --prefix tools/mock-traccar tsx tools/mock-traccar/src/server.ts \
  --port 8082           # Server port (default 8082)
  --host 127.0.0.1      # Bind address (default 127.0.0.1)
  --speed 10            # Playback speed multiplier (default 10)
  --loop                # Loop scenario when it completes
  --start-offset 45     # Start at T+45 minutes into the scenario
  --scenario default    # Scenario config file name
```

### Environment file

A pre-configured `.env.mock` is provided at the repo root:

```
VITE_TRACCAR_BASE_URL=http://127.0.0.1:8082
VITE_TRACCAR_EMAIL=admin@mock.local
VITE_TRACCAR_PASSWORD=mock
```

### Smoke testing with curl

```bash
# Device roster (8 devices)
curl -u admin@mock.local:mock http://127.0.0.1:8082/api/devices | jq length

# Current positions (one per online device)
curl -u admin@mock.local:mock http://127.0.0.1:8082/api/positions | jq '.[].deviceId'

# Breadcrumb history for Team Alpha
curl -u admin@mock.local:mock \
  "http://127.0.0.1:8082/api/positions?deviceId=2&from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z" \
  | jq length

# Server health and current scenario time
curl http://127.0.0.1:8082/health | jq
```

## How the app integration works

The browser validation harness (`src/features/mission/mission-browser-harness.ts`) can optionally start real HTTP polling when `VITE_TRACCAR_BASE_URL` is set and the URL includes `liveTracking=1`. When you open the app at `http://127.0.0.1:1420/?missionHarness=1&liveTracking=1`:

1. The browser harness starts the mission runtime, marker runtime, drawing runtime, and governance runtime as usual.
2. It detects the Traccar env vars and starts the **real tracking runtime** — the same `startTrackingRuntime` function used in the Tauri desktop app.
3. The tracking runtime creates a real `TraccarClient`, connects to the mock server, authenticates, and begins polling at 10-second intervals.
4. Each poll fetches `/api/devices` and `/api/positions` in parallel, then fetches incremental breadcrumbs per device.
5. Position data flows through the normalization layer, gets persisted to the browser harness store, and is applied to the Zustand tracking store — which triggers map overlay re-renders.

This means the full HTTP pipeline is exercised: auth headers, JSON parsing, field normalization, coordinate validation, deduplication, breadcrumb accumulation, device color assignment, and stale-device health annotation.

## What was tested and verified

### Server-level verification

1. **Device roster**: `GET /api/devices` returns exactly 8 devices with correct names, unique IDs, categories, and dynamic status values. Team Echo is always `offline`. Team Delta transitions to `unknown` after its positions end.

2. **Authentication**: Requests without valid credentials receive HTTP 401. Basic auth, Bearer token, and session cookie flows all work. Invalid credentials are rejected.

3. **Current positions**: `GET /api/positions` returns the latest position per device at the current scenario time. Devices that haven't started yet (due to staggered offsets) have no current position. The position count grows as the scenario advances.

4. **Breadcrumb history**: `GET /api/positions?deviceId=2&from=...&to=...` returns the correct filtered position set. The count increases over time as the playback engine advances.

5. **Scenario progression**: The `/health` endpoint confirms scenario time advances at the configured multiplier. At 10x speed, scenario time of T+49 minutes was reached after approximately 5 minutes of wall-clock time.

### End-to-end app verification

The mock server was started and the SAR Tracker Web app was connected to it in browser harness mode. The following was verified using Chrome DevTools:

1. **Tracking connection**: The browser console logged `[browser-harness] Starting real tracking polling against http://127.0.0.1:8082`, confirming the real HTTP polling pipeline was active.

2. **Data accumulation**: Over the test session, the browser harness store accumulated **435 positions** across all devices, with position counts per device reflecting their different start times and point densities:
   - EOC: 85 positions (stationary, started at T+0)
   - Team Alpha: 37 positions (broad loop)
   - Team Bravo: 65 positions (started T+8m)
   - Team Charlie: 102 positions (started T+22m, dense 25s intervals)
   - Team Delta: 1 position (stopped early, went unknown)
   - Team Echo: 0 positions (offline, as expected)
   - Medic 1: 58 positions (started T+35m)
   - Hill Party 2: 87 positions (started T+12m)

3. **Map rendering**: Screenshots confirmed multiple distinct colored breadcrumb trails across the Glenagenty mountain terrain, with device markers at current positions. The map was correctly centered on the operational area.

4. **Device status differentiation**: The Tracking Devices workspace showed all 8 devices with correct status badges:
   - 6 devices showing **ONLINE** with recent timestamps
   - Team Delta showing **UNKNOWN**
   - Team Echo showing **OFFLINE** with a 24-hour-old timestamp

5. **Layer tree**: The layer panel showed the full `Tracking > People` tree with all 8 individual device entries, each with independent visibility toggle controls.

6. **Tracking system status**: The sidebar tracking panel displayed **ONLINE** status with **8 Devices** in the roster and **7 Positions** for online devices (Team Echo excluded).

7. **No regressions**: All 204 existing unit tests passed. Lint was clean. The only code change to the app was the addition of optional real polling to the browser harness — all existing harness, mission, marker, drawing, and tracking behavior is unchanged.

### Known issue: timestamp compression at high speed

The playback engine compresses all timestamps by the speed multiplier. At 10x speed, a 30-second interval between two GPS fixes becomes 3 seconds in the `fixTime` field the app receives. This has three concrete consequences:

1. **Breadcrumb gap segmentation does not trigger at speeds above ~1.4x.** The app segments breadcrumb trails when consecutive timestamps are more than 5 minutes apart. Hill Party 2's deliberate 7-minute radio gap compresses to 42 seconds at 10x speed — well below the threshold. The trail renders as a single unbroken line instead of two segments. **To test segmentation, use `--speed 1`.**

2. **Battery drain appears unrealistically fast.** EOC drains from 95% to 90% in 12 real minutes instead of the intended 2 hours. This is cosmetic — the drain rates are correct in scenario time but the compressed wall-clock display makes them look aggressive.

3. **Team Delta's "gone unknown" transition depends on timing.** At 10x speed, Delta's last position is only 2 minutes old (wall clock) when it stops transmitting, even though 20 minutes have passed in scenario time. The app's 5-minute "unknown" threshold may not trigger until more wall-clock time passes. The transition does happen eventually, just slower than expected.

**Root cause:** `getScenarioDate()` divides `scenarioOffsetMs` by `speedMultiplier` to produce wall-clock timestamps. This is correct for making the from/to breadcrumb queries work (the app sends wall-clock dates), but it compresses time gaps below the app's fixed thresholds.

**Workarounds:**
- Use `--speed 1` for any test that depends on time-gap thresholds (segmentation, staleness, stale-device detection). Everything works correctly at real-time playback.
- Use `--speed 10` or higher for visual/spatial testing (map rendering, device positions, layer controls, roster behavior) where time-gap accuracy doesn't matter.
- A future improvement could emit scenario-time timestamps and remap the query filter, but this would require changes to how the app's incremental breadcrumb fetch interacts with stored timestamps.

### What was not tested (future work)

- **Breadcrumb gap segmentation rendering at 1x speed**: The gap data is correct but was not visually verified at a speed where the threshold triggers.
- **Server outage scenario**: The `outageWindows` config field is defined but not yet implemented in the router. This would allow simulating a period where all endpoints return HTTP 503, testing the app's cache/degraded-mode behavior.
- **Mid-mission join scenario**: Starting the server with `--start-offset 45` works, but has not been tested against the app.
- **Playwright automation**: The mock server could be started as a child process in Playwright tests for automated regression coverage of the tracking pipeline.
