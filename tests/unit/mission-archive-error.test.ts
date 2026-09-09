import { describe, expect, it } from 'vitest'

import { readMissionArchiveErrorCode } from '../../src/features/mission/mission-archive-error'

describe('mission archive error code projection', () => {
  it('keeps parsing the final closed code when Electron prefixes a cleanup diagnostic token', () => {
    expect(readMissionArchiveErrorCode(new Error(
      'Error invoking remote method: Mission archive operation failed safely '
      + '[SARCD1.eyJzYWZlIjp0cnVlfQ] (ARCHIVE_CLEANUP_FAILED).',
    ))).toBe('ARCHIVE_CLEANUP_FAILED')
  })
})
