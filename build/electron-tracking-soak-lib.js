/**
 * Pure profile, CLI, and verdict helpers for the packaged Electron tracking
 * soak. Process control and evidence collection live in the adjacent script.
 */

import { createHash } from 'node:crypto'

import { validateExtendedExactSoakProof } from './electron-tracking-soak-exact-proof-lib.js'

const PROFILE_DEFINITIONS = Object.freeze({
  ci: Object.freeze({
    actualBatches: 6,
    equivalentProductionPolls: 1_080,
    restartCheckpoints: Object.freeze([3]),
    recommendedPollIntervalMs: 25,
  }),
  normal: Object.freeze({
    actualBatches: 480,
    equivalentProductionPolls: 86_400,
    restartCheckpoints: Object.freeze([240]),
    recommendedPollIntervalMs: 250,
  }),
  extended: Object.freeze({
    actualBatches: 1_344,
    equivalentProductionPolls: 241_920,
    restartCheckpoints: Object.freeze([448, 896]),
    recommendedPollIntervalMs: 250,
  }),
})

const DEVICE_COUNT = 32
const MOVING_DEVICE_COUNT = 8
const PRODUCTION_POLLS_PER_BATCH = 180
const MAX_RUNTIME_LOG_BYTES = 5 * 1024 * 1024
const MAX_SUPPORT_BUNDLE_BYTES = 10 * 1024 * 1024
const MAX_PROCESS_TREE_RESIDENT_BYTES = 2 * 1024 * 1024 * 1024

/** Returns one immutable accelerated soak profile. */
export function createTrackingSoakProfile(name) {
  const definition = PROFILE_DEFINITIONS[name]
  if (definition === undefined) {
    throw new Error(`Unknown tracking soak profile "${String(name)}". Use ci, normal, or extended.`)
  }

  return Object.freeze({
    name,
    deviceCount: DEVICE_COUNT,
    movingDeviceCount: MOVING_DEVICE_COUNT,
    actualBatches: definition.actualBatches,
    productionPollsPerBatch: PRODUCTION_POLLS_PER_BATCH,
    equivalentProductionPolls: definition.equivalentProductionPolls,
    expectedPositionRows:
      definition.equivalentProductionPolls * MOVING_DEVICE_COUNT +
      (DEVICE_COUNT - MOVING_DEVICE_COUNT),
    restartCheckpoints: [...definition.restartCheckpoints],
    recommendedPollIntervalMs: definition.recommendedPollIntervalMs,
  })
}

/** Classifies bounded operational mission events captured by the packaged soak. */
export function classifyTrackingSoakMissionEvents(events) {
  const entries = Object.entries(events ?? {}).map(([eventType, count]) => [
    eventType,
    Number(count),
  ])
  const declaredEventTypes = new Set([
    'mission_created',
    'mission_paused',
    'mission_resumed',
    'mission_backup_synced',
    'device_created',
    'device_updated',
    'position_recorded',
    'participants_selected',
    'participant_added',
    'participant_backfill_completed',
    'group_membership_changed',
  ])
  return {
    operationalMissionEvents: entries
      .filter(([eventType]) => !['device_updated', 'position_recorded'].includes(eventType))
      .reduce((sum, [, count]) => sum + count, 0),
    participantBackfillCompletedEvents:
      Number(events?.participant_backfill_completed ?? 0),
    unexplainedMissionEvents: entries
      .filter(([eventType]) => !declaredEventTypes.has(eventType))
      .reduce((sum, [, count]) => sum + count, 0),
  }
}

/**
 * Revalidates the final operator-visible Line total against both SQLite and
 * independent deterministic source truth across two consecutive observations.
 */
