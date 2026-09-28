"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatPct, RateText } from "@/components/dashboard/rate-text"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { CountBarChart } from "@/components/charts/count-bar-chart"
import { TrendLineChart } from "@/components/charts/trend-line-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { careJourneyFunnel, medicineAccessBreakdown } from "@/lib/metrics"
import { makeRate } from "@/lib/types"

const CLASSIFICATION_LABEL: Record<string, string> = {
  completed: "Completed",
  system_stockout: "System stock-out",
  patient_no_collection_attempt: "Patient — no collection attempt",
  indeterminate: "Indeterminate",
  not_advised: "Not advised",
}

const CLASSIFICATION_DESCRIPTION: Record<string, string> = {
  completed: "Fully dispensed — no evidence of a supply-side or collection-side gap.",
  system_stockout:
    "Facility-side stock evidence (a linked dispensing row with stockout_flag=1 or dispense_status='Not dispensed due to stock', or the facility's own stock_status was 'Low stock'/'Reorder raised' for that medicine/month) indicates supply was the constraint, not the patient.",
  patient_no_collection_attempt:
    "A prescription exists, zero dispensing rows were ever recorded for it, and facility stock for that medicine/month was 'Adequate' — supply was not the apparent constraint.",
  indeterminate:
    "Stock evidence for that facility/medicine/month was ambiguous or missing — never defaulted to patient-side blame.",
  not_advised: "Medicine was not advised for this episode; outside the medicine-access funnel entirely.",
}

