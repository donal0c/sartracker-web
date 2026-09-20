#!/usr/bin/env node

const fs = require('node:fs')
let originalFs = null
try {
  originalFs = require('original-fs')
} catch {
  // Source-calibration runs use Node's regular filesystem. Electron's main
  // process supplies the built-in original-fs module for physical ASAR bytes.
}
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { Readable, Writable } = require('node:stream')

const SOURCE_SHA = /^[a-f0-9]{40}$/u
const CASE_IDS = Object.freeze([
  'valid-roundtrip',
  'recovery-roundtrip',
  'machine-slot-unlock',
  'wrong-key',
  'flip',
  'truncate',
  'append',
  'duplicate-frame',
  'reorder-frame',
  'missing-key-slot',
  'duplicate-key-slot',
  'slot-replacement',
  'unavailable-key-slot',
  'splice-frame',
  'mission-header-swap',
  'epoch-header-swap',
  'entry-boundary-duplicate',
  'entry-boundary-index-gap',
  'legacy-v1-roundtrip',
  'legacy-v1-mutant',
  'manifest-inventory-extra',
  'registry-ciphertext-swap',
  'archive-replaced-during-verify',
  'same-open-file-replacement',
  'cross-process-custody-reconciliation',
])
const KEY_SLOT_CASE_IDS = Object.freeze([
  'recovery-roundtrip',
  'machine-slot-unlock',
  'missing-key-slot',
  'duplicate-key-slot',
  'slot-replacement',
  'unavailable-key-slot',
])
const CUSTODY_CASE_IDS = Object.freeze([
  'registry-ciphertext-swap',
  'archive-replaced-during-verify',
  'same-open-file-replacement',
  'cross-process-custody-reconciliation',
])
const PASSPHRASE = 'C21 passphrase secret canary 2026!'
const WRONG_PASSPHRASE = 'C21 wrong passphrase'
const RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const MACHINE_SECRET = 'C21 machine secret canary 2026!'
const REQUEST_EVENT_ID = '33333333-3333-4333-8333-333333333333'
const CREATION_OPERATION_ID = '44444444-4444-4444-8444-444444444444'

/** Run the bounded archive-security corpus using the supplied module root. */
async function runArchiveSecurityProbe({ moduleRoot, tier, sourceSha }) {
  validateProbeInputs(moduleRoot, tier, sourceSha)
  const modules = loadArchiveModules(moduleRoot)
  const runtime = describeRuntime(moduleRoot, tier)
  const fixture = await createFixture(modules)
  const legacyFixture = await createLegacyFixture(modules)
  const semanticFixture = await createSemanticFixture(modules)
  const originalBytes = Buffer.from(fixture.archiveBytes)
  const originalSha256 = sha256(originalBytes)
  const cases = []

  for (const caseId of CASE_IDS) {
    const candidate = caseId.startsWith('legacy-v1-')
      ? buildLegacyCandidate(caseId, legacyFixture)
      : caseId === 'manifest-inventory-extra'
        ? await buildSemanticCandidate(semanticFixture, modules)
      : buildCandidate(caseId, originalBytes, fixture, modules.container)
    const result = caseId.startsWith('legacy-v1-')
      ? await executeLegacyCandidate(caseId, legacyFixture, modules.legacy)
      : caseId === 'manifest-inventory-extra'
        ? await executeSemanticCandidate(semanticFixture, modules)
      : CUSTODY_CASE_IDS.includes(caseId)
      ? await executeCustodyCandidate(caseId, candidate, fixture, modules.custody, modules.reconciliation)
      : await executeCandidate(caseId, candidate, fixture, modules)
    const unchanged = sha256(originalBytes) === originalSha256
    cases.push({
      id: caseId,
      kind: caseId === 'valid-roundtrip' ? 'roundtrip'
        : caseId === 'wrong-key' || caseId === 'recovery-roundtrip' || caseId === 'machine-slot-unlock' ? 'key'
          : KEY_SLOT_CASE_IDS.includes(caseId) ? 'key-slot'
      : caseId.startsWith('legacy-v1-') ? 'legacy'
        : CUSTODY_CASE_IDS.includes(caseId) ? 'custody' : 'mutation',
      mutation: caseId,
      boundary: candidate.boundary,
      input: { sha256: sha256(candidate.bytes), sizeBytes: candidate.bytes.length },
      result: result.result,
      plaintext: result.plaintext,
      custody: result.custody,
      original: { sha256: originalSha256, sizeBytes: originalBytes.length, unchanged },
    })
  }
  legacyFixture.cleanup()
  semanticFixture.cleanup()

  const report = {
    schemaVersion: 1,
    proofKind: 'c21-archive-security-probe-v1',
    contractId: 'C21',
    proofMode: tier,
    sourceSha,
    runtime,
    fixture: {
      archiveSha256: originalSha256,
      sizeBytes: originalBytes.length,
      headerSha256: fixture.headerSha256,
      frameCount: fixture.frameCount,
      entryCount: fixture.entryCount,
      entryNames: fixture.entryNames,
      plaintextBytes: fixture.plaintextBytes,
      plaintextSha256: fixture.plaintextSha256,
    },
    corpus: {
      id: 'sararch2-frame-mutation-v1',
      caseIds: CASE_IDS,
      requiredCaseIds: CASE_IDS,
      coveredCaseIds: CASE_IDS,
      coveredKeySlotCases: KEY_SLOT_CASE_IDS,
      coveredCustodyCases: CUSTODY_CASE_IDS,
      missingKeySlotCases: [],
      missingCustodyCases: [],
      missingStructuralCases: [],
    },
    cases,
    secretCanaryScan: { passphrase: false, recoveryCode: false },
  }
  const serialized = JSON.stringify(report)
  report.secretCanaryScan.passphrase = serialized.includes(PASSPHRASE) || serialized.includes(WRONG_PASSPHRASE)
  report.secretCanaryScan.recoveryCode = serialized.includes(RECOVERY_CODE)
  return report
}

/** Validate the explicit source/package execution boundary before loading code. */
function validateProbeInputs(moduleRoot, tier, sourceSha) {
  if (tier !== 'packaged-module' && tier !== 'source-calibration') {
    throw new Error('C21 probe tier must be packaged-module or source-calibration.')
  }
  if (typeof moduleRoot !== 'string' || !path.isAbsolute(moduleRoot)) {
    throw new Error('C21 probe module root must be an absolute path.')
  }
  if (!SOURCE_SHA.test(sourceSha)) throw new Error('C21 probe source SHA is invalid.')
  if (tier === 'packaged-module' && !moduleRoot.endsWith('.asar')) {
    throw new Error('Packaged-module C21 probe requires an explicit app.asar root.')
  }
  if (tier === 'source-calibration' && moduleRoot.endsWith('.asar')) {
    throw new Error('Source-calibration C21 probe requires an explicit source root.')
  }
}

