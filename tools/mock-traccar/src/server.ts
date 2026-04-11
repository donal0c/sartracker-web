import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSeedCsv } from './csv-parser.js'
import { generateAllRoutes, DEVICE_DEFINITIONS } from './route-generator.js'
import { createPlaybackEngine } from './playback-engine.js'
import { createPositionStore } from './position-store.js'
import { createAuthManager } from './auth.js'
import { createRouter } from './router.js'
import type { ScenarioConfig } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** Parse CLI arguments. */
function parseArgs(): {
  port: number
  speed: number
  loop: boolean
  startOffset: number
  scenario: string
  host: string
} {
  const args = process.argv.slice(2)
  const result = {
    port: 8082,
    speed: 10,
    loop: false,
    startOffset: 0,
    scenario: 'default',
    host: '127.0.0.1',
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        result.port = parseInt(args[++i], 10)
        break
      case '--speed':
        result.speed = parseFloat(args[++i])
        break
      case '--loop':
        result.loop = true
        break
      case '--start-offset':
        result.startOffset = parseFloat(args[++i]) * 60 * 1000 // minutes → ms
        break
      case '--scenario':
        result.scenario = args[++i]
        break
      case '--host':
        result.host = args[++i]
        break
    }
  }

  return result
}

function loadScenario(name: string): ScenarioConfig {
  const scenarioPath = resolve(ROOT, 'scenarios', `${name}.json`)
  try {
    const raw = readFileSync(scenarioPath, 'utf-8')
    return JSON.parse(raw) as ScenarioConfig
  } catch {
    console.log(`  Scenario file "${name}.json" not found, using defaults`)
    return {
      name: 'Default Glenagenty Rescue',
      description: '8-device mountain rescue simulation',
      durationMs: 2 * 60 * 60 * 1000, // 2 hours
      speedMultiplier: 10,
      startOffsetMs: 0,
      loop: false,
      auth: {
        email: 'admin@mock.local',
        password: 'mock',
        token: 'mock-bearer-token',
      },
    }
  }
}

function main(): void {
  const args = parseArgs()
  const scenario = loadScenario(args.scenario)

  // Override scenario values with CLI args
  const speedMultiplier = args.speed
  const startOffsetMs = args.startOffset || scenario.startOffsetMs
  const loop = args.loop || scenario.loop

  // 1. Parse seed CSV
  console.log('\n  Loading seed route data...')
  const csvPath = resolve(ROOT, 'fixtures', 'seed', 'glenagenty.csv')
  const csvContent = readFileSync(csvPath, 'utf-8')
  const seedPoints = parseSeedCsv(csvContent)
  console.log(`  Parsed ${seedPoints.length} seed points from Glenagenty CSV`)

  // 2. Generate routes for all devices
  console.log('  Generating routes for 8 devices...')
  const routes = generateAllRoutes(seedPoints)

  let totalPoints = 0
  for (const [deviceId, route] of routes) {
    const def = DEVICE_DEFINITIONS.find((d) => d.id === deviceId)
    console.log(`    ${def?.name ?? `Device ${deviceId}`}: ${route.length} points`)
    totalPoints += route.length
  }
  console.log(`  Total: ${totalPoints} position points across ${routes.size} devices`)
  console.log(`  Team Echo: roster only (offline, no positions)`)

  // 3. Create playback engine
  const engine = createPlaybackEngine({
    speedMultiplier,
    startOffsetMs,
    durationMs: scenario.durationMs,
    loop,
  })

  // 4. Create position store
  const positionStore = createPositionStore(routes, engine)

  // 5. Create auth
  const auth = createAuthManager(scenario.auth)

  // 6. Create router
  const handleRequest = createRouter({
    auth,
    engine,
    positionStore,
    deviceDefinitions: DEVICE_DEFINITIONS,
    routes,
  })

  // 7. Start server
  const server = createServer(handleRequest)
  server.listen(args.port, args.host, () => {
    console.log('\n  ┌─────────────────────────────────────────────────┐')
    console.log('  │          Mock Traccar Server Running             │')
    console.log('  ├─────────────────────────────────────────────────┤')
    console.log(`  │  URL:        http://${args.host}:${args.port}         │`)
    console.log(`  │  Scenario:   ${scenario.name.padEnd(34)}│`)
    console.log(`  │  Speed:      ${speedMultiplier}x real time${' '.repeat(Math.max(0, 24 - String(speedMultiplier).length - 12))}│`)
    console.log(`  │  Loop:       ${loop ? 'yes' : 'no '}${' '.repeat(31)}│`)
    console.log(`  │  Start:      T+${formatDuration(startOffsetMs).padEnd(31)}│`)
    console.log(`  │  Duration:   ${formatDuration(scenario.durationMs).padEnd(34)}│`)
    console.log('  ├─────────────────────────────────────────────────┤')
    console.log(`  │  Auth:       admin@mock.local / mock            │`)
    console.log(`  │  Token:      mock-bearer-token                  │`)
    console.log('  ├─────────────────────────────────────────────────┤')
    console.log('  │  Endpoints:                                     │')
    console.log('  │    GET  /api/devices                            │')
    console.log('  │    GET  /api/positions                          │')
    console.log('  │    GET  /api/positions?deviceId&from&to         │')
    console.log('  │    POST /api/session                            │')
    console.log('  │    GET  /health                                 │')
    console.log('  └─────────────────────────────────────────────────┘')
    console.log('')
  })
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

main()
