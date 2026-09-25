import path from 'node:path'
import { PAGING_PROFILES } from './paging-file-oracle.mjs'
import { C28_VARIANT_AXIS_MAP } from './composite-coverage.mjs'
import { C02_LIFECYCLE_VARIANTS } from './c02-lifecycle-receipts.mjs'
import { BACKUP_FAULT_VARIANTS } from '../../build/electron-storage-diagnostics-kill-probe-lib.js'

const PRODUCERS = Object.freeze({
  C01: ['scripts/qualification/startup-probe.mjs', 'receipt.json'],
  C02: ['scripts/electron-repair-train-d-smoke.mjs', 'receipt.json'],
  C03: ['scripts/qualification/composite-probe.mjs', 'composite-receipt.json'],
  C05: ['scripts/qualification/attention-probe.mjs', 'attention-report.json'],
  C06: ['scripts/qualification/attention-probe.mjs', 'attention-report.json'],
  C07: ['scripts/qualification/paging-probe.mjs', 'paging-report.json'],
  C08: ['scripts/qualification/paging-probe.mjs', 'paging-report.json'],
  C09: ['scripts/electron-gpx-fidelity-smoke.mjs', 'receipt.json'],
  C10: ['scripts/replay-map-packaged-proof.mjs', 'report.json'],
  C11: ['scripts/qualification/composite-probe.mjs', 'composite-receipt.json'],
  C12: ['scripts/qualification/marker-attachment-probe.mjs', 'marker-attachment-receipt.json'],
  C13: ['scripts/qualification/coordinate-surface-probe.mjs', 'coordinate-surface-report.json'],
  C14: ['scripts/qualification/map-surface-probe.mjs', 'map-surface-report.json'],
  C15: ['scripts/electron-official-map-qualification-smoke.mjs', 'summary.json'],
  C16: ['scripts/qualification/settings-probe.mjs', 'receipt.json'],
  C17: ['scripts/qualification/composite-probe.mjs', 'composite-receipt.json'],
  C18: ['scripts/electron-storage-diagnostics-kill-probe.mjs', 'storage-diagnostics-kill-probe-report.json'],
  C19: ['scripts/electron-legacy-object-recovery-smoke.mjs', 'report.json'],
  C23: ['scripts/qualification/ipc-probe.mjs', 'receipt.json'],
  C21: ['scripts/qualification/archive-security-packaged-probe.mjs', 'archive-security-report.json'],
  C26: ['scripts/qualification/duplicate-launch-probe.mjs', 'duplicate-launch-receipt.json'],
  C28: ['scripts/qualification/composite-probe.mjs', 'composite-receipt.json'],
  C20: ['scripts/qualification/composite-large-archive-probe.mjs', 'composite-large-archive-report.json'],
  C22: ['scripts/qualification/composite-large-archive-probe.mjs', 'composite-large-archive-report.json'],
})

