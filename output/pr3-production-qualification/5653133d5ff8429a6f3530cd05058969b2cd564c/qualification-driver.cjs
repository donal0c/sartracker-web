const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../electron/mission-store.cjs')

async function main() {
  const [fixturePath, runDirectory, expectedHead] = process.argv.slice(2)
  if (!fixturePath || !runDirectory || !expectedHead) throw new Error('fixture, run directory, and head are required')
  await fsp.rm(runDirectory, { recursive: true, force: true })
  await fsp.mkdir(runDirectory, { recursive: true })
  await fsp.copyFile(fixturePath, path.join(runDirectory, 'mission-store.sqlite'))
  const source = new Database(fixturePath, { readonly: true, fileMustExist: true })
  const missionId = source.prepare(`SELECT mission_id AS id, COUNT(*) AS position_count
    FROM positions GROUP BY mission_id ORDER BY position_count DESC, mission_id ASC LIMIT 1`).get()?.id
  source.close()
  if (typeof missionId !== 'string') throw new Error('qualification mission is missing')

  const gaps = []
  let lastProbe = performance.now()
  const probe = setInterval(() => {
    const now = performance.now()
    gaps.push(Math.max(0, now - lastProbe - 5))
    lastProbe = now
  }, 5)
  const startedAt = performance.now()
  const store = createElectronMissionStore({ userDataPath: runDirectory })
  try {
    const manifest = await store.readCoverageManifest(missionId, 'qualification-manifest')
    const manifestReadyAt = performance.now()
    const outingById = new Map(manifest.outings.map((outing) => [outing.id, outing]))
    const ordered = [...manifest.chunks].sort((left, right) => {
      const leftStart = left.key.period_kind === 'outing'
        ? outingById.get(left.key.period_id)?.started_at ?? ''
        : ''
      const rightStart = right.key.period_kind === 'outing'
        ? outingById.get(right.key.period_id)?.started_at ?? ''
        : ''
      return rightStart.localeCompare(leftStart) ||
        left.key.period_kind.localeCompare(right.key.period_kind) ||
        left.key.period_id.localeCompare(right.key.period_id) ||
        left.key.device_id.localeCompare(right.key.device_id)
    })
    const groups = []
    for (const chunk of ordered) {
      const identity = `${chunk.key.period_kind}\u0000${chunk.key.period_id}`
      const current = groups.at(-1)
      if (current?.identity === identity) current.chunks.push(chunk)
      else groups.push({ identity, chunks: [chunk] })
    }
    const working = []
    let firstUsefulAt = null
    let deliveredFixes = 0
    const periodDurationsMs = []
    for (const group of groups) {
      working.push(...group.chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev })))
      const periodStartedAt = performance.now()
      const catalog = await store.syncCoverageTileCatalog({
        missionId,
        chunks: working,
      }, `qualification-catalog-${groups.indexOf(group)}`)
      if (typeof catalog.activationId !== "string") throw new Error("qualification catalog has no activation ID")
      const stagedPeriod = catalog.periods[0]
      if (stagedPeriod === undefined) throw new Error("qualification catalog has no staged period")
      await store.readCoverageTile({
        periodKey: stagedPeriod.periodKey, revisionDigest: stagedPeriod.revisionDigest,
        z: 0, x: 0, y: 0,
      })
      await store.activateCoverageTileCatalog({ activationId: catalog.activationId })
      await store.readCoverageTile({
        periodKey: stagedPeriod.periodKey, revisionDigest: stagedPeriod.revisionDigest,
        z: 0, x: 0, y: 0,
      })
      periodDurationsMs.push(performance.now() - periodStartedAt)
      const delivered = new Set(catalog.delivered.map((entry) =>
        `${entry.key.device_id}\u0000${entry.key.period_kind}\u0000${entry.key.period_id}@${entry.contentRev}`))
      deliveredFixes = manifest.chunks.reduce((sum, chunk) =>
        sum + (delivered.has(`${chunk.key.device_id}\u0000${chunk.key.period_kind}\u0000${chunk.key.period_id}@${chunk.contentRev}`)
          ? chunk.exactCount
          : 0), 0)
      if (firstUsefulAt === null && deliveredFixes > 0) firstUsefulAt = performance.now()
    }
    const completedAt = performance.now()
    const claim = await store.readCoverageClaim({
      missionId,
      selectedKeys: manifest.chunks.map((chunk) => chunk.key),
    }, 'qualification-claim')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const report = {
      exactHead: expectedHead,
      fixturePath,
      fixtureBytes: fs.statSync(fixturePath).size,
      missionId,
      chunkCount: manifest.chunks.length,
      periodCount: groups.length,
      totalFixes: manifest.chunks.reduce((sum, chunk) => sum + chunk.exactCount, 0),
      deliveredFixes,
      manifestReadyMs: manifestReadyAt - startedAt,
      firstUsefulMs: firstUsefulAt === null ? null : firstUsefulAt - startedAt,
      completeMs: completedAt - startedAt,
      periodDurationsMs,
      mainMaxGapMs: Math.max(0, ...gaps),
      claim: {
        changeSeq: claim.changeSeq,
        databaseReady: claim.databaseReady,
        blockers: claim.blockers,
        revisionCount: claim.chunkRevisions.length,
      },
      completedAt: new Date().toISOString(),
    }
    await fsp.writeFile(path.join(runDirectory, 'production-qualification.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    if (report.firstUsefulMs === null || report.firstUsefulMs > 5_000) process.exitCode = 2
    const unexpectedBlockers = claim.blockers.filter((blocker) => blocker !== 'backfill_incomplete')
    if (report.mainMaxGapMs > 200 || unexpectedBlockers.length > 0) process.exitCode = 3
  } finally {
    clearInterval(probe)
    store.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
