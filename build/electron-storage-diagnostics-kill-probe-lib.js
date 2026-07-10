/** Parses the fail-closed packaged kill/restart probe CLI. */
export function parseStorageKillProbeArgs(argv) {
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
      case '--timeout-ms':
        args.timeoutMs = Number(nextValue())
        break
      case '--post-restart-observation-ms':
        args.postRestartObservationMs = Number(nextValue())
        break
      case '--':
        args.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }
  if (!args.appPath) throw new Error('--app <packaged Electron binary> is required.')
  if (!args.fixturePath) throw new Error('--fixture <mission-store.sqlite> is required.')
  const timeoutMs = args.timeoutMs ?? 180_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.')
  }
  const postRestartObservationMs = args.postRestartObservationMs ?? 35_000
  if (!Number.isFinite(postRestartObservationMs) || postRestartObservationMs < 30_000) {
    throw new Error('--post-restart-observation-ms must be at least 30000.')
  }
  return {
    appPath: args.appPath,
    fixturePath: args.fixturePath,
    evidenceDir: args.evidenceDir ?? 'output/storage-diagnostics-kill-probe',
    timeoutMs,
    postRestartObservationMs,
    extraArgs: args.extraArgs,
  }
}

/** Produces a machine-readable, fail-closed packaged kill/restart verdict. */
export function buildStorageKillProbeVerdict(input) {
  const failures = []
  if (
    input.beforeKill?.activeOperation?.type !== 'backup' ||
    input.beforeKill?.activeOperation?.stage !== 'started'
  ) {
    failures.push('The durable checkpoint was not at backup started before kill.')
  }
  if (
    input.afterRestart?.activeOperation !== null ||
    input.afterRestart?.previousInterruptedOperation?.type !== 'backup' ||
    input.afterRestart?.previousInterruptedOperation?.stage !== 'started'
  ) {
    failures.push('The checkpoint did not expose the interrupted backup start after restart.')
  }
  if (
    !String(input.runtimeLog).includes('storage_backup_started') ||
    !String(input.runtimeLog).includes('storage_previous_run_interrupted')
  ) {
    failures.push('The runtime log is missing the pre-kill or restart interruption marker.')
  }
  if (!String(input.runtimeLog).includes('storage_main_event_loop_summary')) {
    failures.push('The runtime log is missing the packaged main event-loop delay summary.')
  }
  if (
    !String(input.supportBundle).includes('[storage-diagnostics]') ||
    !String(input.supportBundle).includes(
      'previous interrupted operation: backup started',
    )
  ) {
    failures.push('The support bundle is missing interrupted storage-operation evidence.')
  }
  if (!/event loop latest maximum delay ms: [1-9][0-9]*/u.test(String(input.supportBundle))) {
    failures.push('The support bundle is missing a measured event-loop delay summary.')
  }
  for (const forbiddenValue of input.forbiddenValues ?? []) {
    if (forbiddenValue !== '' && String(input.supportBundle).includes(forbiddenValue)) {
      failures.push(`The support bundle contains a forbidden value: ${forbiddenValue}`)
    }
  }
  return { passed: failures.length === 0, failures }
}
