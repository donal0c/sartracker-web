import path from 'node:path'

/**
 * Builds the deterministic packaged-soak runner arguments for one platform.
 *
 * GitHub's Xvfb runner has no hardware WebGL implementation. Request ANGLE's
 * OpenGL backend so the Xvfb host can use its Mesa-backed rendering path. Do
 * not permit SwiftShader fallback: GitHub's Azure runner selected its Vulkan
 * path even with explicit ANGLE arguments, then failed to initialize Vulkan
 * and produced invalid 15 fps timing evidence. The headless desktop must also
 * keep the validation window foreground-equivalent; otherwise Chromium
 * deliberately throttles renderer frames and the timing gate measures Xvfb
 * occlusion instead of the application.
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
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    )
  }

  return runnerArgs
}

/**
 * Forces the Linux validation process tree onto Mesa's CPU renderer.
 *
 * These variables are scoped to the packaged soak child process. They do not
 * alter the shipped application or any macOS validation path.
 */
export function buildTrackingSoakCiEnvironment(input) {
  if (input.platform !== 'linux') {
    return { ...input.environment }
  }
  return {
    ...input.environment,
    LIBGL_ALWAYS_SOFTWARE: '1',
    GALLIUM_DRIVER: 'llvmpipe',
  }
}
