const { createElectronMissionStore } = require('../../electron/mission-store.cjs')

const [userDataPath, missionId, sourcePath, pauseAfter] = process.argv.slice(2)

async function run() {
  const store = createElectronMissionStore({
    userDataPath,
    readAdminRoster: async () => [],
    gpxEvidenceImportFaultInjection: { pauseAfter },
  })
  await store.importGpxEvidencePaths({ missionId, paths: [sourcePath] })
  await store.prepareClose()
  store.close()
}

run().catch((error) => {
  process.send?.({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
