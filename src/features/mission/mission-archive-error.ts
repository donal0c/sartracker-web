const ARCHIVE_ERROR_CODE = /^ARCHIVE_[A-Z0-9_]{1,80}$/u
const ARCHIVE_ERROR_MESSAGE_SUFFIX = /\((ARCHIVE_[A-Z0-9_]{1,80})\)\.?$/u

/** Reads only a stable archive error code from direct or Electron-serialized failures. */
export function readMissionArchiveErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null
  if ('code' in error && typeof error.code === 'string'
    && ARCHIVE_ERROR_CODE.test(error.code)) {
    return error.code
  }
  if (!('message' in error) || typeof error.message !== 'string') return null
  return ARCHIVE_ERROR_MESSAGE_SUFFIX.exec(error.message)?.[1] ?? null
}
