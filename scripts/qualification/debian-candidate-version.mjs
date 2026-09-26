/** Map the reviewed beta version exactly as electron-builder does for Debian. */
export function debianVersionOf(candidateVersion) {
  if (typeof candidateVersion !== 'string' || !/^0\.1\.0-beta\.\d+(?:\.\d+)?$/u.test(candidateVersion)) {
    throw new Error('Explicit candidate beta version is required for Debian identity.')
  }
  return candidateVersion.replace('-', '~')
}

/** Reject any control or installed version other than this exact candidate. */
export function validateCandidateDebianVersion(actualVersion, candidateVersion) {
  if (actualVersion !== debianVersionOf(candidateVersion)) {
    throw new Error('Debian package version differs from the exact candidate version.')
  }
}
