const MAX_COVERAGE_TILE_ZOOM = 16

/** Accepts only an integral tile address inside the configured coverage pyramid. */
function normalizeCoverageTileAddress(input) {
  const { z, x, y } = input
  const coordinateLimit = Number.isInteger(z) && z >= 0 && z <= MAX_COVERAGE_TILE_ZOOM
    ? 2 ** z
    : 0
  if (
    !Number.isInteger(z) || z < 0 || z > MAX_COVERAGE_TILE_ZOOM ||
    !Number.isInteger(x) || x < 0 || x >= coordinateLimit ||
    !Number.isInteger(y) || y < 0 || y >= coordinateLimit
  ) {
    throw new Error('Coverage tile coordinates are invalid.')
  }
  return { z, x, y }
}

module.exports = { MAX_COVERAGE_TILE_ZOOM, normalizeCoverageTileAddress }