export function validateFinalLineTotalAudit(audit, profile, positionRows) {
  const failureReasons = []
  if (profile?.name !== 'extended') {
    return { passed: true, failureReasons }
  }
  const expectedTotal = profile.expectedPositionRows
  const observations = Array.isArray(audit?.observations)
    ? audit.observations
    : []
  const observationsMatch =
    observations.length === 2 &&
    observations.every(
      (observation, index) =>
        observation?.observationIndex === index + 1 &&
        observation.reportedTotalObserved === expectedTotal &&
        observation.sqlitePositionRows === expectedTotal &&
        observation.independentSourceTotal === expectedTotal,
    )
  if (
    audit?.required !== true ||
    audit?.passed !== true ||
    audit?.lineModeRestored !== true ||
    audit?.stableObservationCount !== 2 ||
    audit?.reportedTotalObserved !== expectedTotal ||
    audit?.sqlitePositionRows !== expectedTotal ||
    audit?.independentSourceTotal !== expectedTotal ||
    positionRows !== expectedTotal ||
    !observationsMatch
  ) {
    failureReasons.push(
      'Two stable restored-Line totals must exactly match SQLite and independent source truth.',
    )
  }
  return { passed: failureReasons.length === 0, failureReasons }
}

/** Parses the fail-closed packaged soak command line. */
export function parseTrackingSoakArgs(argv) {
  const parsed = { extraArgs: [] }
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
        parsed.appPath = nextValue()
        break
      case '--profile':
        parsed.profileName = nextValue()
        break
      case '--evidence':
        parsed.evidenceDir = nextValue()
        break
      case '--poll-interval-ms':
        parsed.pollIntervalMs = Number(nextValue())
        break
      case '--timeout-ms':
        parsed.timeoutMs = Number(nextValue())
        break
      case '--freeze-threshold-ms':
        parsed.freezeThresholdMs = Number(nextValue())
        break
      case '--':
        parsed.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (typeof parsed.appPath !== 'string' || parsed.appPath.trim() === '') {
    throw new Error('--app <packaged Electron binary> is required.')
  }
  const profile = createTrackingSoakProfile(parsed.profileName ?? 'ci')
  const pollIntervalMs = boundedInteger(
    parsed.pollIntervalMs,
    profile.recommendedPollIntervalMs,
    5,
    1_000,
    '--poll-interval-ms',
  )

  return {
    appPath: parsed.appPath,
    profile,
    evidenceDir: parsed.evidenceDir ?? 'output/electron-tracking-soak',
    pollIntervalMs,
    timeoutMs: positiveNumber(parsed.timeoutMs, 30 * 60_000, '--timeout-ms'),
    freezeThresholdMs: positiveNumber(
      parsed.freezeThresholdMs,
      1_000,
      '--freeze-threshold-ms',
    ),
    extraArgs: parsed.extraArgs,
  }
}