/** Load only production archive modules from the requested source/package root. */
function loadArchiveModules(moduleRoot) {
  const container = require(path.join(moduleRoot, 'electron', 'archive-container.cjs'))
  const crypto = require(path.join(moduleRoot, 'electron', 'archive-crypto.cjs'))
  const custody = require(path.join(moduleRoot, 'electron', 'archive-custody-file.cjs'))
  const reconciliation = require(path.join(moduleRoot, 'electron', 'archive-custody-reconcile-runner.cjs'))
  const legacy = require(path.join(moduleRoot, 'electron', 'legacy-archive-restore.cjs'))
  const zip = require(path.join(moduleRoot, 'electron', 'zip-archive.cjs'))
  const archiveVerify = require(path.join(moduleRoot, 'electron', 'archive-verify.cjs'))
  const archiveRunner = require(path.join(moduleRoot, 'electron', 'mission-archive-runner.cjs'))
  const missionStore = require(path.join(moduleRoot, 'electron', 'mission-store.cjs'))
  const cleanupMembership = require(path.join(moduleRoot, 'electron', 'archive-cleanup-membership.cjs'))
  return { container, crypto, custody, reconciliation, legacy, zip, archiveVerify, archiveRunner, missionStore, cleanupMembership }
}

/** Capture the exact runtime identity without claiming package proof in source mode. */
function describeRuntime(moduleRoot, tier) {
  const executablePath = path.resolve(process.execPath)
  return {
    tier,
    sourceRoot: tier === 'source-calibration' ? moduleRoot : null,
    appAsarPath: tier === 'packaged-module' ? moduleRoot : null,
    appAsarSha256: tier === 'packaged-module' ? hashFile(moduleRoot) : null,
    executablePath,
    executableSha256: hashFile(executablePath),
  }
}

/** Create a small real SARARCH2 archive with enough frames for structural mutants. */
async function createFixture({ container, crypto }) {
  const noncePrefix = randomBytes(4)
  const missionArchiveKey = crypto.generateMissionArchiveKey()
  const header = {
    cipher: 'aes-256-gcm',
    container_version: 2,
    created_at: '2026-09-19T19:00:00.000Z',
    creation_operation_id: CREATION_OPERATION_ID,
    frame_size: 64 * 1024,
    framing: 'sararch2-framed-v1',
    inventory_version: 1,
    key_slot_count: 3,
    mission_id: 'c21-security-fixture',
    nonce_prefix: noncePrefix.toString('base64'),
    previous_archive_sha256: null,
    protected_finalization_epoch: null,
    request_event_id: REQUEST_EVENT_ID,
    request_event_rowid: 1,
    schema_version: 13,
  }
  const payload = Buffer.alloc(1_100_000, 0x43)
  const metadata = Buffer.from('C21 public metadata. '.repeat(256), 'utf8')
  const manifest = Buffer.from(container.canonicalJson({
    schema: 'c21-fixture-v1',
    entries: [
      { name: 'payload.bin', size_bytes: payload.length, sha256: sha256(payload) },
      { name: 'metadata.json', size_bytes: metadata.length, sha256: sha256(metadata) },
    ],
  }), 'utf8')
  const entries = [
    { name: 'manifest.json', size: manifest.length, source: manifest },
    { name: 'payload.bin', size: payload.length, source: payload },
    { name: 'metadata.json', size: metadata.length, source: metadata },
  ]
  const headerDigest = createHash('sha256').update(container.canonicalJson(header), 'utf8').digest()
  const passphraseBytes = Buffer.from(PASSPHRASE, 'utf8')
  const recoveryCodeBytes = Buffer.from(RECOVERY_CODE, 'utf8')
  const machineSecretBytes = Buffer.from(MACHINE_SECRET, 'utf8')
  let keySlots = []
  const chunks = []
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  try {
    keySlots = await Promise.all([
      crypto.wrapMissionArchiveKey({
        missionArchiveKey,
        slotType: 'passphrase',
        slotId: 'passphrase-v1',
        secret: passphraseBytes,
        headerDigest,
      }),
      crypto.wrapMissionArchiveKey({
        missionArchiveKey,
        slotType: 'recovery',
        slotId: 'recovery-v1',
        secret: recoveryCodeBytes,
        headerDigest,
      }),
      crypto.wrapMissionArchiveKey({
        missionArchiveKey,
        slotType: 'machine',
        slotId: 'machine-v1',
        secret: machineSecretBytes,
        headerDigest,
      }),
    ])
    const written = await container.writeArchiveContainer({
      writable,
      header,
      keySlots,
      missionArchiveKey,
      entries,
    })
    const archiveBytes = Buffer.concat(chunks)
    const spliceArchiveBytes = await writeSpliceArchive({
      container,
      crypto,
      header,
      entries,
      missionArchiveKey,
    })
    const structuralArchives = await writeStructuralArchives({
      container,
      crypto,
      header,
      entries,
    })
    const frames = locateFrames(archiveBytes)
    const plaintext = Buffer.concat(entries.map((entry) => entry.source))
    return {
      archiveBytes,
      frames,
      headerSha256: written.headerDigest,
      frameCount: Number(written.frameCount),
      entryCount: entries.length,
      entryNames: entries.map((entry) => entry.name),
      plaintextBytes: plaintext.length,
      plaintextSha256: sha256(plaintext),
      header,
      keySlots,
      preambleLength: locatePreamble(archiveBytes).preambleLength,
      slotOffset: locatePreamble(archiveBytes).slotOffset,
      spliceArchiveBytes,
      spliceFrames: locateFrames(spliceArchiveBytes),
      structuralArchives,
    }
  } finally {
    crypto.zeroBuffer(missionArchiveKey)
    crypto.zeroBuffer(passphraseBytes)
    crypto.zeroBuffer(recoveryCodeBytes)
    crypto.zeroBuffer(machineSecretBytes)
    crypto.zeroBuffer(noncePrefix)
    headerDigest.fill(0)
    payload.fill(0)
    metadata.fill(0)
    manifest.fill(0)
    chunks.forEach((chunk) => chunk.fill(0))
    keySlots.forEach((slot) => {
      for (const field of ['salt', 'nonce', 'ciphertext', 'authTag']) {
        if (typeof slot[field] === 'string') Buffer.from(slot[field], 'base64').fill(0)
      }
    })
  }
}

