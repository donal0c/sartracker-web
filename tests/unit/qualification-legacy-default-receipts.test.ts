// @vitest-environment node
import { expect,it } from 'vitest'
import { validateLegacyDefaultReceipt } from '../../scripts/qualification/legacy-default-receipts.mjs'

it('refuses a development recovery claim and a kill after recovery already completed', async () => {
  const expected = {variantId:'legacy-v11-50k-kill',appSha256:'a'.repeat(64),asarSha256:'b'.repeat(64),evidencePath:'/owned/evidence'}
  const launches = [11,12,13].map(pid => ({pid,profile:'/owned/profile',executableSha256:expected.appSha256,asarSha256:expected.asarSha256}))
  const report = {schemaVersion:1,contractId:'C19',variantId:expected.variantId,developmentTestHarness:true,profile:'/owned/profile',launches,cleanup:{applicationClosed:true,profileRemoved:true},interruption:{pid:11,observedRows:50000,exit:{signal:'SIGKILL'}}}
  await expect(validateLegacyDefaultReceipt(report,expected)).rejects.toThrow(/envelope/)
  await expect(validateLegacyDefaultReceipt({...report,developmentTestHarness:false},expected)).rejects.toThrow(/intermediate/)
  await expect(validateLegacyDefaultReceipt({...report,developmentTestHarness:false,launches:[launches[0],launches[0],launches[2]]},expected)).rejects.toThrow(/distinct/)
})