/** Builds the release-blocking verdict from collected packaged-runtime evidence. */
export function buildTrackingSoakVerdict(input) {
  const failureReasons = []
  const expectedRestarts = input.profile.restartCheckpoints.length

  requireAtLeast(failureReasons, input.observedBatches, input.profile.actualBatches, 'tracking batches')
  requireExact(failureReasons, input.deviceRows, input.profile.deviceCount, 'device rows')
  requireExact(
    failureReasons,
    input.positionRows,
    input.profile.expectedPositionRows,
    'position rows',
  )
  requireExact(
    failureReasons,
    input.deviceCreatedEvents,
    input.profile.deviceCount,
    'device_created events',
  )
  requireExact(failureReasons, input.deviceUpdatedEvents, 0, 'device_updated events')
  requireExact(failureReasons, input.positionRecordedEvents, 0, 'position_recorded events')
  requireExact(
    failureReasons,
    input.missingSourcePositionIdentityRows,
    0,
    'positions missing source position identity',
  )
  if (input.positionTruthExactMatch !== true) {
    failureReasons.push('Persisted position identity/time/coordinate truth did not match the deterministic source.')
  }
  if (input.normalPrefixTruthExactMatch !== true) {
    failureReasons.push('The shared five-day position truth did not match across soak profiles.')
  }
  if (input.profile.name === 'extended') {
    failureReasons.push(
      ...validateExtendedExactSoakProof(
        input.exactDotProof,
        input.profile,
      ).failureReasons,
      ...validateFinalLineTotalAudit(
        input.finalLineTotalAudit,
        input.profile,
        input.positionRows,
      ).failureReasons,
    )
  }
  requireAtLeast(failureReasons, input.operationalMissionEvents, 1, 'operational mission events')
  if (input.operationalMissionEvents > input.declaredOperationalEventBudget) {
    failureReasons.push(
      `Operational mission events exceeded the declared budget: ${input.operationalMissionEvents}/${input.declaredOperationalEventBudget}.`,
    )
  }
  requireExact(failureReasons, input.unexplainedMissionEvents, 0, 'unexplained mission events')
  requireExact(
    failureReasons,
    input.restartCheckpointsPassed,
    expectedRestarts,
    'restart checkpoints passed',
  )
  requireAtLeast(failureReasons, input.backupCycles, 1, 'completed backup cycles')
  requireAtLeast(failureReasons, input.mainHeartbeatSamples, 1, 'main-process heartbeat samples')
  requireExact(failureReasons, input.mainHeartbeatErrors, 0, 'main-process heartbeat errors')
  requireAtLeast(failureReasons, input.rendererSamples, 40, 'renderer responsiveness samples')
  const rendererLaunchSampleCounts = Array.isArray(input.rendererLaunchSampleCounts)
    ? input.rendererLaunchSampleCounts
    : []
  requireExact(
    failureReasons,
    rendererLaunchSampleCounts.length,
    expectedRestarts + 1,
    'renderer launch sample counts',
  )
  for (let index = 0; index < expectedRestarts + 1; index += 1) {
    requireAtLeast(
      failureReasons,
      rendererLaunchSampleCounts[index],
      20,
      `renderer responsiveness samples for launch ${index + 1}`,
    )
  }
  requireExact(failureReasons, input.rendererCrashes, 0, 'renderer crashes')
  requireAtLeast(
    failureReasons,
    input.operatorInteractionSamples,
    1,
    'operator interaction samples',
  )
  requireExact(
    failureReasons,
    input.operatorInteractionErrors,
    0,
    'operator interaction errors',
  )
  requireAtLeast(
    failureReasons,
    input.operatorActionSamples,
    1,
    'operator action timing samples',
  )
  requireAtLeast(
    failureReasons,
    input.operatorExternalActionSamples,
    1,
    'external operator action timing samples',
  )
  if (input.webGlRendererAttested !== true) {
    failureReasons.push('The required WebGL renderer backend was not directly attested.')
  }
  if (
    !Number.isFinite(input.maximumProcessTreeResidentBytes) ||
    input.maximumProcessTreeResidentBytes <= 0
  ) {
    failureReasons.push('Process-tree resident memory was not sampled.')
  } else if (input.maximumProcessTreeResidentBytes > MAX_PROCESS_TREE_RESIDENT_BYTES) {
    failureReasons.push(
      `Process-tree resident memory exceeded the ${MAX_PROCESS_TREE_RESIDENT_BYTES}-byte budget: ${input.maximumProcessTreeResidentBytes}.`,
    )
  }

  if (input.mainMaximumMs >= input.freezeThresholdMs) {
    failureReasons.push(
      `Main-process maximum ${input.mainMaximumMs}ms reached the ${input.freezeThresholdMs}ms freeze threshold.`,
    )
  }
  if (input.rendererMaximumMs >= input.freezeThresholdMs) {
    failureReasons.push(
      `Renderer maximum ${input.rendererMaximumMs}ms reached the ${input.freezeThresholdMs}ms freeze threshold.`,
    )
  }
  if (input.operatorActionMaximumMs >= input.freezeThresholdMs) {
    failureReasons.push(
      `Operator action maximum ${input.operatorActionMaximumMs}ms reached the ${input.freezeThresholdMs}ms freeze threshold.`,
    )
  }
  if (input.operatorExternalActionMaximumMs >= input.freezeThresholdMs) {
    failureReasons.push(
      `External operator action maximum ${input.operatorExternalActionMaximumMs}ms reached the ${input.freezeThresholdMs}ms freeze threshold.`,
    )
  }
  if (input.integrityResult !== 'ok') {
    failureReasons.push(`SQLite integrity result was ${String(input.integrityResult)}, not ok.`)
  }
  if (input.walCheckpointBusy !== 0) {
    failureReasons.push(`WAL checkpoint reported ${input.walCheckpointBusy} busy readers/writers.`)
  }
  if (!input.supportBundleInspected) {
    failureReasons.push('Support bundle was not inspected.')
  }
  if (!input.supportBundleRedacted) {
    failureReasons.push('Support bundle redaction check did not pass.')
  }
  requireBoundedBytes(
    failureReasons,
    input.runtimeLogBytes,
    MAX_RUNTIME_LOG_BYTES,
    'runtime log',
  )
  requireBoundedBytes(
    failureReasons,
    input.supportBundleBytes,
    MAX_SUPPORT_BUNDLE_BYTES,
    'support bundle',
  )

  const redundantRows = input.deviceUpdatedEvents + input.positionRecordedEvents
  return {
    valid: failureReasons.length === 0,
    passed: failureReasons.length === 0,
    failureReasons,
    redundantTelemetrySlopeRowsPerEquivalentPoll:
      redundantRows / input.profile.equivalentProductionPolls,
    operationalPositionSlopeRowsPerEquivalentPoll:
      input.positionRows / input.profile.equivalentProductionPolls,
  }
}

