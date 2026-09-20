/** Independently reconcile public durable rows with synthetic provider fixTime, never its alternate clocks. */
export function validateCanonicalIngestSurface(facts) {
  const source = facts?.source
  if (!source || source.stationary?.length !== 2 || !source.stale) throw new Error('Canonical ingest source is incomplete.')
  const fixes = [...source.stationary, source.stale]
  if (!Number.isSafeInteger(facts.sourcePollsBeforeAck) || facts.sourcePollsBeforeAck < 1
      || !Number.isSafeInteger(facts.sourcePollsAfterAck) || facts.sourcePollsAfterAck <= facts.sourcePollsBeforeAck) throw new Error('Canonical ingest lacks a repeated provider poll.')
  if (fixes.some((row, index) => row.id !== [101, 102, 201][index] || row.deviceId !== [1, 1, 2][index]
      || row.latitude !== [52, 52.00001, 52.002][index] || row.longitude !== -9.7
      || !Number.isFinite(Date.parse(row.fixTime))
      || Date.parse(row.serverTime) - Date.parse(row.fixTime) !== 9 * 60_000
      || Date.parse(row.deviceTime) - Date.parse(row.fixTime) !== 7 * 60_000)
      || Date.parse(fixes[1].fixTime) - Date.parse(fixes[0].fixTime) !== 20 * 60_000
      || fixes[2].fixTime !== fixes[0].fixTime) {
    throw new Error('Canonical ingest requires deliberately distinct provider clocks.')
  }
  for (const rows of [facts.durableBeforeAck, facts.durableAfterAck]) {
    if (!Array.isArray(rows) || rows.length !== 3 || new Set(rows.map(row => row.source_position_id)).size !== 3) throw new Error('Canonical ingest lost or duplicated source evidence.')
    for (const fix of fixes) {
      const row = rows.find(value => value.source_position_id === String(fix.id))
      if (!row || row.device_id !== String(fix.deviceId) || row.timestamp !== fix.fixTime
          || row.lat !== fix.latitude || row.lon !== fix.longitude || row.timestamp_source !== 'fix'
          || row.data_origin !== 'live' || row.source_kind !== 'traccar') throw new Error('Canonical ingest changed source identity, coordinates, fixTime or provenance.')
    }
  }
  return { passed: true, producerContractId: 'C06', scope: 'packaged synthetic canonical ingest and duplicate-poll durability; exhaustive adversarial source/browser corpus and real-provider GET proof remain separate' }
}