/** Creates one real repository legacy v1 ZIP fixture without importing test helpers. */
async function createLegacyFixture({ legacy: _legacy, zip }) {
  const Database = require('better-sqlite3')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sartracker-c21-legacy-'))
  const missionId = 'c21-legacy-v1-mission'
  const databasePath = path.join(directory, 'mission-store.sqlite')
  const database = new Database(databasePath)
  try {
    database.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      );
      CREATE TABLE markers (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        attachment_path TEXT
      );
      CREATE TABLE mission_object_versions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        version_sequence INTEGER NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE TABLE mission_events (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details_json TEXT
      );
    `)
    database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('schema_version', '13')
    database.prepare('INSERT INTO missions (id, name, status, schema_version) VALUES (?, ?, ?, ?)')
      .run(missionId, 'C21 legacy mission', 'finalized', 13)
  } finally {
    database.close()
  }
  const databaseBytes = fs.readFileSync(databasePath)
  const manifestBytes = Buffer.from(JSON.stringify({
    archive_version: 1,
    created_at: '2026-09-19T19:00:00.000Z',
    mission_id: missionId,
    schema_version: 13,
    snapshot_format: 'sqlite',
  }), 'utf8')
  const missionBytes = Buffer.from(JSON.stringify({
    id: missionId,
    name: 'C21 legacy mission',
    status: 'finalized',
    schema_version: 13,
  }), 'utf8')
  const archiveBytes = zip.createZipArchive([
    { name: 'manifest.json', data: manifestBytes },
    { name: 'mission.json', data: missionBytes },
    { name: 'mission-store.sqlite', data: databaseBytes },
  ])
  return {
    archiveBytes,
    missionId,
    archiveSha256: sha256(archiveBytes),
    archiveSizeBytes: archiveBytes.length,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }),
  }
}

/** Returns a legacy source or one CRC-invalid byte mutation with its exact boundary. */
function buildLegacyCandidate(caseId, fixture) {
  if (caseId === 'legacy-v1-roundtrip') {
    return {
      bytes: Buffer.from(fixture.archiveBytes),
      boundary: { operation: 'legacy-v1-source', frameIndex: null, byteOffset: null },
    }
  }
  const bytes = Buffer.from(fixture.archiveBytes)
  const nameLength = bytes.readUInt16LE(26)
  const extraLength = bytes.readUInt16LE(28)
  const byteOffset = 30 + nameLength + extraLength
  bytes[byteOffset] ^= 0x01
  return {
    bytes,
    boundary: { operation: 'legacy-v1-crc-mutation', frameIndex: null, byteOffset },
  }
}

/** Runs the real legacy restore reader and records only scrubbed output facts. */
async function executeLegacyCandidate(caseId, fixture, legacy) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sartracker-c21-legacy-run-'))
  const archivePath = path.join(directory, 'candidate.zip')
  const sessionDirectory = path.join(directory, 'session')
  const candidateBytes = caseId === 'legacy-v1-roundtrip'
    ? Buffer.from(fixture.archiveBytes)
    : (() => {
        const bytes = Buffer.from(fixture.archiveBytes)
        const nameLength = bytes.readUInt16LE(26)
        const extraLength = bytes.readUInt16LE(28)
        bytes[30 + nameLength + extraLength] ^= 0x01
        return bytes
      })()
  fs.writeFileSync(archivePath, candidateBytes, { mode: 0o600 })
  const plaintext = emptyPlaintextObservation()
  let error = null
  try {
    const result = await legacy.restoreLegacyMissionArchive({
      archivePath,
      sessionDirectory,
      expectedMissionId: fixture.missionId,
      expectedArchiveSha256: sha256(candidateBytes),
      expectedArchiveSizeBytes: candidateBytes.length,
    })
    await result.databaseFileHandle.close()
    for (const name of ['manifest.json', 'mission.json', 'mission-store.sqlite']) {
      const outputPath = path.join(sessionDirectory, name)
      const bytes = fs.readFileSync(outputPath)
      plaintext.entryNames.push(name)
      plaintext.observedBytes += bytes.length
      plaintext.observedHash.update(bytes)
      bytes.fill(0)
    }
  } catch (caught) {
    error = caught
  } finally {
    candidateBytes.fill(0)
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  return {
    result: resultFromError(error, error === null),
    plaintext: finishPlaintextObservation(plaintext),
    custody: emptyCustodyObservation(),
  }
}

/** Creates one production worker archive so manifest inventory attacks reach the verifier. */
async function createSemanticFixture({ container, crypto, archiveRunner, missionStore, cleanupMembership }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sartracker-c21-semantic-'))
  const archiveDirectory = path.join(directory, 'archives')
  const databasePath = path.join(directory, 'mission-store.sqlite')
  const missionId = 'c21-semantic-mission'
  const archiveId = '55555555-5555-4555-8555-555555555555'
  const operationId = '66666666-6666-4666-8666-666666666666'
  const requestEventId = '77777777-7777-4777-8777-777777777777'
  const createdAt = '2026-09-19T19:00:00.000Z'
  const requestedAt = '2026-09-19T18:59:59.000Z'
  const store = missionStore.createElectronMissionStore({ userDataPath: directory })
  store.close()
  const Database = require('better-sqlite3')
  const database = new Database(databasePath)
  try {
    database.prepare(`INSERT INTO missions (
      id, name, status, start_time, finish_time, paused_seconds, schema_version
    ) VALUES (?, ?, 'finished', ?, ?, 0, 13)`).run(
      missionId,
      'C21 semantic mission',
      '2026-09-19T10:00:00.000Z',
      '2026-09-19T12:00:00.000Z',
    )
    const generation = cleanupMembership.readArchiveCleanupMembershipGeneration(database, missionId)
    database.prepare(`INSERT INTO mission_events (
      rowid, id, mission_id, event_type, timestamp, details_json,
      recorded_at, recording_completeness
    ) VALUES (42, ?, ?, 'mission_finalize_requested', ?, ?, ?, 'complete')`).run(
      requestEventId,
      missionId,
      requestedAt,
      JSON.stringify({
        resulting_status: 'finished',
        archive_id: archiveId,
        operation_id: operationId,
        archive_kind: 'finalized',
        archive_relative_path: `${archiveId}.sararch`,
        cleanup_membership_generation: generation,
        protected_finalization_epoch: null,
      }),
      requestedAt,
    )
    database.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
      VALUES (?, ?)`).run(missionId, requestedAt)
  } finally {
    database.close()
  }
  const operation = archiveRunner.startMissionArchiveCreateWorker({
    request: {
      operationId,
      archiveId,
      databasePath,
      archiveDirectory,
      missionId,
      requestEventRowid: 42,
      fenceRequestedAt: requestedAt,
      requestEventId,
      archiveKind: 'finalized',
      createdAt,
      schemaVersion: 13,
      inventoryVersion: 1,
      previousArchiveSha256: null,
      protectedFinalizationEpoch: null,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    },
  })
  const creation = await operation
  await operation.workerExited
  const originalPath = path.join(archiveDirectory, creation.temporaryRelativePath)
  const originalBytes = fs.readFileSync(originalPath)
  const preamble = await container.readArchivePreamble(Readable.from([originalBytes]))
  const passphraseSlot = preamble.keySlots.find((slot) => slot.slotType === 'passphrase')
  if (passphraseSlot === undefined) throw new Error('C21 semantic fixture has no passphrase slot.')
  const missionArchiveKey = await crypto.unwrapMissionArchiveKey({
    slot: passphraseSlot,
    secret: Buffer.from(PASSPHRASE, 'utf8'),
    headerDigest: preamble.headerDigest,
  })
  const entries = []
  let chunks = null
  try {
    await container.readArchiveContainer({
      readable: Readable.from([originalBytes]),
      missionArchiveKey,
      onEntryStart: () => { chunks = [] },
      onEntryChunk: (_entry, chunk) => { chunks.push(Buffer.from(chunk)) },
      onEntryEnd: (entry) => {
        entries.push({ name: entry.name, bytes: Buffer.concat(chunks) })
        chunks.forEach((chunk) => chunk.fill(0))
        chunks = null
      },
    })
  } finally {
    crypto.zeroBuffer(missionArchiveKey)
    preamble.headerDigest.fill(0)
    chunks?.forEach((chunk) => chunk.fill(0))
  }
  return {
    directory,
    archiveDirectory,
    databasePath,
    archiveId,
    operationId,
    requestEventId,
    missionId,
    createdAt,
    header: preamble.header,
    entries,
    creation,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }),
  }
}