/**
 * Measures click-to-state latency without including recorder setup/readback.
 *
 * The recorder calls prove trusted browser delivery, but their CDP round trips
 * are harness diagnostics rather than time an operator waits for the UI.
 */
export async function measureOperatorAction(input) {
  await input.installRecorder().catch(() => undefined)
  const startedAt = input.now()
  const errorClasses = []
  let clickCompleted = false
  let stateReached = false
  let targetStabilityWaitMs = 0

  try {
    const clickResult = await input.click()
    targetStabilityWaitMs =
      Number.isFinite(clickResult?.targetStabilityWaitMs) &&
      clickResult.targetStabilityWaitMs >= 0
        ? clickResult.targetStabilityWaitMs
        : 0
    clickCompleted = true
  } catch (error) {
    errorClasses.push(error instanceof Error ? error.name : 'UnknownError')
  }
  const clickCompletedAt = input.now()

  try {
    stateReached = await input.waitForState()
  } catch (error) {
    errorClasses.push(error instanceof Error ? error.name : 'UnknownError')
  }
  const stateCompletedAt = input.now()
  const externalDurationMs = Math.max(
    0,
    stateCompletedAt - startedAt - targetStabilityWaitMs,
  )
  const recorder = await input.readRecorder().catch(() => ({
    received: false,
    actionDurationMs: null,
  }))
  const recorderTimingAvailable =
    recorder?.received === true &&
    Number.isFinite(recorder.actionDurationMs) &&
    recorder.actionDurationMs >= 0
  if (recorder?.received === true && !recorderTimingAvailable) {
    errorClasses.push('OperatorActionTimingUnavailable')
  }

  return {
    clickCompleted,
    clickReceived: recorderTimingAvailable,
    stateReached,
    durationMs: recorderTimingAvailable ? recorder.actionDurationMs : externalDurationMs,
    externalDurationMs,
    clickDeliveryDurationMs: Math.max(
      0,
      clickCompletedAt - startedAt - targetStabilityWaitMs,
    ),
    stateWaitDurationMs: stateCompletedAt - clickCompletedAt,
    targetStabilityWaitMs,
    errorClasses,
  }
}

/**
 * Delivers a trusted operator click to the current location of a preflighted target.
 *
 * Tracking updates can legitimately move the status panel between the preflight
 * inspection and input delivery. Resolve a stable, currently hit-testable centre
 * immediately before one explicit mouse dispatch. The target must keep the same
 * actionable geometry for the requested stability duration. This avoids both stale
 * coordinates and locator retries after a close action unmounts its target.
 */
