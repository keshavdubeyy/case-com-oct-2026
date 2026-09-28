/** Validated categorical palette (see DESIGN.md) -- fixed hue order, never
 * cycled arbitrarily. Referenced as CSS custom properties so light/dark
 * swap automatically via the .dark class already wired in app/globals.css. */
export const CATEGORICAL = [
  "var(--chart-1)", // blue
  "var(--chart-2)", // orange
  "var(--chart-3)", // aqua
  "var(--chart-4)", // yellow
  "var(--chart-5)", // magenta
  "var(--chart-6)", // green
  "var(--chart-7)", // violet
  "var(--chart-8)", // red
] as const

/** First three categorical slots validate all-pairs comparisons (scatter,
 * choropleth, small multiples) in both light and dark -- past three, fold
 * extra categories into "Other" or facet instead of extending this list. */
export const CATEGORICAL_ALL_PAIRS_SAFE = CATEGORICAL.slice(0, 3)

export const STATUS = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
} as const

export const SEQUENTIAL_BLUE = [
  "var(--seq-blue-100)",
  "var(--seq-blue-300)",
  "var(--seq-blue-500)",
  "var(--seq-blue-700)",
] as const

export const DIVERGING = {
  cool: "var(--diverging-cool)",
  warm: "var(--diverging-warm)",
  mid: "var(--diverging-mid)",
} as const

export const CHART_GRID = "var(--chart-grid)"
export const CHART_AXIS = "var(--chart-axis)"

/** LTFU-rate -> status color, used consistently on facility/geography/segment
 * tables and maps so "high dropout" always reads the same way. */
export function ltfuStatusColor(rate: number | null): string {
  if (rate == null) return CHART_AXIS
  if (rate >= 0.55) return STATUS.critical
  if (rate >= 0.4) return STATUS.serious
  if (rate >= 0.25) return STATUS.warning
  return STATUS.good
}
