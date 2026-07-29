/**
 * Fail-closed helpers for Electron draft-release qualification and publication.
 *
 * The release workflow creates a draft. Publication is a separate act that is
 * allowed only after the exact draft assets have passed the complete packaged
 * smoke matrix. Keeping the validation pure makes the safety contract directly
 * unit-testable while the CLI wrapper owns GitHub and filesystem I/O.
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
]

const NOT_APPLICABLE_GATE = 'Official offline Discovery package'
const NON_FINAL_EVIDENCE = /\b(?:todo|pending|tbd|local pass|ci artifact pending|none)\b/iu
const SHA256_PATTERN = /\b[a-f0-9]{64}\b/iu

/**
 * @typedef {Object} DraftReleaseState
 * @property {boolean} isDraft
 * @property {boolean} isPrerelease
 */

/**
 * @typedef {Object} QualifiedArtifact
 * @property {string} name
 * @property {string} sha256
 */

/**
 * @typedef {Object} QualificationIdentity
 * @property {QualifiedArtifact} appImage
 * @property {QualifiedArtifact} deb
 */

/**
 * Rejects any release state that could overwrite published or wrong-commit
 * assets.
 *
 * @param {DraftReleaseState} release
 * @returns {void}
 */
export function assertDraftReleaseState(release) {
  if (release?.isDraft !== true) {
    throw new Error('Existing release is not a draft; refusing to replace published assets.')
  }
  if (release?.isPrerelease !== true) {
    throw new Error('Existing release is not a prerelease; refusing Electron beta publication.')
  }
}

/**
 * @typedef {Object} GitHubGitObject
 * @property {'commit' | 'tag' | string} type
 * @property {string} sha
 */

/**
 * Peels a lightweight or annotated GitHub tag reference to one commit.
 *
 * @param {GitHubGitObject} initial
 * @param {(tagSha: string) => Promise<GitHubGitObject>} loadAnnotatedTarget
 * @returns {Promise<string>}
 */
export async function peelGitHubTagToCommit(initial, loadAnnotatedTarget) {
  let current = initial
  const visitedTags = new Set()
  for (let depth = 0; depth < 16; depth += 1) {
    if (!isFullGitSha(current?.sha)) {
      throw new Error(`Remote tag contains invalid Git object SHA ${JSON.stringify(current?.sha)}.`)
    }
    if (current.type === 'commit') {
      return current.sha.toLowerCase()
    }
    if (current.type !== 'tag') {
      throw new Error(`Remote tag points to unexpected Git object type ${current.type}.`)
    }
    if (visitedTags.has(current.sha)) {
      throw new Error(`Remote annotated tag cycle detected at ${current.sha}.`)
    }
    visitedTags.add(current.sha)
    current = await loadAnnotatedTarget(current.sha)
  }
  throw new Error('Remote annotated tag depth exceeds the safety limit.')
}

/**
 * Validates the complete packaged-smoke table in a draft release body and
 * extracts the exact AppImage and Debian artifact identities.
 *
 * @param {string} body
 * @returns {QualificationIdentity}
 */
