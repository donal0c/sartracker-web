import { execFileSync, spawnSync } from 'node:child_process'
import { access, copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve('.')
const cliSourcePath = path.join(repositoryRoot, 'scripts', 'qualification-control-plane.mjs')
const qualificationSourceRoot = path.join(repositoryRoot, 'scripts', 'qualification')
const fixtureSourcePath = path.join(repositoryRoot, 'tests', 'fixtures', 'outing-window-vectors.json')

let temporaryRoot: string | undefined

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true).catch(() => false)
}

async function createSyntheticGitFixture() {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sartracker-qualification-cli-'))
  const fixtureRoot = path.join(temporaryRoot, 'fixture')
  await mkdir(path.join(fixtureRoot, 'scripts', 'qualification'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'docs'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'fixtures'), { recursive: true })
  await cp(path.join(repositoryRoot, 'build'), path.join(fixtureRoot, 'build'), { recursive: true, errorOnExist: true })
  await copyFile(cliSourcePath, path.join(fixtureRoot, 'scripts', 'qualification-control-plane.mjs'))
  for (const entry of await readdir(qualificationSourceRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      await copyFile(path.join(qualificationSourceRoot, entry.name), path.join(fixtureRoot, 'scripts', 'qualification', entry.name))
    }
  }
  await writeFile(
    path.join(fixtureRoot, 'docs', 'qualification-contracts.json'),
    execFileSync('git', ['show', 'HEAD:docs/assurance/qualification-contracts.json'], { cwd: repositoryRoot, encoding: 'utf8' }),
  )
  await copyFile(fixtureSourcePath, path.join(fixtureRoot, 'fixtures', 'outing-window-vectors.json'))

  execFileSync('git', ['init', '-q'], { cwd: fixtureRoot })
  execFileSync('git', ['config', 'user.email', 'qualification-cli-test@example.invalid'], { cwd: fixtureRoot })
  execFileSync('git', ['config', 'user.name', 'Qualification CLI Test'], { cwd: fixtureRoot })
  execFileSync('git', ['add', '.'], { cwd: fixtureRoot })
  execFileSync('git', ['commit', '-qm', 'synthetic qualification fixture'], { cwd: fixtureRoot })

  const campaignRoot = path.join(temporaryRoot, 'campaign')
  const planPath = path.join(fixtureRoot, 'campaign-plan.json')
  await writeFile(planPath, JSON.stringify({
    schema: 'sartracker-qualification-campaign-plan-v1',
    campaignId: 'synthetic-cli-campaign',
    mode: 'calibration',
    releaseEligible: false,
    authorization: { issue: 'DON-254', explicitlyEnabled: true },
    registryPath: 'docs/qualification-contracts.json',
    fixturePaths: ['fixtures/outing-window-vectors.json'],
    validatorPaths: ['scripts/qualification-control-plane.mjs', 'scripts/qualification/control-plane.mjs'],
    requiredContracts: ['C00', 'C01'],
    bindings: [
      {
        contractId: 'C00',
        variantId: 'synthetic-pass',
        adapterId: 'calibration.pass',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        resourceKey: 'calibration',
        mandatory: true,
        command: ['internal-calibration', 'pass'],
      },
      {
        contractId: 'C01',
        variantId: 'synthetic-interrupt',
        adapterId: 'calibration.interrupt',
        receiptValidatorId: 'calibration.v1',
        proofMode: 'synthetic',
        capability: 'node',
        resourceKey: 'calibration',
        mandatory: true,
        command: ['internal-calibration', 'interrupt-resume'],
      },
    ],
  }, null, 2))
  execFileSync('git', ['add', 'campaign-plan.json'], { cwd: fixtureRoot })
  execFileSync('git', ['commit', '-qm', 'add synthetic campaign plan'], { cwd: fixtureRoot })

  return {
    fixtureRoot,
    campaignRoot,
    planPath,
    definitionPath: path.join(temporaryRoot, 'campaign-definition.json'),
    cliPath: path.join(fixtureRoot, 'scripts', 'qualification-control-plane.mjs'),
  }
}

function runCli(cliPath: string, cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  const output = result.stdout.trim()
  return {
    exitCode: result.status,
    stderr: result.stderr.trim(),
    stdout: output,
    json: output === '' ? undefined : JSON.parse(output) as Record<string, unknown>,
  }
}

async function compileCampaign(
  fixture: Awaited<ReturnType<typeof createSyntheticGitFixture>>,
  planPath = fixture.planPath,
  definitionPath = fixture.definitionPath,
) {
  const result = runCli(fixture.cliPath, fixture.fixtureRoot, [
    'compile', '--plan', planPath, '--output', definitionPath,
  ])
  expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(0)
  return JSON.parse(await readFile(definitionPath, 'utf8')) as Record<string, unknown>
}

