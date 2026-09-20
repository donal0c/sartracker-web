import { describe, expect, it } from 'vitest'
import { compilePackageCommand, normalizePackagedVariant } from '../../scripts/qualification/package-command.mjs'

const context = { app: '/owned/candidate.AppImage', evidence: '/owned/evidence',
  sourceSha: 'a'.repeat(40), fixture: '/owned/copy.sqlite' }

describe('fixed packaged qualification commands', () => {
  it('normalizes only reviewed tier suffixes and preserves proof-tier binding', () => {
    expect(normalizePackagedVariant('C28', 'routine-appimage', 'ci-appimage')).toEqual({
      outerVariantId: 'routine-appimage', producerVariantId: 'routine', tier: 'ci-appimage',
    })
    expect(normalizePackagedVariant('C28', 'routine-installed', 'installed-deb')).toEqual({
      outerVariantId: 'routine-installed', producerVariantId: 'routine', tier: 'installed-deb',
    })
    expect(normalizePackagedVariant('C03', 'family-contract', undefined)).toEqual({
      outerVariantId: 'family-contract', producerVariantId: 'routine', tier: undefined,
    })
    expect(() => normalizePackagedVariant('C28', 'routine-installed', 'ci-appimage')).toThrow(/proof|tier/iu)
    expect(() => normalizePackagedVariant('C28', 'invented-appimage', 'ci-appimage')).toThrow(/reviewed|variant/iu)
    expect(() => normalizePackagedVariant('C03', 'invented', undefined)).toThrow(/reviewed|variant/iu)
  })

  it('routes tier-suffixed C28, C02, and C18 bindings to canonical producer scenarios', () => {
    for (const tier of ['appimage', 'installed']) {
      const proofMode = tier === 'appimage' ? 'ci-appimage' : 'installed-deb'
      const c28 = compilePackageCommand('C28', {
        ...context, proofMode, variantId: `routine-${tier}`,
      })
      expect(c28.producerVariantId).toBe('routine')
      expect(c28.args.at(-1)).toBe('routine')
      for (const variant of ['graceful-close', 'reload', 'renderer-crash', 'main-sigkill', 'pending-finalize']) {
        const c02 = compilePackageCommand('C02', {
          ...context, proofMode, variantId: `${variant}-${tier}`,
        })
        expect(c02.args).toContain(variant)
        expect(c02.producerVariantId).toBe(variant)
      }
      for (const variant of ['disk-full', 'permission', 'corrupt-temp', 'busy-wal', 'concurrent-writes', 'worker-crash', 'stale-good-mirror']) {
        const c18 = compilePackageCommand('C18', {
          ...context, proofMode, variantId: `${variant}-${tier}`,
        })
        expect(c18.args).toContain(variant)
        expect(c18.producerVariantId).toBe(variant)
      }
    }
  })

  it('keeps family bindings tiered while routing their shared producer as routine', () => {
    for (const contractId of ['C03', 'C11', 'C17']) {
      for (const tier of ['appimage', 'installed']) {
        const proofMode = tier === 'appimage' ? 'ci-appimage' : 'installed-deb'
        const variantId = `family-contract-${tier}`
        expect(normalizePackagedVariant(contractId, variantId, proofMode)).toEqual({
          outerVariantId: variantId, producerVariantId: 'routine', tier: proofMode,
        })
        const command = compilePackageCommand(contractId, { ...context, proofMode, variantId })
        expect(command.producerVariantId).toBe('routine')
        expect(command.args).toContain('routine')
      }
    }
  })

  it('routes tier-suffixed paging bindings using the canonical profile', () => {
    for (const contractId of ['C07', 'C08']) {
      const variantId = 'paging-960k-appimage'
      const command = compilePackageCommand(contractId, {
        ...context, fixture: '/owned/paging.sqlite', proofMode: 'ci-appimage', variantId,
      })
      expect(command.producerVariantId).toBe('paging-960k')
      expect(command.args).toEqual([context.app, context.evidence, '/owned/paging.sqlite', contractId])
    }
  })

  it('uses the actual Train D and GPX command interfaces', () => {
    expect(compilePackageCommand('C01', { ...context, appSha256: 'b'.repeat(64) })).toMatchObject({
      script: 'scripts/qualification/startup-probe.mjs', report: 'receipt.json',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
        '--expected-app-sha256', 'b'.repeat(64)],
    })
    expect(compilePackageCommand('C01', {
      ...context,
      appSha256: 'b'.repeat(64),
      enospcMount: '/owned/enospc-mount',
    }).args).toEqual([
      '--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
      '--expected-app-sha256', 'b'.repeat(64), '--enospc-mount', '/owned/enospc-mount',
    ])
    expect(compilePackageCommand('C02', context)).toMatchObject({
      script: 'scripts/electron-repair-train-d-smoke.mjs',
      args: ['--app', context.app, '--evidence', context.evidence], report: 'receipt.json',
    })
    expect(compilePackageCommand('C02', { ...context, variantId: 'lifecycle-recovery' })).toMatchObject({
      script: 'scripts/electron-repair-train-d-smoke.mjs',
      args: ['--app', context.app, '--evidence', context.evidence], report: 'receipt.json',
    })
    for (const variantId of ['graceful-close', 'reload', 'renderer-crash', 'main-sigkill', 'pending-finalize']) {
      expect(compilePackageCommand('C02', { ...context, variantId })).toMatchObject({
        script: 'scripts/qualification/c02-lifecycle-probe.mjs',
        args: ['--app', context.app, '--evidence', context.evidence,
          '--expected-head', context.sourceSha, '--variant', variantId],
        report: 'c02-lifecycle-report.json',
      })
    }
    expect(compilePackageCommand('C09', context).args).toEqual([context.app, context.evidence])
    expect(compilePackageCommand('C10', context)).toMatchObject({
      script: 'scripts/replay-map-packaged-proof.mjs',
      args: [context.app, context.evidence],
      report: 'report.json',
    })
    expect(compilePackageCommand('C10', { ...context, fixture: '/owned/replay.sqlite', variantId: 'replay-960k' })).toMatchObject({
      script: 'scripts/qualification/replay-scale-probe.mjs',
      args: [context.app, context.evidence, '/owned/replay.sqlite', 'replay-960k'],
      report: 'replay-scale-report.json',
      timeoutMs: 60 * 60 * 1000,
    })
    expect(compilePackageCommand('C10', { ...context, variantId: 'replay-201-outings' })).toMatchObject({
      script: 'scripts/qualification/replay-outing-probe.mjs',
      args: [context.app, context.evidence],
      report: 'replay-outing-report.json',
    })
    expect(compilePackageCommand('C06', context)).toMatchObject({
      script: 'scripts/qualification/attention-probe.mjs',
      args: [context.app, context.evidence],
      report: 'attention-report.json',
    })
    expect(compilePackageCommand('C05', context)).toMatchObject({
      script: 'scripts/qualification/attention-probe.mjs',
      args: [context.app, context.evidence],
      report: 'attention-report.json',
    })
    expect(compilePackageCommand('C19', { ...context, variantId: 'legacy-v11-50k' })).toMatchObject({
      script: 'scripts/qualification/legacy-default-probe.mjs',
      args: [context.app, context.evidence, 'legacy-v11-50k'],
      report: 'legacy-default-report.json',
      timeoutMs: 15 * 60 * 1000,
    })
    expect(compilePackageCommand('C19', { ...context, variantId: 'legacy-v11-field-37gb' })).toMatchObject({
      script: 'scripts/qualification/legacy-default-probe.mjs',
      args: [context.app, context.evidence, 'legacy-v11-field-37gb'],
      report: 'legacy-default-report.json',
      timeoutMs: 60 * 60 * 1000,
    })
    expect(compilePackageCommand('C19', { ...context, variantId: 'legacy-schema-matrix' })).toMatchObject({
      script: 'scripts/qualification/legacy-schema-probe.mjs',
      args: [context.app, context.evidence],
      report: 'legacy-schema-report.json',
    })
    expect(compilePackageCommand('C19', {
      ...context,
      appSha256: 'b'.repeat(64),
      enospcMount: '/owned/enospc-mount',
      variantId: 'legacy-startup-boundaries',
    })).toMatchObject({
      script: 'scripts/qualification/startup-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
        '--expected-app-sha256', 'b'.repeat(64), '--enospc-mount', '/owned/enospc-mount'],
      report: 'receipt.json',
    })
    expect(compilePackageCommand('C03', context)).toMatchObject({
      script: 'scripts/qualification/composite-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
        '--variant', 'routine', '--family-contract', 'C03'],
      report: 'composite-receipt.json',
    })
    for (const contractId of ['C11', 'C17']) {
      expect(compilePackageCommand(contractId, context)).toMatchObject({
        script: 'scripts/qualification/composite-probe.mjs',
        args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
          '--variant', 'routine', '--family-contract', contractId],
        report: 'composite-receipt.json',
      })
    }
    expect(compilePackageCommand('C07', { ...context, fixture: '/owned/paging.sqlite', variantId: 'paging-960k' })).toMatchObject({
      script: 'scripts/qualification/paging-probe.mjs',
      args: [context.app, context.evidence, '/owned/paging.sqlite', 'C07'],
      report: 'paging-report.json',
    })
    expect(compilePackageCommand('C08', { ...context, fixture: '/owned/paging.sqlite', variantId: 'paging-field-37gb' })).toMatchObject({
      script: 'scripts/qualification/paging-probe.mjs',
      args: [context.app, context.evidence, '/owned/paging.sqlite', 'C08'],
      report: 'paging-report.json',
    })
    expect(compilePackageCommand('C07', { ...context, fixture: '/owned/paging.sqlite', variantId: 'paging-2m' }).args)
      .toEqual([context.app, context.evidence, '/owned/paging.sqlite', 'C07'])
    expect(compilePackageCommand('C12', context)).toMatchObject({
      script: 'scripts/qualification/marker-attachment-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha],
      report: 'marker-attachment-receipt.json',
    })
    expect(compilePackageCommand('C13', context)).toMatchObject({
      script: 'scripts/qualification/coordinate-surface-probe.mjs',
      args: [context.app, context.evidence],
      report: 'coordinate-surface-report.json',
    })
    expect(compilePackageCommand('C14', context)).toMatchObject({
      script: 'scripts/qualification/map-surface-probe.mjs',
      args: [context.app, context.evidence],
      report: 'map-surface-report.json',
    })
    expect(compilePackageCommand('C16', context)).toMatchObject({
      script: 'scripts/qualification/settings-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha],
      report: 'receipt.json',
    })
    expect(compilePackageCommand('C23', context)).toMatchObject({
      script: 'scripts/qualification/ipc-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha],
      report: 'receipt.json',
    })
    expect(compilePackageCommand('C21', context)).toMatchObject({
      script: 'scripts/qualification/archive-security-packaged-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha],
      report: 'archive-security-report.json',
    })
    expect(compilePackageCommand('C15', context)).toMatchObject({
      script: 'scripts/electron-official-map-qualification-smoke.mjs',
      args: ['--app', context.app, '--evidence-dir', context.evidence],
      report: 'summary.json',
    })
  })
  it('requires an owned copy for the destructive crash probe and freezes archive bounds', () => {
    expect(() => compilePackageCommand('C18', { ...context, fixture: undefined })).toThrow(/fixture/iu)
    expect(compilePackageCommand('C18', context).args).toContain(context.fixture)
    expect(compilePackageCommand('C18', { ...context, variantId: 'sqlite-recovery' })).toMatchObject({
      script: 'scripts/electron-storage-diagnostics-kill-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--fixture', context.fixture],
      report: 'storage-diagnostics-kill-probe-report.json',
    })
    for (const variantId of ['disk-full', 'permission', 'corrupt-temp', 'busy-wal', 'concurrent-writes', 'worker-crash', 'stale-good-mirror']) {
      expect(compilePackageCommand('C18', { ...context, variantId })).toMatchObject({
        script: 'scripts/electron-storage-diagnostics-kill-probe.mjs',
        args: ['--app', context.app, '--evidence', context.evidence, '--fixture', context.fixture,
          '--variant', variantId],
        report: 'storage-backup-fault-matrix-report.json',
      })
    }
    expect(compilePackageCommand('C18', {
      ...context, variantId: 'disk-full', enospcMount: '/owned/enospc-mount',
    }).args).toEqual([
      '--app', context.app, '--evidence', context.evidence, '--fixture', context.fixture,
      '--variant', 'disk-full', '--enospc-mount', '/owned/enospc-mount',
    ])
    expect(() => compilePackageCommand('C18', {
      ...context, variantId: 'permission', enospcMount: '/owned/enospc-mount',
    })).toThrow(/ENOSPC|disk-full/iu)
    for (const contractId of ['C20', 'C22']) {
      expect(compilePackageCommand(contractId, context)).toMatchObject({
        script: 'scripts/qualification/composite-large-archive-probe.mjs',
        report: 'composite-large-archive-report.json',
        args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
          '--variant', 'field-archive-37gb'],
      })
    }
    expect(() => compilePackageCommand('C07', { ...context, fixture: undefined, variantId: 'paging-960k' })).toThrow(/fixture/iu)
    expect(() => compilePackageCommand('C07', { ...context, fixture: '/owned/paging.sqlite', variantId: 'unknown' })).toThrow(/profile|reviewed|variant/iu)
    expect(() => compilePackageCommand('C10', { ...context, fixture: undefined, variantId: 'replay-960k' })).toThrow(/fixture/iu)
    expect(() => compilePackageCommand('C10', { ...context, fixture: '/owned/replay.sqlite', variantId: 'unknown' })).toThrow(/replay|profile|reviewed|variant/iu)
    expect(() => compilePackageCommand('C19', context)).toThrow(/legacy|variant/iu)
    expect(() => compilePackageCommand('C19', { ...context, variantId: 'legacy-unknown' })).toThrow(/legacy|variant/iu)
  })
  it.each([
    ['C26', 'duplicate-launch-probe.mjs', 'duplicate-launch-receipt.json', undefined],
    ['C28', 'composite-probe.mjs', 'composite-receipt.json', 'routine'],
  ])('binds the actual %s packaged journey command', (contractId, script, report, variantId) => {
    const commandContext = variantId === undefined ? context : { ...context, variantId }
    const expectedArgs = ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
      ...(variantId === undefined ? [] : ['--variant', variantId])]
    expect(compilePackageCommand(contractId, commandContext)).toMatchObject({
      script: `scripts/qualification/${script}`, report,
      args: expectedArgs,
    })
  })
  it('binds each C28 command to one fixed reviewed variant', () => {
    expect(compilePackageCommand('C28', { ...context, variantId: 'failure-settings-bootstrap' })).toMatchObject({
      script: 'scripts/qualification/composite-probe.mjs',
      args: ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
        '--variant', 'failure-settings-bootstrap'],
      report: 'composite-receipt.json',
    })
  })
  it('does not accept source/browser commands or invent missing producers', () => {
    expect(() => compilePackageCommand('C02', { ...context, app: 'relative' })).toThrow(/absolute/iu)
    expect(() => compilePackageCommand('C03', { ...context, proofMode: 'installed-deb', variantId: 'family-contract-appimage' }))
      .toThrow(/proof|tier/iu)
  })
})
