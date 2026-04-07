# R3: Traccar WebSocket Reconnect & Reconciliation

This document is now a v2 exploration note. It is not the active v1 plan.

## Risk Level: HIGH
## Status: Deferred. V1 uses HTTP polling

## Context
The project decision after Spike S7 is to use HTTP polling for v1 because it matches the proven plugin behaviour and avoids introducing unnecessary statefulness into the first operational release.

## Keep This For V2
- Current plugin polls Traccar REST API: GET /api/positions (all current) + GET /api/positions?deviceId=X&from=...&to=... (breadcrumbs)
- Traccar offers WebSocket at /api/socket — pushes position updates in real-time
- WebSocket requires session auth (POST /api/session first)
- On reconnect, WebSocket only sends NEW positions from that point
- The plugin's traccar_http.py (1,942 lines) handles all this currently

## Questions To Revisit Later
- [ ] Traccar WebSocket message format (what fields, how are positions identified?)
- [ ] Does Traccar assign sequential IDs to positions?
- [ ] What happens to positions recorded while the client is disconnected?
- [ ] Can we query historical positions by time range via REST alongside WebSocket?
- [ ] What's the Traccar server version running at kmrtsar.ddns.net?
- [ ] How does the current plugin handle reconnection/missed data?
- [ ] What's the practical reconnect frequency in Kerry mountain terrain?

## V2 Requirements If Reopened
- Automatic reconnection with exponential backoff
- HTTP polling fallback when WebSocket is unavailable
- On reconnect: fetch all positions between last-known timestamp and now via REST
- De-duplication of positions (same position from both WS and HTTP backfill)
- Monotonic ordering — reject/buffer out-of-order positions
- Graceful degradation: if server is unreachable, show last known positions with staleness indicator

## Current V1 Rule
- Do not build WebSocket transport into the initial production scaffold
- Use the proven HTTP polling approach from Spike S7
- Revisit this document only after the Phase 1 operational core is stable
