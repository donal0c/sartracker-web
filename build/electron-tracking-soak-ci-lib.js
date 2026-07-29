import path from 'node:path'

/**
 * Builds the deterministic packaged-soak runner arguments for one platform.
 *
 * GitHub's Xvfb runner has no hardware WebGL implementation. Keep its
 * software-rendering switches aligned with the separate Linux launch smoke so
 * MapLibre can mount and the operator-interaction probe exercises the real UI.
 */
export function buildTrackingSoakCiRunnerArgs(input) {
  const runnerArgs = [
    path.join(input.projectRoot, 'scripts', 'electron-tracking-soak.mjs'),
    '--app',
    input.appPath,
    '--profile',
    'ci',
    '--evidence',
    path.join(input.projectRoot, 'tmp', 'beta-artifacts', 'tracking-soak-ci'),
  ]

  if (input.platform === 'linux') {
    runnerArgs.push(
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
    )
  }

  return runnerArgs
}