export async function clickActionablePointerTarget(input) {
  if (
    input.preflight?.documentFocused !== true ||
    input.preflight?.targetReceivesPointer !== true
  ) {
    throw new Error(
      `Pointer target ${input.testId} was not actionable during preflight.`,
    )
  }

  const stabilityStartedAt = performance.now()
  const centerPoint = await input.page.evaluate(
    async ({ expectedTestId, stableDurationMs, timeoutMs }) => {
      const startedAt = performance.now()
      let previousRect = null
      let stableSince = null

      while (performance.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
        const observedAt = performance.now()
        const target = Array.from(
          document.querySelectorAll('[data-testid]'),
        ).find(
          (element) =>
            element instanceof HTMLElement &&
            element.dataset.testid === expectedTestId,
        )
        if (!(target instanceof HTMLElement) || !document.hasFocus()) {
          previousRect = null
          stableSince = null
          continue
        }

        const rect = target.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const centerInViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          centerX >= 0 &&
          centerX < window.innerWidth &&
          centerY >= 0 &&
          centerY < window.innerHeight
        const hit = centerInViewport
          ? document.elementFromPoint(centerX, centerY)
          : null
        const receivesPointer =
          hit === target || (hit !== null && target.contains(hit))
        const currentRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
        const stable =
          previousRect !== null &&
          Math.abs(previousRect.left - currentRect.left) < 0.25 &&
          Math.abs(previousRect.top - currentRect.top) < 0.25 &&
          Math.abs(previousRect.width - currentRect.width) < 0.25 &&
          Math.abs(previousRect.height - currentRect.height) < 0.25

        if (
          receivesPointer &&
          stable &&
          stableSince !== null &&
          observedAt - stableSince >= stableDurationMs
        ) {
          return { x: centerX, y: centerY }
        }
        if (receivesPointer) {
          if (!stable) {
            stableSince = observedAt
          }
          previousRect = currentRect
        } else {
          previousRect = null
          stableSince = null
        }
      }

      throw new Error(
        `Pointer target ${expectedTestId} did not reach a stable actionable state.`,
      )
    },
    {
      expectedTestId: input.testId,
      stableDurationMs: Math.max(0, input.stableDurationMs ?? 0),
      timeoutMs: input.timeoutMs,
    },
  )

  const targetStabilityWaitMs = performance.now() - stabilityStartedAt
  await input.page.mouse.click(centerPoint.x, centerPoint.y)
  return { targetStabilityWaitMs }
}

/**
 * Partitions a launch-wide click audit without losing events at sample boundaries.
 *
 * `afterSequence` is the final sequence consumed by the previous sample.
 * `interactionStartSequence` is observed at the start of the current sample but
 * deliberately does not advance that cursor. Events between those values are
 * therefore retained as inter-sample input rather than silently sliced away.
 */
export function partitionOperatorClickAudit(input) {
  const afterSequence = Number.isSafeInteger(input.afterSequence)
    ? Math.max(0, input.afterSequence)
    : 0
  const interactionStartSequence = Number.isSafeInteger(
    input.interactionStartSequence,
  )
    ? Math.max(afterSequence, input.interactionStartSequence)
    : afterSequence
  const observedLastSequence = Number.isSafeInteger(input.audit?.lastSequence)
    ? Math.max(0, input.audit.lastSequence)
    : 0
  const sequenceRegressed = observedLastSequence < afterSequence
  const lastSequence = Math.max(afterSequence, observedLastSequence)
  const events = Array.isArray(input.audit?.events)
    ? input.audit.events.filter(
        (event) =>
          Number.isSafeInteger(event?.sequence) &&
          event.sequence > afterSequence &&
          event.sequence <= lastSequence,
      )
    : []

  return {
    interSampleEvents: events.filter(
      (event) => event.sequence <= interactionStartSequence,
    ),
    interactionEvents: events.filter(
      (event) => event.sequence > interactionStartSequence,
    ),
    lastSequence,
    missingEventCount: Math.max(
      0,
      lastSequence - afterSequence - events.length,
    ),
    sequenceRegressed,
  }
}

/**
 * Requires direct Mesa/llvmpipe proof for every Linux CI app launch.
 *
 * Other platforms and longer local profiles record renderer evidence without
 * enforcing this GitHub-runner-specific backend policy.
 */
