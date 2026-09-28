"use client"

import { useMemo, useState } from "react"

import { PageHeader } from "@/components/dashboard/page-header"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { developmentOnly } from "@/lib/metrics"
import { makeRate, type Episode, type Facility, type MedicineStockRow, type Rate } from "@/lib/types"

/**
 * One row per facility (27 total, from the static `facilities` reference
 * list — not derived from filteredEpisodes, so a facility filtered down to
 * zero episodes still appears with n=0 rather than silently disappearing).
 * All episode-derived numbers are scoped to that facility's slice of
 * filteredEpisodes and recomputed locally per METRICS.md §8 (mirrors
 * careJourneyFunnel's numerator/denominator logic, scoped per facility,
 * rather than averaging any global pre-computed rate).
 */
interface FacilityRow {
  facility: Facility
  teleconsultations: number
  uniquePatients: number
  ltfu: Rate
  medicineCompletion: Rate
  labCompletion: Rate
  reviewCompletion: Rate
  outreachActions: number
  contactSuccess: Rate
  stockoutDays: number
}

function buildFacilityRows(facilities: Facility[], episodes: Episode[], medicineStock: MedicineStockRow[]): FacilityRow[] {
  const byFacility = new Map<string, Episode[]>()
  for (const e of episodes) {
    if (!byFacility.has(e.facility_id)) byFacility.set(e.facility_id, [])
    byFacility.get(e.facility_id)!.push(e)
  }

  const stockByFacility = new Map<string, number>()
  for (const s of medicineStock) {
    stockByFacility.set(s.facility_id, (stockByFacility.get(s.facility_id) ?? 0) + s.stockout_days)
  }

  return facilities.map((facility) => {
    const fEpisodes = byFacility.get(facility.facility_id) ?? []

    const uniquePatients = new Set(fEpisodes.map((e) => e.predicted_patient_id).filter((id): id is string => id != null)).size

    // METRICS.md #0 -- LTFU is DEVELOPMENT-cohort only.
    const dev = developmentOnly(fEpisodes)
    const ltfuCount = dev.filter((e) => e.lost_to_followup_label === 1).length
    const ltfu = makeRate(ltfuCount, dev.length)

    // METRICS.md #2/#4 -- medicine completion = fully dispensed / prescription generated (eligible denominator), reimplemented per facility.
    const medAdvised = fEpisodes.filter((e) => e.medicine_advised === "Yes")
    const presc = medAdvised.filter((e) => e.prescription_generated)
    const fullyDispensed = presc.filter((e) => e.medicine_fully_dispensed).length
    const medicineCompletion = makeRate(fullyDispensed, presc.length)

    const testAdvised = fEpisodes.filter((e) => e.test_advised === "Yes")
    const testsCompleted = testAdvised.filter((e) => e.test_status === "Available").length
    const labCompletion = makeRate(testsCompleted, testAdvised.length)

    const reviewAdvised = fEpisodes.filter((e) => e.review_advised === "Yes")
    const reviewsCompleted = reviewAdvised.filter((e) => e.review_completed).length
    const reviewCompletion = makeRate(reviewsCompleted, reviewAdvised.length)

    const outreachActions = fEpisodes.reduce((sum, e) => sum + e.outreach_count, 0)
    const successfulContacts = fEpisodes.reduce((sum, e) => sum + e.successful_contact_count, 0)
    const contactSuccess = makeRate(successfulContacts, outreachActions)

    const stockoutDays = stockByFacility.get(facility.facility_id) ?? 0

    return {
      facility,
      teleconsultations: fEpisodes.length,
      uniquePatients,
      ltfu,
      medicineCompletion,
      labCompletion,
      reviewCompletion,
      outreachActions,
      contactSuccess,
      stockoutDays,
    }
  })
}

function fmtRate(rate: Rate): string {
  if (rate.rate == null) return `— (n=${rate.denominator})`
  return `${(rate.rate * 100).toFixed(1)}% (${rate.numerator}/${rate.denominator})`
}

type SortMode = "geography" | "ltfu"

