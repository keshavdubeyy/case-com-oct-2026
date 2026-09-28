"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { DimensionExplorer, type Dimension } from "@/components/dashboard/dimension-explorer"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { CountBarChart } from "@/components/charts/count-bar-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { AGE_GROUP_ORDER, DISTANCE_BUCKET_ORDER, developmentOnly, dropoutStageBreakdown, ltfuRate } from "@/lib/metrics"
import type { Episode } from "@/lib/types"

const DIMENSIONS: Dimension[] = [
  { key: "diagnosis_group", label: "Diagnosis", keyFn: (e: Episode) => e.diagnosis_group },
  { key: "age_group", label: "Age group", keyFn: (e: Episode) => e.age_group, order: AGE_GROUP_ORDER },
  { key: "gender", label: "Gender", keyFn: (e: Episode) => e.gender },
  { key: "facility_name", label: "Facility", keyFn: (e: Episode) => e.facility_name },
  { key: "village", label: "Village", keyFn: (e: Episode) => e.village_resolved ?? e.village },
  { key: "district", label: "District", keyFn: (e: Episode) => e.district },
  { key: "distance_bucket", label: "Distance", keyFn: (e: Episode) => e.distance_bucket, order: DISTANCE_BUCKET_ORDER },
  { key: "connectivity_quality", label: "Connectivity", keyFn: (e: Episode) => e.connectivity_quality },
  { key: "road_access", label: "Road access", keyFn: (e: Episode) => e.road_access },
  { key: "vulnerability_group", label: "Vulnerability group", keyFn: (e: Episode) => e.vulnerability_group },
  { key: "known_ncd_status", label: "NCD status", keyFn: (e: Episode) => e.known_ncd_status },
  { key: "ncd_control_status", label: "NCD control status", keyFn: (e: Episode) => e.ncd_control_status },
]

export default function DropoutPage() {
  const { loading, error, filteredEpisodes } = useDashboardData()

  const stageBreakdown = useMemo(() => dropoutStageBreakdown(filteredEpisodes), [filteredEpisodes])

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
  const ltfu = ltfuRate(filteredEpisodes)
  const ltfuCount = dev.filter((e) => e.lost_to_followup_label === 1).length

  const stageData = stageBreakdown.map((s) => ({ label: s.stage, value: s.count, denominator: ltfuCount || undefined }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dropout Analysis"
        description="Where does the lost-to-follow-up problem concentrate? Every breakdown below is correlational, restricted to the Development cohort, and responds to the filters above."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Overall LTFU rate"
          value={ltfu.rate == null ? "—" : `${(ltfu.rate * 100).toFixed(1)}%`}
          sub={`${ltfu.numerator.toLocaleString()} / ${ltfu.denominator.toLocaleString()} · Development only`}
          tooltip="lost_to_followup_label = 1: any required care component (medicine, test, or review — whichever were advised) remained incomplete. Development cohort only, per the dataset's own definition."
        />
        <KpiCard
          label="LTFU episodes"
          value={ltfuCount.toLocaleString()}
          sub={`of ${dev.length.toLocaleString()} development episodes`}
          tooltip="Count of Development-cohort episodes with lost_to_followup_label = 1."
        />
        {stageBreakdown.map((s) => (
          <KpiCard
            key={s.stage}
            label={s.stage}
            value={s.count.toLocaleString()}
            sub={s.pctOfLtfu == null ? "— of LTFU" : `${(s.pctOfLtfu * 100).toFixed(1)}% of LTFU`}
            tooltip={`Development-cohort episodes whose dropout_stage_label = "${s.stage}" — the first unresolved stage, so episodes are never double-counted across stages. % of LTFU = count / all Development LTFU episodes.`}
          />
        ))}
      </div>

      <ChartCard
        title="Which stage do development-cohort dropouts stop at?"
        description="dropout_stage_label distribution, non-completed stages only (Development cohort)"
        denominatorNote={`n = ${ltfuCount.toLocaleString()} LTFU episodes · bars show % of LTFU on hover`}
      >
        <CountBarChart data={stageData} />
      </ChartCard>

      <ChartCard
        title="Where is LTFU rate higher, by dimension?"
        description="Pick a dimension to see episode count, LTFU rate, and completion rate per segment (Development cohort)"
      >
        <DimensionExplorer episodes={filteredEpisodes} dimensions={DIMENSIONS} />
        <AssociationNote />
      </ChartCard>
    </div>
  )
}
