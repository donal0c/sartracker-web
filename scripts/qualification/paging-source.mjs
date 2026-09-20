/** Select the primary mission while keeping the reviewed BCP generator's twelve legacy rows explicit. */
export function selectPagingSource(database, contractId) {
  if (!['C07', 'C08'].includes(contractId)) throw new Error('Paging source contract is invalid.')
  const missions = database.prepare(`SELECT mission.id, mission.start_time, COUNT(position.id) AS positionCount
    FROM missions AS mission LEFT JOIN positions AS position ON position.mission_id = mission.id
      AND position.timestamp_source = 'fix'${contractId === 'C07' ? ' AND position.timestamp >= mission.start_time' : ''}
    GROUP BY mission.id ORDER BY positionCount DESC, mission.id ASC`).all()
  if (missions.length < 1 || missions.length > 2 || missions[0].positionCount < 1) throw new Error('Paging fixture primary mission is missing or ambiguous.')
  const legacy = missions.slice(1)
  if (legacy.some(mission => mission.id !== 'fixture-mission-legacy-no-outings' || mission.positionCount !== 12)) {
    throw new Error('Paging fixture contains an unreviewed secondary mission; only the fixed twelve legacy rows are allowed.')
  }
  return { primary: missions[0], fixturePositionCount: missions.reduce((sum, mission) => sum + mission.positionCount, 0),
    legacyPositionCount: legacy.reduce((sum, mission) => sum + mission.positionCount, 0) }
}
