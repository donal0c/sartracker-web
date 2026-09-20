import { createRequire } from 'node:module'
import { mkdir,writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Build 201 actual dated GPX imports with distinct outing assignments through the source store's public methods. */
export async function createReplayOutingFixture(profile) {
  await mkdir(profile,{recursive:true,mode:0o700})
  const sourceDirectory = path.join(profile,'synthetic-gpx-inputs')
  await mkdir(sourceDirectory)
  const {createElectronMissionStore} = createRequire(import.meta.url)('../../electron/mission-store.cjs')
  const store = createElectronMissionStore({userDataPath:profile})
  try {
    const base = Date.parse('2026-01-01T00:00:00.000Z')
    const mission = await store.createMission({name:'Replay 201 outing filter fixture',start_time:new Date(base).toISOString()})
    const outings = []
    const files = []
    for (let index=0;index<201;index++) {
      const start = new Date(base+index*60000).toISOString()
      const outing = await store.createOuting({mission_id:mission.id,label:`Replay outing ${String(index).padStart(3,'0')}`,started_at:start})
      await store.endOuting({mission_id:mission.id,outing_id:outing.id,ended_at:new Date(base+index*60000+30000).toISOString()})
      outings.push(outing.id)
      const filename = path.join(sourceDirectory,`replay-outing-${String(index).padStart(3,'0')}.gpx`)
      const timestamp = new Date(base+index*60000+1000).toISOString()
      const secondTime = new Date(base+index*60000+2000).toISOString()
      await writeFile(filename,`<?xml version="1.0"?><gpx version="1.1" creator="synthetic replay fixture" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Outing ${index}</name><trkseg><trkpt lat="${52+index*0.000001}" lon="-9.7"><time>${timestamp}</time></trkpt><trkpt lat="${52+index*0.000001+0.0000001}" lon="-9.7"><time>${secondTime}</time></trkpt></trkseg></trk></gpx>`)
      files.push(filename)
    }
    const imports = []
    for (let offset=0;offset<files.length;offset+=100) {
      const batch = await store.importGpxEvidencePaths({missionId:mission.id,paths:files.slice(offset,offset+100)})
      if (batch.failures.length || batch.imports.length !== Math.min(100,files.length-offset)) throw new Error('Replay outing source import did not settle every fixed GPX file.')
      for (const entry of batch.imports) {
        const match = /^replay-outing-(\d{3})\.gpx$/u.exec(entry.file_name)
        if (!match) throw new Error('Replay outing imported filename differs.')
        const index = Number(match[1])
        await store.assignGpxImportToOuting({import_id:entry.id,outing_id:outings[index],assigned_by:'Synthetic replay fixture'})
        imports.push({id:entry.id,outingId:outings[index],index})
      }
    }
    await store.finishMission(mission.id)
    await store.prepareClose()
    return {missionId:mission.id,outings:outings.sort(),imports,selectedTime:new Date().toISOString()}
  } finally { await store.prepareClose(); store.close() }
}
