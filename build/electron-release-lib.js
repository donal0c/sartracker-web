/**
 * Fail-closed helpers for guarded Electron beta publication.
 *
 * The release workflow creates a draft. Publication is a separate act that is
 * allowed only when the draft body carries a complete result for every check in
 * `build/release-checklist.js`: each row is PASS, NOT APPLICABLE where the
 * checklist allows it, or FAIL/NOT TESTED covered by an owner-approved
 * exception bound to this tag. Keeping validation pure makes the contract
 * directly unit-testable while the CLI wrapper owns GitHub and filesystem I/O.
 */

import {
  EXCEPTABLE_SEVERITIES,
  RELEASE_CHECKS,
  RELEASE_RESULTS,
} from './release-checklist.js'

const NON_FINAL_EVIDENCE = /\b(?:todo|pending|tbd|local pass|ci artifact pending|none)\b/iu
const NON_FINAL_REGRESSION_EVIDENCE = /\b(?:todo|pending|tbd|local pass|ci artifact pending)\b/iu
const SHA256_PATTERN = /\b[a-f0-9]{64}\b/iu
const REQUIRED_REGRESSION_FIELDS = [
  'Linear issue',
  'Affected release(s)',
  'Last known good',
  'First known bad',
  'Root cause',
  'Escape analysis',
  'Before/after evidence',
  'Regression gate',
  'Remaining uncertainty',
]

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
 * @typedef {Object} OwnerException
 * @property {string} check
 * @property {string} result
 * @property {string} severity
 * @property {string} exposure
 * @property {string} approvedBy
 * @property {string} approvalReference
 * @property {string} followUp
 */

/**
 * @typedef {QualificationIdentity & {exceptions: OwnerException[]}} ReleaseMatrix
 */

/**
 * Validates the release checklist results and owner exceptions in a draft
 * release body and extracts the exact AppImage and Debian artifact identities.
 *
 * A FAIL stays a FAIL: an exception must restate the row's observed result, so
 * it can accept a known issue for this release but never relabel it as a pass.
 * Exceptions name the tag they apply to, so a copied note cannot carry an old
 * approval into a new release.
 *
 * @param {string} body
 * @param {string} tag
 * @returns {ReleaseMatrix}
 */
export function validateReleaseMatrix(body, tag) {
  const rows = parseReleaseRows(body)
  const exceptions = parseOwnerExceptions(body, tag)
  const known = new Set(RELEASE_CHECKS.map((check) => check.name))
  for (const name of rows.keys()) {
    if (!known.has(name)) {
      throw new Error(`Release checklist results contain unknown check "${name}".`)
    }
  }

  for (const check of RELEASE_CHECKS) {
    const row = rows.get(check.name)
    if (row === undefined) {
      throw new Error(`Release checklist results are missing check "${check.name}".`)
    }
    if (!RELEASE_RESULTS.includes(row.result)) {
      throw new Error(
        `Release check "${check.name}" has unknown result ${JSON.stringify(row.result)}; ` +
          `use ${RELEASE_RESULTS.join(', ')}.`,
      )
    }
    if (row.evidence === '' || NON_FINAL_EVIDENCE.test(row.evidence)) {
      throw new Error(`Release check "${check.name}" has missing or non-final evidence.`)
    }
    const exception = exceptions.get(check.name)
    if (row.result === 'PASS' || (row.result === 'NOT APPLICABLE' && check.notApplicableAllowed)) {
      if (exception !== undefined) {
        throw new Error(`Owner exception for "${check.name}" does not match a FAIL or NOT TESTED result.`)
      }
      continue
    }
    if (row.result === 'NOT APPLICABLE') {
      throw new Error(`Release check "${check.name}" cannot be NOT APPLICABLE.`)
    }
    if (check.identity) {
      throw new Error(`Identity check "${check.name}" must PASS; it cannot be covered by an exception.`)
    }
    if (exception === undefined) {
      throw new Error(
        `Release check "${check.name}" is ${row.result} with no owner-approved exception.`,
      )
    }
    if (exception.result !== row.result) {
      throw new Error(
        `Owner exception for "${check.name}" records ${JSON.stringify(exception.result)} ` +
          `but the check result is ${JSON.stringify(row.result)}.`,
      )
    }
  }
  for (const name of exceptions.keys()) {
    if (!rows.has(name)) {
      throw new Error(`Owner exception names unknown check "${name}".`)
    }
  }

  return {
    appImage: parseArtifactIdentity(rows.get('AppImage SHA-256').evidence, '.AppImage'),
    deb: parseArtifactIdentity(rows.get('.deb SHA-256').evidence, '.deb'),
    exceptions: [...exceptions.values()],
  }
}

/**
 * Requires every beta to classify whether it corrects a regression. Regression
 * releases must retain the field report's Linear issue, causal history, escape
 * analysis, before/after evidence, durable gate, and residual uncertainty.
 * This prevents a fully green artifact matrix from erasing why the release was
 * necessary or how the same class of failure is now detected.
 *
 * @param {string} body
 * @returns {void}
 */
