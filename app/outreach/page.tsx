"use client"

import { useMemo } from "react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { RateText } from "@/components/dashboard/rate-text"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { CountBarChart, type CountDatum } from "@/components/charts/count-bar-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { makeRate } from "@/lib/types"
import type { OutreachAction } from "@/lib/types"

/** METRICS.md #9 -- value-count distribution over a string field, sorted
 * descending so the tallest bar leads. */
function distribution(rows: OutreachAction[], keyFn: (r: OutreachAction) => string): CountDatum[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = keyFn(r) || "Unknown"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value, denominator: rows.length }))
    .sort((a, b) => b.value - a.value)
}

export default function OutreachPage() {
  const { loading, error, filteredEpisodes, outreach } = useDashboardData()

  const filteredOutreach = useMemo(() => {
    const episodeIds = new Set(filteredEpisodes.map((e) => e.episode_id))
    return outreach.filter((o) => episodeIds.has(o.episode_id))
  }, [outreach, filteredEpisodes])

  const methodData = useMemo(() => distribution(filteredOutreach, (r) => r.action_method), [filteredOutreach])
  const outcomeData = useMemo(() => distribution(filteredOutreach, (r) => r.contact_outcome), [filteredOutreach])
  const cadreData = useMemo(() => distribution(filteredOutreach, (r) => r.cadre), [filteredOutreach])
  const followupReasonData = useMemo(() => distribution(filteredOutreach, (r) => r.followup_reason), [filteredOutreach])

  const atRiskEpisodes = useMemo(() => filteredEpisodes.filter((e) => e.at_risk_no_outcome_needed), [filteredEpisodes])

  const successfulContactRate = useMemo(
    () => makeRate(filteredOutreach.filter((r) => r.is_successful_contact === true).length, filteredOutreach.length),
    [filteredOutreach]
  )

  const perAtRiskEpisode = useMemo(
    () => makeRate(filteredOutreach.length, atRiskEpisodes.length),
    [filteredOutreach, atRiskEpisodes]
  )

  // Post-outreach completion association: DEVELOPMENT-cohort at-risk episodes,
  // split by whether they had ≥1 successful outreach contact, comparing the
  // still-LTFU share. Association only -- see AssociationNote below.
  const association = useMemo(() => {
    const devAtRisk = filteredEpisodes.filter((e) => e.cohort === "DEVELOPMENT" && e.at_risk_no_outcome_needed)
    const withContact = devAtRisk.filter((e) => e.successful_contact_count > 0)
    const withoutContact = devAtRisk.filter((e) => e.successful_contact_count === 0)
    return {
      withContact: makeRate(withContact.filter((e) => e.lost_to_followup_label === 1).length, withContact.length),
      withoutContact: makeRate(withoutContact.filter((e) => e.lost_to_followup_label === 1).length, withoutContact.length),
    }
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
        title="Outreach"
        description="How much outreach happens, does it land, and how does it relate to completion? Every card and chart below responds to the filters above."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <KpiCard
          label="Total outreach actions"
          value={filteredOutreach.length.toLocaleString()}
          tooltip="Rows in outreach_actions.csv whose episode_id falls within the currently filtered episodes."
        />
        <KpiCard
          label="Outreach actions per at-risk episode"
          value={perAtRiskEpisode.rate == null ? "—" : perAtRiskEpisode.rate.toFixed(2)}
          sub={`${perAtRiskEpisode.numerator.toLocaleString()} actions / ${perAtRiskEpisode.denominator.toLocaleString()} at-risk episodes`}
          tooltip="Total outreach actions divided by count of filtered episodes flagged at_risk_no_outcome_needed (computable without the outcome label, so valid on EVALUATION episodes too)."
        />
        <KpiCard
          label="Successful contact rate"
          value={successfulContactRate.rate == null ? "—" : `${(successfulContactRate.rate * 100).toFixed(1)}%`}
          sub={`${successfulContactRate.numerator.toLocaleString()} / ${successfulContactRate.denominator.toLocaleString()}`}
          tooltip="Share of outreach actions where is_successful_contact = true, among the currently filtered outreach actions."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="How do outreach workers try to make contact?"
          description="action_method distribution"
          denominatorNote={`n = ${filteredOutreach.length.toLocaleString()} outreach actions`}
        >
          <CountBarChart data={methodData} horizontal />
        </ChartCard>

        <ChartCard
          title="What happens when contact is attempted?"
          description="contact_outcome distribution"
          denominatorNote={`n = ${filteredOutreach.length.toLocaleString()} outreach actions`}
        >
          <CountBarChart data={outcomeData} horizontal />
        </ChartCard>

        <ChartCard
          title="Who is doing the outreach?"
          description="cadre distribution (ASHA / CHO)"
          denominatorNote={`n = ${filteredOutreach.length.toLocaleString()} outreach actions`}
        >
          <CountBarChart data={cadreData} horizontal />
        </ChartCard>

        <ChartCard
          title="Why was the episode flagged for follow-up?"
          description="followup_reason distribution"
          denominatorNote={`n = ${filteredOutreach.length.toLocaleString()} outreach actions`}
        >
          <CountBarChart data={followupReasonData} horizontal />
        </ChartCard>
      </div>

      <ChartCard
        title="Do episodes with a successful outreach contact show a different completion pattern?"
        description="Still-LTFU share among DEVELOPMENT-cohort at-risk episodes, split by whether outreach ever landed"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">With ≥1 successful outreach contact</span>
            <RateText rate={association.withContact} className="text-lg font-semibold" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">With no successful outreach contact</span>
            <RateText rate={association.withoutContact} className="text-lg font-semibold" />
          </div>
        </div>
        <AssociationNote text="Episodes with a successful outreach contact show a different completion pattern than those without — this is an association, not evidence that outreach caused the outcome. At-risk episodes may have been contacted precisely because they looked harder to reach, which would bias this comparison." />
      </ChartCard>
    </div>
  )
}