describe('qualification CLI lease lifecycle', () => {
  it('runs standalone preflight as a disposable probe and leaves no lease behind', async () => {
    const fixture = await createSyntheticGitFixture()
    await compileCampaign(fixture)

    const help = runCli(fixture.cliPath, fixture.fixtureRoot, ['help'])
    expect(help.exitCode).toBe(0)
    expect(help.json?.commands).toContain('ingest-human')

    const first = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'preflight', '--campaign', fixture.definitionPath, '--root', fixture.campaignRoot,
    ])
    expect(first.exitCode).toBe(0)
    expect(first.json).toMatchObject({ status: 'READY', lifecycle: 'probe', cleanup: { status: 'CLEANED' } })
    expect(first.json?.lease).toBeUndefined()
    expect(await pathExists(path.join(fixture.campaignRoot, 'campaign.lock'))).toBe(false)

    const second = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'preflight', '--campaign', fixture.definitionPath, '--root', fixture.campaignRoot,
    ])
    expect(second.exitCode).toBe(0)
    expect(second.json).toMatchObject({ status: 'READY', lifecycle: 'probe', cleanup: { status: 'CLEANED' } })
    expect(await pathExists(path.join(fixture.campaignRoot, 'campaign.lock'))).toBe(false)
  })

  it('cleans run and resume leases, and verifies against the required campaign definition', async () => {
    const fixture = await createSyntheticGitFixture()
    const definition = await compileCampaign(fixture)

    const run = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'run', '--campaign', fixture.definitionPath, '--root', fixture.campaignRoot,
      '--contract', 'C00', '--variant', 'synthetic-pass',
    ])
    expect(run.exitCode).toBe(0)
    expect(run.json).toMatchObject({ status: 'PASS', cleanup: { status: 'CLEANED' } })
    expect(await pathExists(path.join(fixture.campaignRoot, 'campaign.lock'))).toBe(false)

    const attemptDirectory = String(run.json?.attemptDirectory)
    const judgePath = path.join(fixture.campaignRoot, 'judge-result.json')
    await writeFile(judgePath, JSON.stringify({
      schema: 'sartracker-oracle-blind-judge-result-v1',
      campaignId: definition.campaignId,
      attemptId: run.json?.attemptId,
      packetSha256: run.json?.judgePacketSha256,
      verdict: 'pass',
      observations: [],
    }))
    const ingest = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'ingest-judge', '--attempt', attemptDirectory, '--result', judgePath,
    ])
    expect(ingest.exitCode).toBe(0)

    const verified = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'verify', '--attempt', attemptDirectory, '--campaign', fixture.definitionPath,
    ])
    expect(verified.exitCode).toBe(0)
    expect(verified.json).toMatchObject({ campaignId: definition.campaignId, status: 'PASS' })

    const missingCampaign = runCli(fixture.cliPath, fixture.fixtureRoot, ['verify', '--attempt', attemptDirectory])
    expect(missingCampaign.exitCode).toBe(1)
    expect(missingCampaign.stderr).toMatch(/--campaign is required/u)

    const otherPlanPath = path.join(temporaryRoot!, 'other-campaign-plan.json')
    const otherDefinitionPath = path.join(temporaryRoot!, 'other-campaign-definition.json')
    const otherPlan = JSON.parse(await readFile(fixture.planPath, 'utf8'))
    otherPlan.campaignId = 'synthetic-other-campaign'
    otherPlan.registryPath = path.join(fixture.fixtureRoot, 'docs', 'qualification-contracts.json')
    otherPlan.fixturePaths = [path.join(fixture.fixtureRoot, 'fixtures', 'outing-window-vectors.json')]
    otherPlan.validatorPaths = [
      path.join(fixture.fixtureRoot, 'scripts', 'qualification-control-plane.mjs'),
      path.join(fixture.fixtureRoot, 'scripts', 'qualification', 'control-plane.mjs'),
    ]
    await writeFile(otherPlanPath, JSON.stringify(otherPlan, null, 2))
    await compileCampaign(fixture, otherPlanPath, otherDefinitionPath)
    const wrongCampaign = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'verify', '--attempt', attemptDirectory, '--campaign', otherDefinitionPath,
    ])
    expect(wrongCampaign.exitCode).toBe(1)
    expect(wrongCampaign.stderr).toMatch(/immutable campaign binding|cross-campaign/u)

    const malformedResume = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'resume', '--campaign', fixture.definitionPath, '--root', fixture.campaignRoot,
      '--attempt', 'missing-attempt',
    ])
    expect(malformedResume.exitCode).toBe(1)
    expect(malformedResume.stderr).toMatch(/ENOENT|attempt metadata/u)
    expect(await pathExists(path.join(fixture.campaignRoot, 'campaign.lock'))).toBe(false)

    const interrupted = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'run', '--campaign', fixture.definitionPath, '--root', fixture.campaignRoot,
      '--contract', 'C01', '--variant', 'synthetic-interrupt',
    ])
    expect(interrupted.exitCode).toBe(0)
    expect(interrupted.json).toMatchObject({ status: 'ABORTED_SAFE', cleanup: { status: 'CLEANED' } })
    expect(await pathExists(path.join(fixture.campaignRoot, 'campaign.lock'))).toBe(false)

    const resumed = runCli(fixture.cliPath, fixture.fixtureRoot, [
      'resume', '--campaign', fixture.definitionPath, '--root', fixture.campaignRoot,
      '--attempt', interrupted.json?.attemptId as string,
    ])
    expect(resumed.exitCode).toBe(0)
    expect(resumed.json).toMatchObject({ status: 'PASS', cleanup: { status: 'CLEANED' } })
    expect(await pathExists(path.join(fixture.campaignRoot, 'campaign.lock'))).toBe(false)
  })
})
