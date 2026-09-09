import type { MissionArchiveInfo } from '../../infrastructure/mission-store/tauri-mission-store'

/**
 * Compares every archive field that verification is forbidden to mutate.
 * Availability, verification time/status, and last non-machine unwrap are the
 * only registry projections allowed to change during verification.
 */
export function sameMissionArchiveImmutableIdentity(
  left: MissionArchiveInfo,
  right: MissionArchiveInfo,
): boolean {
  return left.id === right.id
    && left.mission_id === right.mission_id
    && left.protected_finalization_epoch === right.protected_finalization_epoch
    && left.archive_kind === right.archive_kind
    && left.container_version === right.container_version
    && left.archive_path === right.archive_path
    && left.ciphertext_sha256 === right.ciphertext_sha256
    && left.size_bytes === right.size_bytes
    && left.created_at === right.created_at
    && left.previous_archive_id === right.previous_archive_id
    && left.previous_archive_sha256 === right.previous_archive_sha256
    && left.revision_sequence === right.revision_sequence
    && left.revision_count === right.revision_count
    && left.supplement_authority === right.supplement_authority
    && left.supplement_reason === right.supplement_reason
    && left.supplement_created_at === right.supplement_created_at
    && canonicalSlotIdentity(left) === canonicalSlotIdentity(right)
}

/** Produces an order-independent identity for the closed archive slot projection. */
function canonicalSlotIdentity(archive: MissionArchiveInfo): string {
  return archive.slots
    .map((slot) => `${slot.slotId}\u0000${slot.slotType}`)
    .toSorted()
    .join('\u0001')
}
