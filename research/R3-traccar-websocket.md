# R3: Traccar WebSocket Reconnect & Reconciliation

## Risk Level: HIGH
## Status: 🔬 Needs deep research

## The Problem
Upgrading from HTTP polling to WebSocket push introduces statefulness. Mountain networks drop frequently. Without proper reconnection and gap-filling logic, breadcrumb trails will have gaps, positions will be lost, and the team won't know where their people actually walked.

## What We Know
- Current plugin polls Traccar REST API: GET /api/positions (all current) + GET /api/positions?deviceId=X&from=...&to=... (breadcrumbs)
- Traccar offers WebSocket at /api/socket — pushes position updates in real-time
- WebSocket requires session auth (POST /api/session first)
- On reconnect, WebSocket only sends NEW positions from that point
- The plugin's traccar_http.py (1,942 lines) handles all this currently

## Research Needed
- [ ] Traccar WebSocket message format (what fields, how are positions identified?)
- [ ] Does Traccar assign sequential IDs to positions?
- [ ] What happens to positions recorded while the client is disconnected?
- [ ] Can we query historical positions by time range via REST alongside WebSocket?
- [ ] What's the Traccar server version running at kmrtsar.ddns.net?
- [ ] How does the current plugin handle reconnection/missed data?
- [ ] What's the practical reconnect frequency in Kerry mountain terrain?

## Design Requirements
- Automatic reconnection with exponential backoff
- HTTP polling fallback when WebSocket is unavailable
- On reconnect: fetch all positions between last-known timestamp and now via REST
- De-duplication of positions (same position from both WS and HTTP backfill)
- Monotonic ordering — reject/buffer out-of-order positions
- Graceful degradation: if server is unreachable, show last known positions with staleness indicator

## Spike Criteria
✅ WebSocket connects, receives real-time positions, renders on map
✅ Kill network, wait 60s, restore — breadcrumb trail has no gaps
✅ HTTP polling fallback activates within 10s of WebSocket failure
✅ De-duplication verified — no doubled position markers
