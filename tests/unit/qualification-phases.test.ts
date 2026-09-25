import { describe, expect, it } from 'vitest'
import {
  assertC27Admission,
  assertC29Admission,
  assertPostpublicationAdmission,
  evaluateQualificationPhases,
  evaluateTechnicalHandover,
  validateQualificationPhase,
} from '../../scripts/qualification/campaign-phases.mjs'
import { BETA13_CLAIM_SCOPE, BETA13_NOT_CLAIMED_CAPABILITIES } from '../../scripts/qualification/product-capabilities.mjs'

const bindings = [
  { contractId: 'C19', variantId: 'integrity', mandatory: true, phase: 'prepublication' },
  { contractId: 'C24', variantId: 'responsiveness', mandatory: true, phase: 'prepublication' },
  { contractId: 'C29', variantId: 'human-acceptance', mandatory: true, phase: 'posthandover' },
  { contractId: 'C27', variantId: 'draft', mandatory: true, phase: 'prepublication' },
  { contractId: 'C00', variantId: 'public', mandatory: true, phase: 'postpublication' },
]

function readyForC27() {
  const attempts = [
    { contractId: 'C19', variantId: 'integrity', status: 'PASS' },
    { contractId: 'C24', variantId: 'responsiveness', status: 'PASS' },
    { contractId: 'C29', variantId: 'human-acceptance', status: 'PASS' },
  ]
  const phases = evaluateQualificationPhases(bindings, attempts, [], BETA13_NOT_CLAIMED_CAPABILITIES)
  return {
    mode: 'candidate',
    verdict: 'ENVIRONMENT_BLOCKED',
    claimScope: BETA13_CLAIM_SCOPE,
    phases,
    notClaimedCapabilities: BETA13_NOT_CLAIMED_CAPABILITIES,
    deterministicFailures: [], evidenceErrors: [],
    blockers: [
      'missing required variant C27:draft',
      'missing required variant C00:public',
      'missing required contract C27',
      'missing required contract C00',
    ],
    attempts,
    retainedAttemptStatuses: attempts.map(({ contractId, variantId, status }) => ({ contractId, variantId, status })),
    contractRows: Array.from({ length: 30 }, (_, index) => {
      const contractId = `C${String(index).padStart(2, '0')}`
      return { contractId, required: true, status: ['C27', 'C00'].includes(contractId) ? 'not-run'
        : ['C19', 'C24'].includes(contractId) ? 'SCOPE_LIMITED' : 'PASS' }
    }),
  }
}