export default function FacilitiesPage() {
  const { loading, error, filteredEpisodes, facilities, medicineStock } = useDashboardData()
  const [sortMode, setSortMode] = useState<SortMode>("geography")

  const rows = useMemo(
    () => buildFacilityRows(facilities, filteredEpisodes, medicineStock),
    [facilities, filteredEpisodes, medicineStock]
  )

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (sortMode === "ltfu") {
      copy.sort((a, b) => {
        if (a.ltfu.rate == null && b.ltfu.rate == null) return 0
        if (a.ltfu.rate == null) return 1
        if (b.ltfu.rate == null) return -1
        return b.ltfu.rate - a.ltfu.rate
      })
    } else {
      copy.sort((a, b) => {
        const d = a.facility.district.localeCompare(b.facility.district)
        if (d !== 0) return d
        return a.facility.block.localeCompare(b.facility.block)
      })
    }
    return copy
  }, [rows, sortMode])

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

  const facilitiesInView = new Set(filteredEpisodes.map((e) => e.facility_id)).size
  const busiest = [...rows].sort((a, b) => b.teleconsultations - a.teleconsultations)[0]
  const quietest = [...rows].sort((a, b) => a.teleconsultations - b.teleconsultations)[0]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Facility Analysis"
        description="How does case volume, workforce, connectivity, and care-journey performance vary by facility? Every facility is shown with its geography and workforce context alongside any rate — this is not a leaderboard, and the default sort is by district/block, not by performance."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Facilities in view"
          value={`${facilitiesInView.toLocaleString()} / ${facilities.length.toLocaleString()}`}
          tooltip="Distinct facility_id values among the currently filtered episodes, out of 27 total facilities. The table below always shows all facilities; a facility with zero filtered episodes shows n=0 rather than disappearing."
        />
        <KpiCard
          label="Busiest facility (in view)"
          value={busiest ? busiest.teleconsultations.toLocaleString() : "—"}
          sub={busiest?.facility.facility_name}
          tooltip="Facility with the highest teleconsultation count among currently filtered episodes. Volume context only, not a performance ranking."
        />
        <KpiCard
          label="Quietest facility (in view)"
          value={quietest ? quietest.teleconsultations.toLocaleString() : "—"}
          sub={quietest?.facility.facility_name}
          tooltip="Facility with the lowest teleconsultation count among currently filtered episodes. Volume context only, not a performance ranking."
        />
        <KpiCard
          label="Total medicine stock-out days"
          value={rows.reduce((sum, r) => sum + r.stockoutDays, 0).toLocaleString()}
          sub="Across all 27 facilities, all months"
          tooltip="Sum of medicine_stock_status.stockout_days across every facility and medicine snapshot. Not affected by the episode filter bar — this reference table is filtered by facility only."
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Unique-patient counts use probabilistic patient-entity linkage (<code>predicted_patient_id</code>) and are
            approximate, especially where links are medium-confidence or ambiguous rather than high-confidence — treat as
            directional, not exact deduplication.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortMode((m) => (m === "ltfu" ? "geography" : "ltfu"))}
          >
            {sortMode === "ltfu" ? "Reset to district / block order" : "Sort by LTFU rate (descending)"}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Facility</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>District</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Network</TableHead>
              <TableHead className="text-right">CHOs</TableHead>
              <TableHead className="text-right">ASHA-linked</TableHead>
              <TableHead className="text-right">Teleconsultations</TableHead>
              <TableHead className="text-right">Unique patients</TableHead>
              <TableHead>LTFU rate (Dev.)</TableHead>
              <TableHead>Medicine completion</TableHead>
              <TableHead>Lab completion</TableHead>
              <TableHead>Review completion</TableHead>
              <TableHead className="text-right">Outreach actions</TableHead>
              <TableHead>Contact success</TableHead>
              <TableHead className="text-right">Stock-out days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((r) => (
              <TableRow key={r.facility.facility_id}>
                <TableCell className="font-medium">{r.facility.facility_name}</TableCell>
                <TableCell>{r.facility.facility_type}</TableCell>
                <TableCell>{r.facility.district}</TableCell>
                <TableCell>{r.facility.block}</TableCell>
                <TableCell className="text-muted-foreground">{r.facility.network_context}</TableCell>
                <TableCell className="text-right tabular-nums">{r.facility.cho_count}</TableCell>
                <TableCell className="text-right tabular-nums">{r.facility.asha_linked_count}</TableCell>
                <TableCell className="text-right tabular-nums">{r.teleconsultations.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.uniquePatients.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{fmtRate(r.ltfu)}</TableCell>
                <TableCell className="tabular-nums">{fmtRate(r.medicineCompletion)}</TableCell>
                <TableCell className="tabular-nums">{fmtRate(r.labCompletion)}</TableCell>
                <TableCell className="tabular-nums">{fmtRate(r.reviewCompletion)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.outreachActions.toLocaleString()}</TableCell>
                <TableCell className="tabular-nums">{fmtRate(r.contactSuccess)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.stockoutDays.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
