import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve('.')
const receiptWriter = path.resolve('scripts/record-electron-repair-train-d-deferred.mjs')

interface DeferredQualificationReceipt {
  readonly schema: string
  readonly status: string
  readonly result: string
  readonly qualification: string
  readonly runRequested: boolean
  readonly releaseHold: boolean
  readonly reason: {
    readonly code: string
    readonly message: string
  }
  readonly source: {
    readonly expectedSourceSha: string | null
    readonly expectedSourceTree: string | null
  }
}

interface WorkflowStep {
  readonly name?: string
  readonly if?: string
  readonly run?: string
  readonly with?: {
    readonly path?: string
  }
}

interface WorkflowJob {
  readonly steps: readonly WorkflowStep[]
}

interface Workflow {
  readonly jobs: Record<string, WorkflowJob>
}

/** Selects a named step from the Linux validation job for contract assertions. */
function selectStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name)
  expect(step, `Expected workflow step "${name}"`).toBeDefined()
  return step as WorkflowStep
}

describe('Repair Train D deferred packaged qualification evidence', () => {
  it('writes an explicit non-pass receipt when packaged smoke is not requested', async () => {
    const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-train-d-deferred-'))
    const outputPath = path.join(evidenceDirectory, 'repair-train-d', 'receipt.json')
    try {
      await execFileAsync(process.execPath, [receiptWriter, '--output', outputPath], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          EXPECTED_SOURCE_SHA: 'source-sha',
          EXPECTED_SOURCE_TREE: 'source-tree',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_REF: 'refs/pull/27/merge',
          GITHUB_RUN_ID: '1234',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_WORKFLOW: 'Electron Linux Validation Build',
        },
      })

      const receipt = JSON.parse(await readFile(outputPath, 'utf8')) as DeferredQualificationReceipt
      expect(receipt).toMatchObject({
        schema: 'sartracker-electron-repair-train-d-qualification-v1',
        status: 'not-run',
        result: 'not-run',
        qualification: 'deferred',
        runRequested: false,
        releaseHold: true,
        reason: {
          code: 'packaged_smoke_not_requested',
        },
        source: {
          expectedSourceSha: 'source-sha',
          expectedSourceTree: 'source-tree',
        },
      })
      expect(receipt.reason.message).toMatch(/manual.*run_repair_train_d_smoke/i)
      expect(receipt).not.toHaveProperty('scenarioResults')
    } finally {
      await rm(evidenceDirectory, { recursive: true, force: true })
    }
  })

  it('keeps the default-off workflow path machine-readable and outside the strict smoke gate', () => {
    const workflowSource = readFileSync('.github/workflows/electron-linux-validation.yml', 'utf8')
    const workflow = load(workflowSource) as Workflow
    const job = workflow.jobs.build
    const smoke = selectStep(job, 'Packaged participant progress and Search Operations backup proof')
    const deferred = selectStep(job, 'Record deferred Repair Train D packaged qualification')
    const upload = selectStep(job, 'Upload validation evidence')

    expect(workflowSource).toContain('default: false')
    expect(smoke.if).toContain('inputs.run_repair_train_d_smoke == true')
    expect(deferred.if).toContain('always()')
    expect(deferred.if).toContain('inputs.run_repair_train_d_smoke == true')
    expect(deferred.run).toContain('record-electron-repair-train-d-deferred.mjs')
    expect(deferred.run).toContain(
      'tmp/electron-validation-evidence/repair-train-d/receipt.json',
    )
    expect(String(upload.with?.path).split('\n')).toContain(
      'tmp/electron-validation-evidence/repair-train-d/receipt.json',
    )
  })
})
