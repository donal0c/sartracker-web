/** Parses the fail-closed packaged mission-store responsiveness probe CLI. */
export function parseMissionStoreProbeArgs(argv) {
  const args = { extraArgs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`)
      }
      index += 1
      return value
    }

    switch (token) {
      case '--app':
        args.appPath = nextValue()
        break
      case '--fixture':
        args.fixturePath = nextValue()
        break
      case '--evidence':
        args.evidenceDir = nextValue()
        break
      case '--cycles':
        args.expectedCycles = Number(nextValue())
        break
      case '--timeout-ms':
        args.timeoutMs = Number(nextValue())
        break
      case '--probe-interval-ms':
        args.probeIntervalMs = Number(nextValue())
        break
      case '--freeze-threshold-ms':
        args.freezeThresholdMs = Number(nextValue())
        break
      case '--expect':
        args.expectation = nextValue()
        break
      case '--':
        args.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (!args.appPath) {
    throw new Error('--app <packaged Electron binary> is required.')
  }
  if (!args.fixturePath) {
    throw new Error('--fixture <mission-store.sqlite> is required.')
  }
  const expectedCycles = positiveInteger(args.expectedCycles, 3, '--cycles')
  const timeoutMs = positiveNumber(args.timeoutMs, 180_000, '--timeout-ms')
  const probeIntervalMs = positiveNumber(
    args.probeIntervalMs,
    50,
    '--probe-interval-ms',
  )
  const freezeThresholdMs = positiveNumber(
    args.freezeThresholdMs,
    1_000,
    '--freeze-threshold-ms',
  )
  const expectation = args.expectation ?? 'observe'
  if (!['observe', 'frozen', 'healthy'].includes(expectation)) {
    throw new Error('--expect must be one of observe, frozen, or healthy.')
  }

  return {
    appPath: args.appPath,
    fixturePath: args.fixturePath,
    evidenceDir: args.evidenceDir ?? 'output/mission-store-freeze-probe',
    expectedCycles,
    timeoutMs,
    probeIntervalMs,
    freezeThresholdMs,
    expectation,
    extraArgs: args.extraArgs,
  }
}

/** Creates the immutable initial state for backup-copy/validation timing. */
export function createBackupTimelineState({ databaseBytes }) {
  if (!Number.isFinite(databaseBytes) || databaseBytes <= 0) {
    throw new Error('Backup timeline requires a positive database byte count.')
  }
  return {
    databaseBytes,
    activeCycle: null,
    cycles: [],
  }
}

/** Identifies only the temporary SQLite database, never its WAL/SHM sidecars. */
export function isTemporaryBackupDatabaseName(name) {
  return /^mission-store\.backup\.sqlite\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
    String(name),
  )
}

/**
 * Advances the external backup-file timeline. The temporary file grows while
 * `db.backup()` copies pages, then stays at its final size while beta.11 runs
 * synchronous `integrity_check`; atomic rename removes it after validation.
 */
export function updateBackupTimeline(state, snapshot) {
  const temporaryFiles = Array.isArray(snapshot.temporaryFiles)
    ? snapshot.temporaryFiles
    : []
  let activeCycle = state.activeCycle === null ? null : { ...state.activeCycle }
  const cycles = [...state.cycles]

  if (activeCycle === null && temporaryFiles.length > 0) {
    const first = temporaryFiles[0]
    activeCycle = {
      temporaryName: first.name,
      startedAtMs: snapshot.atMs,
      lastGrowthAtMs: snapshot.atMs,
      copyCompletedAtMs:
        first.size >= state.databaseBytes ? snapshot.atMs : null,
      lastTemporaryBytes: first.size,
      maximumTemporaryBytes: first.size,
    }
  } else if (activeCycle !== null) {
    const current = temporaryFiles.find(
      (temporaryFile) => temporaryFile.name === activeCycle.temporaryName,
    )
    if (current !== undefined) {
      if (current.size !== activeCycle.lastTemporaryBytes) {
        activeCycle.lastGrowthAtMs = snapshot.atMs
      }
      activeCycle.lastTemporaryBytes = current.size
      activeCycle.maximumTemporaryBytes = Math.max(
        activeCycle.maximumTemporaryBytes,
        current.size,
      )
      if (
        activeCycle.copyCompletedAtMs === null &&
        current.size >= state.databaseBytes
      ) {
        activeCycle.copyCompletedAtMs = snapshot.atMs
      }
    } else if (snapshot.backup?.exists === true) {
      const copyCompletedAtMs =
        activeCycle.copyCompletedAtMs ?? activeCycle.lastGrowthAtMs
      cycles.push({
        temporaryName: activeCycle.temporaryName,
        startedAtMs: activeCycle.startedAtMs,
        copyCompletedAtMs,
        completedAtMs: snapshot.atMs,
        copyDurationMs: Math.max(0, copyCompletedAtMs - activeCycle.startedAtMs),
        validationDurationMs: Math.max(0, snapshot.atMs - copyCompletedAtMs),
        totalDurationMs: Math.max(0, snapshot.atMs - activeCycle.startedAtMs),
        maximumTemporaryBytes: activeCycle.maximumTemporaryBytes,
        finalBackupBytes: snapshot.backup.size,
        finalBackupMtimeMs: snapshot.backup.mtimeMs,
      })
      activeCycle = null
    }
  }

  return {
    databaseBytes: state.databaseBytes,
    activeCycle,
    cycles,
  }
}

/**
 * Produces a fail-closed storage-probe verdict. Renderer throttling is reported
 * but cannot mark the storage path frozen by itself because Ubuntu/X11 may
 * throttle background rendering; the dedicated main-process IPC heartbeat is
 * the release-blocking signal.
 */
export function buildMissionStoreProbeVerdict(input) {
  const invalidReasons = []
  if (input.cycles.length < input.expectedCycles) {
    invalidReasons.push(
      `Expected ${input.expectedCycles} completed backup cycles; observed ${input.cycles.length}.`,
    )
  }
  if ((input.mainStats?.count ?? 0) === 0) {
    invalidReasons.push('Main-process heartbeat collected zero samples.')
  }
  if ((input.mainHeartbeatErrors ?? 0) > 0) {
    invalidReasons.push(
      `Main-process heartbeat recorded ${input.mainHeartbeatErrors} errors.`,
    )
  }

  const probeValid = invalidReasons.length === 0
  const mainMaximumMs = input.mainStats?.maxMs ?? 0
  const rendererMaximumMs = input.rendererStats?.maxMs ?? 0
  const frozen = probeValid && mainMaximumMs >= input.freezeThresholdMs
  const rendererThrottled = rendererMaximumMs >= input.freezeThresholdMs
  const offender = frozen ? 'main' : 'none'
  const expectationMet =
    probeValid &&
    (input.expectation === 'observe' ||
      (input.expectation === 'frozen' && frozen) ||
      (input.expectation === 'healthy' && !frozen))

  return {
    probeValid,
    invalidReasons,
    frozen,
    offender,
    rendererThrottled,
    freezeThresholdMs: input.freezeThresholdMs,
    completedCycles: input.cycles.length,
    expectedCycles: input.expectedCycles,
    expectation: input.expectation,
    expectationMet,
  }
}

/** Returns a positive integer CLI value or a default. */
function positiveInteger(value, fallback, flag) {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`)
  }
  return value
}

/** Returns a positive numeric CLI value or a default. */
function positiveNumber(value, fallback, flag) {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number.`)
  }
  return value
}
