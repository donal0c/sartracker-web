/**
 * The single list of checks that gates a team beta.
 *
 * `docs/release-checklist.md` explains each check, `docs/releases/TEMPLATE.md`
 * carries the result table, `scripts/team-smoke/` automates the rows it can,
 * and the guarded publisher enforces the table. Unit tests keep all four in
 * agreement with this list, so a check is renamed, added or removed here first.
 *
 * `identity` checks bind the published bytes to the CI build. They must PASS
 * and can never be covered by an owner exception.
 * `notApplicableAllowed` checks may be marked NOT APPLICABLE with a reason.
 */

/**
 * @typedef {Object} ReleaseCheck
 * @property {string} name
 * @property {boolean} identity
 * @property {boolean} notApplicableAllowed
 */

/** @type {readonly ReleaseCheck[]} */
export const RELEASE_CHECKS = Object.freeze(
  [
    ['CI release run', true, false],
    ['AppImage SHA-256', true, false],
    ['.deb SHA-256', true, false],
    ['Installed .deb payload', true, false],
    ['Startup with bad stored credential', false, false],
    ['Corrupt or newer database refused', false, false],
    ['Unwritable profile shows an error', false, false],
    ['Duplicate launch', false, false],
    ["Upgrade from the team's current release", false, false],
    ['Mission lifecycle and crash recovery', false, false],
    ['Tracking matches provider exactly', false, false],
    ['Provider outage warning and backfill', false, false],
    ['Live Traccar', false, false],
    ['Coordinate conversion and rejection', false, false],
    ['Markers, attachments and GPX import', false, false],
    ['Replay, basemaps and layers', false, false],
    ['Encrypted archive create and reopen', false, false],
    ['Settings, secrets and support bundle', false, false],
    ['Large mission opens responsive', false, false],
    ['Packaged soak', false, false],
    ['Strict responsiveness (<200 ms)', false, false],
    ['Offline map package', false, true],
  ].map(([name, identity, notApplicableAllowed]) =>
    Object.freeze({ name, identity, notApplicableAllowed }),
  ),
)

/** Results a checklist row may record. */
export const RELEASE_RESULTS = Object.freeze(['PASS', 'FAIL', 'NOT TESTED', 'NOT APPLICABLE'])

/** Severities from the checklist. Only the non-blocking two can be excepted. */
export const EXCEPTABLE_SEVERITIES = Object.freeze(['Ship with known issue', 'Backlog'])
