"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { CountBarChart } from "@/components/charts/count-bar-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { developmentOnly } from "@/lib/metrics"
import { makeRate } from "@/lib/types"
import type { Episode } from "@/lib/types"

/** The 6 candidate historical-behaviour features from METRICS.md #11.
 * Each is computed by the pipeline strictly from visit_date < consult_date
 * for the same resolved canonical patient -- this page only presents the
 * association with the known Development-cohort outcome, it does not fit
 * anything. */
type HistoricalFeatureKey =
  | "visits_prior_30d"
  | "visits_prior_60d"
  | "visits_prior_90d"
  | "prior_followup_reviews"
  | "prior_referrals"
  | "prior_relevant_interactions"

const HISTORICAL_FEATURES: { key: HistoricalFeatureKey; label: string }[] = [
  { key: "visits_prior_30d", label: "Visits, prior 30 days" },
  { key: "visits_prior_60d", label: "Visits, prior 60 days" },
  { key: "visits_prior_90d", label: "Visits, prior 90 days" },
  { key: "prior_followup_reviews", label: "Prior follow-up reviews" },
  { key: "prior_referrals", label: "Prior referrals" },
  { key: "prior_relevant_interactions", label: "Prior relevant interactions (NCD follow-up / screening / OPD)" },
]

/** Never coerces null ("linkage unresolved") to 0 -- nulls are dropped from
 * the value list entirely rather than pulling the mean toward zero. In
 * practice this page only ever calls it on history_link_status==="matched"
 * episodes, where the pipeline always populates these fields, but the null
 * guard is kept defensively rather than assumed. */