export function buildWebGlRendererAttestation(input) {
  const required = input.platform === 'linux' && input.profileName === 'ci'
  const expectedBackend = required ? 'Mesa llvmpipe via ANGLE/OpenGL' : null
  if (!required) {
    return {
      required: false,
      passed: true,
      expectedBackend,
      launchCount: input.launches.length,
      acceptedLaunches: 0,
      failures: [],
    }
  }

  const failures = []
  let acceptedLaunches = 0
  input.launches.forEach((launch, index) => {
    const evidence = launch.webGlRenderer
    const renderer =
      typeof evidence?.unmaskedRenderer === 'string'
        ? evidence.unmaskedRenderer
        : evidence?.renderer
    const normalized = typeof renderer === 'string' ? renderer.toLowerCase() : ''
    const accepted =
      evidence?.available === true &&
      normalized.includes('angle') &&
      normalized.includes('llvmpipe') &&
      normalized.includes('opengl') &&
      !normalized.includes('swiftshader') &&
      !normalized.includes('vulkan')
    if (accepted) {
      acceptedLaunches += 1
      return
    }
    failures.push(
      `Launch ${index + 1} did not attest ${expectedBackend}: ${renderer || evidence?.reason || 'renderer unavailable'}.`,
    )
  })
  if (input.launches.length === 0) {
    failures.push(`No app launch attested ${expectedBackend}.`)
  }

  return {
    required: true,
    passed: failures.length === 0,
    expectedBackend,
    launchCount: input.launches.length,
    acceptedLaunches,
    failures,
  }
}

/**
 * Reads the renderer behind MapLibre's live WebGL canvas.
 *
 * Launch flags are requests rather than proof. Recording both masked and
 * unmasked values makes packaged CI evidence identify the backend Chromium
 * actually selected.
 */
export function readWebGlRendererInfoFromDocument(documentRoot = globalThis.document) {
  const canvas = documentRoot?.querySelector?.('.maplibregl-canvas')
  if (canvas === null || canvas === undefined || typeof canvas.getContext !== 'function') {
    return { available: false, reason: 'map_canvas_unavailable' }
  }

  try {
    const webGl2 = canvas.getContext('webgl2')
    const context = webGl2 ?? canvas.getContext('webgl')
    if (context === null || context === undefined) {
      return { available: false, reason: 'webgl_context_unavailable' }
    }
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info')
    const readParameter = (key) => {
      const value = context.getParameter(key)
      return typeof value === 'string' ? value : String(value ?? '')
    }
    return {
      available: true,
      contextType: webGl2 === null ? 'webgl' : 'webgl2',
      vendor: readParameter(context.VENDOR),
      renderer: readParameter(context.RENDERER),
      unmaskedVendor:
        debugInfo === null ? null : readParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
      unmaskedRenderer:
        debugInfo === null ? null : readParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
    }
  } catch (error) {
    return {
      available: false,
      reason: 'webgl_probe_failed',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    }
  }
}

/**
 * Installs a renderer-frame probe whose own work is deliberately rate-limited.
 *
 * A raw rAF loop couples the probe's work to the display backend and can add
 * avoidable load to a CPU-only renderer. This probe retains rAF as the
 * compositor signal while sampling it at a controlled cadence. Delayed timer
 * or frame delivery still appears as a large gap.
 */
export function installCadencedRendererProbeInWindow(
  windowRoot = globalThis.window,
  sampleIntervalMs = 16,
) {
  windowRoot.__TRACKING_SOAK_RENDERER_PROBE_CLEANUP__?.()
  const gaps = []
  windowRoot.__TRACKING_SOAK_RENDERER_GAPS__ = gaps
  let previous = windowRoot.performance.now()
  let frameId
  let timerId
  let stopped = false

  const cleanup = () => {
    stopped = true
    if (frameId !== undefined) {
      windowRoot.cancelAnimationFrame(frameId)
    }
    if (timerId !== undefined) {
      windowRoot.clearTimeout(timerId)
    }
  }
  windowRoot.__TRACKING_SOAK_RENDERER_PROBE_CLEANUP__ = cleanup

  const frame = (now) => {
    if (stopped) {
      return
    }
    gaps.push(now - previous)
    previous = now
    timerId = windowRoot.setTimeout(() => {
      if (!stopped) {
        frameId = windowRoot.requestAnimationFrame(frame)
      }
    }, sampleIntervalMs)
  }
  frameId = windowRoot.requestAnimationFrame(frame)
}

/**
 * Creates a streaming digest over source identity, device, timestamp, and
 * coordinates so million-row packaged soaks can prove exact truth without
 * retaining another in-memory copy of the mission.
 */