export function validateQualificationBody(body) {
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
 * Requires exactly one full build commit in the CI provenance section and
 * binds it to the freshly peeled remote release tag.
 *
 * @param {string} body
 * @param {string} expectedCommit
 * @returns {void}
 */
export function validateReleaseProvenance(body, expectedCommit) {
  const matches = [
    ...body.matchAll(/^- Build commit: `([a-f0-9]{40})`\s*$/gimu),
  ]
  if (matches.length !== 1) {
    throw new Error('Draft release body must contain exactly one full build commit.')
  }
  if (matches[0][1].toLowerCase() !== expectedCommit.toLowerCase()) {
    throw new Error(
      `Draft build commit ${matches[0][1]} does not match remote tag ${expectedCommit}.`,
    )
  }
}

/**
 * Parses a standard sha256sum manifest into an exact filename-to-digest map.
 *
 * @param {string} manifest
 * @returns {Map<string, string>}
 */
export function parseSha256Manifest(manifest) {
  const entries = new Map()
  for (const line of manifest.split(/\r?\n/u)) {
    if (line.trim() === '') {
      continue
    }
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/iu.exec(line)
    if (match === null) {
      throw new Error(`Invalid SHA256SUMS line: ${JSON.stringify(line)}.`)
    }
    const name = match[2].trim().replace(/^.*[\\/]/u, '')
    if (entries.has(name)) {
      throw new Error(`SHA256SUMS contains duplicate asset ${JSON.stringify(name)}.`)
    }
    entries.set(name, match[1].toLowerCase())
  }
  if (entries.size === 0) {
    throw new Error('SHA256SUMS is empty.')
  }
  return entries
}

/**
 * Requires the draft asset list and manifest to contain both qualified Linux
 * artifacts and the manifest itself with the exact reviewed digests.
 *
 * @param {string[]} assetNames
 * @param {QualificationIdentity} qualification
 * @param {Map<string, string>} manifest
 * @returns {void}
 */
export function assertQualifiedAssets(assetNames, qualification, manifest) {
  const names = new Set(assetNames)
  const qualifiedNames = new Set([
    qualification.appImage.name,
    qualification.deb.name,
    'SHA256SUMS',
  ])
  for (const name of names) {
    if (!qualifiedNames.has(name)) {
      throw new Error(`Draft contains unqualified release asset ${JSON.stringify(name)}.`)
    }
  }
  for (const artifact of [qualification.appImage, qualification.deb]) {
    if (!names.has(artifact.name)) {
      throw new Error(`Draft release is missing qualified asset ${JSON.stringify(artifact.name)}.`)
    }
    const manifestDigest = manifest.get(artifact.name)
    if (manifestDigest !== artifact.sha256) {
      throw new Error(
        `SHA256SUMS digest for ${JSON.stringify(artifact.name)} does not match qualification.`,
      )
    }
  }
  if (!names.has('SHA256SUMS')) {
    throw new Error('Draft release is missing SHA256SUMS.')
  }
  const allowedManifestNames = new Set([
    qualification.appImage.name,
    qualification.deb.name,
  ])
  for (const name of manifest.keys()) {
    if (!allowedManifestNames.has(name)) {
      throw new Error(`SHA256SUMS contains unqualified SHA256SUMS entry ${JSON.stringify(name)}.`)
    }
  }
}

/**
 * Requires immutable GitHub asset metadata to agree with the reviewed
 * qualification hashes immediately before publication.
 *
 * @param {{name: string, digest: string, size: number, state: string}[]} assets
 * @param {QualificationIdentity} qualification
 * @param {string} manifestSha256
 * @returns {void}
 */
export function assertReleaseAssetMetadata(assets, qualification, manifestSha256) {
  if (!/^[a-f0-9]{64}$/iu.test(manifestSha256)) {
    throw new Error('Downloaded SHA256SUMS digest is invalid.')
  }
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const allowedNames = new Set([
    qualification.appImage.name,
    qualification.deb.name,
    'SHA256SUMS',
  ])
  for (const asset of assets) {
    if (!allowedNames.has(asset.name)) {
      throw new Error(`Draft contains unqualified release asset ${JSON.stringify(asset.name)}.`)
    }
    if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Release asset ${JSON.stringify(asset.name)} is not fully uploaded.`)
    }
  }
  for (const artifact of [qualification.appImage, qualification.deb]) {
    const asset = byName.get(artifact.name)
    if (asset === undefined) {
      throw new Error(`Draft release is missing qualified asset ${JSON.stringify(artifact.name)}.`)
    }
    if (asset.digest?.toLowerCase() !== `sha256:${artifact.sha256}`) {
      throw new Error(
        `Release asset metadata digest for ${JSON.stringify(artifact.name)} does not match qualification.`,
      )
    }
  }
  const manifestAsset = byName.get('SHA256SUMS')
  if (manifestAsset === undefined) {
    throw new Error('Draft release is missing SHA256SUMS.')
  }
  if (manifestAsset.digest?.toLowerCase() !== `sha256:${manifestSha256.toLowerCase()}`) {
    throw new Error('SHA256SUMS asset metadata digest does not match the downloaded manifest.')
  }
}

/**
 * Rejects any release-body or asset-metadata mutation that occurs while exact
 * draft bytes are being downloaded and hashed.
 *
 * @param {{body: string, assets: unknown[]}} initialRelease
 * @param {{body: string, assets: unknown[]}} finalRelease
 * @returns {void}
 */
export function assertReleaseUnchanged(initialRelease, finalRelease) {
  if (finalRelease.body !== initialRelease.body) {
    throw new Error('Draft release body changed during fresh-download verification.')
  }
  if (
    stableJson(releaseAssetSafetyIdentity(initialRelease.assets), true) !==
    stableJson(releaseAssetSafetyIdentity(finalRelease.assets), true)
  ) {
    throw new Error('Draft release asset metadata changed during fresh-download verification.')
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

function isFullGitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/iu.test(value)
}

/**
 * Retains every asset field that binds release bytes and identity while
 * deliberately excluding GitHub's volatile downloadCount.
 *
 * @param {unknown[]} assets
 * @returns {unknown[]}
 */
function releaseAssetSafetyIdentity(assets) {
  return assets.map((asset) => ({
    apiUrl: asset?.apiUrl,
    contentType: asset?.contentType,
    createdAt: asset?.createdAt,
    digest: asset?.digest,
    id: asset?.id,
    label: asset?.label,
    name: asset?.name,
    size: asset?.size,
    state: asset?.state,
    updatedAt: asset?.updatedAt,
    url: asset?.url,
  }))
}

/**
 * Produces deterministic JSON for an object graph. Release asset arrays are
 * sorted by name so GitHub response ordering cannot create a false mutation.
 *
 * @param {unknown} value
 * @param {boolean} [sortAssetArray]
 * @returns {string}
 */
function stableJson(value, sortAssetArray = false) {
  const normalized = normalizeJson(value)
  if (sortAssetArray && Array.isArray(normalized)) {
    normalized.sort((left, right) =>
      String(left?.name ?? '').localeCompare(String(right?.name ?? '')),
    )
  }
  return JSON.stringify(normalized)
}

/**
 * Recursively sorts object keys without dropping GitHub metadata fields.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    )
  }
  return value
}
