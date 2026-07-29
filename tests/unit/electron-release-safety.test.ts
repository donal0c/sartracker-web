import { readFileSync } from 'node:fs'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import {
  assertDraftReleaseState,
  assertQualifiedAssets,
  assertReleaseAssetMetadata,
  assertReleaseUnchanged,
  parseSha256Manifest,
  peelGitHubTagToCommit,
  validateQualificationBody,
  validateReleaseProvenance,
} from '../../build/electron-release-lib.js'

interface WorkflowStep {
  env?: Record<string, string>
  name?: string
  run?: string
  uses?: string
  with?: Record<string, string>
}

interface WorkflowJob {
  outputs?: Record<string, string>
  steps: WorkflowStep[]
}

interface Workflow {
  jobs: Record<string, WorkflowJob>
}

const expectedCommitExpression = '${{ needs.gates.outputs.commit }}'

/**
 * Selects one workflow step by its human-readable name.
 */
function selectStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((candidate) => candidate.name === name)
  expect(step, `Expected workflow step "${name}"`).toBeDefined()
  return step as WorkflowStep
}

/**
 * Builds a fully qualified release body fixture.
 */
function qualifiedReleaseBody(): string {
  return [
    '## Packaged smoke matrix',
    '',
    '| Gate | Result | Evidence |',
    '| --- | --- | --- |',
    '| AppImage SHA-256 | PASS | `sartracker_0.1.0.AppImage` `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; `evidence/checksums.txt` |',
    '| .deb SHA-256 | PASS | `sartracker_0.1.0_amd64.deb` `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`; `evidence/checksums.txt` |',
    '| AppImage launch | PASS | `evidence/appimage-launch.json` |',
    '| .deb install and launch | PASS | `evidence/deb-launch.json` |',
    '| Core lifecycle, restart/recovery, finish/finalize/archive | PASS | `evidence/lifecycle.json` |',
    '| Coordinate rejection | PASS | `evidence/coordinates.json` |',
    '| Diagnostics/support/incident exports sanitized | PASS | `evidence/diagnostics.json` |',
    '| Bad/corrupt stored credential reaches shell | PASS | `evidence/bad-secret.json` |',
    '| Live Traccar connection and breadcrumb reconciliation | PASS | `evidence/live-traccar.json` |',
    '| Official offline Discovery package | NOT APPLICABLE | Map loading unchanged in this hotfix; no customer package supplied. |',
    '| Duplicate launch | PASS | `evidence/duplicate-launch.json` |',
    '| Five-day and fourteen-day packaged soak | PASS | `evidence/multi-day-soak.json` |',
    '| Cross-profile exact breadcrumb identity comparison | PASS | `evidence/cross-profile.json` |',
    '',
    '## Known limitations',
    '',
    '## CI Provenance',
    '',
    `- Build commit: \`${'f'.repeat(40)}\``,
  ].join('\n')
}