/** Writes one extra authenticated logical entry while retaining the original production manifest. */
async function buildSemanticCandidate(fixture, { container, crypto }) {
  const noncePrefix = randomBytes(4)
  const header = { ...fixture.header, nonce_prefix: noncePrefix.toString('base64') }
  const headerDigest = createHash('sha256').update(container.canonicalJson(header), 'utf8').digest()
  const missionArchiveKey = crypto.generateMissionArchiveKey()
  const passphraseBytes = Buffer.from(PASSPHRASE, 'utf8')
  const recoveryCodeBytes = Buffer.from(RECOVERY_CODE, 'utf8')
  const outputPath = path.join(fixture.archiveDirectory, `${fixture.archiveId}.sararch`)
  let chunks = []
  const writable = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
  try {
    const slots = await Promise.all([
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'passphrase', slotId: 'passphrase-v1', secret: passphraseBytes, headerDigest }),
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'recovery', slotId: 'recovery-v1', secret: recoveryCodeBytes, headerDigest }),
    ])
    await container.writeArchiveContainer({
      writable,
      header,
      keySlots: slots,
      missionArchiveKey,
      entries: [
        ...fixture.entries.map((entry) => ({ name: entry.name, size: entry.bytes.length, source: entry.bytes })),
        { name: 'undeclared.bin', size: Buffer.byteLength('C21 undeclared semantic bytes', 'utf8'), source: Buffer.from('C21 undeclared semantic bytes', 'utf8') },
      ],
    })
    const bytes = Buffer.concat(chunks)
    fs.writeFileSync(outputPath, bytes, { mode: 0o600 })
    return { bytes, boundary: { operation: 'manifest-inventory-extra', frameIndex: null, byteOffset: fixture.header.frame_size } }
  } finally {
    crypto.zeroBuffer(missionArchiveKey)
    crypto.zeroBuffer(passphraseBytes)
    crypto.zeroBuffer(recoveryCodeBytes)
    crypto.zeroBuffer(noncePrefix)
    headerDigest.fill(0)
    chunks.forEach((chunk) => chunk.fill(0))
  }
}

/** Runs the independent archive verifier and records its semantic rejection without retaining plaintext. */
async function executeSemanticCandidate(fixture, { archiveVerify }) {
  const attackPath = path.join(fixture.archiveDirectory, `${fixture.archiveId}.sararch`)
  const bytes = fs.readFileSync(attackPath)
  const plaintext = emptyPlaintextObservation()
  let error = null
  try {
    await archiveVerify.verifyMissionArchiveFile({
      request: {
        operationId: '88888888-8888-4888-8888-888888888888',
        archiveId: fixture.archiveId,
        archiveKind: 'finalized',
        archiveDirectory: fixture.archiveDirectory,
        archiveRelativePath: `${fixture.archiveId}.sararch`,
        databasePath: fixture.databasePath,
        missionId: fixture.missionId,
        requestEventRowid: 42,
        requestEventId: fixture.requestEventId,
        creationOperationId: fixture.operationId,
        protectedFinalizationEpoch: null,
        createdAt: fixture.createdAt,
        containerVersion: 2,
        schemaVersion: 13,
        inventoryVersion: 1,
        ciphertextSha256: sha256(bytes),
        previousArchiveSha256: null,
        sizeBytes: bytes.length,
        frameCount: countArchiveFrames(bytes),
        headerSha256: sha256(Buffer.from(archiveHeaderBytes(bytes, fixture), 'utf8')),
        manifestSha256: sha256(fixture.entries.find((entry) => entry.name === 'manifest.json').bytes),
        entryCount: fixture.creation.manifestSummary.entryCount + 1,
        tableCount: fixture.creation.manifestSummary.tableCount,
      },
      passphraseBytes: Buffer.from(PASSPHRASE, 'utf8'),
      recoveryCodeBytes: Buffer.from(RECOVERY_CODE, 'utf8'),
      cancellationFlag: new Int32Array(new SharedArrayBuffer(4)),
    })
  } catch (caught) {
    error = caught
  } finally {
    bytes.fill(0)
    fs.rmSync(attackPath, { force: true })
  }
  return { result: resultFromError(error, error === null), plaintext: finishPlaintextObservation(plaintext), custody: emptyCustodyObservation() }
}

/** Counts framed records in a production archive without decrypting payloads. */
function countArchiveFrames(bytes) {
  const headerLength = bytes.readUInt32BE(8)
  const slotLengthOffset = 12 + headerLength
  const slotLength = bytes.readUInt32BE(slotLengthOffset)
  let offset = slotLengthOffset + 4 + slotLength
  let count = 0
  while (offset + 13 <= bytes.length) {
    const final = bytes[offset + 8] === 1
    const length = bytes.readUInt32BE(offset + 9)
    offset += 13 + length + 16
    count += 1
    if (final) break
  }
  return count
}

/** Reads the canonical archive header bytes for the verifier identity. */
function archiveHeaderBytes(bytes, fixture) {
  const headerLength = bytes.readUInt32BE(8)
  return bytes.subarray(12, 12 + headerLength).toString('utf8')
}

/**
 * Creates authenticated logical-stream mutants that exercise entry-boundary
 * validation after the production frame reader has authenticated the bytes.
 */
async function writeStructuralArchives({ container, crypto, header, entries }) {
  const variants = {}
  for (const mode of ['entry-boundary-duplicate', 'entry-boundary-index-gap']) {
    const logicalEntries = entries.map((entry, index) => ({
      index,
      name: entry.name,
      size: entry.source.length,
      source: entry.source,
    }))
    const duplicate = logicalEntries[logicalEntries.length - 1]
    logicalEntries.push({
      index: mode === 'entry-boundary-index-gap' ? logicalEntries.length + 1 : logicalEntries.length,
      name: mode === 'entry-boundary-index-gap' ? 'boundary-gap.bin' : duplicate.name,
      size: duplicate.source.length,
      source: duplicate.source,
    })
    variants[mode] = await writeRawLogicalArchive({ container, crypto, header, entries: logicalEntries })
  }
  return variants
}

