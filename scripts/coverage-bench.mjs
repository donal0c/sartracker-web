#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  aggregateCoverageBenchRuns,
  checksumCoverageBenchValue,
  renderCoverageBenchVerdictTable,
  validateCoverageBenchManifest,
} from '../build/coverage-bench-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

main().catch((error) => {
  console.error(`coverage-bench: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs one full interleaved A/B/C × 960k/2M × three-repetition G2 matrix. */
async function main() {
  const args = parseArguments(process.argv.slice(2))
  await validateExactHead(args.appSha)
  await mkdir(args.outputDirectory, { recursive: true })
  const dotsProofPath = path.join(args.outputDirectory, 'exact-dots-contract-proof.json')
  await runExactDotsContract(args.appSha, dotsProofPath)

  const fixtures = [
    { preset: 'bcp-960k', path: args.fixture960k },
    { preset: 'bcp-2m', path: args.fixture2m },
  ]
  for (const fixture of fixtures) await validateFixture(fixture)

  const manifests = []
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const fixture of fixtures) {
      for (const candidate of ['A', 'B', 'C']) {
        const runRoot = path.join(args.outputDirectory, `${fixture.preset}-${candidate}`)
        const fixtureCopy = path.join(runRoot, 'fixture', 'mission-store.sqlite')
        const fixtureManifestCopy = `${fixtureCopy}.manifest.json`
        const profileDirectory = path.join(runRoot, 'profile')
        const killProofPath = path.join(runRoot, 'kill-proof.json')
        await mkdir(path.dirname(fixtureCopy), { recursive: true })

        if (repetition === 1) {
          const killFixtureCopy = path.join(runRoot, 'kill-probe', 'fixture', 'mission-store.sqlite')
          const killFixtureManifestCopy = `${killFixtureCopy}.manifest.json`
          await mkdir(path.dirname(killFixtureCopy), { recursive: true })
          await copyFile(fixture.path, killFixtureCopy)
          await copyFile(`${fixture.path}.manifest.json`, killFixtureManifestCopy)
          await runPackagedBench({
            ...args,
            candidate,
            fixture,
            fixtureCopy: killFixtureCopy,
            fixtureManifestCopy: killFixtureManifestCopy,
            profileDirectory: path.join(runRoot, 'kill-probe', 'profile'),
            runRoot,
            repetition,
            dotsProofPath,
            killProofPath,
            killProbe: true,
            outputPath: path.join(runRoot, 'kill-probe-should-not-complete.json'),
          })
          await assertKillProof(killProofPath, args.appSha, candidate, fixture.preset)
          await copyFile(fixture.path, fixtureCopy)
          await copyFile(`${fixture.path}.manifest.json`, fixtureManifestCopy)
        }

        const outputPath = path.join(runRoot, `run-${repetition}.json`)
        await runPackagedBench({
          ...args,
          candidate,
          fixture,
          fixtureCopy,
          fixtureManifestCopy,
          profileDirectory,
          runRoot,
          repetition,
          dotsProofPath,
          killProofPath,
          killProbe: false,
          outputPath,
        })
        const manifest = validateCoverageBenchManifest(
          JSON.parse(await readFile(outputPath, 'utf8')),
        )
        manifests.push(manifest)
        console.log(`coverage-bench: ${candidate}/${fixture.preset}/run-${repetition} ${checksumCoverageBenchValue(manifest)}`)
      }
    }
  }

  const aggregate = aggregateCoverageBenchRuns(manifests)
  const aggregatePath = path.join(args.outputDirectory, 'aggregate.json')
  const tablePath = path.join(args.outputDirectory, 'verdict-table.md')
  await writeFile(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8')
  await writeFile(tablePath, `${renderCoverageBenchVerdictTable(aggregate)}\n`, 'utf8')
  console.log(`coverage-bench: aggregate ${aggregatePath}`)
  console.log(renderCoverageBenchVerdictTable(aggregate))
}

/** Launches one packaged run and requires the expected exit mode. */
async function runPackagedBench(input) {
  const appArgs = [
    `--bench-candidate=${input.candidate}`,
    `--bench-fixture=${input.fixtureCopy}`,
    `--bench-fixture-preset=${input.fixture.preset}`,
    `--bench-fixture-manifest=${input.fixtureManifestCopy}`,
    `--bench-app-sha=${input.appSha}`,
    `--bench-output=${input.outputPath}`,
    `--bench-run-directory=${input.runRoot}`,
    `--bench-repetition=${input.repetition}`,
    `--bench-thermal-state=${input.repetition === 1 ? 'cold' : 'warm'}`,
    `--bench-dots-proof=${input.dotsProofPath}`,
    `--bench-spawned-at=${Date.now()}`,
    `--user-data-dir=${input.profileDirectory}`,
    '--ozone-platform=x11',
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=gl',
  ]
  if (input.killProbe) {
    appArgs.push('--bench-kill-probe', `--bench-kill-checkpoint=${input.killProofPath}`)
  } else {
    appArgs.push(`--bench-kill-proof=${input.killProofPath}`)
  }
  const result = await spawnWithOutput(input.appPath, appArgs, projectRoot)
  if (input.killProbe) {
    if (result.signal !== 'SIGKILL' && result.code !== 137) {
      throw new Error(`Kill probe ${input.candidate}/${input.fixture.preset} did not exit by SIGKILL (code=${result.code}, signal=${result.signal}).`)
    }
    return
  }
  if (result.code !== 0) {
    throw new Error(`Packaged run ${input.candidate}/${input.fixture.preset}/${input.repetition} failed with ${result.code}.`)
  }
}

/** Runs the unchanged exact-Dots contract once and binds it to this app SHA. */
async function runExactDotsContract(appSha, outputPath) {
  const result = await spawnWithOutput('npm', ['run', 'test:contract:dots'], projectRoot)
  const proof = {
    appSha,
    passed: result.code === 0,
    completedAt: new Date().toISOString(),
    command: 'npm run test:contract:dots',
  }
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
  if (!proof.passed) throw new Error('The exact Breadcrumb Dots contract failed; G2 cannot proceed.')
}

/** Verifies the immutable fixture and sidecar exist and identify the requested preset. */
async function validateFixture(fixture) {
  const fixtureStats = await stat(fixture.path)
  const manifest = JSON.parse(await readFile(`${fixture.path}.manifest.json`, 'utf8'))
  if (manifest.preset !== fixture.preset || manifest.generatorVersion !== 4) {
    throw new Error(`${fixture.preset} fixture binding is invalid.`)
  }
  if (manifest.workload.realPositionRows !== (fixture.preset === 'bcp-960k' ? 960_000 : 2_000_000)) {
    throw new Error(`${fixture.preset} fixture position count is invalid.`)
  }
  if (fixtureStats.size !== manifest.database.bytes) {
    throw new Error(`${fixture.preset} fixture byte count does not match its sidecar.`)
  }
  const digest = await sha256File(fixture.path)
  if (digest !== manifest.database.sha256) {
    throw new Error(`${fixture.preset} fixture digest does not match its sidecar.`)
  }
}

/** Refuses to label evidence with any commit other than the checked-out exact head. */
async function validateExactHead(appSha) {
  const result = await spawnCaptured('git', ['rev-parse', 'HEAD'], projectRoot)
  if (result.code !== 0 || result.stdout.trim() !== appSha) {
    throw new Error(`--app-sha ${appSha} does not match checked-out HEAD ${result.stdout.trim() || 'unknown'}.`)
  }
}

/** Streams a large fixture once so its sidecar cannot silently bind different bytes. */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => digest.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(digest.digest('hex')))
  })
}

/** Verifies a kill checkpoint belongs to this candidate, fixture, and exact app head. */
async function assertKillProof(proofPath, appSha, candidate, fixturePreset) {
  const proof = JSON.parse(await readFile(proofPath, 'utf8'))
  if (
    proof.appSha !== appSha ||
    proof.candidate !== candidate ||
    proof.fixturePreset !== fixturePreset ||
    !Number.isSafeInteger(proof.deliveredFixes) ||
    proof.deliveredFixes <= 0
  ) {
    throw new Error(`Kill/resume proof for ${candidate}/${fixturePreset} is invalid.`)
  }
}

/** Spawns a process without parallel heavy work and preserves its output in the task terminal. */
function spawnWithOutput(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

/** Spawns one short metadata command and captures its bounded stdout. */
function spawnCaptured(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

/** Parses the deliberately small matrix CLI. */
function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`Unknown argument: ${token}`)
    const key = token.slice(2)
    values[key] = argv[index + 1]
    index += 1
  }
  for (const required of ['app', 'fixture-960k', 'fixture-2m', 'output-dir', 'app-sha']) {
    if (!values[required]) throw new Error(`--${required} <value> is required.`)
  }
  if (!/^[a-f0-9]{40}$/i.test(values['app-sha'])) throw new Error('--app-sha must be a full Git SHA.')
  return {
    appPath: path.resolve(values.app),
    fixture960k: path.resolve(values['fixture-960k']),
    fixture2m: path.resolve(values['fixture-2m']),
    outputDirectory: path.resolve(values['output-dir']),
    appSha: values['app-sha'],
  }
}