export function createPositionTruthDigestAccumulator() {
  const hash = createHash('sha256')
  let rowCount = 0
  let missingSourcePositionIdentityRows = 0
  let finished = false

  return {
    add: (row) => {
      if (finished) {
        throw new Error('Position truth digest is already finalized.')
      }
      const sourcePositionId =
        typeof row.source_position_id === 'string'
          ? row.source_position_id.trim()
          : ''
      if (!/^[1-9]\d*$/u.test(sourcePositionId)) {
        missingSourcePositionIdentityRows += 1
      }
      if (
        typeof row.device_id !== 'string' ||
        row.device_id.trim() === '' ||
        typeof row.timestamp !== 'string' ||
        row.timestamp.trim() === '' ||
        !Number.isFinite(row.lat) ||
        !Number.isFinite(row.lon)
      ) {
        throw new Error('Position truth digest received an invalid persisted row.')
      }

      hash.update(
        `${JSON.stringify([
          sourcePositionId,
          row.device_id,
          row.timestamp,
          row.lat,
          row.lon,
        ])}\n`,
        'utf8',
      )
      rowCount += 1
    },
    finish: () => {
      if (finished) {
        throw new Error('Position truth digest is already finalized.')
      }
      finished = true
      return {
        rowCount,
        missingSourcePositionIdentityRows,
        sha256: hash.digest('hex'),
      }
    },
  }
}

/** Parses macOS `ps` rows and returns RSS for only one root and its descendants. */
export function parseDarwinProcessTreeResidentMemory(contents, rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return null
  }
  const rows = String(contents)
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s*$/u)
      if (match === null) {
        return []
      }
      const pid = Number(match[1])
      const parentPid = Number(match[2])
      const residentKib = Number(match[3])
      if (
        !Number.isInteger(pid) ||
        !Number.isInteger(parentPid) ||
        !Number.isFinite(residentKib) ||
        residentKib < 0
      ) {
        return []
      }
      return [{
        pid,
        parentPid,
        residentBytes: residentKib * 1_024,
        command: match[4],
      }]
    })
  const rowByPid = new Map(rows.map((row) => [row.pid, row]))
  if (!rowByPid.has(rootPid)) {
    return null
  }
  const childPidsByParent = new Map()
  for (const row of rows) {
    const children = childPidsByParent.get(row.parentPid) ?? []
    children.push(row.pid)
    childPidsByParent.set(row.parentPid, children)
  }
  const pending = [rootPid]
  const visited = new Set()
  const processes = []
  while (pending.length > 0) {
    const pid = pending.pop()
    if (!Number.isInteger(pid) || visited.has(pid)) {
      continue
    }
    visited.add(pid)
    const row = rowByPid.get(pid)
    if (row === undefined) {
      continue
    }
    processes.push({
      pid: row.pid,
      parentPid: row.parentPid,
      residentBytes: row.residentBytes,
      kind: classifyDarwinProcessKind(row.command, row.pid === rootPid),
    })
    pending.push(...(childPidsByParent.get(pid) ?? []))
  }
  processes.sort((left, right) => left.pid - right.pid)
  const totalResidentBytes = processes.reduce(
    (total, process) => total + process.residentBytes,
    0,
  )
  return totalResidentBytes > 0
    ? { totalResidentBytes, processes }
    : null
}

function classifyDarwinProcessKind(command, root) {
  if (root) return 'main'
  if (/--type=renderer(?:\s|$)/u.test(command)) return 'renderer'
  if (/--type=gpu-process(?:\s|$)/u.test(command)) return 'gpu'
  if (/--type=utility(?:\s|$)/u.test(command)) return 'utility'
  if (/crashpad_handler/u.test(command)) return 'crashpad'
  return 'other'
}

/**
 * Classifies which operator-input boundary failed without relying on error text.
 *
 * The order follows the actual event path: DOM target -> Chromium hit test ->
 * browser click delivery -> React state -> main-process IPC -> close path.
 */