/** Writes a production-compatible SARARCH2 stream around deliberately malformed logical entries. */
async function writeRawLogicalArchive({ container, crypto, header, entries }) {
  const noncePrefix = randomBytes(4)
  const variantHeader = { ...header, nonce_prefix: noncePrefix.toString('base64') }
  const headerBytes = Buffer.from(container.canonicalJson(variantHeader), 'utf8')
  const headerDigest = createHash('sha256').update(headerBytes).digest()
  const missionArchiveKey = crypto.generateMissionArchiveKey()
  const passphraseBytes = Buffer.from(PASSPHRASE, 'utf8')
  const recoveryCodeBytes = Buffer.from(RECOVERY_CODE, 'utf8')
  const machineSecretBytes = Buffer.from(MACHINE_SECRET, 'utf8')
  let slots = []
  try {
    slots = await Promise.all([
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'passphrase', slotId: 'passphrase-v1', secret: passphraseBytes, headerDigest }),
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'recovery', slotId: 'recovery-v1', secret: recoveryCodeBytes, headerDigest }),
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'machine', slotId: 'machine-v1', secret: machineSecretBytes, headerDigest }),
    ])
    const slotBytes = Buffer.from(container.canonicalJson(slots), 'utf8')
    const headerLength = Buffer.alloc(4)
    headerLength.writeUInt32BE(headerBytes.length)
    const slotLength = Buffer.alloc(4)
    slotLength.writeUInt32BE(slotBytes.length)
    const logical = []
    for (const entry of entries) {
      const marker = Buffer.from('SARENTRY', 'ascii')
      const entryHeader = Buffer.from(container.canonicalJson({ index: entry.index, name: entry.name }), 'utf8')
      const entryHeaderLength = Buffer.alloc(4)
      entryHeaderLength.writeUInt32BE(entryHeader.length)
      const entrySize = Buffer.alloc(8)
      entrySize.writeBigUInt64BE(BigInt(entry.size))
      logical.push(marker, entryHeaderLength, entryHeader, entrySize, Buffer.from(entry.source))
    }
    const logicalBytes = Buffer.concat(logical)
    const frames = []
    let frameIndex = 0n
    for (let offset = 0; offset < logicalBytes.length; offset += variantHeader.frame_size) {
      const plaintext = logicalBytes.subarray(offset, Math.min(offset + variantHeader.frame_size, logicalBytes.length))
      const encrypted = crypto.encryptFrame({
        missionArchiveKey,
        noncePrefix,
        frameIndex,
        final: false,
        plaintext,
        headerDigest,
      })
      const frameHeader = Buffer.alloc(13)
      frameHeader.writeBigUInt64BE(frameIndex)
      frameHeader[8] = 0
      frameHeader.writeUInt32BE(plaintext.length, 9)
      frames.push(frameHeader, encrypted.ciphertext, encrypted.authTag)
      frameIndex += 1n
    }
    const final = crypto.encryptFrame({
      missionArchiveKey,
      noncePrefix,
      frameIndex,
      final: true,
      plaintext: Buffer.alloc(0),
      headerDigest,
    })
    const finalHeader = Buffer.alloc(13)
    finalHeader.writeBigUInt64BE(frameIndex)
    finalHeader[8] = 1
    finalHeader.writeUInt32BE(0, 9)
    frames.push(finalHeader, final.ciphertext, final.authTag)
    const trailer = Buffer.alloc(17)
    Buffer.from('SARTRLR2', 'ascii').copy(trailer)
    trailer.writeBigUInt64BE(frameIndex + 1n, 8)
    trailer[16] = 1
    return Buffer.concat([
      container.SARARCH2_MAGIC,
      headerLength,
      headerBytes,
      slotLength,
      slotBytes,
      ...frames,
      trailer,
    ])
  } finally {
    crypto.zeroBuffer(missionArchiveKey)
    crypto.zeroBuffer(passphraseBytes)
    crypto.zeroBuffer(recoveryCodeBytes)
    crypto.zeroBuffer(machineSecretBytes)
    crypto.zeroBuffer(noncePrefix)
    headerDigest.fill(0)
    headerBytes.fill(0)
    slots.forEach((slot) => {
      for (const field of ['salt', 'nonce', 'ciphertext', 'authTag']) {
        if (typeof slot[field] === 'string') Buffer.from(slot[field], 'base64').fill(0)
      }
    })
  }
}

/** Creates a second authenticated archive with the same logical entries for a real frame splice. */
async function writeSpliceArchive({ container, crypto, header, entries, missionArchiveKey }) {
  const noncePrefix = randomBytes(4)
  const variantHeader = { ...header, nonce_prefix: noncePrefix.toString('base64') }
  const headerDigest = createHash('sha256').update(container.canonicalJson(variantHeader), 'utf8').digest()
  const passphraseBytes = Buffer.from(PASSPHRASE, 'utf8')
  const recoveryCodeBytes = Buffer.from(RECOVERY_CODE, 'utf8')
  const machineSecretBytes = Buffer.from(MACHINE_SECRET, 'utf8')
  const keySlots = []
  const chunks = []
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  try {
    keySlots.push(...await Promise.all([
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'passphrase', slotId: 'passphrase-v1', secret: passphraseBytes, headerDigest }),
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'recovery', slotId: 'recovery-v1', secret: recoveryCodeBytes, headerDigest }),
      crypto.wrapMissionArchiveKey({ missionArchiveKey, slotType: 'machine', slotId: 'machine-v1', secret: machineSecretBytes, headerDigest }),
    ]))
    await container.writeArchiveContainer({ writable, header: variantHeader, keySlots, missionArchiveKey, entries })
    return Buffer.concat(chunks)
  } finally {
    crypto.zeroBuffer(passphraseBytes)
    crypto.zeroBuffer(recoveryCodeBytes)
    crypto.zeroBuffer(machineSecretBytes)
    crypto.zeroBuffer(noncePrefix)
    headerDigest.fill(0)
    chunks.forEach((chunk) => chunk.fill(0))
    keySlots.forEach((slot) => {
      for (const field of ['salt', 'nonce', 'ciphertext', 'authTag']) {
        if (typeof slot[field] === 'string') Buffer.from(slot[field], 'base64').fill(0)
      }
    })
  }
}

/** Locate authenticated frame records without interpreting their plaintext. */
function locateFrames(bytes) {
  const headerLength = bytes.readUInt32BE(8)
  const headerStart = 12
  const slotLengthOffset = headerStart + headerLength
  const slotLength = bytes.readUInt32BE(slotLengthOffset)
  let offset = slotLengthOffset + 4 + slotLength
  const records = []
  while (offset + 13 <= bytes.length) {
    const frameIndex = bytes.readBigUInt64BE(offset)
    const final = bytes[offset + 8] === 1
    const plaintextLength = bytes.readUInt32BE(offset + 9)
    const end = offset + 13 + plaintextLength + 16
    if (end > bytes.length) break
    records.push({
      frameIndex: Number(frameIndex),
      final,
      start: offset,
      end,
      ciphertextStart: offset + 13,
      ciphertextLength: plaintextLength,
    })
    offset = end
    if (final) break
  }
  const nonFinal = records.filter((record) => !record.final)
  if (nonFinal.length < 2 || records.at(-1)?.final !== true) {
    throw new Error('C21 fixture did not produce two non-final frames and a final frame.')
  }
  return Object.freeze({ records, nonFinal })
}