const PAGING_VARIANTS = new Set(Object.keys(PAGING_PROFILES))
export const REPLAY_SCALE_PROFILES = Object.freeze({
  'replay-960k': Object.freeze({ rows: 960_000 }),
  'replay-2m': Object.freeze({ rows: 2_000_000 }),
})
export const REPLAY_OUTING_VARIANT = 'replay-201-outings'
const LEGACY_REPLAY_VARIANTS = new Set(['known-at-time-replay', REPLAY_OUTING_VARIANT])
export const LEGACY_STARTUP_VARIANT = 'legacy-startup-boundaries'
export const LEGACY_DEFAULT_VARIANTS = new Set([
  'legacy-v11-50k',
  'legacy-v11-50k-kill',
  'legacy-v11-local-1gib',
  'legacy-v11-field-37gb',
])
export const LEGACY_SCHEMA_VARIANT = 'legacy-schema-matrix'
export const C18_BACKUP_FAULT_VARIANTS = BACKUP_FAULT_VARIANTS
const C18_LEGACY_VARIANTS = new Set(['sqlite-recovery'])
const C02_LEGACY_VARIANTS = new Set(['lifecycle-recovery'])
const REVIEWED_TIERED_SCENARIOS = Object.freeze({
  C01: Object.freeze(['startup-fault-admission']),
  C02: Object.freeze([...C02_LIFECYCLE_VARIANTS, ...C02_LEGACY_VARIANTS]),
  C03: Object.freeze(['routine', 'family-contract']),
  C05: Object.freeze(['canonical-ingest-surface']),
  C06: Object.freeze(['stationary-attention']),
  C07: Object.freeze([...PAGING_VARIANTS]),
  C08: Object.freeze([...PAGING_VARIANTS]),
  C09: Object.freeze(['gpx-custody']),
  C10: Object.freeze(['known-at-time-replay', ...Object.keys(REPLAY_SCALE_PROFILES), REPLAY_OUTING_VARIANT]),
  C11: Object.freeze(['routine', 'family-contract']),
  C12: Object.freeze(['marker-attachment']),
  C13: Object.freeze(['coordinate-surface']),
  C14: Object.freeze(['map-surface']),
  C15: Object.freeze(['official-offline-map', 'private-offline-map']),
  C16: Object.freeze(['settings-bootstrap']),
  C17: Object.freeze(['routine', 'family-contract']),
  C18: Object.freeze([...BACKUP_FAULT_VARIANTS, ...C18_LEGACY_VARIANTS]),
  C19: Object.freeze([
    LEGACY_STARTUP_VARIANT, LEGACY_SCHEMA_VARIANT, ...LEGACY_DEFAULT_VARIANTS,
  ]),
  C20: Object.freeze(['streamed-archive']),
  C21: Object.freeze(['archive-security']),
  C22: Object.freeze(['archive-restore']),
  C23: Object.freeze(['packaged-ipc-containment']),
  C26: Object.freeze(['duplicate-launch']),
  C28: Object.freeze(Object.keys(C28_VARIANT_AXIS_MAP)),
})

// The plan names the outer family binding explicitly; the shared producer has
// one fixed routine scenario. Keep that translation here so the receipt keeps
// the full binding identity while the CLI receives only its canonical input.
const PRODUCER_VARIANT_ALIASES = Object.freeze({
  C03: Object.freeze({ 'family-contract': 'routine' }),
  C11: Object.freeze({ 'family-contract': 'routine' }),
  C17: Object.freeze({ 'family-contract': 'routine' }),
})

/** Normalize one fixed reviewed package scenario while retaining its outer tier binding. */
export function normalizePackagedVariant(contractId, variantId, proofMode) {
  if (variantId === undefined) return { outerVariantId: undefined, producerVariantId: undefined, tier: undefined }
  if (typeof variantId !== 'string' || variantId.length === 0) throw new Error('Packaged variant must be a nonempty reviewed identifier.')
  const allowed = REVIEWED_TIERED_SCENARIOS[contractId] ?? []
  const suffix = variantId.endsWith('-appimage')
    ? { text: '-appimage', tier: 'ci-appimage' }
    : variantId.endsWith('-installed')
      ? { text: '-installed', tier: 'installed-deb' }
      : null
  if (suffix === null) {
    if (allowed.length > 0 && !allowed.includes(variantId)) {
      throw new Error(`Packaged variant ${variantId} is not a fixed reviewed ${contractId} scenario.`)
    }
    return {
      outerVariantId: variantId,
      producerVariantId: PRODUCER_VARIANT_ALIASES[contractId]?.[variantId] ?? variantId,
      tier: undefined,
    }
  }
  if (proofMode !== undefined && proofMode !== suffix.tier) {
    throw new Error(`Packaged variant ${variantId} conflicts with proof tier ${proofMode}.`)
  }
  const rawProducerVariantId = variantId.slice(0, -suffix.text.length)
  if (!allowed.includes(rawProducerVariantId)) {
    throw new Error(`Packaged variant ${variantId} is not a fixed reviewed ${contractId} scenario.`)
  }
  const producerVariantId = PRODUCER_VARIANT_ALIASES[contractId]?.[rawProducerVariantId] ?? rawProducerVariantId
  return { outerVariantId: variantId, producerVariantId, tier: suffix.tier }
}