export function classifyOperatorInteraction(input) {
  const failureStages = []
  if (input.unexpectedInputEvents > 0) {
    failureStages.push('unexpected_browser_input')
  }
  if (input.targetFound !== true) {
    failureStages.push('target_missing')
  } else if (input.targetReceivesPointer !== true) {
    failureStages.push('input_occluded')
  }

  if (input.targetFound === true && input.targetReceivesPointer === true) {
    if (input.openClickCompleted !== true || input.openClickReceived !== true) {
      failureStages.push('browser_input_not_delivered')
    } else if (input.workspaceOpened !== true) {
      failureStages.push('ui_state_not_updated')
    }
  }

  if (input.mainIpcStatus === 'timeout' || input.mainIpcStatus === 'error') {
    failureStages.push(
      input.mainIpcStatus === 'timeout' ? 'main_ipc_unresponsive' : 'main_ipc_error',
    )
  }

  if (input.workspaceOpened === true) {
    if (input.closeClickCompleted !== true || input.closeClickReceived !== true) {
      failureStages.push('close_input_not_delivered')
    } else if (input.workspaceClosed !== true) {
      failureStages.push('ui_state_not_dismissed')
    }
  }

  return {
    passed: failureStages.length === 0,
    classification: failureStages[0] ?? 'healthy',
    failureStages,
  }
}

/** Calculates interval slopes without conflating retained positions and redundant telemetry. */
export function buildTrackingGrowthEvidence(checkpoints) {
  const normalized = checkpoints.map((checkpoint) => ({ ...checkpoint }))
  const intervals = []
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]
    const current = normalized[index]
    const pollDelta = current.equivalentProductionPolls - previous.equivalentProductionPolls
    if (!Number.isFinite(pollDelta) || pollDelta <= 0) {
      throw new Error('Tracking growth checkpoints must have increasing production-poll counts.')
    }
    intervals.push({
      fromEquivalentProductionPolls: previous.equivalentProductionPolls,
      toEquivalentProductionPolls: current.equivalentProductionPolls,
      databaseBytesPerEquivalentPoll:
        (current.databaseBytes - previous.databaseBytes) / pollDelta,
      positionRowsPerEquivalentPoll:
        (current.positionRows - previous.positionRows) / pollDelta,
      redundantEventRowsPerEquivalentPoll:
        (current.redundantEventRows - previous.redundantEventRows) / pollDelta,
    })
  }
  return { checkpoints: normalized, intervals }
}

/** Extracts bounded backup and position-write timings from JSONL runtime evidence. */
export function parseTrackingSoakRuntimeLog(contents) {
  const backupCycles = []
  const trackingPositionBatches = []
  for (const line of String(contents).split(/\r?\n/u)) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.event === 'storage_backup_completed') {
      backupCycles.push({
        totalDurationMs: Number(entry.totalDurationMs),
        databaseBytes: Number(entry.databaseBytes),
      })
    } else if (entry?.event === 'storage_tracking_positions_completed') {
      trackingPositionBatches.push({
        durationMs: Number(entry.durationMs),
        insertedPositionCount: Number(entry.insertedPositionCount),
      })
    }
  }
  return {
    backupCycles,
    trackingPositionBatches,
    backupDurationTrendMs:
      backupCycles.length < 2
        ? 0
        : backupCycles.at(-1).totalDurationMs - backupCycles[0].totalDurationMs,
  }
}

function positiveNumber(value, fallback, flag) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${flag} must be a positive number.`)
  }
  return resolved
}

function boundedInteger(value, fallback, minimum, maximum, flag) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${flag} poll interval must be an integer between ${minimum} and ${maximum} ms.`)
  }
  return resolved
}

function requireExact(reasons, actual, expected, label) {
  if (actual !== expected) {
    reasons.push(`Expected ${expected} ${label}; observed ${String(actual)}.`)
  }
}

function requireAtLeast(reasons, actual, minimum, label) {
  if (!Number.isFinite(actual) || actual < minimum) {
    reasons.push(`Expected at least ${minimum} ${label}; observed ${String(actual)}.`)
  }
}

function requireBoundedBytes(reasons, actual, maximum, label) {
  if (!Number.isFinite(actual) || actual <= 0 || actual > maximum) {
    reasons.push(`Expected ${label} bytes in 1-${maximum}; observed ${String(actual)}.`)
  }
}
