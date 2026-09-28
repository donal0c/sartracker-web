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
  validateRegressionRecord,
  validateReleaseMatrix,
  validateReleaseProvenance,
} from '../../build/electron-release-lib.js'
import { RELEASE_CHECKS } from '../../build/release-checklist.js'

interface WorkflowStep {
  if?: string
  'continue-on-error'?: boolean
  env?: Record<string, string>
  name?: string
  run?: string
  uses?: string
  with?: Record<string, string>
}

interface WorkflowJob {
  needs?: string | string[]
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

const TAG = 'electron-v0.1.0-beta.13.5'

/**
 * Evidence for one passing checklist row. Identity rows carry the exact
 * artifact filename and digest that the publisher extracts.
 */
function passingEvidence(name: string): string {
  if (name === 'AppImage SHA-256') {
    return `\`sartracker_0.1.0.AppImage\` \`${'a'.repeat(64)}\`; CI artifact, draft and SHA256SUMS agree`
  }
  if (name === '.deb SHA-256') {
    return `\`sartracker_0.1.0_amd64.deb\` \`${'b'.repeat(64)}\`; CI artifact, draft and SHA256SUMS agree`
  }
  return `team-smoke run 2026-10-01, \`${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}.json\``
}

/**
 * Builds a release body whose checklist rows all pass, except the offline map
 * row which uses its permitted NOT APPLICABLE result.
 */
function qualifiedReleaseBody(): string {
  return [
    '## Release checklist results',
    '',
    '| Check | Result | Evidence |',
    '| --- | --- | --- |',
    ...RELEASE_CHECKS.map(({ name }) => name === 'Offline map package'
      ? `| ${name} | NOT APPLICABLE | No offline map package ships with this build. |`
      : `| ${name} | PASS | ${passingEvidence(name)} |`),
    '',
    '## Regression provenance',
    '',
    '- Classification: Regression correction',
    '- Linear issue: [DON-260](https://linear.app/donal-oc/issue/DON-260)',
    '- Affected release(s): electron-v0.1.0-beta.12.5',
    '- Last known good: Unknown — this workload was not previously release-gated.',
    '- First known bad: electron-v0.1.0-beta.12.5',
    '- Root cause: Initial history work was coupled to the steady polling cadence.',
    '- Escape analysis: Existing smoke started missions at the current time and never exercised a cold 36-hour lookback.',
    '- Before/after evidence: Nine-minute field wait versus exact persistence within 47 seconds on the qualified profile.',
    '- Regression gate: Deterministic 36-hour packaged proof with exact identity, restart, fault, and render oracles.',
    '- Remaining uncertainty: Original-team-machine confirmation remains tracked separately.',
    '',
    '## Known limitations',
    '',
    '## CI Provenance',
    '',
    `- Build commit: \`${'f'.repeat(40)}\``,
  ].join('\n')
}

/** Replaces the result and evidence of one checklist row. */
function withResult(body: string, name: string, result: string, evidence = 'Observed on the exact artifact; see smoke log.'): string {
  const row = new RegExp(`^\\| ${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} \\|.*$`, 'mu')
  expect(row.test(body), `row ${name}`).toBe(true)
  return body.replace(row, `| ${name} | ${result} | ${evidence} |`)
}

/** Appends an owner-approved exception section. */
function withExceptions(body: string, rows: string[], tag = TAG): string {
  return body.replace('## Regression provenance', [
    '## Owner-approved exceptions',
    '',
    `Applies to: \`${tag}\``,
    '',
    '| Check | Result | Severity | Exposure and workaround | Approved by | Approval reference | Follow-up |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Regression provenance',
  ].join('\n'))
}

const unwritableException =
  '| Unwritable profile shows an error | FAIL | Ship with known issue | App exits silently; release note tells testers to check folder permissions | Donal | Chat 2026-10-01 | DON-999 |'

describe('Electron release workflow safety [DON-260]', () => {
  const workflowPath = '.github/workflows/electron-release.yml'
  const workflowSource = readFileSync(workflowPath, 'utf8')
  const workflow = load(workflowSource) as Workflow

  it('requires explicit strict responsiveness before release artifacts and retains packaged timing gates [DON-254]', () => {
    const gates = workflow.jobs.gates
    const strict = selectStep(gates, 'Strict responsiveness qualification (<200 ms)')
    expect(strict.run).toBe('npm run test:responsiveness')
    expect(strict.if).toBeUndefined()
    expect(strict['continue-on-error']).toBeUndefined()
    expect(selectStep(gates, 'Unit tests').run).toBe('npm run test:correctness -- --no-file-parallelism')
    expect(workflow.jobs['bundle-linux'].needs).toBe('gates')
    expect(selectStep(workflow.jobs['bundle-linux'], 'Packaged tracking soak (CI profile)').run)
      .toContain('npm run electron:smoke:tracking-soak:ci')
  })

  it('requires the package receipt independently of other uploaded evidence [DON-146]', () => {
    const receipt = selectStep(workflow.jobs['bundle-linux'], 'Upload package safety receipt')
    expect(receipt.with?.path).toBe('tmp/electron-validation-evidence/package-safety.json')
    expect(receipt.with?.['if-no-files-found']).toBe('error')
  })

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
    expect(publisherSource.match(/validateRegressionRecord\(/gu)).toHaveLength(3)
    expect(publisherSource.match(/fetchDraftRelease\(repo, args\.tag\)/gu)).toHaveLength(2)
    expect(publisherSource).not.toContain('git rev-list')
    expect(publisherSource).not.toContain('targetCommitish')

    const runbook = readFileSync('docs/release-checklist.md', 'utf8')
    expect(runbook).not.toMatch(/gh release edit .*--draft=false/u)
    expect(runbook).not.toMatch(/gh release upload/u)
  })
})