describe('Electron release workflow safety [DON-260]', () => {
  const workflowPath = '.github/workflows/electron-release.yml'
  const workflowSource = readFileSync(workflowPath, 'utf8')
  const workflow = load(workflowSource) as Workflow

  it('pins every build and release checkout to the commit resolved by gates', () => {
    const gates = workflow.jobs.gates
    expect(gates.outputs?.commit).toBe('${{ steps.resolve_tag.outputs.commit }}')
    expect(selectStep(gates, 'Resolve tag, commit, and version').run).toContain(
      'COMMIT="$(git rev-parse HEAD)"',
    )
    expect(selectStep(gates, 'Resolve tag, commit, and version').run).toContain(
      'echo "commit=$COMMIT"',
    )
    expect(selectStep(gates, 'Resolve tag, commit, and version').run).toContain(
      '} >> "$GITHUB_OUTPUT"',
    )

    for (const jobName of ['bundle-linux', 'release']) {
      const checkout = workflow.jobs[jobName].steps.find(
        (step) => step.uses === 'actions/checkout@v4',
      )
      expect(checkout?.with?.ref, `${jobName} checkout`).toBe(expectedCommitExpression)
    }

    expect(selectStep(workflow.jobs['bundle-linux'], 'Build Electron Linux artifacts').env).toMatchObject(
      { GITHUB_SHA: expectedCommitExpression },
    )
  })

  it('refuses to reuse or clobber a published or wrong-target release', () => {
    const releaseStep = selectStep(
      workflow.jobs.release,
      'Create or refresh exact-target draft prerelease and upload all assets',
    )
    expect(releaseStep.env).toMatchObject({ COMMIT: expectedCommitExpression })
    expect(releaseStep.run).toContain('gh release view "$TAG"')
    expect(releaseStep.run).toContain('--json isDraft,isPrerelease,tagName')
    expect(releaseStep.run).not.toContain('/releases/tags/')
    expect(releaseStep.run).toContain('git ls-remote origin')
    expect(releaseStep.run).toContain('"refs/tags/$TAG^{}"')
    expect(releaseStep.run).toContain('Existing release $TAG is not a draft')
    expect(releaseStep.run).toContain('Existing release $TAG is not a prerelease')
    expect(releaseStep.run).toContain('Remote tag $TAG resolves to')
    expect(releaseStep.run).not.toContain('.target_commitish')
    expect(releaseStep.run).not.toContain('--target "$COMMIT"')
    expect(releaseStep.run).toContain('gh release edit "$TAG"')
    expect(releaseStep.run).toContain('--notes-file "$BODY_FILE"')
    expect(releaseStep.run).toContain('--clobber assets/*')
  })

  it('records the resolved commit and emits only the guarded publish command', () => {
    expect(workflowSource).toContain('echo "- Build commit: \\`${COMMIT}\\`"')
    expect(workflowSource).not.toContain(
      'gh release edit ${TAG} --repo ${GITHUB_REPOSITORY} --draft=false',
    )
    expect(workflowSource).toContain(
      'npm run electron:release:publish -- --tag ${TAG} --repo ${GITHUB_REPOSITORY}',
    )
    expect(workflowSource).not.toContain('enable_windows')
    expect(workflow.jobs['bundle-windows']).toBeUndefined()
    const publisherSource = readFileSync('scripts/electron-release-publish.mjs', 'utf8')
    expect(publisherSource.match(/resolveRemoteTagCommit\(repo, args\.tag\)/gu)).toHaveLength(2)
    expect(publisherSource.match(/validateReleaseProvenance\(/gu)).toHaveLength(2)
    expect(publisherSource.match(/fetchDraftRelease\(repo, args\.tag\)/gu)).toHaveLength(2)
    expect(publisherSource).not.toContain('git rev-list')
    expect(publisherSource).not.toContain('targetCommitish')

    const runbook = readFileSync('docs/releases/README.md', 'utf8')
    expect(runbook).toContain(
      'npm run electron:release:publish -- --tag electron-v<version>',
    )
    expect(runbook).not.toMatch(/gh release edit .*--draft=false/u)
    expect(runbook).not.toMatch(/gh release upload/u)
  })
})

describe('release qualification body guard [DON-260]', () => {
  it('accepts a complete matrix and returns distinct artifact identities', () => {
    expect(validateQualificationBody(qualifiedReleaseBody())).toEqual({
      appImage: {
        name: 'sartracker_0.1.0.AppImage',
        sha256: 'a'.repeat(64),
      },
      deb: {
        name: 'sartracker_0.1.0_amd64.deb',
        sha256: 'b'.repeat(64),
      },
    })
  })

  it.each(['TODO', 'PENDING', 'LOCAL PASS', 'CI ARTIFACT PENDING'])(
    'rejects non-final matrix result %s',
    (result) => {
      const body = qualifiedReleaseBody().replace(
        '| AppImage launch | PASS |',
        `| AppImage launch | ${result} |`,
      )
      expect(() => validateQualificationBody(body)).toThrow(/must pass/i)
    },
  )

  it('permits not-applicable only for the unchanged private map-package gate', () => {
    const body = qualifiedReleaseBody().replace(
      '| AppImage launch | PASS | `evidence/appimage-launch.json` |',
      '| AppImage launch | NOT APPLICABLE | Linux launch was skipped. |',
    )
    expect(() => validateQualificationBody(body)).toThrow(/must pass/i)
    expect(() => validateQualificationBody(qualifiedReleaseBody())).not.toThrow()
  })

  it('rejects missing evidence and missing .deb qualification', () => {
    expect(() =>
      validateQualificationBody(
        qualifiedReleaseBody().replace(
          '| AppImage launch | PASS | `evidence/appimage-launch.json` |',
          '| AppImage launch | PASS | pending |',
        ),
      ),
    ).toThrow(/evidence/i)

    expect(() =>
      validateQualificationBody(
        qualifiedReleaseBody().replace('| .deb install and launch |', '| Unknown gate |'),
      ),
    ).toThrow(/\.deb install and launch/i)
  })

  it('rejects abbreviated or ambiguous artifact hashes', () => {
    expect(() =>
      validateQualificationBody(qualifiedReleaseBody().replace('b'.repeat(64), 'bbbb…bbbb')),
    ).toThrow(/sha-256/i)
  })
})

describe('release body provenance guard [DON-260]', () => {
  it('requires exactly one full build commit matching the remote tag', () => {
    expect(() =>
      validateReleaseProvenance(qualifiedReleaseBody(), 'f'.repeat(40)),
    ).not.toThrow()
    expect(() =>
      validateReleaseProvenance(qualifiedReleaseBody(), 'e'.repeat(40)),
    ).toThrow(/does not match remote tag/i)
    expect(() =>
      validateReleaseProvenance(
        qualifiedReleaseBody().replace(`\`${'f'.repeat(40)}\``, '`f00ba4`'),
        'f'.repeat(40),
      ),
    ).toThrow(/one full build commit/i)
    expect(() =>
      validateReleaseProvenance(
        `${qualifiedReleaseBody()}\n- Build commit: \`${'f'.repeat(40)}\``,
        'f'.repeat(40),
      ),
    ).toThrow(/one full build commit/i)
  })
})

describe('existing release state guard [DON-260]', () => {
  it('accepts only a draft prerelease', () => {
    expect(() =>
      assertDraftReleaseState({ isDraft: true, isPrerelease: true }),
    ).not.toThrow()
  })

  it.each([
    [{ isDraft: false, isPrerelease: true }, /not a draft/i],
    [{ isDraft: true, isPrerelease: false }, /not a prerelease/i],
  ])('rejects unsafe release state %#', (release, expected) => {
    expect(() => assertDraftReleaseState(release)).toThrow(expected)
  })
})

describe('remote annotated-tag peeling [DON-260]', () => {
  it('accepts a lightweight commit tag', async () => {
    await expect(
      peelGitHubTagToCommit(
        { type: 'commit', sha: 'a'.repeat(40) },
        async () => {
          throw new Error('lookup should not run')
        },
      ),
    ).resolves.toBe('a'.repeat(40))
  })

  it('peels an annotated tag object to its commit', async () => {
    await expect(
      peelGitHubTagToCommit(
        { type: 'tag', sha: 'b'.repeat(40) },
        async (sha) => {
          expect(sha).toBe('b'.repeat(40))
          return { type: 'commit', sha: 'c'.repeat(40) }
        },
      ),
    ).resolves.toBe('c'.repeat(40))
  })

  it('rejects cycles and non-commit targets', async () => {
    await expect(
      peelGitHubTagToCommit(
        { type: 'tag', sha: 'b'.repeat(40) },
        async () => ({ type: 'tag', sha: 'b'.repeat(40) }),
      ),
    ).rejects.toThrow(/cycle/i)
    await expect(
      peelGitHubTagToCommit(
        { type: 'tree', sha: 'd'.repeat(40) },
        async () => ({ type: 'commit', sha: 'e'.repeat(40) }),
      ),
    ).rejects.toThrow(/unexpected/i)
  })
})

describe('draft asset provenance guard [DON-260]', () => {
  const qualification = validateQualificationBody(qualifiedReleaseBody())
  const manifest = parseSha256Manifest(
    [
      `${'a'.repeat(64)}  dist/sartracker_0.1.0.AppImage`,
      `${'b'.repeat(64)}  dist/sartracker_0.1.0_amd64.deb`,
    ].join('\n'),
  )

  it('accepts distinct qualified assets backed by SHA256SUMS', () => {
    expect(() =>
      assertQualifiedAssets(
        ['sartracker_0.1.0.AppImage', 'sartracker_0.1.0_amd64.deb', 'SHA256SUMS'],
        qualification,
        manifest,
      ),
    ).not.toThrow()
    expect(() =>
      assertReleaseAssetMetadata(
        [
          uploadedAsset('sartracker_0.1.0.AppImage', 'a'.repeat(64)),
          uploadedAsset('sartracker_0.1.0_amd64.deb', 'b'.repeat(64)),
          uploadedAsset('SHA256SUMS', 'c'.repeat(64)),
        ],
        qualification,
        'c'.repeat(64),
      ),
    ).not.toThrow()
  })

  it('rejects a missing installer, manifest, or digest mismatch', () => {
    expect(() =>
      assertQualifiedAssets(
        ['sartracker_0.1.0.AppImage', 'SHA256SUMS'],
        qualification,
        manifest,
      ),
    ).toThrow(/missing qualified asset/i)

    expect(() =>
      assertQualifiedAssets(
        ['sartracker_0.1.0.AppImage', 'sartracker_0.1.0_amd64.deb'],
        qualification,
        manifest,
      ),
    ).toThrow(/missing SHA256SUMS/i)

    const wrongManifest = new Map(manifest)
    wrongManifest.set('sartracker_0.1.0_amd64.deb', 'c'.repeat(64))
    expect(() =>
      assertQualifiedAssets(
        ['sartracker_0.1.0.AppImage', 'sartracker_0.1.0_amd64.deb', 'SHA256SUMS'],
        qualification,
        wrongManifest,
      ),
    ).toThrow(/does not match qualification/i)

    expect(() =>
      assertQualifiedAssets(
        [
          'sartracker_0.1.0.AppImage',
          'sartracker_0.1.0_amd64.deb',
          'sartracker_0.1.0_windows.exe',
          'SHA256SUMS',
        ],
        qualification,
        manifest,
      ),
    ).toThrow(/unqualified release asset/i)

    expect(() =>
      assertReleaseAssetMetadata(
        [
          uploadedAsset('sartracker_0.1.0.AppImage', 'd'.repeat(64)),
          uploadedAsset('sartracker_0.1.0_amd64.deb', 'b'.repeat(64)),
          uploadedAsset('SHA256SUMS', 'c'.repeat(64)),
        ],
        qualification,
        'c'.repeat(64),
      ),
    ).toThrow(/metadata digest/i)

    expect(() =>
      assertReleaseAssetMetadata(
        [
          uploadedAsset('sartracker_0.1.0.AppImage', 'a'.repeat(64)),
          uploadedAsset('sartracker_0.1.0_amd64.deb', 'b'.repeat(64)),
          uploadedAsset('SHA256SUMS', 'd'.repeat(64)),
        ],
        qualification,
        'c'.repeat(64),
      ),
    ).toThrow(/SHA256SUMS.*metadata digest/i)
  })

  it('rejects malformed or duplicate SHA256SUMS entries', () => {
    expect(() => parseSha256Manifest('not a manifest')).toThrow(/invalid SHA256SUMS/i)
    expect(() =>
      parseSha256Manifest(
        `${'a'.repeat(64)}  dist/app.AppImage\n${'b'.repeat(64)}  app.AppImage`,
      ),
    ).toThrow(/duplicate/i)
  })

  it('rejects extra manifest entries and any release mutation during fresh download', () => {
    const extraManifest = new Map(manifest)
    extraManifest.set('unqualified.txt', 'd'.repeat(64))
    expect(() =>
      assertQualifiedAssets(
        ['sartracker_0.1.0.AppImage', 'sartracker_0.1.0_amd64.deb', 'SHA256SUMS'],
        qualification,
        extraManifest,
      ),
    ).toThrow(/unqualified SHA256SUMS entry/i)

    const initial = {
      body: qualifiedReleaseBody(),
      assets: [
        uploadedAsset('sartracker_0.1.0.AppImage', 'a'.repeat(64)),
        uploadedAsset('sartracker_0.1.0_amd64.deb', 'b'.repeat(64)),
        uploadedAsset('SHA256SUMS', 'c'.repeat(64)),
      ],
    }
    expect(() => assertReleaseUnchanged(initial, structuredClone(initial))).not.toThrow()

    const bodyChanged = structuredClone(initial)
    bodyChanged.body = bodyChanged.body.replace(
      '`evidence/lifecycle.json`',
      '`evidence/changed-lifecycle.json`',
    )
    expect(() => assertReleaseUnchanged(initial, bodyChanged)).toThrow(/body changed/i)

    const assetChanged = structuredClone(initial)
    assetChanged.assets[2].digest = `sha256:${'d'.repeat(64)}`
    expect(() => assertReleaseUnchanged(initial, assetChanged)).toThrow(/asset metadata changed/i)

    const downloadCountChanged = structuredClone(initial)
    downloadCountChanged.assets[0].downloadCount = 3
    expect(() => assertReleaseUnchanged(initial, downloadCountChanged)).not.toThrow()
  })
})

function uploadedAsset(name: string, digest: string) {
  return {
    apiUrl: `https://api.github.test/assets/${encodeURIComponent(name)}`,
    contentType: 'application/octet-stream',
    createdAt: '2026-07-29T10:00:00Z',
    downloadCount: 0,
    name,
    digest: `sha256:${digest}`,
    id: name,
    label: '',
    size: 1024,
    state: 'uploaded',
    updatedAt: '2026-07-29T10:00:00Z',
    url: `https://github.test/download/${encodeURIComponent(name)}`,
  }
}