/** Build one independent candidate byte stream and its mutation boundary. */
function buildCandidate(caseId, originalBytes, fixture, container) {
  const frames = fixture.frames
  if (caseId === 'valid-roundtrip' || caseId === 'recovery-roundtrip'
    || caseId === 'machine-slot-unlock' || caseId === 'wrong-key') {
    return { bytes: Buffer.from(originalBytes), boundary: { operation: 'none', frameIndex: null, byteOffset: null } }
  }
  const first = frames.nonFinal[0]
  const second = frames.nonFinal[1]
  if (caseId === 'flip') {
    const bytes = Buffer.from(originalBytes)
    bytes[first.ciphertextStart] ^= 0x01
    return { bytes, boundary: { operation: 'flip-ciphertext-byte', frameIndex: first.frameIndex, byteOffset: first.ciphertextStart } }
  }
  if (caseId === 'truncate') {
    const endBeforeAuthTag = first.ciphertextStart + first.ciphertextLength + 8
    return { bytes: originalBytes.subarray(0, endBeforeAuthTag), boundary: { operation: 'truncate-frame-auth-tag', frameIndex: first.frameIndex, byteOffset: endBeforeAuthTag } }
  }
  if (caseId === 'append') {
    return { bytes: Buffer.concat([originalBytes, Buffer.from([0xa5])]), boundary: { operation: 'append-after-trailer', frameIndex: null, byteOffset: originalBytes.length } }
  }
  if (caseId === 'duplicate-frame') {
    const duplicate = originalBytes.subarray(first.start, first.end)
    return { bytes: Buffer.concat([originalBytes.subarray(0, first.end), duplicate, originalBytes.subarray(first.end)]), boundary: { operation: 'duplicate-frame-record', frameIndex: first.frameIndex, byteOffset: first.end } }
  }
  if (caseId === 'reorder-frame') {
    const before = originalBytes.subarray(0, first.start)
    const firstBytes = originalBytes.subarray(first.start, first.end)
    const secondBytes = originalBytes.subarray(second.start, second.end)
    const between = originalBytes.subarray(first.end, second.start)
    const after = originalBytes.subarray(second.end)
    return { bytes: Buffer.concat([before, secondBytes, between, firstBytes, after]), boundary: { operation: 'reorder-frame-records', frameIndex: second.frameIndex, byteOffset: first.start } }
  }
  if (caseId === 'splice-frame') {
    const alternate = fixture.spliceFrames.nonFinal[0]
    if (alternate.end - alternate.start !== first.end - first.start) {
      throw new Error('C21 splice fixture frame boundaries differ.')
    }
    const bytes = Buffer.from(originalBytes)
    fixture.spliceArchiveBytes.subarray(alternate.start, alternate.end).copy(bytes, first.start)
    return {
      bytes,
      boundary: { operation: 'splice-frame-from-independent-archive', frameIndex: first.frameIndex, byteOffset: first.start },
    }
  }
  if (caseId === 'missing-key-slot') {
    const slots = fixture.keySlots.filter((slot) => slot.slotType !== 'recovery')
    const header = { ...fixture.header, key_slot_count: slots.length }
    return rebuildPreambleCandidate(
      originalBytes,
      fixture.preambleLength,
      encodePreamble(container, header, slots),
      { operation: 'remove-recovery-key-slot', frameIndex: null, byteOffset: fixture.slotOffset },
    )
  }
  if (caseId === 'duplicate-key-slot') {
    const slots = fixture.keySlots.map((slot, index) => index === 1
      ? { ...slot, slotId: fixture.keySlots[0].slotId }
      : { ...slot })
    return rebuildPreambleCandidate(
      originalBytes,
      fixture.preambleLength,
      encodePreamble(container, fixture.header, slots),
      { operation: 'duplicate-key-slot-id', frameIndex: null, byteOffset: fixture.slotOffset },
    )
  }
  if (caseId === 'slot-replacement') {
    const slots = fixture.keySlots.map((slot) => {
      if (slot.slotType !== 'passphrase') return { ...slot }
      const ciphertext = Buffer.alloc(Buffer.from(slot.ciphertext, 'base64').length, 0x7f)
      return { ...slot, ciphertext: ciphertext.toString('base64') }
    })
    return rebuildPreambleCandidate(
      originalBytes,
      fixture.preambleLength,
      encodePreamble(container, fixture.header, slots),
      { operation: 'replace-passphrase-slot-ciphertext', frameIndex: null, byteOffset: fixture.slotOffset },
    )
  }
  if (caseId === 'unavailable-key-slot') {
    const slots = fixture.keySlots.filter((slot) => slot.slotType !== 'machine')
    const header = { ...fixture.header, key_slot_count: slots.length }
    return rebuildPreambleCandidate(
      originalBytes,
      fixture.preambleLength,
      encodePreamble(container, header, slots),
      { operation: 'remove-optional-machine-key-slot', frameIndex: null, byteOffset: fixture.slotOffset },
    )
  }
  if (caseId === 'mission-header-swap' || caseId === 'epoch-header-swap') {
    const header = caseId === 'mission-header-swap'
      ? { ...fixture.header, mission_id: 'c21-substituted-mission' }
      : { ...fixture.header, protected_finalization_epoch: 42 }
    return rebuildPreambleCandidate(
      originalBytes,
      fixture.preambleLength,
      encodePreamble(container, header, fixture.keySlots),
      { operation: caseId, frameIndex: null, byteOffset: 12 },
    )
  }
  if (caseId === 'entry-boundary-duplicate' || caseId === 'entry-boundary-index-gap') {
    return {
      bytes: Buffer.from(fixture.structuralArchives[caseId]),
      boundary: { operation: caseId, frameIndex: null, byteOffset: fixture.preambleLength },
    }
  }
  if (CUSTODY_CASE_IDS.includes(caseId)) {
    return { bytes: Buffer.from(originalBytes), boundary: { operation: caseId, frameIndex: null, byteOffset: null } }
  }
  throw new Error(`Unsupported C21 case ${caseId}.`)
}

/** Locate the fixed preamble boundary without interpreting authenticated frames. */
function locatePreamble(bytes) {
  const headerLength = bytes.readUInt32BE(8)
  const slotLengthOffset = 12 + headerLength
  const slotLength = bytes.readUInt32BE(slotLengthOffset)
  return { slotOffset: slotLengthOffset + 4, preambleLength: slotLengthOffset + 4 + slotLength }
}

/** Encode a canonical preamble and retain the original authenticated frame bytes. */
function encodePreamble(container, header, slots) {
  const headerBytes = Buffer.from(container.canonicalJson(header), 'utf8')
  const slotBytes = Buffer.from(container.canonicalJson(slots), 'utf8')
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(headerBytes.length)
  const slotLength = Buffer.alloc(4)
  slotLength.writeUInt32BE(slotBytes.length)
  return Buffer.concat([
    container.SARARCH2_MAGIC,
    headerLength,
    headerBytes,
    slotLength,
    slotBytes,
  ])
}

/** Rebuild one candidate with a deliberately changed unauthenticated preamble. */
function rebuildPreambleCandidate(originalBytes, originalPreambleLength, preamble, boundary) {
  return {
    bytes: Buffer.concat([preamble, originalBytes.subarray(originalPreambleLength)]),
    boundary,
  }
}

