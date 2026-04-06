#!/usr/bin/env node
/**
 * Synthetic SAR Mission Data Generator
 * Generates realistic tracking, marker, and drawing GeoJSON data
 * centered around MacGillycuddy's Reeks, Kerry, Ireland.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// MacGillycuddy's Reeks center
const CENTER = { lat: 51.9975, lon: -9.7400 };
const MISSION_START = new Date('2026-04-06T06:00:00Z');

// Device names (Kerry Mountain Rescue style)
const DEVICE_NAMES = [
  'Alpha Team', 'Bravo Team', 'Charlie Team', 'Delta Team', 'Echo Team',
  'Foxtrot Team', 'Golf Team', 'Hotel Team', 'India Team', 'Juliet Team',
  'Kilo Team', 'Lima Team', 'Mike Team', 'November Team', 'Oscar Team',
  'Papa Team', 'Quebec Team', 'Romeo Team', 'Sierra Team', 'Tango Team',
  'Uniform Team', 'Victor Team', 'Whiskey Team', 'Xray Team', 'Yankee Team',
  'Zulu Team', 'Base Ops', 'Mobile CP', 'Heli Liaison', 'Dog Handler'
];

// Distinct colors for devices
const DEVICE_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
  '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000',
  '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9',
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4'
];

function uuid() {
  return crypto.randomUUID();
}

/** Generate a random point near center within radius (km) */
function randomPoint(center, radiusKm) {
  const r = radiusKm / 111.32; // rough degrees
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.sqrt(Math.random()) * r;
  return {
    lat: center.lat + dist * Math.cos(angle),
    lon: center.lon + dist * Math.sin(angle) / Math.cos(center.lat * Math.PI / 180)
  };
}

/** Simulate a realistic walking path from a start point */
function generateTrail(startPoint, numPoints, intervalSec) {
  const points = [];
  let lat = startPoint.lat;
  let lon = startPoint.lon;
  let heading = Math.random() * 360;
  const speed = 0.8 + Math.random() * 1.2; // km/h walking speed

  for (let i = 0; i < numPoints; i++) {
    // Slight heading variation (realistic mountain walking)
    heading += (Math.random() - 0.5) * 30;
    if (heading < 0) heading += 360;
    if (heading >= 360) heading -= 360;

    const stepKm = (speed * intervalSec / 3600);
    const stepDeg = stepKm / 111.32;

    lat += stepDeg * Math.cos(heading * Math.PI / 180);
    lon += stepDeg * Math.sin(heading * Math.PI / 180) / Math.cos(lat * Math.PI / 180);

    // Add some altitude variation
    const altitude = 300 + Math.sin(i / 50) * 200 + Math.random() * 50;
    const gpxSpeed = speed + (Math.random() - 0.5) * 0.5;
    const battery = Math.max(10, 100 - (i / numPoints) * 60 + Math.random() * 5);

    const timestamp = new Date(MISSION_START.getTime() + i * intervalSec * 1000);

    points.push({
      lat, lon, altitude,
      speed: gpxSpeed,
      battery,
      timestamp: timestamp.toISOString()
    });
  }
  return points;
}

// ─── Generate Tracking Data ───────────────────────────────────────────

function generateTrackingData() {
  const devices = [];
  const allBreadcrumbs = [];
  const currentPositions = [];

  for (let i = 0; i < 30; i++) {
    const deviceId = `device-${String(i + 1).padStart(3, '0')}`;
    const name = DEVICE_NAMES[i];
    const color = DEVICE_COLORS[i];
    const startPoint = randomPoint(CENTER, 3);
    const numPoints = 960; // 8hrs at 30s intervals
    const trail = generateTrail(startPoint, numPoints, 30);

    // Breadcrumb line
    const breadcrumbCoords = trail.map(p => [p.lon, p.lat]);

    allBreadcrumbs.push({
      type: 'Feature',
      properties: {
        deviceId, name, color,
        pointCount: numPoints,
        startTime: trail[0].timestamp,
        endTime: trail[trail.length - 1].timestamp
      },
      geometry: {
        type: 'LineString',
        coordinates: breadcrumbCoords
      }
    });

    // Current position (last point)
    const last = trail[trail.length - 1];
    currentPositions.push({
      type: 'Feature',
      properties: {
        deviceId, name, color,
        timestamp: last.timestamp,
        altitude: Math.round(last.altitude),
        speed: Math.round(last.speed * 10) / 10,
        battery: Math.round(last.battery)
      },
      geometry: {
        type: 'Point',
        coordinates: [last.lon, last.lat]
      }
    });

    devices.push({ deviceId, name, color });
  }

  return {
    positions: {
      type: 'FeatureCollection',
      features: currentPositions
    },
    breadcrumbs: {
      type: 'FeatureCollection',
      features: allBreadcrumbs
    },
    devices
  };
}