export default function MedicineAccessPage() {
  const { loading, error, filteredEpisodes, medicineStock, facilities } = useDashboardData()

  const funnel = useMemo(() => careJourneyFunnel(filteredEpisodes), [filteredEpisodes])

  const accessBreakdown = useMemo(() => medicineAccessBreakdown(filteredEpisodes), [filteredEpisodes])

  const accessChartData = useMemo(
    () =>
      accessBreakdown.map((row) => ({
        label: CLASSIFICATION_LABEL[row.classification] ?? row.classification,
        value: row.count,
        denominator: filteredEpisodes.length,
      })),
    [accessBreakdown, filteredEpisodes.length]
  )

  const stockoutTrend = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const r of medicineStock) {
      byMonth.set(r.snapshot_month, (byMonth.get(r.snapshot_month) ?? 0) + r.stockout_days)
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stockoutDays]) => ({ month, stockoutDays }))
  }, [medicineStock])

  const medicineStockoutRanking = useMemo(() => {
    const byMedicine = new Map<string, number>()
    for (const r of medicineStock) {
      byMedicine.set(r.medicine_name, (byMedicine.get(r.medicine_name) ?? 0) + r.stockout_flag_month)
    }
    return Array.from(byMedicine.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
  }, [medicineStock])

  const facilityStockStats = useMemo(() => {
    const facilityNames = new Map(facilities.map((f) => [f.facility_id, f.facility_name]))
    const byFacility = new Map<string, { totalDays: number; stockoutRows: number; totalRows: number }>()
    for (const r of medicineStock) {
      const row = byFacility.get(r.facility_id) ?? { totalDays: 0, stockoutRows: 0, totalRows: 0 }
      row.totalDays += r.stockout_days
      row.stockoutRows += r.stockout_flag_month
      row.totalRows += 1
      byFacility.set(r.facility_id, row)
    }
    return Array.from(byFacility.entries())
      .map(([facility_id, s]) => ({
        facility_id,
        facility_name: facilityNames.get(facility_id) ?? facility_id,
        avgStockoutDays: s.totalRows > 0 ? s.totalDays / s.totalRows : 0,
        availability: s.totalRows > 0 ? 1 - s.stockoutRows / s.totalRows : null,
      }))
      .sort((a, b) => b.avgStockoutDays - a.avgStockoutDays)
  }, [medicineStock, facilities])

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
        title="Medicine Access"
        description="Of episodes where medicine was advised, how much of the prescription actually reaches the patient — and when it doesn't, was that a supply problem or a collection problem? Episode-level cards and charts respond to the filters above; facility stock charts come from a separate, unfiltered table (see caption below)."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Medicine advised"
          value={funnel.medicineAdvised.toLocaleString()}
          tooltip="Count of filtered episodes with medicine_advised='Yes'. Denominator for prescription-generated rate below."
        />
        <KpiCard
          label="Prescription generated rate"
          value={formatPct(funnel.prescriptionGenerated.rate)}
          sub={`${funnel.prescriptionGenerated.numerator.toLocaleString()} / ${funnel.prescriptionGenerated.denominator.toLocaleString()}`}
          tooltip="prescription_generated=true / medicine-advised episodes."
        />
        <KpiCard
          label="Medicine Fulfillment Rate"
          value={formatPct(funnel.medicineFulfillmentRate.rate)}
          sub={`${funnel.medicineFulfillmentRate.numerator.toLocaleString()} / ${funnel.medicineFulfillmentRate.denominator.toLocaleString()} · of ALL prescriptions generated`}
          tooltip="METRICS.md §2: fully-dispensed prescriptions / ALL prescriptions generated (includes zero-attempt prescriptions in the denominator). This is a DIFFERENT metric from Dispensing Success Rate below — do not conflate the two. See VALIDATION_REPORT.md MED-01."
        />
        <KpiCard
          label="Dispensing Success Rate"
          value={formatPct(funnel.dispensingSuccessRate.rate)}
          sub={`${funnel.dispensingSuccessRate.numerator.toLocaleString()} / ${funnel.dispensingSuccessRate.denominator.toLocaleString()} · of prescriptions with ≥1 attempt`}
          tooltip="METRICS.md §4: fully-dispensed prescriptions / prescriptions with ≥1 recorded dispensing attempt (medicine_dispensing_attempted=true). Zero-attempt prescriptions are excluded from this denominator entirely, so this rate is always ≥ Medicine Fulfillment Rate — it answers 'once someone tried to collect, how often did it fully succeed?', not 'of everyone prescribed, how many got it?'."
        />
        <KpiCard
          label="Dispensing attempted"
          value={formatPct(funnel.medicineDispensingAttempted.rate)}
          sub={`${funnel.medicineDispensingAttempted.numerator.toLocaleString()} / ${funnel.medicineDispensingAttempted.denominator.toLocaleString()} · of prescriptions generated`}
          tooltip="Share of generated prescriptions with ≥1 recorded dispensing row of any kind (full or partial) — the denominator-bridge between Medicine Fulfillment Rate and Dispensing Success Rate above. The complement (no attempt at all) is the true zero-attempt / non-collection population."
        />
        <KpiCard
          label="Partial dispensing rate"
          value={formatPct(funnel.medicinePartial.rate)}
          sub={`${funnel.medicinePartial.numerator.toLocaleString()} / ${funnel.medicinePartial.denominator.toLocaleString()} · of prescriptions generated`}
          tooltip="Episodes with medicine_outcome='partial dispensing' / ALL prescriptions generated — an episode-level rate, not a per-dispensing-row rate. (METRICS.md §4 previously described a row-level 'count(partial_fill=1)/count(dispensing rows)' formula that was never implemented; METRICS.md has been corrected to document this episode-level definition instead — see P1_FIXES.md MED-02.)"
        />
        <KpiCard
          label="Medicine-not-received rate"
          value={formatPct(funnel.medicineNotReceived.rate)}
          sub={`${funnel.medicineNotReceived.numerator.toLocaleString()} / ${funnel.medicineNotReceived.denominator.toLocaleString()}`}
          tooltip="medicine_outcome='medicine not received' / prescription generated."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="When medicine access fails, is it the system or the patient?"
          description="medicine_access_classification distribution (Development + Evaluation, filtered)"
          denominatorNote={`n = ${filteredEpisodes.length.toLocaleString()} filtered episodes`}
        >
          <CountBarChart data={accessChartData} horizontal />
          <AssociationNote text="Documented limitation: this derived classification does not perfectly match the dataset's own ground-truth dropout_stage_label. About 9.3% of episodes the dataset labels 'Medicine not collected' (109 of 1,170) are classified 'completed' here by the dispensing-based logic — likely because the ground truth encodes collection timing relative to a deadline that raw dispensing status doesn't capture. (This was 270 of 1,170 / 23% before a per-medicine dispensing-coverage bug was fixed — see P1_FIXES.md — which had let a prescription with 2+ medicines count as 'fully dispensed' if only one of them ever had a dispensing row.) Treat this as a useful but imperfect lens, not an authoritative relabeling." />
        </ChartCard>

        <ChartCard
          title="Has facility stock-out volume improved over the observation window?"
          description="Sum of stockout_days across all facilities and medicines, by snapshot_month"
        >
          <TrendLineChart data={stockoutTrend} xKey="month" series={[{ key: "stockoutDays", label: "Total stockout days" }]} />
          <p className="mt-2 text-xs text-muted-foreground">
            From medicine_stock_status — a separate facility × medicine × month table (27 facilities × 6 medicines × 8 months),
            not affected by the episode filters above.
          </p>
        </ChartCard>
      </div>

      <div className="flex flex-col gap-3">
        <ChartCard
          title="Which medicines see the most stock-out months?"
          description="Count of snapshot-months with stockout_flag_month=1, by medicine_name"
        >
          <CountBarChart data={medicineStockoutRanking} horizontal />
        </ChartCard>

        <ChartCard
          title="Non-compliance vs. system failure: how do the four outcome classes break down?"
          description="Per METRICS.md §4 — a case is only labelled patient-side when facility stock evidence rules out a supply constraint"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classification</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Share of medicine-advised</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accessBreakdown.map((row) => (
                <TableRow key={row.classification}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {CLASSIFICATION_LABEL[row.classification] ?? row.classification}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-xs text-muted-foreground">
                    {CLASSIFICATION_DESCRIPTION[row.classification] ?? ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.count.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <RateText rate={makeRate(row.count, funnel.medicineAdvised)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
      </div>

      <ChartCard
        title="Where does facility-side stock risk concentrate?"
        description="Average stockout_days and medicine availability per facility, across the 6 tracked medicines × 8 months"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Facility</TableHead>
              <TableHead className="text-right">Avg. stock-out days</TableHead>
              <TableHead className="text-right">Medicine availability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facilityStockStats.map((f) => (
              <TableRow key={f.facility_id}>
                <TableCell className="font-medium whitespace-nowrap">{f.facility_name}</TableCell>
                <TableCell className="text-right tabular-nums">{f.avgStockoutDays.toFixed(1)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.availability == null ? "—" : `${(f.availability * 100).toFixed(1)}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Availability = 1 − (stock-out snapshot-months / 8) per medicine, averaged across facilities. From
          medicine_stock_status — not affected by the episode filters above.
        </p>
      </ChartCard>
    </div>
  )
}
