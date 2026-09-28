"use client"

import { useMemo } from "react"
import type { ReactNode } from "react"

import { ChartCard } from "@/components/dashboard/chart-card"
import { ConfidenceBadge } from "@/components/dashboard/confidence-badge"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatPct, RateText } from "@/components/dashboard/rate-text"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { careJourneyFunnel } from "@/lib/metrics"
import type { Rate } from "@/lib/types"

/** Top-of-funnel row: a plain count, always the 100%-width reference bar for
 * whatever follows it. Never a rate -- there's no denominator above it. */
function FunnelTop({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value.toLocaleString()}</span>
      </div>
      <div className="h-4 w-full rounded bg-primary" />
    </div>
  )
}

/** A funnel stage rendered against its own eligible denominator (the Rate's
 * own `denominator`, not a shared/top-level N) -- bar width and the label
 * both come from that same Rate so they can never drift apart. Rendered via
 * RateText so a percentage never appears without its N. */
function FunnelStage({ label, rate, badge }: { label: string; rate: Rate; badge?: ReactNode }) {
  const pct = rate.rate ?? 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {label}
          {badge}
        </span>
        <RateText rate={rate} className="shrink-0 tabular-nums" />
      </div>
      <div className="h-4 w-full overflow-hidden rounded bg-muted">
        <div className="h-full rounded bg-primary" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  )
}

export default function CareJourneyPage() {
  const { loading, error, filteredEpisodes } = useDashboardData()

  const funnel = useMemo(() => careJourneyFunnel(filteredEpisodes), [filteredEpisodes])

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

  const labConfidenceNote =
    "Tests completed is linkage-dependent: lab_tests has no direct episode key, so it's joined via patient-entity linkage plus a date window rather than a direct key. Confidence-weighted — see the Data Quality & Record Linkage page for method and match distribution."

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Care Journey"
        description="Once medicine, a test, or a review is advised, how much of that journey actually completes? Every stage below divides by the count of episodes eligible for that stage — never by the full episode count. Responds to the filters above."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Medicine advised"
          value={funnel.medicineAdvised.toLocaleString()}
          tooltip="Episodes where medicine_advised = 'Yes'. Denominator for every downstream medicine-stage rate on this page."
        />
        <KpiCard
          label="Prescription generated rate"
          value={formatPct(funnel.prescriptionGenerated.rate)}
          sub={`${funnel.prescriptionGenerated.numerator.toLocaleString()} / ${funnel.prescriptionGenerated.denominator.toLocaleString()} · of medicine advised`}
          tooltip="Episodes with prescription_generated = true, out of episodes where medicine was advised."
        />
        <KpiCard
          label="Medicine Fulfillment Rate"
          value={formatPct(funnel.medicineFulfillmentRate.rate)}
          sub={`${funnel.medicineFulfillmentRate.numerator.toLocaleString()} / ${funnel.medicineFulfillmentRate.denominator.toLocaleString()} · of prescriptions generated`}
          tooltip="medicine_fully_dispensed = true, divided by ALL prescriptions generated — not by all teleconsultations, and not restricted to prescriptions with a dispensing attempt. This is METRICS.md §2's funnel rate. A separate, higher 'Dispensing Success Rate' (fully dispensed / prescriptions with ≥1 attempt only) is shown on the Medicine Access page — the two are never the same number, see METRICS.md §4."
        />
        <KpiCard
          label="Tests advised"
          value={funnel.testsAdvised.toLocaleString()}
          tooltip="Episodes where test_advised = 'Yes'. Denominator for the tests-completed rate."
        />
        <div className="relative">
          <KpiCard
            label="Tests completed rate"
            value={formatPct(funnel.testsCompleted.rate)}
            sub={`${funnel.testsCompleted.numerator.toLocaleString()} / ${funnel.testsCompleted.denominator.toLocaleString()} · computed only for episodes with a resolved lab match — see Data Quality page`}
            tooltip={labConfidenceNote}
          />
          <div className="absolute right-3 top-3">
            <ConfidenceBadge tier="matched" note={labConfidenceNote} />
          </div>
        </div>
        <KpiCard
          label="Reviews advised"
          value={funnel.reviewsAdvised.toLocaleString()}
          tooltip="Episodes where review_advised = 'Yes'. Denominator for the reviews-completed rate."
        />
        <KpiCard
          label="Reviews completed rate"
          value={formatPct(funnel.reviewsCompleted.rate)}
          sub={`${funnel.reviewsCompleted.numerator.toLocaleString()} / ${funnel.reviewsCompleted.denominator.toLocaleString()} · of reviews advised`}
          tooltip="Episodes with ≥1 followup_visits row, out of episodes where a review was advised."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCard
          title="How much of the medicine journey completes, once advised?"
          description="Each stage below is divided by the stage before it, not by all teleconsultations"
          denominatorNote={`n = ${funnel.medicineAdvised.toLocaleString()} medicine-advised episodes`}
        >
          <div className="flex flex-col gap-3">
            <FunnelTop label="Medicine advised" value={funnel.medicineAdvised} />
            <FunnelStage label="Prescription generated" rate={funnel.prescriptionGenerated} />
            <p className="pt-1 text-[11px] font-medium text-muted-foreground">Of prescriptions generated:</p>
            <FunnelStage label="Fully dispensed" rate={funnel.medicineFulfillmentRate} />
            <FunnelStage label="Partially dispensed" rate={funnel.medicinePartial} />
            <FunnelStage label="Not received" rate={funnel.medicineNotReceived} />
          </div>
        </ChartCard>

        <ChartCard
          title="How much of the testing journey completes, once advised?"
          description="Result-available rate among test-advised episodes; linkage-dependent (see badge)"
          denominatorNote={`n = ${funnel.testsAdvised.toLocaleString()} test-advised episodes`}
        >
          <div className="flex flex-col gap-3">
            <FunnelTop label="Tests advised" value={funnel.testsAdvised} />
            <FunnelStage
              label="Completed (result available)"
              rate={funnel.testsCompleted}
              badge={<ConfidenceBadge tier="matched" note={labConfidenceNote} />}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="How much of the follow-up review journey completes, once advised?"
          description="Review-completion rate among review-advised episodes"
          denominatorNote={`n = ${funnel.reviewsAdvised.toLocaleString()} review-advised episodes`}
        >
          <div className="flex flex-col gap-3">
            <FunnelTop label="Reviews advised" value={funnel.reviewsAdvised} />
            <FunnelStage label="Completed" rate={funnel.reviewsCompleted} />
          </div>
        </ChartCard>
      </div>

      <p className="text-[11px] text-muted-foreground">
        These three funnels are not comparable on a shared denominator — each divides by its own eligible base (medicine advised,
        test advised, review advised respectively). The detailed medicine-access classification (system stock-out vs. patient
        non-collection) lives on the Medicine Access page; this page shows only the eligible-denominator completion funnel.
      </p>
    </div>
  )
}
