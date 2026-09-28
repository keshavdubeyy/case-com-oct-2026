"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { SegmentTable } from "@/components/dashboard/segment-table"
import { SegmentRateBarChart } from "@/components/charts/segment-rate-bar-chart"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { CHART_AXIS, ltfuStatusColor, STATUS } from "@/lib/chart-colors"
import { DISTANCE_BUCKET_ORDER, ltfuRate, orderBy, segmentBreakdown } from "@/lib/metrics"

const MAP_SIZE = 400
const MAP_PAD = 10
const MAP_SPAN = MAP_SIZE - 2 * MAP_PAD

const LEGEND_ITEMS = [
  { label: "Good (< 25% LTFU)", color: STATUS.good },
  { label: "Warning (25–40%)", color: STATUS.warning },
  { label: "Serious (40–55%)", color: STATUS.serious },
  { label: "Critical (≥ 55%)", color: STATUS.critical },
  { label: "No episodes in view", color: CHART_AXIS },
]

export default function GeographyPage() {
  const { loading, error, filteredEpisodes, facilities } = useDashboardData()

  const distanceRows = useMemo(
    () => segmentBreakdown(filteredEpisodes, (e) => e.distance_bucket).sort(orderBy(DISTANCE_BUCKET_ORDER)),
    [filteredEpisodes]
  )
  const connectivityRows = useMemo(
    () => segmentBreakdown(filteredEpisodes, (e) => e.connectivity_quality),
    [filteredEpisodes]
  )
  const roadAccessRows = useMemo(() => segmentBreakdown(filteredEpisodes, (e) => e.road_access), [filteredEpisodes])
  const villageRows = useMemo(
    () => segmentBreakdown(filteredEpisodes, (e) => e.village_resolved ?? e.village),
    [filteredEpisodes]
  )
  const districtRows = useMemo(() => segmentBreakdown(filteredEpisodes, (e) => e.district), [filteredEpisodes])

  const facilityPoints = useMemo(() => {
    const byFacility = new Map<string, typeof filteredEpisodes>()
    for (const e of filteredEpisodes) {
      const arr = byFacility.get(e.facility_id)
      if (arr) arr.push(e)
      else byFacility.set(e.facility_id, [e])
    }

    const lats = facilities.map((f) => f.latitude)
    const lons = facilities.map((f) => f.longitude)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const latSpan = maxLat - minLat
    const lonSpan = maxLon - minLon

    return facilities.map((f) => {
      const eps = byFacility.get(f.facility_id) ?? []
      const rate = ltfuRate(eps)
      const x = lonSpan > 0 ? ((f.longitude - minLon) / lonSpan) * MAP_SPAN + MAP_PAD : MAP_SIZE / 2
      const y = latSpan > 0 ? ((maxLat - f.latitude) / latSpan) * MAP_SPAN + MAP_PAD : MAP_SIZE / 2
      const radius = Math.min(14, Math.max(3, Math.sqrt(eps.length)))
      return { facility: f, x, y, radius, episodeCount: eps.length, ltfuRate: rate.rate }
    })
  }, [facilities, filteredEpisodes])

  const districtsInView = useMemo(() => new Set(filteredEpisodes.map((e) => e.district)).size, [filteredEpisodes])
  const villagesInView = useMemo(
    () => new Set(filteredEpisodes.map((e) => e.village_resolved ?? e.village)).size,
    [filteredEpisodes]
  )
  const facilitiesInView = useMemo(
    () => new Set(filteredEpisodes.map((e) => e.facility_id)).size,
    [filteredEpisodes]
  )
  const avgDistanceKm = useMemo(() => {
    if (filteredEpisodes.length === 0) return null
    const sum = filteredEpisodes.reduce((acc, e) => acc + e.distance_to_facility_km, 0)
    return sum / filteredEpisodes.length
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Geography & Access"
        description="Where does lost-to-follow-up concentrate geographically, and how does it relate to distance, connectivity, and road access? Every card below responds to the filters above; facility locations are a fixed reference layer."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Districts in view"
          value={districtsInView.toLocaleString()}
          tooltip="Distinct district values among currently filtered episodes."
        />
        <KpiCard
          label="Villages in view"
          value={villagesInView.toLocaleString()}
          tooltip="Distinct village_resolved (falling back to raw village) values among currently filtered episodes. Up to 36 canonical villages after normalization — see Data Quality page."
        />
        <KpiCard
          label="Facilities in view"
          value={facilitiesInView.toLocaleString()}
          tooltip="Distinct facility_id values among currently filtered episodes, out of 27 total facilities."
        />
        <KpiCard
          label="Avg. distance to facility"
          value={avgDistanceKm == null ? "—" : `${avgDistanceKm.toFixed(1)} km`}
          tooltip="Mean of distance_to_facility_km across currently filtered episodes (all cohorts) — an episode-level field with zero linkage dependency."
        />
      </div>

      <ChartCard
        title="Where are facilities, and how does LTFU rate vary by location? (schematic, not to scale)"
        description="Dot position is a linear projection of facility latitude/longitude, not a real basemap. Dot size ~ episode volume; dot color ~ LTFU rate severity."
        denominatorNote={`${facilities.length} facilities (facility_reference, unfiltered reference table) · episode counts and LTFU rate per facility from currently filtered episodes`}
      >
        <div className="mx-auto max-w-md">
          <svg viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`} role="img" aria-label="Schematic scatter of facility locations, sized by episode volume and colored by LTFU rate" className="h-auto w-full">
            <rect x={0} y={0} width={MAP_SIZE} height={MAP_SIZE} fill="var(--muted)" opacity={0.3} rx={8} />
            {facilityPoints.map((p) => (
              <circle
                key={p.facility.facility_id}
                cx={p.x}
                cy={p.y}
                r={p.radius}
                fill={ltfuStatusColor(p.ltfuRate)}
                fillOpacity={0.85}
                stroke="var(--background)"
                strokeWidth={1}
              >
                <title>{`${p.facility.facility_name}: ${p.episodeCount.toLocaleString()} episodes, ${p.ltfuRate == null ? "—" : `${(p.ltfuRate * 100).toFixed(1)}%`} LTFU`}</title>
              </circle>
            ))}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
        <AssociationNote text="Facility-level LTFU rate is Development-cohort only; association only — not a causal estimate of facility quality." />
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="How does LTFU rate vary with distance to facility?"
          description="distance_to_facility_km bucketed. Episode-level field with zero linkage dependency."
          denominatorNote={`n = ${distanceRows.reduce((a, r) => a + r.episodeCount, 0).toLocaleString()} development episodes`}
        >
          <SegmentRateBarChart rows={distanceRows} />
          <SegmentTable rows={distanceRows} segmentLabel="Distance" />
        </ChartCard>

        <ChartCard
          title="How does LTFU rate vary with connectivity during the consult?"
          description="connectivity_quality is the episode's own recorded connectivity at consult time — distinct from the village-level mobile_connectivity reference field shown in the road-access-style breakdowns below."
          denominatorNote={`n = ${connectivityRows.reduce((a, r) => a + r.episodeCount, 0).toLocaleString()} development episodes`}
        >
          <SegmentRateBarChart rows={connectivityRows} />
          <SegmentTable rows={connectivityRows} segmentLabel="Connectivity" />
        </ChartCard>

        <ChartCard
          title="How does LTFU rate vary with road access?"
          description="road_access is a village-level field from geography_reference, joined via a normalized-village match — it carries the linkage's village-resolution confidence, not the patient-entity confidence."
          denominatorNote={`n = ${roadAccessRows.reduce((a, r) => a + r.episodeCount, 0).toLocaleString()} development episodes`}
        >
          <SegmentRateBarChart rows={roadAccessRows} />
          <SegmentTable rows={roadAccessRows} segmentLabel="Road access" />
        </ChartCard>

        <ChartCard
          title="How does LTFU rate vary by district?"
          description="Episode's own recorded district — clean/categorical, no linkage dependency."
          denominatorNote={`n = ${districtRows.reduce((a, r) => a + r.episodeCount, 0).toLocaleString()} development episodes`}
        >
          <SegmentRateBarChart rows={districtRows} />
          <SegmentTable rows={districtRows} segmentLabel="District" />
        </ChartCard>

        <ChartCard
          title="How does LTFU rate vary by village?"
          description="village_resolved (falling back to raw village text) — ~36 canonical villages after normalization; see Data Quality page for match-score distribution. Chart shows the top 15 villages by episode volume; the table below lists all."
          denominatorNote={`n = ${villageRows.reduce((a, r) => a + r.episodeCount, 0).toLocaleString()} development episodes across ${villageRows.length} villages`}
          className="lg:col-span-2"
        >
          <SegmentRateBarChart rows={villageRows.slice(0, 15)} />
          <div className="mt-3 max-h-96 overflow-y-auto">
            <SegmentTable rows={villageRows} segmentLabel="Village" />
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