function featureValues(episodes: Episode[], key: HistoricalFeatureKey): number[] {
  return episodes.map((e) => e[key]).filter((v): v is number => v != null)
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function fmt(v: number | null): string {
  return v == null ? "—" : v.toFixed(2)
}

const INTERACTION_BUCKETS = ["0", "1-2", "3+"] as const
type InteractionBucket = (typeof INTERACTION_BUCKETS)[number]

function bucketInteractions(v: number | null): InteractionBucket | null {
  if (v == null) return null
  if (v <= 0) return "0"
  if (v <= 2) return "1-2"
  return "3+"
}

function bucketCounts(episodes: Episode[]): { label: string; value: number }[] {
  const counts = new Map<InteractionBucket, number>(INTERACTION_BUCKETS.map((b) => [b, 0]))
  for (const e of episodes) {
    const b = bucketInteractions(e.prior_relevant_interactions)
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  return INTERACTION_BUCKETS.map((b) => ({ label: b, value: counts.get(b) ?? 0 }))
}

export default function HistoryPage() {
  const { loading, error, filteredEpisodes } = useDashboardData()

  const linkageCoverage = useMemo(
    () => makeRate(filteredEpisodes.filter((e) => e.history_link_status === "matched").length, filteredEpisodes.length),
    [filteredEpisodes]
  )

  const dev = useMemo(() => developmentOnly(filteredEpisodes), [filteredEpisodes])
  const linked = useMemo(() => dev.filter((e) => e.history_link_status === "matched"), [dev])
  const unresolvedCount = dev.length - linked.length

  const ltfuGroup = useMemo(() => linked.filter((e) => e.lost_to_followup_label === 1), [linked])
  const completedGroup = useMemo(() => linked.filter((e) => e.lost_to_followup_label === 0), [linked])

  const rows = useMemo(
    () =>
      HISTORICAL_FEATURES.map(({ key, label }) => {
        const ltfuValues = featureValues(ltfuGroup, key)
        const completedValues = featureValues(completedGroup, key)
        return {
          key,
          label,
          meanLtfu: mean(ltfuValues),
          medianLtfu: median(ltfuValues),
          meanCompleted: mean(completedValues),
          medianCompleted: median(completedValues),
        }
      }),
    [ltfuGroup, completedGroup]
  )

  const ltfuBuckets = useMemo(() => bucketCounts(ltfuGroup), [ltfuGroup])
  const completedBuckets = useMemo(() => bucketCounts(completedGroup), [completedGroup])

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Historical Behaviour"
        description="Do prior-visit patterns before this episode's consult date associate with the eventual outcome? Candidate features for a future dropout-prediction model, not a fitted model output."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Historical-link coverage"
          value={linkageCoverage.rate == null ? "—" : `${(linkageCoverage.rate * 100).toFixed(1)}%`}
          sub={`${linkageCoverage.numerator.toLocaleString()} / ${linkageCoverage.denominator.toLocaleString()} filtered episodes`}
          tooltip="Share of currently-filtered episodes whose patient link cleared the confidence threshold (history_link_status === 'matched'), and so have usable prior-visit history features. Episodes with an unresolved link are excluded from every average below, never treated as having zero prior visits."
        />
        <KpiCard
          label="Development, link resolved"
          value={linked.length.toLocaleString()}
          sub={`of ${dev.length.toLocaleString()} development episodes`}
          tooltip="Development-cohort episodes with history_link_status === 'matched'. Only these feed the LTFU vs Completed comparison below, since only Development has a known lost_to_followup_label."
        />
        <KpiCard
          label="Link unresolved (excluded)"
          value={unresolvedCount.toLocaleString()}
          sub="Development cohort"
          tooltip="Development-cohort episodes whose patient link did not clear the confidence threshold. Their prior-visit fields are null ('linkage unresolved'), not zero, so they are excluded from the averages rather than silently folded in as zero prior visits."
        />
        <KpiCard
          label="LTFU vs Completed (linked)"
          value={`${ltfuGroup.length.toLocaleString()} / ${completedGroup.length.toLocaleString()}`}
          sub="n(LTFU=1) / n(LTFU=0)"
          tooltip="Split of the link-resolved Development episodes by outcome -- the two groups compared in the table below."
        />
      </div>

      <ChartCard
        title="How do prior-visit counts differ between episodes that were eventually lost to follow-up and those that completed care?"
        description="Development cohort, link-resolved episodes only. Mean of each feature within each outcome group."
        denominatorNote={`N=${unresolvedCount.toLocaleString()} development episodes excluded — patient link unresolved`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Feature</TableHead>
              <TableHead className="text-right">{`Mean (LTFU=1) n=${ltfuGroup.length.toLocaleString()}`}</TableHead>
              <TableHead className="text-right">{`Mean (LTFU=0) n=${completedGroup.length.toLocaleString()}`}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="whitespace-normal">{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(row.meanLtfu)}
                  {row.medianLtfu != null ? (
                    <span className="ml-1 text-xs text-muted-foreground">(median {row.medianLtfu})</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(row.meanCompleted)}
                  {row.medianCompleted != null ? (
                    <span className="ml-1 text-xs text-muted-foreground">(median {row.medianCompleted})</span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <AssociationNote text="These are candidate features for a future dropout-prediction model, shown here only as an association with the historical outcome — not a fitted model, and not a causal claim. Episodes with an unresolved patient link are excluded from the averages above (see the count noted) rather than treated as having zero prior visits." />
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Prior relevant interactions, among episodes eventually lost to follow-up"
          description="prior_relevant_interactions bucketed (NCD follow-up / screening / OPD visits before consult_date)"
          denominatorNote={`n = ${ltfuGroup.length.toLocaleString()} linked LTFU=1 episodes`}
        >
          <CountBarChart data={ltfuBuckets} horizontal />
        </ChartCard>

        <ChartCard
          title="Prior relevant interactions, among episodes that completed care"
          description="prior_relevant_interactions bucketed (NCD follow-up / screening / OPD visits before consult_date)"
          denominatorNote={`n = ${completedGroup.length.toLocaleString()} linked LTFU=0 episodes`}
        >
          <CountBarChart data={completedBuckets} horizontal />
        </ChartCard>
      </div>
    </div>
  )
}
