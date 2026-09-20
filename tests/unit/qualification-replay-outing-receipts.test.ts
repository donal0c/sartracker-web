// @vitest-environment node
import { expect,it } from 'vitest'
import { validateReplayOutingFacts,validateReplayOutingReceipt } from '../../scripts/qualification/replay-outing-receipts.mjs'

it('requires the final outing beyond two full pages, archive parity and visible search',async () => {
  const ids = Array.from({length:201},(_,index) => `outing-${String(index).padStart(3,'0')}`)
  const binding = {missionId:'m',selectedTime:'2026-09-20T00:00:00Z',replayGeneration:1}
  const query = {...binding,filterKind:'outing',filterLimit:100}
  const lane = {first:{...binding,availableOutingTotalCount:201,availableOutingIds:ids.slice(0,100),availableOutingNextCursor:'second'},pages:[{query:{...query,filterCursor:'second'},result:{totalCount:201,entries:ids.slice(100,200),nextCursor:'third'}},{query:{...query,filterCursor:'third'},result:{totalCount:201,entries:ids.slice(200),nextCursor:null}}],search:{totalCount:1,entries:[ids[200]],search:ids[200]}}
  const report = {...binding,live:lane,archive:{...lane,verified:true,immutable:true},ui:{initialTotal:'201',searchedIdentity:ids[200],searchFound:true}}
  expect(validateReplayOutingFacts(report,ids)).toBeUndefined()
  const duplicate = structuredClone(report)
  duplicate.archive.pages[1]!.result.entries[0] = ids[0]!
  expect(() => validateReplayOutingFacts(duplicate,ids)).toThrow(/dropped, repeated/)
  expect(() => validateReplayOutingFacts({...report,archive:{...report.archive,verified:false}},ids)).toThrow(/verified/)
  expect(() => validateReplayOutingFacts({...report,ui:{...report.ui,searchFound:false}},ids)).toThrow(/rendered/)
  expect(() => validateReplayOutingFacts(report,ids.slice(1))).toThrow(/201/)
  await expect(validateReplayOutingReceipt({...report,developmentTestHarness:true},{})).rejects.toThrow(/envelope/)
})
