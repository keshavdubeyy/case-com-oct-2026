"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { CountBarChart } from "@/components/charts/count-bar-chart"
import { TrendLineChart } from "@/components/charts/trend-line-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { careCompletionRate, developmentOnly, dropoutStageBreakdown, ltfuRate } from "@/lib/metrics"

export default function OverviewPage() {
  const { loading, error, filteredEpisodes, dataQuality } = useDashboardData()

  const stageData = useMemo(
    () => dropoutStageBreakdown(filteredEpisodes).map((s) => ({ label: s.stage, value: s.count })),
    [filteredEpisodes]
  )

  const monthly = useMemo(() => {
    const byMonth = new Map<string, { development: number; evaluation: number }>()
    for (const e of filteredEpisodes) {
      const month = e.consult_date.slice(0, 7)
      const row = byMonth.get(month) ?? { development: 0, evaluation: 0 }
      if (e.cohort === "DEVELOPMENT") row.development++
      else row.evaluation++
      byMonth.set(month, row)
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }))
  }, [filteredEpisodes])

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

  const dev = developmentOnly(filteredEpisodes)
  const evalCohort = filteredEpisodes.filter((e) => e.cohort === "EVALUATION")
  const ltfu = ltfuRate(filteredEpisodes)
  const completion = careCompletionRate(filteredEpisodes)
  const ltfuCount = dev.filter((e) => e.lost_to_followup_label === 1).length
  const evalAtRisk = evalCohort.filter((e) => e.at_risk_no_outcome_needed).length
  const requiringAction = ltfuCount + evalAtRisk

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Overview"
        description="How large is the lost-to-follow-up problem, and where does it concentrate? Every card and chart below responds to the filters above."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Total patients"
          value={(dataQuality?.row_counts.patient_360_reference ?? 0).toLocaleString()}
          tooltip="Distinct rows in patient_360_reference.csv, the canonical patient entity table. Not affected by filters — this is the full reference population."
        />
        <KpiCard
          label="Total episodes"
          value={filteredEpisodes.length.toLocaleString()}
          tooltip="One row per teleconsultation episode (episode_outcomes.csv), after applying the filters above."
        />
        <KpiCard
          label="Development cohort"
          value={dev.length.toLocaleString()}
          sub="consult_date ≤ 2026-06-30"
          tooltip="Episodes whose outcome label is known. All LTFU / dropout / completion rates on this dashboard are computed on this cohort only."
        />
        <KpiCard
          label="Evaluation cohort"
          value={evalCohort.length.toLocaleString()}
          sub="consult_date 2026-07-01 → 2026-08-15"
          tooltip="Episodes whose lost_to_followup_label and dropout_stage_label are blank by design (organizer-retained). Shown for volume/context only — never used in a rate."
        />
        <KpiCard
          label="Lost-to-follow-up rate"
          value={ltfu.rate == null ? "—" : `${(ltfu.rate * 100).toFixed(1)}%`}
          sub={`${ltfu.numerator.toLocaleString()} / ${ltfu.denominator.toLocaleString()} · Development only`}
          tooltip="lost_to_followup_label = 1: any required care component (medicine, test, or review — whichever were advised) remained incomplete. Development cohort only, per the dataset's own definition."
        />
        <KpiCard
          label="Completed-care rate"
          value={completion.rate == null ? "—" : `${(completion.rate * 100).toFixed(1)}%`}
          sub={`${completion.numerator.toLocaleString()} / ${completion.denominator.toLocaleString()} · Development only`}
          tooltip="lost_to_followup_label = 0: every advised care component was completed. Development cohort only."
        />
        <KpiCard
          label="Episodes requiring action"
          value={requiringAction.toLocaleString()}
          sub={`${ltfuCount.toLocaleString()} confirmed LTFU + ${evalAtRisk.toLocaleString()} at-risk (evaluation)`}
          tooltip="Development episodes already confirmed lost-to-follow-up, plus Evaluation episodes flagged at-risk using only fields known without the outcome label (advised-but-not-yet-completed medicine/test/review). Evaluation episodes are never counted as LTFU — their label is unknown, not negative."
        />
        <KpiCard
          label="Facilities in view"
          value={new Set(filteredEpisodes.map((e) => e.facility_id)).size.toLocaleString()}
          tooltip="Distinct facility_id values among the currently filtered episodes, out of 27 total facilities."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Where do development-cohort episodes stop, when they stop?"
          description="dropout_stage_label distribution (Development cohort only)"
          denominatorNote={`n = ${dev.length.toLocaleString()} development episodes`}
        >
          <CountBarChart data={stageData} />
          <AssociationNote text="First unresolved stage only — an episode is counted once, at whichever stage broke first." />
        </ChartCard>

        <ChartCard
          title="How does episode volume split across cohorts over time?"
          description="Teleconsultations by month of consult_date"
        >
          <TrendLineChart
            data={monthly}
            xKey="month"
            series={[
              { key: "development", label: "Development" },
              { key: "evaluation", label: "Evaluation" },
            ]}
          />
        </ChartCard>
      </div>
    </div>
  )
}