// ─── Generate Markers ─────────────────────────────────────────────────

function generateMarkers() {
  const markers = [];
  const types = [
    { type: 'ipp_lkp', name: 'IPP - Car Park', subType: 'Hiker', count: 2 },
    { type: 'ipp_lkp', name: 'LKP - Witness', subType: 'Elderly', count: 1 },
    { type: 'clue', name: 'Jacket Found', subType: 'Clothing', count: 3 },
    { type: 'clue', name: 'Footprint', subType: 'Footprint', count: 2 },
    { type: 'hazard', name: 'Cliff Edge', subType: 'Cliff/Drop-off', count: 3 },
    { type: 'hazard', name: 'Water Crossing', subType: 'Water Hazard', count: 2 },
    { type: 'casualty', name: 'Casualty Alpha', subType: 'Injured', count: 1 },
    { type: 'casualty', name: 'Casualty Bravo', subType: 'Hypothermic', count: 1 },
  ];

  const markerColors = {
    ipp_lkp: '#FF0000',
    clue: '#FFD700',
    hazard: '#FF6600',
    casualty: '#FF00FF'
  };

  let idx = 0;
  for (const def of types) {
    for (let i = 0; i < def.count; i++) {
      idx++;
      const pt = randomPoint(CENTER, 4);
      markers.push({
        type: 'Feature',
        properties: {
          id: uuid(),
          name: `${def.name}${def.count > 1 ? ` ${i + 1}` : ''}`,
          markerType: def.type,
          subType: def.subType,
          color: markerColors[def.type],
          description: `Auto-generated marker #${idx}`,
          timestamp: new Date(MISSION_START.getTime() + idx * 600000).toISOString()
        },
        geometry: {
          type: 'Point',
          coordinates: [pt.lon, pt.lat]
        }
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features: markers
  };
}

// ─── Generate Drawings ────────────────────────────────────────────────

function generateDrawings() {
  const features = [];

  // 3 search areas (polygons)
  for (let i = 0; i < 3; i++) {
    const center = randomPoint(CENTER, 2);
    const sides = 5 + Math.floor(Math.random() * 3);
    const radius = 0.005 + Math.random() * 0.01; // ~0.5-1.5km
    const coords = [];
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * 2 * Math.PI;
      const jitter = 1 + (Math.random() - 0.5) * 0.3;
      coords.push([
        center.lon + radius * Math.sin(angle) * jitter / Math.cos(center.lat * Math.PI / 180),
        center.lat + radius * Math.cos(angle) * jitter
      ]);
    }
    coords[coords.length - 1] = coords[0]; // close ring

    features.push({
      type: 'Feature',
      properties: {
        id: uuid(),
        name: `Search Area ${String.fromCharCode(65 + i)}`,
        drawingType: 'search_area',
        color: ['#0064FF', '#00C864', '#C86400'][i],
        team: DEVICE_NAMES[i],
        status: ['Planned', 'InProgress', 'Completed'][i],
        priority: ['High', 'Medium', 'Low'][i]
      },
      geometry: { type: 'Polygon', coordinates: [coords] }
    });
  }

  // 2 range ring sets (each set = 3 concentric rings as polygons)
  for (let i = 0; i < 2; i++) {
    const center = randomPoint(CENTER, 1);
    const radii = [500, 1500, 3000]; // meters
    const labels = ['25th %ile', '50th %ile', '75th %ile'];
    for (let r = 0; r < radii.length; r++) {
      const ringCoords = [];
      const numSegments = 64;
      const radiusDeg = (radii[r] / 1000) / 111.32;
      for (let s = 0; s <= numSegments; s++) {
        const angle = (s / numSegments) * 2 * Math.PI;
        ringCoords.push([
          center.lon + radiusDeg * Math.sin(angle) / Math.cos(center.lat * Math.PI / 180),
          center.lat + radiusDeg * Math.cos(angle)
        ]);
      }
      ringCoords[ringCoords.length - 1] = ringCoords[0];

      features.push({
        type: 'Feature',
        properties: {
          id: uuid(),
          name: `Range Ring Set ${i + 1} - ${labels[r]}`,
          drawingType: 'range_ring',
          color: i === 0 ? '#FFA500' : '#FF69B4',
          radiusM: radii[r],
          label: labels[r],
          setIndex: i
        },
        geometry: { type: 'Polygon', coordinates: [ringCoords] }
      });
    }
  }

  // 2 bearing lines
  for (let i = 0; i < 2; i++) {
    const origin = randomPoint(CENTER, 1);
    const bearing = Math.random() * 360;
    const distKm = 2 + Math.random() * 3;
    const endLat = origin.lat + (distKm / 111.32) * Math.cos(bearing * Math.PI / 180);
    const endLon = origin.lon + (distKm / 111.32) * Math.sin(bearing * Math.PI / 180) / Math.cos(origin.lat * Math.PI / 180);

    features.push({
      type: 'Feature',
      properties: {
        id: uuid(),
        name: `Bearing Line ${i + 1}`,
        drawingType: 'bearing_line',
        color: '#800080',
        bearing: Math.round(bearing),
        distanceM: Math.round(distKm * 1000)
      },
      geometry: {
        type: 'LineString',
        coordinates: [[origin.lon, origin.lat], [endLon, endLat]]
      }
    });
  }

  // 1 search sector (pie slice as polygon)
  {
    const center = randomPoint(CENTER, 1);
    const startBearing = 30;
    const endBearing = 120;
    const radiusKm = 2;
    const radiusDeg = radiusKm / 111.32;
    const coords = [[center.lon, center.lat]];
    for (let deg = startBearing; deg <= endBearing; deg += 2) {
      const rad = deg * Math.PI / 180;
      coords.push([
        center.lon + radiusDeg * Math.sin(rad) / Math.cos(center.lat * Math.PI / 180),
        center.lat + radiusDeg * Math.cos(rad)
      ]);
    }
    coords.push([center.lon, center.lat]);

    features.push({
      type: 'Feature',
      properties: {
        id: uuid(),
        name: 'Search Sector 1',
        drawingType: 'search_sector',
        color: '#FF6464',
        startBearing: startBearing,
        endBearing: endBearing,
        radiusM: radiusKm * 1000
      },
      geometry: { type: 'Polygon', coordinates: [coords] }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

// ─── Main ─────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log('Generating synthetic SAR mission data...');

const tracking = generateTrackingData();
const markers = generateMarkers();
const drawings = generateDrawings();

// Write files
fs.writeFileSync(
  path.join(outDir, 'positions.geojson'),
  JSON.stringify(tracking.positions, null, 2)
);
fs.writeFileSync(
  path.join(outDir, 'breadcrumbs.geojson'),
  JSON.stringify(tracking.breadcrumbs, null, 2)
);
fs.writeFileSync(
  path.join(outDir, 'markers.geojson'),
  JSON.stringify(markers, null, 2)
);
fs.writeFileSync(
  path.join(outDir, 'drawings.geojson'),
  JSON.stringify(drawings, null, 2)
);
fs.writeFileSync(
  path.join(outDir, 'devices.json'),
  JSON.stringify(tracking.devices, null, 2)
);

// Stats
const totalBreadcrumbPoints = tracking.breadcrumbs.features.reduce(
  (sum, f) => sum + f.geometry.coordinates.length, 0
);

console.log(`  Devices: ${tracking.devices.length}`);
console.log(`  Current positions: ${tracking.positions.features.length}`);
console.log(`  Breadcrumb trails: ${tracking.breadcrumbs.features.length}`);
console.log(`  Total breadcrumb points: ${totalBreadcrumbPoints}`);
console.log(`  Markers: ${markers.features.length}`);
console.log(`  Drawings: ${drawings.features.length}`);
console.log(`\nFiles written to ${outDir}/`);
