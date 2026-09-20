/**
 * Build the fixed Linux launch arguments used by the packaged Replay map
 * producer. The software rasterizer keeps page compositing off the shared
 * Mesa graphics queue while MapLibre's WebGL context remains enabled.
 */
export function buildReplayMapLaunchArgs(platform) {
  if (platform !== 'linux') return []
  return [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=gl',
    '--disable-gpu-rasterization',
    '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ]
}