/** Compile only reviewed packaged producer interfaces; callers cannot supply commands or relax bounds. */
export function compilePackageCommand(contractId, context) {
  const producer = PRODUCERS[contractId]
  if (!producer) throw new Error('No reviewed packaged producer for this contract.')
  const normalizedVariant = normalizePackagedVariant(contractId, context.variantId, context.proofMode)
  const producerVariantId = normalizedVariant.producerVariantId
  const producerContext = { ...context, variantId: producerVariantId }
  for (const name of ['app', 'evidence']) {
    if (typeof context[name] !== 'string' || !path.isAbsolute(context[name])) throw new Error(`Package ${name} must be absolute.`)
  }
  if (!/^[a-f0-9]{40}$/u.test(context.sourceSha)) throw new Error('Package source SHA must be exact.')
  if (contractId === 'C10' && producerVariantId !== undefined
      && !Object.hasOwn(REPLAY_SCALE_PROFILES, producerVariantId)
      && !LEGACY_REPLAY_VARIANTS.has(producerVariantId)) {
    throw new Error('Replay probe requires a reviewed replay scale or known-at-time variant.')
  }
  if (contractId === 'C19' && (producerVariantId === undefined
      || (!LEGACY_DEFAULT_VARIANTS.has(producerVariantId)
        && producerVariantId !== LEGACY_SCHEMA_VARIANT
        && producerVariantId !== LEGACY_STARTUP_VARIANT))) {
    throw new Error('Legacy recovery requires one reviewed default-profile or schema-matrix variant.')
  }
  if (contractId === 'C02' && producerVariantId !== undefined
      && !C02_LIFECYCLE_VARIANTS.includes(producerVariantId)
      && !C02_LEGACY_VARIANTS.has(producerVariantId)) {
    throw new Error('C02 lifecycle requires one fixed reviewed lifecycle variant.')
  }
  if (contractId === 'C18' && producerVariantId !== undefined
      && !BACKUP_FAULT_VARIANTS.includes(producerVariantId)
      && !C18_LEGACY_VARIANTS.has(producerVariantId)) {
    throw new Error('C18 storage-fault routing requires one fixed reviewed backup variant.')
  }
  if (context.enospcMount !== undefined) {
    if (typeof context.enospcMount !== 'string' || !path.isAbsolute(context.enospcMount)) {
      throw new Error('ENOSPC mount must be an absolute path.')
    }
    const allowed = contractId === 'C01'
      || (contractId === 'C19' && producerVariantId === LEGACY_STARTUP_VARIANT)
      || (contractId === 'C18' && producerVariantId === 'disk-full')
    if (!allowed) throw new Error('ENOSPC mount is only allowed for C01, C19 startup, or C18 disk-full.')
  }
  let args
  if (contractId === 'C02' && C02_LIFECYCLE_VARIANTS.includes(producerVariantId)) {
    args = ['--app', context.app, '--evidence', context.evidence,
      '--expected-head', context.sourceSha, '--variant', producerVariantId]
  } else if (contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, producerVariantId)) {
    if (typeof context.fixture !== 'string' || !path.isAbsolute(context.fixture)) throw new Error('Replay scale probe requires an owned absolute fixture copy.')
    args = [context.app, context.evidence, context.fixture, producerVariantId]
  } else if (contractId === 'C19' && LEGACY_DEFAULT_VARIANTS.has(producerVariantId)) {
    args = [context.app, context.evidence, producerVariantId]
  } else if (contractId === 'C19' && producerVariantId === LEGACY_SCHEMA_VARIANT) {
    args = [context.app, context.evidence]
  } else if (contractId === 'C19' && producerVariantId === LEGACY_STARTUP_VARIANT) {
    if (!/^[a-f0-9]{64}$/u.test(context.appSha256 ?? '')) {
      throw new Error('Legacy startup boundary probe requires the exact launcher SHA-256.')
    }
    args = ['--app', context.app, '--evidence', context.evidence, '--expected-head', context.sourceSha,
      '--expected-app-sha256', context.appSha256]
    if (context.enospcMount !== undefined) args.push('--enospc-mount', context.enospcMount)
  } else if (['C05', 'C06', 'C09', 'C10', 'C13', 'C14', 'C19'].includes(contractId)) args = [context.app, context.evidence]
  else if (['C07', 'C08'].includes(contractId)) {
    if (typeof context.fixture !== 'string' || !path.isAbsolute(context.fixture)) throw new Error('Paging probe requires an owned absolute fixture copy.')
    if (!PAGING_VARIANTS.has(producerVariantId)) throw new Error('Paging probe requires one reviewed paging profile.')
    args = [context.app, context.evidence, context.fixture, contractId]
  }
  else if (contractId === 'C15' && producerVariantId === 'private-offline-map') {
    if (typeof context.privateMap !== 'string' || !path.isAbsolute(context.privateMap)) throw new Error('Private map requires an exact bound absolute input.')
    args = [context.app, context.evidence, context.privateMap]
  }
  else if (contractId === 'C15') args = ['--app', context.app, '--evidence-dir', context.evidence]
  else {
    args = ['--app', context.app, '--evidence', context.evidence]
    if (contractId === 'C18') {
      if (typeof context.fixture !== 'string' || !path.isAbsolute(context.fixture)) throw new Error('Crash probe requires an owned absolute fixture copy.')
      args.push('--fixture', context.fixture)
      if (BACKUP_FAULT_VARIANTS.includes(producerVariantId)) args.push('--variant', producerVariantId)
    }
    if (['C20', 'C22'].includes(contractId)) args.push('--expected-head', context.sourceSha, '--variant', 'field-archive-37gb')
    if (['C01', 'C03', 'C11', 'C12', 'C16', 'C17', 'C21', 'C23', 'C26', 'C28'].includes(contractId)) args.push('--expected-head', context.sourceSha)
    if (['C03', 'C11', 'C17'].includes(contractId)) {
      args.push('--variant', 'routine', '--family-contract', contractId)
    }
    if (contractId === 'C28') {
      if (typeof producerVariantId !== 'string' || !Object.hasOwn(C28_VARIANT_AXIS_MAP, producerVariantId)) {
        throw new Error('C28 packaged composite requires one fixed reviewed variant.')
      }
      args.push('--variant', producerVariantId)
    }
    if (contractId === 'C01') {
      if (!/^[a-f0-9]{64}$/u.test(context.appSha256 ?? '')) throw new Error('Startup admission requires the exact launcher SHA-256.')
      args.push('--expected-app-sha256', context.appSha256)
    }
    if (context.enospcMount !== undefined) args.push('--enospc-mount', context.enospcMount)
  }
  const replayScale = contractId === 'C10' && Object.hasOwn(REPLAY_SCALE_PROFILES, producerVariantId)
  const replayOuting = contractId === 'C10' && producerVariantId === REPLAY_OUTING_VARIANT
  return Object.freeze({
    script: contractId === 'C15' && producerVariantId === 'private-offline-map'
      ? 'scripts/qualification/private-map-probe.mjs'
      : replayScale
      ? 'scripts/qualification/replay-scale-probe.mjs'
      : replayOuting
        ? 'scripts/qualification/replay-outing-probe.mjs'
      : contractId === 'C02' && C02_LIFECYCLE_VARIANTS.includes(producerVariantId)
        ? 'scripts/qualification/c02-lifecycle-probe.mjs'
      : contractId === 'C19' && LEGACY_DEFAULT_VARIANTS.has(producerVariantId)
        ? 'scripts/qualification/legacy-default-probe.mjs'
      : contractId === 'C19' && producerVariantId === LEGACY_SCHEMA_VARIANT
          ? 'scripts/qualification/legacy-schema-probe.mjs'
          : contractId === 'C19' && producerVariantId === LEGACY_STARTUP_VARIANT
            ? 'scripts/qualification/startup-probe.mjs'
          : producer[0],
    args: Object.freeze(args),
    producerVariantId,
    report: contractId === 'C15' && producerVariantId === 'private-offline-map'
      ? 'private-map-report.json'
      : replayScale
      ? 'replay-scale-report.json'
      : replayOuting
        ? 'replay-outing-report.json'
      : contractId === 'C02' && C02_LIFECYCLE_VARIANTS.includes(producerVariantId)
        ? 'c02-lifecycle-report.json'
      : contractId === 'C18' && BACKUP_FAULT_VARIANTS.includes(producerVariantId)
        ? 'storage-backup-fault-matrix-report.json'
      : contractId === 'C19' && LEGACY_DEFAULT_VARIANTS.has(producerVariantId)
        ? 'legacy-default-report.json'
        : contractId === 'C19' && producerVariantId === LEGACY_SCHEMA_VARIANT
          ? 'legacy-schema-report.json'
          : contractId === 'C19' && producerVariantId === LEGACY_STARTUP_VARIANT
            ? 'receipt.json'
          : producer[1],
    timeoutMs: ['C20', 'C22'].includes(contractId) || replayScale
      || ['legacy-v11-local-1gib', 'legacy-v11-field-37gb'].includes(producerVariantId)
      ? 60 * 60 * 1000 : 15 * 60 * 1000,
    scope: 'bounded packaged probe; family coverage is evaluated separately' })
}
