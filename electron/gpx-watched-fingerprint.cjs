'use strict'

/**
 * A write that lands within this long of the last hash can share its timestamp tick on
 * coarse file systems, so the stat alone cannot prove the bytes are unchanged.
 */
const GPX_STAT_TICK_GUARD_MS = 2_000

/**
 * File systems that store whole-second (HFS+), 2-second (FAT on Garmin SD cards) or 10 ms
 * (exFAT) modified times leave the millisecond value on a multiple of 10. They also have no
 * real change time, so a same-size rewrite inside one tick looks identical by stat.
 */
const GPX_COARSE_TIMESTAMP_MS = 10

/**
 * True when a watched file's stat fingerprint is precise enough to skip re-hashing it.
 * Anything doubtful returns false, which costs one bounded read and never skips a changed
 * file [DON-350] [M-38].
 *
 * @param {{ mtimeMs: number, ctimeMs: number }} stat Stat taken before the cached hash.
 * @param {number} verifiedAtMs When the cached hash was taken.
 * @returns {boolean}
 */
function canTrustGpxStatFingerprint(stat, verifiedAtMs) {
  const { mtimeMs, ctimeMs } = stat
  if (![mtimeMs, ctimeMs, verifiedAtMs].every(Number.isFinite)) return false
  if (mtimeMs % GPX_COARSE_TIMESTAMP_MS === 0 || ctimeMs % GPX_COARSE_TIMESTAMP_MS === 0) return false
  const lastChange = Math.max(mtimeMs, ctimeMs)
  return verifiedAtMs - lastChange > GPX_STAT_TICK_GUARD_MS
}

module.exports = { canTrustGpxStatFingerprint }