describe('release checklist guard', () => {
  it('accepts a complete checklist and returns distinct artifact identities', () => {
    expect(validateReleaseMatrix(qualifiedReleaseBody(), TAG)).toEqual({
      appImage: { name: 'sartracker_0.1.0.AppImage', sha256: 'a'.repeat(64) },
      deb: { name: 'sartracker_0.1.0_amd64.deb', sha256: 'b'.repeat(64) },
      exceptions: [],
    })
  })

  it('rejects a missing, unknown or repeated check', () => {
    expect(() => validateReleaseMatrix(
      qualifiedReleaseBody().replace(/^\| Strict responsiveness .*\n/mu, ''), TAG,
    )).toThrow(/missing check "Strict responsiveness/i)
    expect(() => validateReleaseMatrix(
      qualifiedReleaseBody().replace('| Duplicate launch |', '| Duplicate launches |'), TAG,
    )).toThrow(/unknown check "Duplicate launches"/i)
    const duplicated = qualifiedReleaseBody().replace(
      /^(\| Duplicate launch \|.*)$/mu, '$1\n$1',
    )
    expect(() => validateReleaseMatrix(duplicated, TAG)).toThrow(/repeat check/i)
    expect(() => validateReleaseMatrix('## Other\n', TAG)).toThrow(/no Release checklist results/i)
  })

  it.each(['HOLD', 'TODO', 'SKIP', 'LOCAL PASS', 'NOT RUN (DEVIATION)'])(
    'rejects unknown result %s', (result) => {
      expect(() => validateReleaseMatrix(
        withResult(qualifiedReleaseBody(), 'Duplicate launch', result), TAG,
      )).toThrow(/unknown result/i)
    },
  )

  it('permits NOT APPLICABLE only where the checklist allows it', () => {
    expect(() => validateReleaseMatrix(
      withResult(qualifiedReleaseBody(), 'Live Traccar', 'NOT APPLICABLE', 'No provider available.'), TAG,
    )).toThrow(/cannot be NOT APPLICABLE/i)
  })

  it('rejects missing or placeholder evidence', () => {
    for (const evidence of ['', 'pending', 'TODO', 'none']) {
      expect(() => validateReleaseMatrix(
        withResult(qualifiedReleaseBody(), 'Duplicate launch', 'PASS', evidence), TAG,
      )).toThrow(/missing or non-final evidence/i)
    }
  })

  it.each(['FAIL', 'NOT TESTED'])('rejects %s without an owner exception', (result) => {
    expect(() => validateReleaseMatrix(
      withResult(qualifiedReleaseBody(), 'Unwritable profile shows an error', result), TAG,
    )).toThrow(/no owner-approved exception/i)
  })

  it('accepts a FAIL covered by an exception and reports the exception', () => {
    const body = withExceptions(
      withResult(qualifiedReleaseBody(), 'Unwritable profile shows an error', 'FAIL', 'App exits with no window or message.'),
      [unwritableException],
    )
    const matrix = validateReleaseMatrix(body, TAG)
    expect(matrix.exceptions).toEqual([{
      check: 'Unwritable profile shows an error',
      result: 'FAIL',
      severity: 'Ship with known issue',
      exposure: 'App exits silently; release note tells testers to check folder permissions',
      approvedBy: 'Donal',
      approvalReference: 'Chat 2026-10-01',
      followUp: 'DON-999',
    }])
  })

  it('never lets an exception relabel a FAIL as a pass or cover a PASS row', () => {
    const failed = withResult(qualifiedReleaseBody(), 'Unwritable profile shows an error', 'FAIL')
    expect(() => validateReleaseMatrix(
      withExceptions(failed, [unwritableException.replace('| FAIL |', '| NOT TESTED |')]), TAG,
    )).toThrow(/records "NOT TESTED" but the check result is "FAIL"/i)
    expect(() => validateReleaseMatrix(
      withExceptions(qualifiedReleaseBody(), [unwritableException]), TAG,
    )).toThrow(/does not match a FAIL or NOT TESTED/i)
  })

  it('refuses exceptions for identity checks and Block findings', () => {
    const identityFailed = withResult(qualifiedReleaseBody(), 'Installed .deb payload', 'FAIL')
    expect(() => validateReleaseMatrix(withExceptions(identityFailed, [
      '| Installed .deb payload | FAIL | Ship with known issue | n/a | Donal | Chat | DON-1 |',
    ]), TAG)).toThrow(/Identity check .* must PASS/i)
    const failed = withResult(qualifiedReleaseBody(), 'Unwritable profile shows an error', 'FAIL')
    expect(() => validateReleaseMatrix(withExceptions(failed, [
      unwritableException.replace('Ship with known issue', 'Block'),
    ]), TAG)).toThrow(/Block finding cannot be published/i)
  })

  it('binds exceptions to this tag and requires every field', () => {
    const failed = withResult(qualifiedReleaseBody(), 'Unwritable profile shows an error', 'FAIL')
    expect(() => validateReleaseMatrix(
      withExceptions(failed, [unwritableException], 'electron-v0.1.0-beta.13.4'), TAG,
    )).toThrow(/Applies to: `electron-v0.1.0-beta.13.5`/)
    expect(() => validateReleaseMatrix(
      withExceptions(failed, [unwritableException.replace('| Donal |', '| TODO |')]), TAG,
    )).toThrow(/placeholder approvedBy/i)
    expect(() => validateReleaseMatrix(
      withExceptions(failed, [unwritableException.replace('| DON-999 |', '|')]), TAG,
    )).toThrow(/need Check, Result, Severity/i)
    expect(() => validateReleaseMatrix(withExceptions(failed, [
      unwritableException, unwritableException,
    ]), TAG)).toThrow(/repeat check/i)
  })

  it('rejects abbreviated or ambiguous artifact hashes', () => {
    expect(() =>
      validateReleaseMatrix(qualifiedReleaseBody().replace('b'.repeat(64), 'bbbb…bbbb'), TAG),
    ).toThrow(/sha-256/i)
  })
})

describe('one release checklist', () => {
  const names = RELEASE_CHECKS.map((check) => check.name)

  /** Reads the first column of the table with the given header row. */
  function tableChecks(path: string, header: string): string[] {
    const lines = readFileSync(path, 'utf8').split('\n')
    const start = lines.findIndex((line) => line.trim() === header)
    expect(start, `${path} has a checklist table`).toBeGreaterThanOrEqual(0)
    const rows: string[] = []
    for (const line of lines.slice(start + 2)) {
      if (!line.startsWith('|')) break
      rows.push(line.split('|')[1].trim())
    }
    return rows
  }

  it('keeps the checklist document, release template and publisher in agreement', () => {
    expect(tableChecks('docs/release-checklist.md', '| Check | What must be true | How |')).toEqual(names)
    expect(tableChecks('docs/releases/TEMPLATE.md', '| Check | Result | Evidence |')).toEqual(names)
  })

  it('documents the guarded publish and offline note check', () => {
    const checklist = readFileSync('docs/release-checklist.md', 'utf8')
    expect(checklist).toContain('npm run electron:release:publish -- --tag')
    expect(checklist).toContain('--check-notes')
    expect(checklist).not.toMatch(/gh release edit .*--draft=false/u)
  })
})

describe('release regression provenance guard [DON-260]', () => {
  it('accepts a complete regression record', () => {
    expect(() => validateRegressionRecord(qualifiedReleaseBody())).not.toThrow()
  })

  it('accepts an explicit non-regression classification', () => {
    expect(() =>
      validateRegressionRecord(
        [
          '## Regression provenance',
          '',
          '- Classification: No known regression correction',
          '- Linear issue: Not applicable — no regression correction in this release.',
          '',
          '## Known limitations',
        ].join('\n'),
      ),
    ).not.toThrow()
  })

  it('rejects a missing regression record or unsupported classification', () => {
    expect(() =>
      validateRegressionRecord(qualifiedReleaseBody().replace('## Regression provenance', '## Change history')),
    ).toThrow(/regression provenance/i)
    expect(() =>
      validateRegressionRecord(
        qualifiedReleaseBody().replace(
          '- Classification: Regression correction',
          '- Classification: Performance work',
        ),
      ),
    ).toThrow(/classification/i)
  })

  it('requires every closeout field and a linked Linear issue for regressions', () => {
    expect(() =>
      validateRegressionRecord(
        qualifiedReleaseBody().replace(
          '- Escape analysis: Existing smoke started missions at the current time and never exercised a cold 36-hour lookback.\n',
          '',
        ),
      ),
    ).toThrow(/escape analysis/i)
    expect(() =>
      validateRegressionRecord(
        qualifiedReleaseBody().replace(
          '[DON-260](https://linear.app/donal-oc/issue/DON-260)',
          'DON-260',
        ),
      ),
    ).toThrow(/linked Linear issue/i)
  })

  it('rejects placeholder evidence in a regression record', () => {
    expect(() =>
      validateRegressionRecord(
        qualifiedReleaseBody().replace(
          '- Root cause: Initial history work was coupled to the steady polling cadence.',
          '- Root cause: TODO',
        ),
      ),
    ).toThrow(/root cause/i)
  })

  it('rejects duplicate fields and mismatched Linear issue links', () => {
    expect(() =>
      validateRegressionRecord(
        qualifiedReleaseBody().replace(
          '- Root cause: Initial history work was coupled to the steady polling cadence.',
          [
            '- Root cause: Initial history work was coupled to the steady polling cadence.',
            '- Root cause: A conflicting explanation.',
          ].join('\n'),
        ),
      ),
    ).toThrow(/repeats field.*root cause/i)
    expect(() =>
      validateRegressionRecord(
        qualifiedReleaseBody().replace(
          'https://linear.app/donal-oc/issue/DON-260',
          'https://linear.app/donal-oc/issue/DON-259',
        ),
      ),
    ).toThrow(/linked Linear issue/i)
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
  const qualification = validateReleaseMatrix(qualifiedReleaseBody(), TAG)
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
      '`duplicate-launch.json`',
      '`changed-duplicate-launch.json`',
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
