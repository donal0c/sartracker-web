/**
 * Compares strings by JavaScript code-unit order without consulting the host
 * locale or ICU data.
 */
function compareStringsByCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

module.exports = {
  compareStringsByCodeUnit,
}
