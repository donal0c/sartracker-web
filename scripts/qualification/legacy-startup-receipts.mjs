import { STARTUP_PROBE_DESCRIPTOR,validateStartupContractEvidence } from './startup-receipts.mjs'

/** Apply C19's independent refusal/custody requirements to the shared real packaged startup observations. */
export function validateLegacyStartupReceipt(report,expected) {
  const startup = validateStartupContractEvidence('C01',report,expected)
  const required = ['identity','custody','corruptSchemaRefusal','newerSchemaRefusal','permissionFault','diskFullFault']
  const failureReasons = required.filter(key => startup.recomputedPredicates[key] !== true).map(key => `C19 startup boundary ${key} was not proven.`)
  if (report?.schema !== STARTUP_PROBE_DESCRIPTOR.schema || report.contractId !== 'C01'
      || report.proofMode !== STARTUP_PROBE_DESCRIPTOR.proofMode) failureReasons.push('C19 shared startup producer identity differs.')
  return {status:failureReasons.length ? 'INVALID_EVIDENCE' : 'PASS',passed:failureReasons.length === 0,failureReasons,
    requiredPredicates:required,scope:'C19 corrupt/newer-schema, permission and bounded ENOSPC default-app refusal with original-file custody; shared C01 producer, separate C19 predicate'}
}
