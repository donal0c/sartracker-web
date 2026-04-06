# S7: Traccar Integration Spike — Results

## Connection Test Results (2026-04-06)

**Server:** kmrtsar.ddns.net  
**Resolved IP:** 51.199.16.101  
**Traccar Version:** 6.11.1

| Port | Protocol | Status | Latency |
|------|----------|--------|---------|
| 5055 | OsmAnd (position ingestion) | OPEN | 47ms |
| 8082 | Traccar Web/API | OPEN | 35ms |

## API Accessibility

| Endpoint | Auth Required | Status |
|----------|--------------|--------|
| GET /api/server | No | 200 OK — returns version, config, timezone |
| POST /api/session | Yes (email + password) | 401 on bad creds — endpoint works |
| GET /api/session | N/A | 404 (GET not supported on this version) |
| GET /api/devices | Yes | 401 without auth |
| GET /api/positions | Yes | 401 without auth |
| GET /api/session?token=X | Yes (token auth) | 400 on invalid token — token auth path exists |

**Key findings:**
- Server registration is **closed** (`registration: false`) — no self-service account creation
- Session auth uses `POST /api/session` with `email` + `password` form fields → returns JSESSIONID cookie
- Token-based auth also exists (query param `?token=X`) — returns crypto validation error on bad token, confirming the code path exists
- Basic auth (Authorization header) likely also supported per Traccar standard patterns
- All data endpoints (devices, positions) require authentication

**To test authenticated endpoints, we need valid credentials from the KMRT SAR Traccar admin.**

## Server Configuration Notes

From `/api/server` response:
- **Timezone:** Europe/Dublin
- **Map:** googleHybrid
- **Geocoder:** enabled
- **Email/SMS:** disabled
- **OpenID:** disabled
- **Reports:** enabled
- **Storage:** not reported

## Comparison with Plugin's traccar_http.py Approach

The QGIS plugin (`traccar_http.py`, 1,942 lines) implements:

| Feature | Python Plugin | TS Spike |
|---------|--------------|----------|
| Auth | Basic auth + bearer token | Session + basic + bearer |
| Device caching | TTL-based with lock | In polling manager |
| Last-good cache | Disk-persisted JSON | In-memory (suitable for web) |
| Breadcrumbs | Bulk fetch + per-device fallback + parallel workers | Per-device via `getBreadcrumbs()` |
| Retry | Via HttpClient (3 retries) | Exponential backoff (configurable) |
| Stale detection | 4-hour cache max age (SAR life-safety) | Configurable threshold (default 5 min) |
| Position dedup | By device_id (current), by position (breadcrumbs) | By position ID across polls |
| Thread safety | RLock + per-thread sessions | Single-threaded (JS event loop) |
| Error hierarchy | ProviderAuthError/NetworkError/DataError | Standard Error (sufficient for spike) |

**What the plugin does that we should adopt for production:**
1. **Bulk breadcrumb fetch with fallback** — single `/api/positions?from=&to=` request for all devices, falling back to per-device if server doesn't support it. This is critical for missions with 15+ devices.
2. **Incremental breadcrumb mode** — per-device timestamps to fetch only new positions since the last known timestamp + 1 second. Reduces data transfer by 99%+ during long missions.
3. **4-hour cache max age** for SAR scenarios — remote mountain areas can have extended connectivity loss. Stale data with warnings is preferable to no data in life-safety scenarios.
4. **Future timestamp capping** (SAR-4vs) — devices with clock skew reporting future timestamps must be capped to prevent data loss.

## Recommendation: HTTP Polling vs WebSocket vs Hybrid

### Option 1: HTTP Polling (current spike approach)
- **Pros:** Simple, works through proxies/firewalls, stateless, easy retry
- **Cons:** Latency = polling interval, unnecessary requests when nothing changes
- **Best for:** Initial implementation, constrained environments

### Option 2: WebSocket (Traccar supports this)
- **Pros:** Real-time updates (~1s latency), no wasted requests, server pushes changes
- **Cons:** Connection management complexity, may not work through all proxies, needs reconnection logic
- **Traccar support:** `/api/socket` endpoint provides real-time position events via WebSocket
- **Best for:** Dashboard/live view where real-time matters

### Option 3: Hybrid (recommended for production)
- **WebSocket primary** for live position updates — immediate push of new positions
- **HTTP polling fallback** — if WebSocket disconnects, fall back to polling until reconnected
- **HTTP for breadcrumbs** — historical queries always via REST (WebSocket doesn't support time-range queries)
- **Pros:** Best of both worlds, graceful degradation
- **Cons:** More complex, but the Python plugin already proves this pattern works

**Recommendation: Start with HTTP polling (this spike), add WebSocket in a follow-up spike.** The hybrid approach is the right production target, but HTTP polling alone is sufficient for MVP and matches the battle-tested Python plugin's primary mode.

## Test Results

```
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

All pass criteria met:
- [x] TraccarClient correctly models Traccar API responses (device + position parsing)
- [x] Polling manager works with configurable intervals (fake timers test)
- [x] Retry + exponential backoff verified (3 failures then success)
- [x] Stale detection works (5-min threshold, identifies stale devices)
- [x] Connection test documents real server accessibility
- [x] Position deduplication (same ID not emitted twice across polls)
- [x] Last-good cache serves cached data on fetch failure
- [x] Authentication: session cookie, basic auth, bearer token all tested

## Next Steps

1. **Obtain credentials** from KMRT SAR Traccar admin to test authenticated endpoints
2. **WebSocket spike** — implement `/api/socket` connection for real-time updates
3. **Integrate into SAR Tracker web app** — TraccarClient as a provider, PollingManager driving the map layer
4. **Production hardening** — bulk breadcrumbs, incremental fetch, disk cache, error hierarchy