describe('mandatory release phases', () => {
  it('reports all technical rows ready only for approval, with C29 and public evidence pending', () => {
    const complete = [
      ...Array.from({ length: 29 }, (_, index) => ({ contractId: `C${String(index).padStart(2, '0')}`,
        variantId: 'technical', mandatory: true, phase: 'prepublication' })),
      bindings[2], bindings[4],
    ]
    const attempts = complete.filter((binding) => binding.phase === 'prepublication')
      .map((binding) => ({ ...binding, status: 'PASS' }))
    const verdict = { ...readyForC27(),
      phases: evaluateQualificationPhases(complete, attempts, [], BETA13_NOT_CLAIMED_CAPABILITIES, { mode: 'candidate' }),
      retainedAttemptStatuses: attempts,
      blockers: ['missing required variant C29:human-acceptance', 'missing required contract C29',
        'missing required variant C00:public', 'missing required contract C00'],
    }
    expect(evaluateTechnicalHandover(verdict, complete)).toEqual({ stage: 'technical-handover',
      status: 'READY_FOR_APPROVAL', humanAcceptance: 'NOT_RUN', publicBytesVerified: false,
      publicationAuthorized: false, distributionAuthorized: false, operationallyEligible: false })
    // A separately approved controlled draft handover need not publish the build.
    expect(() => assertC29Admission(verdict, complete)).not.toThrow()
    const publicAttempts = [...attempts, { ...bindings[4], status: 'PASS' }]
    const publicVerified = { ...verdict,
      phases: evaluateQualificationPhases(complete, publicAttempts, [], BETA13_NOT_CLAIMED_CAPABILITIES, { mode: 'candidate' }),
      retainedAttemptStatuses: publicAttempts,
      blockers: verdict.blockers.filter((blocker) => !blocker.includes('C00')),
    }
    expect(() => assertC29Admission(publicVerified, complete)).not.toThrow()
    expect(() => assertC29Admission(readyForC27(), complete)).toThrow(/technical/iu)
    expect(verdict.phases).toMatchObject({ evidenceComplete: false, releaseComplete: false, teamRolloutEligible: false })
    for (const status of ['FAIL', 'CLEANUP_BLOCKED', 'ENVIRONMENT_BLOCKED', 'NEEDS_HUMAN_DECISION', 'ABORTED_SAFE', 'INVALID_EVIDENCE']) {
      const retained = [...attempts, { ...attempts[0], status }]
      expect(evaluateTechnicalHandover({ ...verdict, retainedAttemptStatuses: retained }, complete).status).toBe('NOT_READY')
    }
    expect(evaluateTechnicalHandover({ ...verdict, mode: 'calibration' }, complete).status).toBe('NOT_READY')
    expect(evaluateTechnicalHandover({ ...verdict, blockers: [...verdict.blockers, 'missing exact installed deb'] }, complete).status).toBe('NOT_READY')
    expect(evaluateTechnicalHandover({ ...verdict, evidenceErrors: ['mutated input'] }, complete).status).toBe('NOT_READY')
    expect(evaluateTechnicalHandover(verdict, complete.filter((binding) => binding.contractId !== 'C28')).status).toBe('NOT_READY')
    const missingTechnical = { ...verdict,
      phases: evaluateQualificationPhases(complete, attempts.slice(1), [], BETA13_NOT_CLAIMED_CAPABILITIES, { mode: 'candidate' }),
    }
    expect(evaluateTechnicalHandover(missingTechnical, complete).status).toBe('NOT_READY')
    for (const status of ['NEEDS_HUMAN_DECISION', 'FAIL', 'INVALID_EVIDENCE', 'CLEANUP_BLOCKED']) {
      const humanAttempts = [...attempts, { ...bindings[2], status }]
      const human = { ...verdict,
        phases: evaluateQualificationPhases(complete, humanAttempts, [], BETA13_NOT_CLAIMED_CAPABILITIES, { mode: 'candidate' }),
        retainedAttemptStatuses: humanAttempts,
        blockers: verdict.blockers.filter((blocker) => !blocker.includes('C29')),
      }
      expect(evaluateTechnicalHandover(human, complete).status)
        .toBe(status === 'NEEDS_HUMAN_DECISION' ? 'READY_FOR_APPROVAL' : 'NOT_READY')
      expect(human.phases).toMatchObject({ evidenceComplete: false, releaseComplete: false, teamRolloutEligible: false })
    }
  })

  it('allows only external C29 acceptance in the posthandover phase', () => {
    expect(() => validateQualificationPhase({ ...bindings[2], proofMode: 'external-human' })).not.toThrow()
    expect(() => validateQualificationPhase({ ...bindings[0], phase: 'posthandover' })).toThrow()
    for (const proofMode of ['source', 'browser', 'ci-appimage', 'installed-deb', 'synthetic']) {
      expect(() => validateQualificationPhase({ contractId: 'C29', proofMode })).toThrow(/external-human/iu)
    }
  })

  it('admits technical draft and public-byte checks with C29 visibly not run', () => {
    const prior = readyForC27()
    const attempts = prior.attempts.filter((row) => row.contractId !== 'C29')
    const pending = {
      ...prior,
      phases: evaluateQualificationPhases(bindings, attempts, [], BETA13_NOT_CLAIMED_CAPABILITIES),
      retainedAttemptStatuses: attempts,
      blockers: [...prior.blockers, 'missing required variant C29:human-acceptance', 'missing required contract C29'],
      contractRows: prior.contractRows.map((row) => row.contractId === 'C29' ? { ...row, status: 'not-run' } : row),
    }
    expect(() => assertC27Admission(pending, bindings, bindings[3])).not.toThrow()
    const draftAttempts = [...attempts, { contractId: 'C27', variantId: 'draft', status: 'PASS' }]
    const draft = {
      ...pending,
      phases: evaluateQualificationPhases(bindings, draftAttempts, [], BETA13_NOT_CLAIMED_CAPABILITIES),
      retainedAttemptStatuses: draftAttempts,
      blockers: pending.blockers.filter((blocker) => !blocker.includes('C27')),
      contractRows: pending.contractRows.map((row) => row.contractId === 'C27' ? { ...row, status: 'PASS' } : row),
    }
    expect(() => assertPostpublicationAdmission(draft, bindings, bindings[4])).not.toThrow()
    expect(draft.phases).toMatchObject({ humanAcceptance: { status: 'NOT_RUN' }, evidenceComplete: false, releaseComplete: false, teamRolloutEligible: false })
    expect(() => assertC27Admission({ ...pending, retainedAttemptStatuses: [...attempts,
      { contractId: 'C24', variantId: 'responsiveness', status: 'FAIL' }] }, bindings, bindings[3])).toThrow()
  })
  it('allows a completed draft gate to be distinguished from unverified public bytes', () => {
    const releaseBindings = bindings.filter((binding) => ['C27', 'C00'].includes(binding.contractId))
    expect(evaluateQualificationPhases(releaseBindings, [{ contractId: 'C27', variantId: 'draft', status: 'PASS' }], [])).toMatchObject({
      prepublication: { status: 'PASS' }, postpublication: { status: 'NOT_RUN' },
      teamRolloutEligible: false, releaseComplete: false,
    })
  })
  it('keeps postpublication mismatch a hard stop even after draft checks passed', () => {
    expect(evaluateQualificationPhases(bindings, [
      { contractId: 'C27', variantId: 'draft', status: 'PASS' },
      { contractId: 'C00', variantId: 'public', status: 'FAIL' },
    ], [])).toMatchObject({ postpublication: { status: 'FAIL' }, teamRolloutEligible: false,
      requiredDisposition: 'block-team-rollout-and-withdraw-or-rollback' })
  })
  it('cannot move the draft gate after publication or turn public evidence into a prepublication gate', () => {
    expect(() => validateQualificationPhase({ contractId: 'C27', phase: 'postpublication' })).toThrow(/C00/)
    expect(() => validateQualificationPhase({ contractId: 'C00', phase: 'postpublication', proofMode: 'browser' })).toThrow(/public-release/)
  })
  it('requires every variant and preserves prior failed attempts', () => {
    const rows = [
      { contractId: 'C27', variantId: 'draft', status: 'FAIL' },
      { contractId: 'C27', variantId: 'draft', status: 'PASS' },
      { contractId: 'C00', variantId: 'public', status: 'PASS' },
    ]
    expect(evaluateQualificationPhases(bindings, rows, []).prepublication.status).toBe('FAIL')
    expect(evaluateQualificationPhases(bindings, rows.slice(1), ['changed receipt']).prepublication.status).toBe('INVALID_EVIDENCE')
  })

  it('admits C27 only after every other technical contract passes and retains all failures', () => {
    const verdict = readyForC27()
    expect(verdict.phases.prepublication).toMatchObject({ status: 'NOT_RUN', missing: ['C27:draft'] })
    expect(() => assertC27Admission(verdict, bindings, bindings[3])).not.toThrow()
    const failed = { ...verdict, contractRows: verdict.contractRows.map((row) => row.contractId === 'C13' ? { ...row, status: 'FAIL' } : row) }
    expect(() => assertC27Admission(failed, bindings, bindings[3])).toThrow(/every applicable/iu)
    const changedScope = { ...verdict, phases: { ...verdict.phases,
      prepublication: { ...verdict.phases.prepublication, missing: ['C27:draft'], notClaimedCapabilities: [] },
    } }
    expect(() => assertC27Admission(changedScope, bindings, bindings[3])).toThrow(/every applicable/iu)
    const alteredResidualRecord = { ...verdict,
      notClaimedCapabilities: verdict.notClaimedCapabilities.map((entry, index) => index === 0 ? { ...entry, unexpected: true } : entry),
    }
    expect(() => assertC27Admission(alteredResidualRecord, bindings, bindings[3])).toThrow(/every applicable/iu)
    const wrongPendingVariant = { ...verdict,
      phases: { ...verdict.phases, prepublication: { ...verdict.phases.prepublication, missing: ['C27:other'] } },
      blockers: verdict.blockers.map((blocker) => blocker.replace('C27:draft', 'C27:other')),
    }
    expect(() => assertC27Admission(wrongPendingVariant, bindings, bindings[3])).toThrow(/every applicable/iu)
    const failedHumanAcceptance = { ...verdict, contractRows: verdict.contractRows.map((row) => row.contractId === 'C29' ? { ...row, status: 'FAIL' } : row) }
    expect(() => assertC27Admission(failedHumanAcceptance, bindings, bindings[3])).toThrow(/every applicable/iu)
    const noRetainedAttempts = { ...verdict, retainedAttemptStatuses: [] }
    expect(() => assertC27Admission(noRetainedAttempts, bindings, bindings[3])).toThrow(/every applicable/iu)
    const retainedEnvironmentBlocker = { ...verdict,
      blockers: [...verdict.blockers, 'missing required variant C13:startup'],
      retainedAttemptStatuses: [{ contractId: 'C13', variantId: 'startup', status: 'ENVIRONMENT_BLOCKED' }],
    }
    expect(() => assertC27Admission(retainedEnvironmentBlocker, bindings, bindings[3])).toThrow(/every applicable/iu)
    const unrelatedBlocker = { ...verdict,
      blockers: [...verdict.blockers, 'missing required variant C13:startup'],
      retainedAttemptStatuses: [{ contractId: 'C13', variantId: 'startup', status: 'PASS' }],
    }
    expect(() => assertC27Admission(unrelatedBlocker, bindings, bindings[3])).toThrow(/every applicable/iu)
    const retainedBlockerHistory = { ...verdict,
      retainedAttemptStatuses: [{ contractId: 'C13', variantId: 'startup', status: 'ENVIRONMENT_BLOCKED' }],
    }
    expect(() => assertC27Admission(retainedBlockerHistory, bindings, bindings[3])).toThrow(/every applicable/iu)
  })

  it('admits C00 only after C27 and the exact scope-limited technical prepublication result', () => {
    const prior = readyForC27()
    const attempts = [...prior.attempts, { contractId: 'C27', variantId: 'draft', status: 'PASS' }]
    const verdict = {
      ...prior,
      phases: evaluateQualificationPhases(bindings, attempts, [], BETA13_NOT_CLAIMED_CAPABILITIES),
      attempts,
      retainedAttemptStatuses: attempts.map(({ contractId, variantId, status }) => ({ contractId, variantId, status })),
      blockers: ['missing required variant C00:public', 'missing required contract C00'],
      contractRows: prior.contractRows.map((row) => row.contractId === 'C27' ? { ...row, status: 'PASS' } : row),
    }
    expect(() => assertPostpublicationAdmission(verdict, bindings, bindings[4])).not.toThrow()
    const lostResidual = { ...verdict, notClaimedCapabilities: [] }
    expect(() => assertPostpublicationAdmission(lostResidual, bindings, bindings[4])).toThrow(/scope/iu)
    const changedClaimScope = { ...verdict, claimScope: { ...BETA13_CLAIM_SCOPE, allowedData: ['synthetic'] } }
    expect(() => assertPostpublicationAdmission(changedClaimScope, bindings, bindings[4])).toThrow(/scope/iu)
    const unscopedPrepublicationPass = { ...verdict, phases: { ...verdict.phases,
      prepublication: { ...verdict.phases.prepublication, status: 'PASS' },
    } }
    expect(() => assertPostpublicationAdmission(unscopedPrepublicationPass, bindings, bindings[4])).toThrow(/scope/iu)
    const noDraftDecision = { ...verdict, contractRows: verdict.contractRows.map((row) => row.contractId === 'C27' ? { ...row, status: 'not-run' } : row) }
    expect(() => assertPostpublicationAdmission(noDraftDecision, bindings, bindings[4])).toThrow(/C27/u)
    const unrelatedPendingC00 = { ...verdict,
      phases: { ...verdict.phases,
        postpublication: { ...verdict.phases.postpublication, missing: ['C00:public', 'C00:unexpected'] },
      },
      blockers: [...verdict.blockers, 'missing required variant C00:unexpected'],
    }
    expect(() => assertPostpublicationAdmission(unrelatedPendingC00, bindings, bindings[4])).toThrow(/C00/u)
    const failedEvidence = { ...verdict, deterministicFailures: ['C19 failed'] }
    expect(() => assertPostpublicationAdmission(failedEvidence, bindings, bindings[4])).toThrow(/failures/iu)
    const priorBlocker = { ...verdict,
      blockers: [...verdict.blockers, 'missing required variant C13:startup'],
      retainedAttemptStatuses: [{ contractId: 'C13', variantId: 'startup', status: 'ENVIRONMENT_BLOCKED' }],
    }
    expect(() => assertPostpublicationAdmission(priorBlocker, bindings, bindings[4])).toThrow(/C00|blockers/iu)
    const noRetainedAttempts = { ...verdict, retainedAttemptStatuses: [] }
    expect(() => assertPostpublicationAdmission(noRetainedAttempts, bindings, bindings[4])).toThrow(/C00/iu)
  })
})
