#!/usr/bin/env node

import {
  buildBreadcrumb36HourTruthEvidence,
  createBreadcrumb36HourProfile,
  startBreadcrumb36HourMockTraccarServer,
} from '../../build/breadcrumb-36h-mock-traccar.js'

main().catch((error) => {
  console.error(
    `breadcrumb-36h-mock: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})

/** Starts the deterministic field-scale history server until interrupted. */
async function main() {
  const options = parseArguments(process.argv.slice(2))
  const profile = createBreadcrumb36HourProfile()
  const truth = buildBreadcrumb36HourTruthEvidence(profile)
  const server = await startBreadcrumb36HourMockTraccarServer({
    profile,
    host: options.host,
    port: options.port,
    latencyMs: options.latencyMs,
  })

  console.log(`Deterministic 36-hour Traccar: ${server.baseUrl}`)
  console.log(
    `Source truth: ${truth.totalPositionCount} positions across ${profile.deviceCount} devices; SHA-256 ${truth.sha256}`,
  )
  console.log('Authentication: any Basic or Bearer authorization header')

  await new Promise((resolve) => {
    const stop = () => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await server.close()
}

/** Parses the deliberately small manual-server command line. */
function parseArguments(argv) {
  const options = {
    host: '127.0.0.1',
    port: 8083,
    latencyMs: 0,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]
    if (next === undefined) {
      throw new Error(`${token} requires a value.`)
    }
    index += 1
    if (token === '--host') {
      options.host = next
    } else if (token === '--port') {
      options.port = readBoundedInteger(next, 1, 65_535, '--port')
    } else if (token === '--latency-ms') {
      options.latencyMs = readBoundedInteger(next, 0, 60_000, '--latency-ms')
    } else {
      throw new Error(`Unknown argument: ${token}`)
    }
  }
  return options
}

/** Reads one bounded integer CLI value. */
function readBoundedInteger(value, minimum, maximum, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`)
  }
  return parsed
}
