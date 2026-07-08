// Pure helpers for the packaged-Electron map-freeze reproduction probe (DON-240).
//
// The beta.9 field reports were main-window "Not Responding" hangs while panning the official
// Discovery package (~1.2 GB, 31,729 tiles, z8-z16). This probe drives a scripted pan across a
// real package and measures BOTH main-process and renderer responsiveness, so an A/B run
// (beta.9 vs the hotfix) can prove — with numbers, not code-reading — whether the stall is gone
// and which thread it lived on. These helpers are pure so they can be unit-tested without
// launching Electron; the runner in scripts/electron-map-freeze-probe.mjs wires them to CDP.

/**
 * Generates a serpentine (boustrophedon) sweep of map centres across a package's coverage
 * bounds, inset slightly so every waypoint stays inside the offline package. Each waypoint
 * carries a zoom cycled through `zooms`. Sweeping forces MapLibre to request a continuous
 * stream of fresh tiles — the real-world load that triggered the freeze.
 *
 * @param {readonly [number, number, number, number]} bounds - [west, south, east, north] degrees.
 * @param {{ rows?: number, cols?: number, zooms?: readonly number[], insetRatio?: number }} [options]
 * @returns {Array<{ center: [number, number], zoom: number }>}
 */
export function generateSerpentinePanPath(bounds, options = {}) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) {
    throw new Error('generateSerpentinePanPath requires numeric [west, south, east, north] bounds.')
  }
  const rows = clampPositiveInt(options.rows, 6)
  const cols = clampPositiveInt(options.cols, 6)
  const zooms = Array.isArray(options.zooms) && options.zooms.length > 0 ? options.zooms : [13, 14, 15, 16]
  const insetRatio = Number.isFinite(options.insetRatio) ? options.insetRatio : 0.1

  const [west, south, east, north] = bounds
  const insetX = (east - west) * insetRatio
  const insetY = (north - south) * insetRatio
  const minX = west + insetX
  const maxX = east - insetX
  const minY = south + insetY
  const maxY = north - insetY

  const path = []
  let waypointIndex = 0
  for (let r = 0; r < rows; r += 1) {
    const latT = rows === 1 ? 0.5 : r / (rows - 1)
    const lat = minY + (maxY - minY) * latT
    for (let cRaw = 0; cRaw < cols; cRaw += 1) {
      // Reverse direction on odd rows so the sweep is continuous (no long jump back).
      const c = r % 2 === 0 ? cRaw : cols - 1 - cRaw
      const lonT = cols === 1 ? 0.5 : c / (cols - 1)
      const lon = minX + (maxX - minX) * lonT
      path.push({ center: [lon, lat], zoom: zooms[waypointIndex % zooms.length] })
      waypointIndex += 1
    }
  }
  return path
}

/**
 * Summarizes a series of responsiveness samples (milliseconds of observed gap/latency).
 * A large max/p99 is the freeze: on a healthy build the event loop stays near the target
 * cadence; on a stalled build a synchronous burst shows up as a multi-hundred-ms-to-seconds gap.
 *
 * @param {readonly number[]} samples
 * @param {number} [stallThresholdMs]
 * @returns {{ count: number, maxMs: number, meanMs: number, p50Ms: number, p95Ms: number, p99Ms: number, overThresholdCount: number, stallThresholdMs: number }}
 */
export function summarizeResponsiveness(samples, stallThresholdMs = 250) {
  const values = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
  if (values.length === 0) {
    return {
      count: 0,
      maxMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      overThresholdCount: 0,
      stallThresholdMs,
    }
  }
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    count: values.length,
    maxMs: values[values.length - 1],
    meanMs: sum / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    overThresholdCount: values.filter((value) => value >= stallThresholdMs).length,
    stallThresholdMs,
  }
}

/**
 * Decides whether a run reproduced a user-visible freeze and, if so, which thread stalled.
 * `freezeThresholdMs` defaults to 1000 ms — a stall past ~1 s is when a window manager starts
 * reporting "Not Responding". Attributing the worst stall to main vs renderer is what tells us
 * whether the residual fix is off-main-thread tile reads (main) or overlay work (renderer).
 *
 * @param {{ mainStats: ReturnType<typeof summarizeResponsiveness>, rendererStats: ReturnType<typeof summarizeResponsiveness>, freezeThresholdMs?: number }} input
 * @returns {{ frozen: boolean, worstStallMs: number, offender: 'main' | 'renderer' | 'none', freezeThresholdMs: number }}
 */
export function buildFreezeVerdict({ mainStats, rendererStats, freezeThresholdMs = 1000 }) {
  const mainMax = mainStats?.maxMs ?? 0
  const rendererMax = rendererStats?.maxMs ?? 0
  const worstStallMs = Math.max(mainMax, rendererMax)
  const frozen = worstStallMs >= freezeThresholdMs
  let offender = 'none'
  if (frozen) {
    offender = mainMax >= rendererMax ? 'main' : 'renderer'
  }
  return { frozen, worstStallMs, offender, freezeThresholdMs }
}

/**
 * Parses CLI args for the runner. Kept pure so argument handling is unit-tested.
 *
 * @param {readonly string[]} argv
 * @returns {{ appPath: string, packagePath: string, evidenceDir: string, platform: string, rows: number, cols: number, panDurationMs: number, probeIntervalMs: number, blockNetwork: boolean, extraArgs: string[] }}
 */
export function parseFreezeProbeArgs(argv) {
  const args = { extraArgs: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = () => argv[(i += 1)]
    switch (token) {
      case '--app':
        args.appPath = next()
        break
      case '--package':
        args.packagePath = next()
        break
      case '--evidence':
        args.evidenceDir = next()
        break
      case '--platform':
        args.platform = next()
        break
      case '--rows':
        args.rows = Number(next())
        break
      case '--cols':
        args.cols = Number(next())
        break
      case '--pan-duration-ms':
        args.panDurationMs = Number(next())
        break
      case '--probe-interval-ms':
        args.probeIntervalMs = Number(next())
        break
      case '--allow-network':
        args.blockNetwork = false
        break
      case '--':
        args.extraArgs.push(...argv.slice(i + 1))
        i = argv.length
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }
  if (!args.appPath) throw new Error('--app <packaged app binary> is required.')
  if (!args.packagePath) throw new Error('--package <mbtiles path> is required.')
  return {
    appPath: args.appPath,
    packagePath: args.packagePath,
    evidenceDir: args.evidenceDir ?? 'output/beta9-map-freeze-probe',
    platform: args.platform ?? process.platform,
    rows: clampPositiveInt(args.rows, 6),
    cols: clampPositiveInt(args.cols, 6),
    panDurationMs: Number.isFinite(args.panDurationMs) ? args.panDurationMs : 350,
    probeIntervalMs: Number.isFinite(args.probeIntervalMs) ? args.probeIntervalMs : 50,
    blockNetwork: args.blockNetwork !== false,
    extraArgs: args.extraArgs,
  }
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0
  const rank = Math.ceil(ratio * sortedValues.length) - 1
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank))
  return sortedValues[index]
}

function clampPositiveInt(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}
