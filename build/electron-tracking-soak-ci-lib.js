import path from 'node:path'

/**
 * Builds the deterministic packaged-soak runner arguments for one platform.
 *
 * GitHub's Xvfb runner has no hardware WebGL implementation. Request ANGLE's
 * OpenGL backend so the Xvfb host can use its Mesa-backed rendering path;
 * allowing Chromium to choose its software fallback instead selected a
 * SwiftShader/Vulkan path that failed to initialize on the Azure runner. The
 * headless desktop must also keep the validation window foreground-equivalent;
 * otherwise Chromium deliberately throttles renderer frames and the timing
 * gate measures Xvfb occlusion instead of the application.
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
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    )
  }

  return runnerArgs
}
