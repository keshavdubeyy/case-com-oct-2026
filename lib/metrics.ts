/**
 * Reusable metric functions -- one implementation per numerator/denominator
 * pair defined in METRICS.md, mirroring scripts/lib/metrics.py's role on the
 * Python side. Every chart/table on every page calls into these rather than
 * recomputing an aggregate inline, per the brief's "create reusable metric
 * functions rather than calculating the same KPI differently across pages."
 *
 * Every function takes already-filtered Episode[] (the caller applies the
 * global filter bar via lib/filters.ts first) and returns a Rate
 * ({numerator, denominator, rate}) rather than a bare number, so a rate can
 * never be rendered without its N.
 */
import type { Episode } from "./types"
import { makeRate, type Rate } from "./types"

export const LOW_SAMPLE_THRESHOLD = 20

/** METRICS.md #0 -- every LTFU/dropout/completion metric is DEVELOPMENT-only. */
export function developmentOnly(episodes: Episode[]): Episode[] {
  return episodes.filter((e) => e.cohort === "DEVELOPMENT")
}

export function ltfuRate(episodes: Episode[]): Rate {
  const dev = developmentOnly(episodes)
  const n = dev.filter((e) => e.lost_to_followup_label === 1).length
  return makeRate(n, dev.length)
}

export function careCompletionRate(episodes: Episode[]): Rate {
  const dev = developmentOnly(episodes)
  const n = dev.filter((e) => e.lost_to_followup_label === 0).length
  return makeRate(n, dev.length)
}

export interface DropoutStageRow {
  stage: string
  count: number
  pctOfLtfu: number | null
}

export const DROPOUT_STAGES = ["Medicine not collected", "Review not attended", "Test not completed"] as const

export function dropoutStageBreakdown(episodes: Episode[]): DropoutStageRow[] {
  const dev = developmentOnly(episodes)
  const ltfuN = dev.filter((e) => e.lost_to_followup_label === 1).length
  return DROPOUT_STAGES.map((stage) => {
    const count = dev.filter((e) => e.dropout_stage_label === stage).length
    return { stage, count, pctOfLtfu: ltfuN > 0 ? count / ltfuN : null }
  })
}

export interface FunnelStage {
  label: string
  rate: Rate
}

/**
 * METRICS.md #2 -- eligible-denominator care-journey funnel.
 *
 * Two DISTINCT, never-conflated medicine-completion metrics (see
 * VALIDATION_REPORT.md MED-01 and P1_FIXES.md for why this split exists):
 *   - medicineFulfillmentRate: fully dispensed / ALL prescriptions generated
 *     (METRICS.md #2's funnel rate -- the brief's worked-example denominator).
 *   - dispensingSuccessRate: fully dispensed / prescriptions with >=1 recorded
 *     dispensing ATTEMPT only (METRICS.md #4 -- excludes zero-attempt
 *     prescriptions from the denominator entirely, so it is always >= the
 *     fulfillment rate). Never render one as if it were the other.
 */
export function careJourneyFunnel(episodes: Episode[]): {
  medicineAdvised: number
  prescriptionGenerated: Rate
  medicineFulfillmentRate: Rate
  medicineDispensingAttempted: Rate
  dispensingSuccessRate: Rate
  medicinePartial: Rate
  medicineNotReceived: Rate
  testsAdvised: number
  testsCompleted: Rate
  reviewsAdvised: number
  reviewsCompleted: Rate
} {
  const medAdvised = episodes.filter((e) => e.medicine_advised === "Yes")
  const presc = medAdvised.filter((e) => e.prescription_generated)
  const fully = presc.filter((e) => e.medicine_fully_dispensed).length
  const attempted = presc.filter((e) => e.medicine_dispensing_attempted)
  const partial = presc.filter((e) => e.medicine_outcome === "partial dispensing").length
  const notReceived = presc.filter((e) => e.medicine_outcome === "medicine not received").length

  const testAdvised = episodes.filter((e) => e.test_advised === "Yes")
  const testsCompleted = testAdvised.filter((e) => e.test_status === "Available").length

  const reviewAdvised = episodes.filter((e) => e.review_advised === "Yes")
  const reviewsCompleted = reviewAdvised.filter((e) => e.review_completed).length

  return {
    medicineAdvised: medAdvised.length,
    prescriptionGenerated: makeRate(presc.length, medAdvised.length),
    medicineFulfillmentRate: makeRate(fully, presc.length),
    medicineDispensingAttempted: makeRate(attempted.length, presc.length),
    dispensingSuccessRate: makeRate(fully, attempted.length),
    medicinePartial: makeRate(partial, presc.length),
    medicineNotReceived: makeRate(notReceived, presc.length),
    testsAdvised: testAdvised.length,
    testsCompleted: makeRate(testsCompleted, testAdvised.length),
    reviewsAdvised: reviewAdvised.length,
    reviewsCompleted: makeRate(reviewsCompleted, reviewAdvised.length),
  }
}

export const MEDICINE_CLASSIFICATIONS = [
  "completed",
  "system_stockout",
  "patient_no_collection_attempt",
  "indeterminate",
  "not_advised",
] as const

export function medicineAccessBreakdown(episodes: Episode[]): { classification: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const c of MEDICINE_CLASSIFICATIONS) counts.set(c, 0)
  for (const e of episodes) counts.set(e.medicine_access_classification, (counts.get(e.medicine_access_classification) ?? 0) + 1)
  return MEDICINE_CLASSIFICATIONS.map((classification) => ({ classification, count: counts.get(classification) ?? 0 }))
}

export interface SegmentRow {
  segment: string
  episodeCount: number
  ltfuCount: number
  ltfuRate: number | null
  completionRate: number | null
  lowSample: boolean
}

/** Generic "group DEVELOPMENT episodes by a dimension, show N + LTFU rate
 * alongside" -- used by Dropout Analysis, Segments, Geography, Facility. */
export function segmentBreakdown(episodes: Episode[], keyFn: (e: Episode) => string | null | undefined): SegmentRow[] {
  const dev = developmentOnly(episodes)
  const groups = new Map<string, Episode[]>()
  for (const e of dev) {
    const key = keyFn(e) ?? "Unknown"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }
  return Array.from(groups.entries())
    .map(([segment, rows]) => {
      const ltfuCount = rows.filter((r) => r.lost_to_followup_label === 1).length
      const completedCount = rows.filter((r) => r.lost_to_followup_label === 0).length
      return {
        segment,
        episodeCount: rows.length,
        ltfuCount,
        ltfuRate: rows.length > 0 ? ltfuCount / rows.length : null,
        completionRate: rows.length > 0 ? completedCount / rows.length : null,
        lowSample: rows.length < LOW_SAMPLE_THRESHOLD,
      }
    })
    .sort((a, b) => b.episodeCount - a.episodeCount)
}

/** METRICS.md #9 -- computable without the outcome label, so valid on
 * EVALUATION episodes too (used for "requires action" counts). */
export function isAtRisk(e: Episode): boolean {
  return e.at_risk_no_outcome_needed
}

export const AGE_GROUP_ORDER = ["<18", "18-29", "30-44", "45-59", "60+"]
export const DISTANCE_BUCKET_ORDER = ["0-5km", "5-10km", "10-20km", ">20km"]

export function orderBy<T extends string>(order: readonly T[]) {
  return (a: { segment: string }, b: { segment: string }) => order.indexOf(a.segment as T) - order.indexOf(b.segment as T)
}