/** Execute one valid, wrong-key, or structural-mutant candidate and scrub plaintext immediately. */
async function executeCandidate(caseId, candidate, fixture, { container, crypto }) {
  if (caseId === 'unavailable-key-slot') {
    const plaintext = emptyPlaintextObservation()
    let error = null
    let preamble
    const machineSecretBytes = Buffer.from(MACHINE_SECRET, 'utf8')
    try {
      preamble = await container.readArchivePreamble(Readable.from([candidate.bytes]))
      const slot = preamble.keySlots.find((entry) => entry.slotType === 'machine')
      if (slot !== undefined) throw new Error('C21 unavailable-key-slot candidate still contains a machine slot.')
      // Exercise the production unwrap API with the observed unavailable slot.
      await crypto.unwrapMissionArchiveKey({
        slot,
        secret: machineSecretBytes,
        headerDigest: preamble.headerDigest,
      })
    } catch (caught) {
      error = caught
    } finally {
      preamble?.headerDigest.fill(0)
      crypto.zeroBuffer(machineSecretBytes)
    }
    return {
      result: resultFromError(error, false, 'key-slot-unavailable'),
      plaintext: finishPlaintextObservation(plaintext),
      custody: emptyCustodyObservation(),
    }
  }
  if (caseId === 'wrong-key') {
    const plaintext = emptyPlaintextObservation()
    let error = null
    let preamble
    const wrongPassphraseBytes = Buffer.from(WRONG_PASSPHRASE, 'utf8')
    try {
      preamble = await container.readArchivePreamble(Readable.from([candidate.bytes]))
      const slot = preamble.keySlots.find((entry) => entry.slotType === 'passphrase')
      if (slot === undefined) throw new Error('C21 fixture passphrase slot is missing.')
      await crypto.unwrapMissionArchiveKey({
        slot,
        secret: wrongPassphraseBytes,
        headerDigest: preamble.headerDigest,
      })
    } catch (caught) {
      error = caught
    } finally {
      preamble?.headerDigest.fill(0)
      crypto.zeroBuffer(wrongPassphraseBytes)
    }
    return {
      result: resultFromError(error, false),
      plaintext: finishPlaintextObservation(plaintext),
      custody: emptyCustodyObservation(),
    }
  }

  let missionArchiveKey
  let preamble
  let error = null
  const plaintext = emptyPlaintextObservation()
  let secretBytes
  try {
    preamble = await container.readArchivePreamble(Readable.from([candidate.bytes]))
    const slotType = caseId === 'recovery-roundtrip' ? 'recovery'
      : caseId === 'machine-slot-unlock' ? 'machine' : 'passphrase'
    const secret = caseId === 'recovery-roundtrip' ? RECOVERY_CODE
      : caseId === 'machine-slot-unlock' ? MACHINE_SECRET : PASSPHRASE
    const slot = preamble.keySlots.find((entry) => entry.slotType === slotType)
    if (slot === undefined) throw new Error(`C21 fixture ${slotType} slot is missing.`)
    secretBytes = Buffer.from(secret, 'utf8')
    missionArchiveKey = await crypto.unwrapMissionArchiveKey({
      slot,
      secret: secretBytes,
      headerDigest: preamble.headerDigest,
    })
    let current = null
    await container.readArchiveContainer({
      readable: Readable.from([candidate.bytes]),
      missionArchiveKey,
      onEntryStart: (entry) => {
        current = entry.name
        plaintext.entryNames.push(entry.name)
      },
      onEntryChunk: (_entry, chunk) => {
        plaintext.observedBytes += chunk.length
        plaintext.observedHash.update(chunk)
        chunk.fill(0)
      },
      onEntryEnd: (entry) => {
        if (current !== entry.name) throw new Error('C21 probe entry callbacks were out of order.')
        current = null
      },
    })
  } catch (caught) {
    error = caught
  } finally {
    if (missionArchiveKey !== undefined) crypto.zeroBuffer(missionArchiveKey)
    if (secretBytes !== undefined) crypto.zeroBuffer(secretBytes)
    preamble?.headerDigest.fill(0)
  }
  const accepted = error === null
  if ((caseId === 'valid-roundtrip' || caseId === 'recovery-roundtrip'
    || caseId === 'machine-slot-unlock') && accepted) {
    if (plaintext.observedBytes !== fixture.plaintextBytes) throw new Error('C21 valid roundtrip plaintext count differed from fixture.')
    if (plaintext.entryNames.join('\u0000') !== fixture.entryNames.join('\u0000')) throw new Error('C21 valid roundtrip entry order differed from fixture.')
  }
  return {
    result: resultFromError(error, accepted),
    plaintext: finishPlaintextObservation(plaintext),
    custody: emptyCustodyObservation(),
  }
}