export function validateRegressionRecord(body) {
  if (typeof body !== 'string') {
    throw new Error('Draft release body is unavailable.')
  }
  const sectionMatch =
    /(?:^|\n)## Regression provenance\s*\n([\s\S]*?)(?=\n##\s|\s*$)/iu.exec(body)
  if (sectionMatch === null) {
    throw new Error('Draft release body has no Regression provenance section.')
  }

  const fields = new Map()
  for (const line of sectionMatch[1].split(/\r?\n/u)) {
    const match = /^-\s+([^:]+):\s*(.+)$/u.exec(line.trim())
    if (match !== null) {
      const field = match[1].trim().toLowerCase()
      if (fields.has(field)) {
        throw new Error(`Regression provenance repeats field "${match[1].trim()}".`)
      }
      fields.set(field, match[2].trim())
    }
  }

  const classification = fields.get('classification')?.toLowerCase()
  if (classification === 'no known regression correction') {
    const linearIssue = fields.get('linear issue')
    if (linearIssue === undefined || !/^not applicable\b/iu.test(linearIssue)) {
      throw new Error(
        'A non-regression release must explicitly mark Linear issue as not applicable.',
      )
    }
    return
  }
  if (classification !== 'regression correction') {
    throw new Error(
      'Regression provenance Classification must be "Regression correction" or ' +
        '"No known regression correction".',
    )
  }

  for (const field of REQUIRED_REGRESSION_FIELDS) {
    const evidence = fields.get(field.toLowerCase())
    if (
      evidence === undefined ||
      evidence.length < 4 ||
      NON_FINAL_REGRESSION_EVIDENCE.test(evidence)
    ) {
      throw new Error(`Regression provenance field "${field}" is missing or non-final.`)
    }
  }

  const linearIssue = fields.get('linear issue')
  const issueLink =
    /\[(DON-[0-9]+)\]\(https:\/\/linear\.app\/[^)\s]+\/issue\/(DON-[0-9]+)[^)\s]*\)/iu.exec(
      linearIssue,
    )
  if (
    issueLink === null ||
    issueLink[1].toLowerCase() !== issueLink[2].toLowerCase()
  ) {
    throw new Error('Regression provenance must include a linked Linear issue.')
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
 * Extracts one level-two Markdown section body, or null when absent.
 *
 * @param {string} body
 * @param {string} heading
 * @returns {string | null}
 */
function markdownSection(body, heading) {
  if (typeof body !== 'string') {
    throw new Error('Draft release body is unavailable.')
  }
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`(?:^|\\n)## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\s*$)`, 'u').exec(body)
  return match === null ? null : match[1]
}

/**
 * Splits the data rows of a Markdown table, skipping its header and rule.
 *
 * @param {string} section
 * @param {string} firstHeader
 * @returns {string[][]}
 */
function markdownTableRows(section, firstHeader) {
  return section
    .split(/\r?\n/u)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells[0] !== firstHeader && !/^:?-+:?$/u.test(cells[0] ?? ''))
}

/**
 * Parses the release checklist results into one unique row per check.
 *
 * @param {string} body
 * @returns {Map<string, {result: string, evidence: string}>}
 */
function parseReleaseRows(body) {
  const section = markdownSection(body, 'Release checklist results')
  if (section === null) {
    throw new Error('Draft release body has no Release checklist results section.')
  }
  const rows = new Map()
  for (const cells of markdownTableRows(section, 'Check')) {
    if (cells.length !== 3) {
      throw new Error(`Release checklist row must have Check, Result and Evidence: ${JSON.stringify(cells)}.`)
    }
    if (rows.has(cells[0])) {
      throw new Error(`Release checklist results repeat check "${cells[0]}".`)
    }
    rows.set(cells[0], { result: cells[1].toUpperCase(), evidence: cells[2] })
  }
  return rows
}

/**
 * Parses owner-approved exceptions. The section is optional; when present it
 * must name the exact tag and give every field for every exception.
 *
 * @param {string} body
 * @param {string} tag
 * @returns {Map<string, OwnerException>}
 */
function parseOwnerExceptions(body, tag) {
  const section = markdownSection(body, 'Owner-approved exceptions')
  const exceptions = new Map()
  if (section === null) {
    return exceptions
  }
  const rows = markdownTableRows(section, 'Check')
  if (rows.length === 0) {
    return exceptions
  }
  const appliesTo = /^Applies to: `([^`]+)`\s*$/mu.exec(section)
  if (appliesTo === null || appliesTo[1] !== tag) {
    throw new Error(
      `Owner-approved exceptions must state "Applies to: \`${tag}\`"; exceptions never carry to another release.`,
    )
  }
  const fields = ['check', 'result', 'severity', 'exposure', 'approvedBy', 'approvalReference', 'followUp']
  for (const cells of rows) {
    if (cells.length !== fields.length) {
      throw new Error(
        'Owner exception rows need Check, Result, Severity, Exposure and workaround, ' +
          `Approved by, Approval reference and Follow-up: ${JSON.stringify(cells)}.`,
      )
    }
    const exception = Object.fromEntries(fields.map((field, index) => [field, cells[index]]))
    exception.result = exception.result.toUpperCase()
    for (const field of fields) {
      if (exception[field] === '' || /\b(?:todo|tbd|pending)\b|&lt;/iu.test(exception[field])) {
        throw new Error(`Owner exception for "${exception.check}" has a missing or placeholder ${field}.`)
      }
    }
    if (!EXCEPTABLE_SEVERITIES.includes(exception.severity)) {
      throw new Error(
        `Owner exception for "${exception.check}" has severity ${JSON.stringify(exception.severity)}; ` +
          `a Block finding cannot be published. Use ${EXCEPTABLE_SEVERITIES.join(' or ')}.`,
      )
    }
    if (exceptions.has(exception.check)) {
      throw new Error(`Owner exceptions repeat check "${exception.check}".`)
    }
    exceptions.set(exception.check, /** @type {OwnerException} */ (exception))
  }
  return exceptions
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
      `${extension} checklist evidence must include the exact artifact filename and full SHA-256.`,
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
