/**
 * Historical release-body format used by beta releases up to 13.4: the
 * 14-gate "Packaged smoke matrix". Kept only so the retired qualification
 * campaign's read-only release adapter can still read retained releases.
 * New releases use the release checklist enforced by build/electron-release-lib.js.
 */

const REQUIRED_QUALIFICATION_GATES = [
  'AppImage SHA-256',
  '.deb SHA-256',
  'AppImage launch',
  '.deb install and launch',
  'Core lifecycle, restart/recovery, finish/finalize/archive',
  'Coordinate rejection',
  'Diagnostics/support/incident exports sanitized',
  'Bad/corrupt stored credential reaches shell',
  'Live Traccar connection and breadcrumb reconciliation',
  'Official offline Discovery package',
  'Duplicate launch',
  'Five-day and fourteen-day packaged soak',
  'Cross-profile exact breadcrumb identity comparison',
  'Strict responsiveness (<200 ms)',
]

const NOT_APPLICABLE_GATE = 'Official offline Discovery package'
const NON_FINAL_EVIDENCE = /\b(?:todo|pending|tbd|local pass|ci artifact pending|none)\b/iu
const SHA256_PATTERN = /\b[a-f0-9]{64}\b/iu

/**
 * Validates the complete packaged-smoke table in a draft release body and
 * extracts the exact AppImage and Debian artifact identities.
 *
 * @param {string} body
 * @returns {{appImage: {name: string, sha256: string}, deb: {name: string, sha256: string}}}
 */
export function validateLegacySmokeMatrix(body) {
  const rows = parseQualificationRows(body)

  for (const gate of REQUIRED_QUALIFICATION_GATES) {
    const row = rows.get(gate)
    if (row === undefined) {
      throw new Error(`Release qualification matrix is missing required gate "${gate}".`)
    }
    if (row.result !== 'PASS' && !(gate === NOT_APPLICABLE_GATE && row.result === 'NOT APPLICABLE')) {
      throw new Error(
        `Release qualification gate "${gate}" must pass: ${JSON.stringify(row.result)}.`,
      )
    }
    if (row.evidence === '' || NON_FINAL_EVIDENCE.test(row.evidence)) {
      throw new Error(
        `Release qualification gate "${gate}" has missing or non-final evidence.`,
      )
    }
  }

  return {
    appImage: parseArtifactIdentity(rows.get('AppImage SHA-256').evidence, '.AppImage'),
    deb: parseArtifactIdentity(rows.get('.deb SHA-256').evidence, '.deb'),
  }
}

/**
 * Parses the Packaged smoke matrix into one unique row per gate.
 *
 * @param {string} body
 * @returns {Map<string, {result: string, evidence: string}>}
 */
function parseQualificationRows(body) {
  if (typeof body !== 'string') {
    throw new Error('Draft release body is unavailable.')
  }
  const sectionMatch =
    /(?:^|\n)## Packaged smoke matrix\s*\n([\s\S]*?)(?=\n##\s|\s*$)/u.exec(body)
  if (sectionMatch === null) {
    throw new Error('Draft release body has no Packaged smoke matrix section.')
  }

  const rows = new Map()
  for (const line of sectionMatch[1].split(/\r?\n/u)) {
    if (!line.trim().startsWith('|')) {
      continue
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length !== 3 || cells[0] === 'Gate' || /^-+$/u.test(cells[0])) {
      continue
    }
    if (rows.has(cells[0])) {
      throw new Error(`Release qualification matrix repeats gate "${cells[0]}".`)
    }
    rows.set(cells[0], { result: cells[1].toUpperCase(), evidence: cells[2] })
  }
  return rows
}

/**
 * Extracts one exact installer filename and full digest from evidence text.
 *
 * @param {string} evidence
 * @param {string} extension
 * @returns {QualifiedArtifact}
 */
function parseArtifactIdentity(evidence, extension) {
  const escapedExtension = extension.replace('.', '\\.')
  const nameMatch = new RegExp('`([^`\\\\/]+' + escapedExtension + ')`', 'iu').exec(evidence)
  const shaMatch = SHA256_PATTERN.exec(evidence)
  if (nameMatch === null || shaMatch === null) {
    throw new Error(
      `${extension} qualification evidence must include the exact artifact filename and full SHA-256.`,
    )
  }
  return { name: nameMatch[1], sha256: shaMatch[0].toLowerCase() }
}
