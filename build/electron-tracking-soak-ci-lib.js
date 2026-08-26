import path from 'node:path'

/**
 * Builds the deterministic packaged-soak runner arguments for one platform.
 *
 * GitHub's Xvfb runner has no hardware WebGL implementation. Request ANGLE's
 * OpenGL backend so the Xvfb host can use its Mesa-backed rendering path. Do
 * not permit SwiftShader fallback and explicitly disable Chromium's Vulkan
 * features. Keep Chromium's frame-rate limiter enabled: removing it makes
 * ordinary CSS status animations saturate the CPU-only renderer and creates
 * artificial stalls. The headless desktop must also stay
 * foreground-equivalent; otherwise Chromium deliberately throttles renderer
 * frames and the timing gate measures Xvfb occlusion instead of the
 * application.
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
    '--freeze-threshold-ms',
    '200',
  ]

  if (input.platform === 'linux') {
    runnerArgs.push(
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
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
