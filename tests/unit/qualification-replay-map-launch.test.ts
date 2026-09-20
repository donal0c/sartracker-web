import { describe, expect, it } from 'vitest'
import { buildReplayMapLaunchArgs } from '../../scripts/qualification/replay-map-launch.mjs'

describe('packaged Replay map launch controls', () => {
  it('keeps the Linux WebGL path while bounding software page rasterization and background scheduling', () => {
    expect(buildReplayMapLaunchArgs('linux')).toEqual([
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-gpu-rasterization',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ])
  })

  it('does not apply Linux-only renderer controls to other platforms', () => {
    expect(buildReplayMapLaunchArgs('darwin')).toEqual([])
    expect(buildReplayMapLaunchArgs('win32')).toEqual([])
  })
})