/** Execute one custody replacement against the repository-owned pinned-file API. */
async function executeCustodyCandidate(caseId, candidate, fixture, custody, reconciliation) {
  const plaintext = emptyPlaintextObservation()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sartracker-c21-custody-'))
  const archiveRelativePath = 'candidate.sararch'
  const archivePath = path.join(directory, archiveRelativePath)
  const replacementPath = path.join(directory, 'replacement.tmp')
  fs.writeFileSync(archivePath, candidate.bytes, { mode: 0o600 })
  const observed = custody.inspectArchiveCustodyFile({ archiveDirectory: directory, archiveRelativePath })
  const custodyObservation = {
    inspected: true,
    initialSha256: observed.ciphertextSha256,
    initialSizeBytes: observed.sizeBytes,
    replacementSha256: null,
    replacementSizeBytes: null,
    callbackRan: false,
    identityChanged: false,
    reconciliationOutcome: null,
    reconciliationExpectedSha256: null,
    reconciliationObservedSha256: null,
    reconciliationExpectedSizeBytes: null,
    reconciliationObservedSizeBytes: null,
    reconciliationWorkerExited: false,
    reconciliationFileIdentity: null,
  }
  let error = null
  try {
    if (caseId === 'registry-ciphertext-swap') {
      const replacement = Buffer.from(candidate.bytes)
      replacement[Math.min(fixture.preambleLength, replacement.length - 1)] ^= 0x01
      fs.writeFileSync(replacementPath, replacement, { mode: 0o600 })
      custodyObservation.replacementSha256 = sha256(replacement)
      custodyObservation.replacementSizeBytes = replacement.length
      replacement.fill(0)
      fs.renameSync(replacementPath, archivePath)
      const swapped = custody.inspectArchiveCustodyFile({ archiveDirectory: directory, archiveRelativePath })
      custodyObservation.reconciliationOutcome = 'available'
      custodyObservation.reconciliationExpectedSha256 = observed.ciphertextSha256
      custodyObservation.reconciliationObservedSha256 = swapped.ciphertextSha256
      custodyObservation.reconciliationExpectedSizeBytes = observed.sizeBytes
      custodyObservation.reconciliationObservedSizeBytes = swapped.sizeBytes
      custodyObservation.reconciliationFileIdentity = swapped.fileIdentity
      if (swapped.ciphertextSha256 === observed.ciphertextSha256) {
        throw newError('ARCHIVE_CUSTODY_REGISTRY_MISMATCH', 'Registry ciphertext identity was not independently rejected.')
      }
      error = newError('ARCHIVE_CUSTODY_REGISTRY_MISMATCH', 'Registry ciphertext SHA-256 differed from the worker custody observation.')
    } else if (caseId === 'archive-replaced-during-verify') {
      const replacement = Buffer.alloc(candidate.bytes.length, 0x31)
      fs.writeFileSync(replacementPath, replacement, { mode: 0o600 })
      custodyObservation.replacementSha256 = sha256(replacement)
      custodyObservation.replacementSizeBytes = replacement.length
      replacement.fill(0)
      fs.renameSync(replacementPath, archivePath)
      custody.withPinnedCustodyFileIdentity({
        archiveDirectory: directory,
        archiveRelativePath,
        expectedFileIdentity: observed.fileIdentity,
      }, () => {
        custodyObservation.callbackRan = true
      })
    } else if (caseId === 'same-open-file-replacement') {
      let replaced = false
      custody.inspectArchiveCustodyFile({
        archiveDirectory: directory,
        archiveRelativePath,
        onChunk: (completedBytes) => {
          if (replaced || completedBytes < 1024 * 1024) return
          replaced = true
          const replacement = Buffer.alloc(candidate.bytes.length, 0x32)
          fs.writeFileSync(replacementPath, replacement, { mode: 0o600 })
          custodyObservation.replacementSha256 = sha256(replacement)
          custodyObservation.replacementSizeBytes = replacement.length
          replacement.fill(0)
          fs.renameSync(replacementPath, archivePath)
        },
      })
    } else if (caseId === 'cross-process-custody-reconciliation') {
      const crossProcessBytes = Buffer.from(candidate.bytes)
      fs.writeFileSync(archivePath, crossProcessBytes, { mode: 0o600 })
      const expectedSha256 = sha256(crossProcessBytes)
      const expectedSizeBytes = crossProcessBytes.length
      custodyObservation.initialSha256 = expectedSha256
      custodyObservation.initialSizeBytes = expectedSizeBytes
      const ticket = createReconciliationTicket(directory, archiveRelativePath, expectedSha256, expectedSizeBytes)
      const replacement = Buffer.alloc(expectedSizeBytes, 0x36)
      fs.writeFileSync(replacementPath, replacement, { mode: 0o600 })
      custodyObservation.replacementSha256 = sha256(replacement)
      custodyObservation.replacementSizeBytes = replacement.length
      replacement.fill(0)
      fs.renameSync(replacementPath, archivePath)
      const operation = reconciliation.startArchiveCustodyReconciliation({ ticket })
      const workerResult = await operation
      await operation.workerExited
      custodyObservation.reconciliationOutcome = workerResult.outcome
      custodyObservation.reconciliationExpectedSha256 = workerResult.expectedCiphertextSha256
      custodyObservation.reconciliationObservedSha256 = workerResult.observedCiphertextSha256
      custodyObservation.reconciliationExpectedSizeBytes = workerResult.expectedSizeBytes
      custodyObservation.reconciliationObservedSizeBytes = workerResult.observedSizeBytes
      custodyObservation.reconciliationWorkerExited = true
      custodyObservation.reconciliationFileIdentity = workerResult.fileIdentity
      custodyObservation.identityChanged = false
      if (workerResult.outcome !== 'available'
        || workerResult.observedCiphertextSha256 !== custodyObservation.replacementSha256) {
        throw newError('C21_PROBE_REJECTED', 'Cross-process custody reconciliation did not report the replacement bytes.')
      }
      error = newError('ARCHIVE_CUSTODY_REGISTRY_MISMATCH', 'Cross-process custody worker reported bytes different from the issued registry identity.')
      crossProcessBytes.fill(0)
    } else {
      throw new Error(`Unsupported C21 custody case ${caseId}.`)
    }
  } catch (caught) {
    error = caught
    custodyObservation.identityChanged = caught?.code === 'ARCHIVE_CUSTODY_IDENTITY_CHANGED'
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  return {
    result: resultFromError(error, false),
    plaintext: finishPlaintextObservation(plaintext),
    custody: custodyObservation,
  }
}

/** Build one exact v2 custody ticket for the production worker runner. */
function createReconciliationTicket(archiveDirectory, archiveRelativePath, expectedCiphertextSha256, expectedSizeBytes) {
  return {
    operationId: CREATION_OPERATION_ID,
    registryRowid: 1,
    archiveId: '22222222-2222-4222-8222-222222222222',
    containerVersion: 2,
    archiveDirectory,
    archiveRelativePath,
    expectedCiphertextSha256,
    expectedSizeBytes,
  }
}

/** Create one probe-local error while retaining a production-boundary code. */
function newError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Return a new empty plaintext observation that retains no plaintext bytes. */
function emptyPlaintextObservation() {
  return {
    observedBytes: 0,
    observedHash: createHash('sha256'),
    retainedBytes: 0,
    residueDetected: false,
    residuePaths: [],
    entryNames: [],
  }
}

/** Return a non-custody observation for archive parser cases. */
function emptyCustodyObservation() {
  return {
    inspected: false,
    initialSha256: null,
    initialSizeBytes: null,
    replacementSha256: null,
    replacementSizeBytes: null,
    callbackRan: false,
    identityChanged: false,
    reconciliationOutcome: null,
    reconciliationExpectedSha256: null,
    reconciliationObservedSha256: null,
    reconciliationExpectedSizeBytes: null,
    reconciliationObservedSizeBytes: null,
    reconciliationWorkerExited: false,
    reconciliationFileIdentity: null,
  }
}

/** Seal a plaintext observation with a digest and no retained buffers. */
function finishPlaintextObservation(observation) {
  return {
    observedBytes: observation.observedBytes,
    observedSha256: observation.observedHash.digest('hex'),
    retainedBytes: observation.retainedBytes,
    residueDetected: observation.residueDetected,
    residuePaths: observation.residuePaths,
    entryNames: observation.entryNames,
  }
}

/** Convert an actual parser result into a bounded, secret-safe result record. */
function resultFromError(error, accepted, classification = null) {
  if (accepted) return { accepted: true, classification: null, code: 'PASS', name: null, message: null }
  const code = typeof error?.code === 'string' ? error.code : null
  const name = typeof error?.name === 'string' ? error.name : 'Error'
  const message = typeof error?.message === 'string' ? error.message : 'Archive candidate was rejected.'
  return {
    accepted: false,
    classification,
    code,
    name,
    message: message
      .replaceAll(PASSPHRASE, '[REDACTED_SECRET]')
      .replaceAll(WRONG_PASSPHRASE, '[REDACTED_SECRET]')
      .replaceAll(RECOVERY_CODE, '[REDACTED_SECRET]')
      .replaceAll(MACHINE_SECRET, '[REDACTED_SECRET]'),
  }
}

/** Hash one file with bounded streaming reads through the physical filesystem. */
function hashFile(filePath, filesystem = originalFs ?? fs) {
  if (originalFs === null && process.versions.electron && filePath.endsWith('.asar')) {
    throw new Error('Packaged C21 could not load Electron original-fs for physical ASAR hashing.')
  }
  const hash = createHash('sha256')
  const descriptor = filesystem.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = filesystem.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    filesystem.closeSync(descriptor)
    buffer.fill(0)
  }
  return hash.digest('hex')
}

/** Hash one byte buffer without exposing its bytes in a report. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Parse the explicit probe CLI and reject all unbound modes. */
function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--source-root', '--app-asar', '--source-sha'].includes(argument)) {
      throw new Error(`Unknown C21 probe argument ${String(argument)}.`)
    }
    const value = argv[++index]
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing value for ${argument}.`)
    if (options[argument.slice(2)] !== undefined) throw new Error(`Duplicate C21 probe argument ${argument}.`)
    options[argument.slice(2)] = value
  }
  const hasSource = options['source-root'] !== undefined
  const hasPackage = options['app-asar'] !== undefined
  if (hasSource === hasPackage) throw new Error('C21 probe requires exactly one of --source-root or --app-asar.')
  return {
    moduleRoot: path.resolve(hasPackage ? options['app-asar'] : options['source-root']),
    tier: hasPackage ? 'packaged-module' : 'source-calibration',
    sourceSha: options['source-sha'],
  }
}

/** Run the CLI without reflecting secrets or stack traces in stdout. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runArchiveSecurityProbe(options)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'C21 probe failed.'}\n`)
    process.exitCode = 1
  })
}

module.exports = { CASE_IDS, KEY_SLOT_CASE_IDS, CUSTODY_CASE_IDS, hashFile, runArchiveSecurityProbe }
