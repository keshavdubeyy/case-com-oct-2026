"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { RateText } from "@/components/dashboard/rate-text"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AGE_GROUP_ORDER, careJourneyFunnel, orderBy } from "@/lib/metrics"
import { makeRate, type Episode, type Rate } from "@/lib/types"

/** Review-completion rate per segment, computed over review-advised episodes
 * only (the eligible denominator for this metric) -- distinct from
 * segmentBreakdown()'s LTFU-rate-per-segment, which is a different metric
 * scoped to the Development cohort. */
interface ReviewSegmentRow {
  segment: string
  n: number
  completed: number
  rate: Rate
}

function reviewCompletionBreakdown(
  episodes: Episode[],
  keyFn: (e: Episode) => string | null | undefined
): ReviewSegmentRow[] {
  const advised = episodes.filter((e) => e.review_advised === "Yes")
  const groups = new Map<string, Episode[]>()
  for (const e of advised) {
    const key = keyFn(e) ?? "Unknown"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }
  return Array.from(groups.entries())
    .map(([segment, rows]) => {
      const completed = rows.filter((r) => r.review_completed).length
      return { segment, n: rows.length, completed, rate: makeRate(completed, rows.length) }
    })
    .sort((a, b) => b.n - a.n)
}

function ReviewBreakdownTable({ rows, segmentLabel }: { rows: ReviewSegmentRow[]; segmentLabel: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{segmentLabel}</TableHead>
          <TableHead className="text-right">Review-advised (N)</TableHead>
          <TableHead className="text-right">Completed</TableHead>
          <TableHead className="text-right">Completion rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.segment}>
            <TableCell className="font-medium">{r.segment}</TableCell>
            <TableCell className="text-right tabular-nums">{r.n.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">{r.completed.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">
              <RateText rate={r.rate} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export default function ReviewsPage() {
  const { loading, error, filteredEpisodes } = useDashboardData()

  const byFacility = useMemo(
    () => reviewCompletionBreakdown(filteredEpisodes, (e) => e.facility_name),
    [filteredEpisodes]
  )
  const byDiagnosis = useMemo(
    () => reviewCompletionBreakdown(filteredEpisodes, (e) => e.diagnosis_group),
    [filteredEpisodes]
  )
  const byAgeGroup = useMemo(() => {
    const rows = reviewCompletionBreakdown(filteredEpisodes, (e) => e.age_group)
    return [...rows].sort(orderBy(AGE_GROUP_ORDER))
  }, [filteredEpisodes])
  const byDistrict = useMemo(
    () => reviewCompletionBreakdown(filteredEpisodes, (e) => e.district),
    [filteredEpisodes]
  )

  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load processed data: {error}</div>
  }

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  const funnel = careJourneyFunnel(filteredEpisodes)
  const reviewAdvised = filteredEpisodes.filter((e) => e.review_advised === "Yes")

  const overdueEpisodes = filteredEpisodes.filter((e) => e.review_overdue === true)
  const overdueComputableDenominator = reviewAdvised.filter((e) => e.review_due_days != null).length

  const completedReviewDays = reviewAdvised
    .filter((e) => e.review_completed && e.days_consult_to_review != null)
    .map((e) => e.days_consult_to_review as number)
  const medianDays = median(completedReviewDays)

  // "Previous healthcare engagement" association -- defined here as
  // prior_relevant_interactions > 0 vs. === 0 (any prior teleconsult,
  // referral, or follow-up review on record), among review-advised episodes.
  // Episodes whose history couldn't be linked (history_link_status ===
  // "linkage_unresolved") are excluded from both groups and shown as their
  // own count, rather than having their unknown prior-interaction value
  // treated as 0.
  const historyUnresolved = reviewAdvised.filter((e) => e.history_link_status === "linkage_unresolved")
  const historyResolved = reviewAdvised.filter((e) => e.history_link_status !== "linkage_unresolved")
  const withPriorEngagement = historyResolved.filter(
    (e) => e.prior_relevant_interactions != null && e.prior_relevant_interactions > 0
  )
  const withoutPriorEngagement = historyResolved.filter(
    (e) => e.prior_relevant_interactions != null && e.prior_relevant_interactions === 0
  )
  const engagementUnknown = historyResolved.length - withPriorEngagement.length - withoutPriorEngagement.length

  const priorEngagementRate = makeRate(
    withPriorEngagement.filter((e) => e.review_completed).length,
    withPriorEngagement.length
  )
  const noPriorEngagementRate = makeRate(
    withoutPriorEngagement.filter((e) => e.review_completed).length,
    withoutPriorEngagement.length
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Follow-up Reviews"
        description="Of episodes where a follow-up review was advised, how many happened, how overdue is the backlog, and where does completion lag? Every card and table below responds to the filters above."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Review-advised episodes"
          value={funnel.reviewsAdvised.toLocaleString()}
          tooltip="review_advised = 'Yes'. The eligible denominator for every metric on this page."
        />
        <KpiCard
          label="Completed follow-up reviews"
          value={funnel.reviewsCompleted.numerator.toLocaleString()}
          sub={`of ${funnel.reviewsAdvised.toLocaleString()} advised`}
          tooltip="review_completed = true, among review-advised episodes."
        />
        <KpiCard
          label="Review completion rate"
          value={funnel.reviewsCompleted.rate == null ? "—" : `${(funnel.reviewsCompleted.rate * 100).toFixed(1)}%`}
          sub={`${funnel.reviewsCompleted.numerator.toLocaleString()} / ${funnel.reviewsCompleted.denominator.toLocaleString()}`}
          tooltip="Completed follow-up reviews / review-advised episodes."
        />
        <KpiCard
          label="Overdue reviews"
          value={overdueEpisodes.length.toLocaleString()}
          sub={`of ${overdueComputableDenominator.toLocaleString()} with a known due date`}
          tooltip="review_overdue, precomputed by the pipeline: review advised, not completed, and today's-date proxy (2026-08-25) has passed consult_date + review_due_days. Only computable where review_due_days is non-null -- episodes with an unknown due date can never be flagged overdue, so this undercounts the true backlog."
        />
        <KpiCard
          label="Median days, consult → review"
          value={medianDays == null ? "—" : medianDays.toFixed(1)}
          sub={`n = ${completedReviewDays.length.toLocaleString()} completed reviews`}
          tooltip="Median of days_consult_to_review, computed only over episodes with a completed follow-up review (the only episodes where this field is set)."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Which facilities complete the fewest advised reviews?"
          description="Review completion rate by facility, among review-advised episodes"
          denominatorNote={`n = ${reviewAdvised.length.toLocaleString()} review-advised episodes`}
        >
          <ReviewBreakdownTable rows={byFacility} segmentLabel="Facility" />
        </ChartCard>

        <ChartCard
          title="Does review completion vary by diagnosis?"
          description="Review completion rate by disease / diagnosis group"
          denominatorNote={`n = ${reviewAdvised.length.toLocaleString()} review-advised episodes`}
        >
          <ReviewBreakdownTable rows={byDiagnosis} segmentLabel="Diagnosis group" />
        </ChartCard>

        <ChartCard
          title="Does review completion vary by age?"
          description="Review completion rate by age group"
          denominatorNote={`n = ${reviewAdvised.length.toLocaleString()} review-advised episodes`}
        >
          <ReviewBreakdownTable rows={byAgeGroup} segmentLabel="Age group" />
        </ChartCard>

        <ChartCard
          title="Where does review completion lag geographically?"
          description="Review completion rate by district"
          denominatorNote={`n = ${reviewAdvised.length.toLocaleString()} review-advised episodes`}
        >
          <ReviewBreakdownTable rows={byDistrict} segmentLabel="District" />
        </ChartCard>
      </div>

      <ChartCard
        title="Is prior healthcare engagement associated with review completion?"
        description="Review-advised episodes, split by whether the patient had any prior relevant interaction on record (prior_relevant_interactions > 0 vs. = 0)"
        denominatorNote={`${historyUnresolved.length.toLocaleString()} review-advised episode(s) excluded -- history_link_status = "linkage_unresolved", so prior engagement is unknown${
          engagementUnknown > 0 ? `; ${engagementUnknown.toLocaleString()} further excluded with an unknown interaction count` : ""
        }`}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiCard
            label="Prior relevant interactions > 0"
            value={priorEngagementRate.rate == null ? "—" : `${(priorEngagementRate.rate * 100).toFixed(1)}%`}
            sub={`${priorEngagementRate.numerator.toLocaleString()} / ${priorEngagementRate.denominator.toLocaleString()} completed`}
            tooltip="Review completion rate among review-advised episodes with a linked history and prior_relevant_interactions > 0."
          />
          <KpiCard
            label="Prior relevant interactions = 0"
            value={noPriorEngagementRate.rate == null ? "—" : `${(noPriorEngagementRate.rate * 100).toFixed(1)}%`}
            sub={`${noPriorEngagementRate.numerator.toLocaleString()} / ${noPriorEngagementRate.denominator.toLocaleString()} completed`}
            tooltip="Review completion rate among review-advised episodes with a linked history and prior_relevant_interactions = 0."
          />
        </div>
        <AssociationNote text="Association only — not a causal estimate. Patients with more prior contact may simply be easier to reach, not more compliant." />
      </ChartCard>
    </div>
  )
}
