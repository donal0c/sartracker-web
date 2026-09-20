/**
 * Missing product capabilities confirmed against the canonical C19 contract and
 * DON-249/250/251 on 2026-09-20. These source-controlled holds are not runtime
 * inputs or user-waivable exclusions. Their owning implementation must supply
 * the missing behavior and reviewed qualification coverage before removal.
 */
const PRODUCT_CAPABILITY_BLOCKERS = Object.freeze([
  {
    issueId: 'DON-249', contractIds: ['C19', 'C24'],
    reason: 'Background integrity scheduling, resource arbitration, cancellation and stale-result handling are not implemented.',
  },
  {
    issueId: 'DON-250', contractIds: ['C19'],
    reason: 'Mission-state-aware oversized-store classification and recovery actions are not implemented.',
  },
  {
    issueId: 'DON-251', contractIds: ['C19', 'C24'],
    reason: 'Measured index and telemetry-only retention policy with interruption recovery is not implemented.',
  },
].map((entry) => Object.freeze({ ...entry, contractIds: Object.freeze(entry.contractIds) })))

/** Return immutable product holds only for actual candidate admission. */
export function candidateProductCapabilityBlockers(mode) {
  return mode === 'candidate' ? PRODUCT_CAPABILITY_BLOCKERS : Object.freeze([])
}
