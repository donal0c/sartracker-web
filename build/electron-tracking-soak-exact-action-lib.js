const EXACT_PAGE_CONTROL_TEST_IDS = new Map([
  ['exact-breadcrumb-dots-earlier', 'earlier'],
  ['exact-breadcrumb-dots-later', 'later'],
])
const DIAGNOSTIC_SAMPLE_LIMIT_MS = 50
const ACTION_DEADLINE_REACHED = Symbol('exact-action-deadline')

/**
 * Uses Playwright's complete actionability contract for one exact-page click.
 * A preliminary hit sample is evidence only: Playwright may legitimately wait
 * for a transient animation or obstruction to settle before delivering it.
 */
export async function clickExactDotPageControl(input) {
  const action = EXACT_PAGE_CONTROL_TEST_IDS.get(input?.testId)
  if (
    action === undefined ||
    !Number.isSafeInteger(input?.pageIndexFromLatest) ||
    input.pageIndexFromLatest < 0 ||
    !Number.isSafeInteger(input?.timeoutMs) ||
    input.timeoutMs < 1 ||
    input?.page === null ||
    typeof input?.page !== 'object'
  ) {
    throw new Error('Exact breadcrumb page action input is invalid.')
  }
  const button = input.page.getByTestId(input.testId)
  const deadlineMs = Date.now() + input.timeoutMs
  const click = runBeforeDeadline(
    () => button.click({ timeout: input.timeoutMs }),
    deadlineMs,
  )
  const firstObservation = readControlObservation(button, deadlineMs)
  try {
    await click
    return
  } catch {
    const first = await firstObservation
    throw createActionFailure({
      action,
      pageIndexFromLatest: input.pageIndexFromLatest,
      failureClass: 'click_timeout_or_interception',
      first,
      last: await readControlObservation(button, deadlineMs),
    })
  }
}

/** Reads one terminal oldest/latest disabled state inside a hard deadline. */
export async function readExactDotPageControlDisabled(input) {
  if (
    !EXACT_PAGE_CONTROL_TEST_IDS.has(input?.testId) ||
    !Number.isSafeInteger(input?.timeoutMs) ||
    input.timeoutMs < 1 ||
    input?.page === null ||
    typeof input?.page !== 'object'
  ) {
    throw new Error('Exact breadcrumb terminal page-control input is invalid.')
  }
  const button = input.page.getByTestId(input.testId)
  try {
    return await runBeforeDeadline(
      () => button.isDisabled({ timeout: input.timeoutMs }),
      Date.now() + input.timeoutMs,
    )
  } catch {
    throw new Error(
      'Exact breadcrumb terminal page-control state was unavailable.',
    )
  }
}

/** Reads one bounded DOM action sample without text or application data. */
async function readControlObservation(button, actionDeadlineMs) {
  const remainingMs = actionDeadlineMs - Date.now()
  const sampleLimitMs = Math.min(
    DIAGNOSTIC_SAMPLE_LIMIT_MS,
    Math.floor(remainingMs / 10),
  )
  if (sampleLimitMs < 1) return null
  let observation
  try {
    observation = await runBeforeDeadline(
      () => button.evaluate(
        (element) => {
          const bounds = element.getBoundingClientRect()
          const intercept = document.elementFromPoint(
            bounds.left + (bounds.width / 2),
            bounds.top + (bounds.height / 2),
          )
          return {
            bbox: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
            intercept: intercept === null
              ? null
              : {
                  tag: intercept.tagName,
                  testId: intercept.getAttribute('data-testid'),
                  className:
                    typeof intercept.className === 'string'
                      ? intercept.className
                      : '',
                },
          }
        },
        undefined,
        { timeout: sampleLimitMs },
      ),
      Math.min(actionDeadlineMs, Date.now() + sampleLimitMs),
    )
  } catch {
    return null
  }
  return {
    bbox: sanitizeBoundingBox(observation?.bbox),
    intercept: sanitizeIntercept(observation?.intercept),
  }
}

/** Runs one operation inside the shared absolute action deadline. */
function runBeforeDeadline(operation, deadlineMs) {
  const remainingMs = deadlineMs - Date.now()
  if (remainingMs <= 0) return Promise.reject(ACTION_DEADLINE_REACHED)
  let operationPromise
  try {
    operationPromise = Promise.resolve(operation())
  } catch (error) {
    operationPromise = Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(ACTION_DEADLINE_REACHED),
      remainingMs,
    )
    operationPromise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

/** Creates a static-message error with one report-safe action envelope. */
function createActionFailure(exactDotActionFailure) {
  const error = new Error(
    'Exact breadcrumb page control did not become actionable.',
  )
  error.name = 'ExactSoakActionError'
  error.exactDotActionFailure = exactDotActionFailure
  return error
}

/** Bounds viewport geometry to finite, millipixel diagnostic values. */
function sanitizeBoundingBox(bbox) {
  const values = [bbox?.x, bbox?.y, bbox?.width, bbox?.height]
  if (values.some((value) => !Number.isFinite(value))) return null
  const bounded = values.map((value) => Math.max(
    -100_000,
    Math.min(100_000, Math.round(value * 1_000) / 1_000),
  ))
  return {
    x: bounded[0],
    y: bounded[1],
    width: bounded[2],
    height: bounded[3],
  }
}

/** Allowlists only DOM tag, test-id, and class tokens in failure evidence. */
function sanitizeIntercept(intercept) {
  if (intercept === null || typeof intercept !== 'object') return null
  const tag = sanitizeToken(intercept.tag, /^[a-z0-9-]{1,32}$/iu)
  const testId = sanitizeToken(intercept.testId, /^[a-z0-9-]{1,80}$/iu)
  const className = typeof intercept.className === 'string'
    ? intercept.className
        .split(/\s+/u)
        .filter((token) => /^[a-z0-9_:[\]./%+-]{1,80}$/iu.test(token))
        .slice(0, 8)
        .join(' ')
    : ''
  return {
    tag: tag?.toLowerCase() ?? null,
    testId,
    className,
  }
}

/** Returns one exact allowlisted token or null. */
function sanitizeToken(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : null
}
