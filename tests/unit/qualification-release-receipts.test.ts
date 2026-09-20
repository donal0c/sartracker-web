import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compileReleaseInputs, validateReleaseDownloadEvidence } from '../../scripts/qualification/release-receipts.mjs'

const sha = 'a'.repeat(40)
const assets = [{ name: 'candidate.AppImage', sha256: 'b'.repeat(64), bytes: 10 },
  { name: 'candidate.deb', sha256: 'c'.repeat(64), bytes: 20 }]
const manifest = assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n') + '\n'
const manifestSha = createHash('sha256').update(manifest).digest('hex')
const expected = { releaseId: 123, tag: 'electron-v0.1.0-beta.13', sourceSha: sha, assets }
/** Synthetic public/draft transfer facts; these tests never contact GitHub. */
function report(phase: string) {
  const release = { id: 123, tag_name: expected.tag, draft: phase === 'prepublication', prerelease: true,
    body: `- Build commit: \`${sha}\`\n## Regression provenance\n- Classification: No known regression correction\n- Linear issue: Not applicable\n`,
    assets: [...assets.map((asset, index) => ({ id: index + 1, name: asset.name, size: asset.bytes,
      digest: `sha256:${asset.sha256}`, state: 'uploaded' })),
    { id: 3, name: 'SHA256SUMS', size: Buffer.byteLength(manifest), digest: `sha256:${manifestSha}`, state: 'uploaded' }],
  }
  return { phase, before: release, after: structuredClone(release), tagBefore: sha, tagAfter: sha, manifest,
    downloads: [...assets, { name: 'SHA256SUMS', sha256: manifestSha, bytes: Buffer.byteLength(manifest) }]
      .map((asset) => ({ ...asset, transport: phase === 'prepublication' ? 'authenticated-draft-api' : 'unauthenticated-public',
        url: `https://github.com/donal0c/sartracker-web/releases/download/${expected.tag}/${asset.name}` })),
  }
}

describe('separate draft and public byte receipts', () => {
  it('binds future release identifiers without accepting executable configuration or a substituted version', () => {
    const input = { releaseId: 123, tag: expected.tag,
      rollback: { releaseId: 122, tag: 'electron-v0.1.0-beta.12', sourceSha: sha, assets } }
    expect(compileReleaseInputs(input, '0.1.0-beta.13')).toEqual(input)
    expect(() => compileReleaseInputs(input, '0.1.0-beta.14')).toThrow()
    expect(() => compileReleaseInputs({ ...input, command: ['sh'] }, '0.1.0-beta.13')).toThrow()
    expect(() => compileReleaseInputs({ ...input, rollback: { ...input.rollback, releaseId: 123 } }, '0.1.0-beta.13')).toThrow()
  })
  it('accepts fresh public bytes only with exact immutable metadata and unauthenticated transport', () => {
    expect(validateReleaseDownloadEvidence(report('postpublication'), expected)).toMatchObject({ status: 'PASS', releaseEligible: false })
  })
  it.each(['transport', 'hash', 'size', 'tag', 'draft', 'extra'])('rejects %s substitution in public evidence', (mutation) => {
    const value = report('postpublication')
    if (mutation === 'transport') value.downloads[0].transport = 'authenticated-draft-api'
    if (mutation === 'hash') value.downloads[0].sha256 = 'd'.repeat(64)
    if (mutation === 'size') value.downloads[0].bytes++
    if (mutation === 'tag') value.tagAfter = 'e'.repeat(40)
    if (mutation === 'draft') value.before.draft = true
    if (mutation === 'extra') value.after.assets.push({ ...value.after.assets[0], name: 'extra.exe' })
    expect(() => validateReleaseDownloadEvidence(value, expected)).toThrow()
  })
  it('keeps the draft check prepublication and rejects mutation during transfer', () => {
    expect(validateReleaseDownloadEvidence(report('prepublication'), expected).status).toBe('PASS')
    const value = report('prepublication')
    value.after.body += '\nchanged'
    expect(() => validateReleaseDownloadEvidence(value, expected)).toThrow()
  })
})
