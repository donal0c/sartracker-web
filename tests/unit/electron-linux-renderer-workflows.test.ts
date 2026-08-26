import { readFileSync } from 'node:fs'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowStep {
  env?: Record<string, string>
  name?: string
  run?: string
}

interface WorkflowJob {
  steps: WorkflowStep[]
}

interface Workflow {
  jobs: Record<string, WorkflowJob>
}

/**
 * Parses a workflow and fails clearly if its job structure is missing.
 */
function readWorkflow(path: string): Workflow {
  const parsed = load(readFileSync(path, 'utf8')) as Partial<Workflow>
  expect(parsed.jobs).toBeDefined()
  return parsed as Workflow
}

/**
 * Selects a named step so assertions stay bound to the process they protect.
 */
function selectStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name)
  expect(step, `Expected workflow step "${name}"`).toBeDefined()
  return step as WorkflowStep
}

/**
 * Verifies the runner has the Mesa software-rendering libraries.
 */
function expectMesaPackages(step: WorkflowStep): void {
  expect(step.run).toContain('libgl1-mesa-dri')
  expect(step.run).toContain('libglx-mesa0')
  expect(step.run).toContain('mesa-utils')
}

/** Verifies a real X11 window manager can deliver graceful close requests. */
function expectWindowManager(step: WorkflowStep): void {
  expect(step.run).toContain('openbox')
}

/**
 * Verifies that the workflow proves llvmpipe is active before app timing.
 */
function expectRendererAttestation(step: WorkflowStep): void {
  expect(step.env).toMatchObject({
    LIBGL_ALWAYS_SOFTWARE: '1',
    GALLIUM_DRIVER: 'llvmpipe',
  })
  expect(step.run).toContain('glxinfo -B')
  expect(step.run).toContain("grep -qi 'llvmpipe'")
}

/**
 * Verifies an AppImage launch is pinned to Mesa/ANGLE GL without SwiftShader.
 */
function expectMesaLaunch(step: WorkflowStep): void {
  expect(step.run).toContain('export LIBGL_ALWAYS_SOFTWARE=1')
  expect(step.run).toContain('export GALLIUM_DRIVER=llvmpipe')
  expect(step.run).toContain('--use-gl=angle')
  expect(step.run).toContain('--use-angle=gl')
  expect(step.run).toContain('--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE')
  expect(step.run).not.toContain('--disable-frame-rate-limit')
  expect(step.run).not.toContain('--enable-unsafe-swiftshader')
}

describe('Linux Electron renderer workflows [DON-260]', () => {
  it('pins both release workflow Linux paths to Mesa without Vulkan fallback', () => {
    const workflowPath = '.github/workflows/electron-release.yml'
    const workflowSource = readFileSync(workflowPath, 'utf8')
    const workflow = readWorkflow(workflowPath)
    const bundleJob = workflow.jobs['bundle-linux']
    const launchJob = workflow.jobs['launch-smoke-linux']

    expectMesaPackages(selectStep(bundleJob, 'Install Linux Electron runtime deps'))
    expectRendererAttestation(selectStep(bundleJob, 'Attest Mesa llvmpipe renderer'))
    expect(selectStep(bundleJob, 'Packaged tracking soak (CI profile)').env).toMatchObject({
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
    })
    expectMesaPackages(selectStep(launchJob, 'Install launch smoke deps'))
    expectMesaLaunch(selectStep(launchJob, 'Launch AppImage under Xvfb and capture evidence'))
    expect(workflowSource).not.toContain('--enable-unsafe-swiftshader')
  })

  it('pins the standalone Linux validation launch to Mesa without Vulkan fallback', () => {
    const workflowPath = '.github/workflows/electron-linux-validation.yml'
    const workflowSource = readFileSync(workflowPath, 'utf8')
    const workflow = readWorkflow(workflowPath)
    const job = workflow.jobs.build

    expectMesaPackages(selectStep(job, 'Install Linux Electron runtime deps'))
    expectWindowManager(selectStep(job, 'Install Linux Electron runtime deps'))
    expectRendererAttestation(selectStep(job, 'Attest Mesa llvmpipe renderer'))
    expect(selectStep(job, 'Packaged tracking soak (CI profile)').env).toMatchObject({
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
    })
    expectMesaLaunch(selectStep(job, 'Launch AppImage smoke'))
    expect(workflowSource).not.toContain('--enable-unsafe-swiftshader')
  })

  it('proves the standalone packaged app completes a graceful window close', () => {
    const workflow = readWorkflow('.github/workflows/electron-linux-validation.yml')
    const launch = selectStep(workflow.jobs.build, 'Launch AppImage smoke').run ?? ''

    expect(launch).toContain('xdotool windowclose "$WINDOW_ID"')
    expect(launch).toContain('openbox')
    expect(launch).toContain('xprop -root _NET_SUPPORTING_WM_CHECK')
    expect(launch).toContain("grep -Eq '_NET_SUPPORTING_WM_CHECK\\(WINDOW\\): window id # 0x[0-9a-f]+'")
    expect(launch).toContain('timeout 15s tail --pid="$APP_PID" -f /dev/null')
    expect(launch).toContain('wait "$APP_PID"')
    expect(launch).toContain('appimage-graceful-close.txt')
  })

  it('qualifies the internal mission model only in the standalone validation package', () => {
    const validation = readWorkflow('.github/workflows/electron-linux-validation.yml')
    const release = readWorkflow('.github/workflows/electron-release.yml')

    expect(selectStep(validation.jobs.build, 'Build Electron Linux artifacts').env).toMatchObject({
      VITE_SARTRACKER_MISSION_MODEL: '1',
    })
    expect(selectStep(release.jobs['bundle-linux'], 'Build Electron Linux artifacts').env)
      .not.toMatchObject({ VITE_SARTRACKER_MISSION_MODEL: '1' })
  })
})
