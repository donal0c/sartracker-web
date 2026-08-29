/** Parses one non-empty finite decimal without JavaScript's empty-string coercion. */
export function parseGpxDecimal(source: string | null): number | null

/** Parses a full, calendar-valid ISO date-time carrying Z or an explicit offset. */
export function parseExplicitGpxTimestamp(source: string | null): string | null
