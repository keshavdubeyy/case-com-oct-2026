"use client"

import { AssociationNote } from "@/components/dashboard/association-note"
import { DimensionExplorer, type Dimension } from "@/components/dashboard/dimension-explorer"
import { PageHeader } from "@/components/dashboard/page-header"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { AGE_GROUP_ORDER, DISTANCE_BUCKET_ORDER } from "@/lib/metrics"

const DIMENSIONS: Dimension[] = [
  { key: "age_group", label: "Age", keyFn: (e) => e.age_group, order: AGE_GROUP_ORDER },
  { key: "gender", label: "Gender", keyFn: (e) => e.gender },
  { key: "diagnosis_group", label: "Diagnosis", keyFn: (e) => e.diagnosis_group },
  { key: "known_ncd_status", label: "NCD status", keyFn: (e) => e.known_ncd_status },
  { key: "ncd_control_status", label: "NCD control status", keyFn: (e) => e.ncd_control_status },
  { key: "vulnerability_group", label: "Vulnerability group", keyFn: (e) => e.vulnerability_group },
  { key: "preferred_language", label: "Language", keyFn: (e) => e.preferred_language },
  { key: "distance_bucket", label: "Distance", keyFn: (e) => e.distance_bucket, order: DISTANCE_BUCKET_ORDER },
  { key: "village", label: "Village", keyFn: (e) => e.village_resolved ?? e.village },
  { key: "district", label: "District", keyFn: (e) => e.district },
  {
    key: "prior_engagement",
    label: "Previous visit behaviour",
    keyFn: (e) =>
      e.history_link_status === "linkage_unresolved"
        ? "Unresolved"
        : (e.prior_relevant_interactions ?? 0) > 0
          ? "Had prior engagement"
          : "No prior engagement",
  },
]

export default function SegmentsPage() {
  const { loading, error, filteredEpisodes } = useDashboardData()

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
        title="Patient Segments"
        description="How do follow-up outcomes compare across patient and location characteristics? A general exploratory view — pick any dimension below to compare episode volume, LTFU rate, and completion rate across its segments. For a focused look at dropout drivers specifically, see Dropout Analysis."
      />

      <DimensionExplorer episodes={filteredEpisodes} dimensions={DIMENSIONS} />
      <AssociationNote />
    </div>
  )
}
