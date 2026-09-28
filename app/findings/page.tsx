"use client"

import { useMemo } from "react"
import Link from "next/link"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ChartCard } from "@/components/dashboard/chart-card"
import { ConfidenceBadge } from "@/components/dashboard/confidence-badge"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatPct, RateText } from "@/components/dashboard/rate-text"
import { SegmentTable } from "@/components/dashboard/segment-table"
import { CountBarChart } from "@/components/charts/count-bar-chart"
import { SegmentRateBarChart } from "@/components/charts/segment-rate-bar-chart"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Skeleton } from "@/components/ui/skeleton"
import {
  careCompletionRate,
  careJourneyFunnel,
  developmentOnly,
  dropoutStageBreakdown,
  ltfuRate,
  medicineAccessBreakdown,
  segmentBreakdown,
} from "@/lib/metrics"
import { makeRate } from "@/lib/types"

const CLASSIFICATION_LABEL: Record<string, string> = {
  completed: "Completed",
  system_stockout: "System stock-out",
  patient_no_collection_attempt: "Patient — no collection attempt",
  indeterminate: "Indeterminate",
  not_advised: "Not advised",
}

/** Section number + title, rendered identically for every section on this
 * page so the "section-wise" structure the page exists for is visually
 * consistent rather than typed per-section. */
function SectionHeading({ n, title, blurb }: { n: number; title: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3 border-b pb-2">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
    </div>
  )
}

function SeeAlso({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-xs text-primary underline underline-offset-2 hover:no-underline">
      Full detail → {label}
    </Link>
  )
}

export default function FindingsPage() {
  const { loading, error, filteredEpisodes, outreach, dataQuality, labLinkageDiagnostics } = useDashboardData()

  const dev = useMemo(() => developmentOnly(filteredEpisodes), [filteredEpisodes])
  const ltfu = useMemo(() => ltfuRate(filteredEpisodes), [filteredEpisodes])
  const completion = useMemo(() => careCompletionRate(filteredEpisodes), [filteredEpisodes])
  const stageBreakdown = useMemo(() => dropoutStageBreakdown(filteredEpisodes), [filteredEpisodes])
  const funnel = useMemo(() => careJourneyFunnel(filteredEpisodes), [filteredEpisodes])
  const accessBreakdown = useMemo(() => medicineAccessBreakdown(filteredEpisodes), [filteredEpisodes])

  const distanceRows = useMemo(() => segmentBreakdown(filteredEpisodes, (e) => e.distance_bucket), [filteredEpisodes])
  const connectivityRows = useMemo(() => segmentBreakdown(filteredEpisodes, (e) => e.connectivity_quality), [filteredEpisodes])
  const ncdControlRows = useMemo(() => segmentBreakdown(filteredEpisodes, (e) => e.ncd_control_status), [filteredEpisodes])

  const stageData = useMemo(() => stageBreakdown.map((s) => ({ label: s.stage, value: s.count })), [stageBreakdown])
  const accessChartData = useMemo(
    () =>
      accessBreakdown.map((row) => ({
        label: CLASSIFICATION_LABEL[row.classification] ?? row.classification,
        value: row.count,
        denominator: filteredEpisodes.length,
      })),
    [accessBreakdown, filteredEpisodes.length]
  )

  const linkagePctData = useMemo(
    () => (dataQuality?.linkage_stats ?? []).map((s) => ({ label: s.source_system, value: Math.round(s.linked_pct * 10) / 10 })),
    [dataQuality]
  )

  const filteredOutreach = useMemo(() => {
    const episodeIds = new Set(filteredEpisodes.map((e) => e.episode_id))
    return outreach.filter((o) => episodeIds.has(o.episode_id))
  }, [outreach, filteredEpisodes])
  const successfulContactRate = useMemo(
    () => makeRate(filteredOutreach.filter((r) => r.is_successful_contact === true).length, filteredOutreach.length),
    [filteredOutreach]
  )
  const outreachAssociation = useMemo(() => {
    const devAtRisk = filteredEpisodes.filter((e) => e.cohort === "DEVELOPMENT" && e.at_risk_no_outcome_needed)
    const withContact = devAtRisk.filter((e) => e.successful_contact_count > 0)
    const withoutContact = devAtRisk.filter((e) => e.successful_contact_count === 0)
    return {
      withContact: makeRate(withContact.filter((e) => e.lost_to_followup_label === 1).length, withContact.length),
      withoutContact: makeRate(withoutContact.filter((e) => e.lost_to_followup_label === 1).length, withoutContact.length),
    }
  }, [filteredEpisodes])

  const priorEngagement = useMemo(() => {
    const resolved = dev.filter((e) => e.history_link_status === "matched")
    const ltfuGroup = resolved.filter((e) => e.lost_to_followup_label === 1)
    const completedGroup = resolved.filter((e) => e.lost_to_followup_label === 0)
    const mean = (rows: typeof resolved) => {
      const vals = rows.map((r) => r.prior_relevant_interactions).filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    return {
      n: resolved.length,
      ltfuMean: mean(ltfuGroup),
      completedMean: mean(completedGroup),
    }
  }, [dev])

  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load processed data: {error}</div>
  }

  if (loading || !dataQuality) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  const ltfuCount = dev.filter((e) => e.lost_to_followup_label === 1).length
  const meanLinkedPct = dataQuality.linkage_stats.length
    ? dataQuality.linkage_stats.reduce((sum, s) => sum + s.linked_pct, 0) / dataQuality.linkage_stats.length
    : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Findings"
        description="Everything else on this dashboard, read together as a story: how the records get linked, where follow-up actually breaks down, and what's still open. Responds to the filters above like every other page — narrow to a district or facility to see the same story for that slice. Each section links to its full detail page."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Total patients"
          value={(dataQuality.row_counts.patient_360_reference ?? 0).toLocaleString()}
          tooltip="Canonical patients in patient_360_reference.csv. Not affected by filters."
        />
        <KpiCard
          label="Total episodes (filtered)"
          value={filteredEpisodes.length.toLocaleString()}
          tooltip="One row per teleconsultation episode, after the filters above."
        />
        <KpiCard
          label="Lost-to-follow-up rate"
          value={ltfu.rate == null ? "—" : formatPct(ltfu.rate)}
          sub={`${ltfu.numerator.toLocaleString()} / ${ltfu.denominator.toLocaleString()} · Development only`}
          tooltip="Any required care component (medicine/test/review, whichever advised) remained incomplete. Development cohort only."
        />
        <KpiCard
          label="Completed-care rate"
          value={completion.rate == null ? "—" : formatPct(completion.rate)}
          sub={`${completion.numerator.toLocaleString()} / ${completion.denominator.toLocaleString()} · Development only`}
          tooltip="Every advised care component was completed. Development cohort only."
        />
      </div>

      {/* 1. Linkage */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          n={1}
          title="Linking fragmented records"
          blurb="Teleconsultation, NCD screening, dispensing, and visit records each use their own local patient ID — this is how they get tied to one real person, and how confidently."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Avg. linkage rate across 8 systems"
            value={meanLinkedPct == null ? "—" : `${meanLinkedPct.toFixed(1)}%`}
            sub="high + medium confidence, per source system"
            tooltip="Mean of linked_pct (high+medium confidence share) across all 8 operational source systems that carry their own local patient ID."
          />
          <KpiCard
            label="Village geography resolved"
            value={`${dataQuality.village_resolution.resolved_pct.toFixed(1)}%`}
            sub={`${dataQuality.village_resolution.n_operational_villages_raw} raw strings → ${dataQuality.village_resolution.n_canonical_villages} villages`}
            tooltip="Free-text village names normalized to the 36 canonical villages — a separate, lighter-weight problem from patient linkage."
          />
          <KpiCard
            label="Lab records matched to an episode"
            value={`${((dataQuality.lab_linkage.matched / dataQuality.lab_linkage.test_advised_episodes) * 100).toFixed(1)}%`}
            sub={`${dataQuality.lab_linkage.matched.toLocaleString()} / ${dataQuality.lab_linkage.test_advised_episodes.toLocaleString()} test-advised`}
            tooltip="lab_tests.csv has no episode key at all — matched via patient identity + a date window around the consult."
          />
          {labLinkageDiagnostics ? (
            <KpiCard
              label="Lab matches sensitive to processing order"
              value={`${labLinkageDiagnostics.order_sensitivity_of_actual_assignments.order_sensitive_pct_of_matched.toFixed(1)}%`}
              sub={`${labLinkageDiagnostics.order_sensitivity_of_actual_assignments.order_sensitive_assignments} of ${labLinkageDiagnostics.order_sensitivity_of_actual_assignments.total_matched_assignments} matched`}
              tooltip="Share of matched lab-to-episode assignments where the lab record was also eligible for another nearby consult of the same patient — a real but modest ambiguity, not a hidden certainty."
            />
          ) : null}
        </div>
        <ChartCard
          title="How confidently does each source system link to a canonical patient?"
          description="Share of records linked at high or medium confidence, per source system"
        >
          <CountBarChart data={linkagePctData} horizontal />
        </ChartCard>
        <p className="text-xs text-muted-foreground">
          <strong>Takeaway:</strong> fragmented records can be linked, but not with uniform certainty — most systems clear
          96%+ confident linkage, and every unmatched or ambiguous record is left unlinked rather than guessed. Lab
          results are the hardest case: no direct key exists, so they inherit both a patient-linkage confidence and a
          separate date-window confidence.
        </p>
        <SeeAlso href="/data-quality" label="Data Quality & Record Linkage" />
      </section>

      {/* 2. Where follow-up breaks down */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          n={2}
          title="Where follow-up breaks down"
          blurb="Lost-to-follow-up isn't one failure — it's three distinct, mutually-exclusive stages, and it concentrates in identifiable segments."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="LTFU episodes"
            value={ltfuCount.toLocaleString()}
            sub={`of ${dev.length.toLocaleString()} development episodes`}
            tooltip="Development-cohort episodes with lost_to_followup_label = 1."
          />
          {stageBreakdown.map((s) => (
            <KpiCard
              key={s.stage}
              label={s.stage}
              value={s.count.toLocaleString()}
              sub={s.pctOfLtfu == null ? "— of LTFU" : `${(s.pctOfLtfu * 100).toFixed(1)}% of LTFU`}
              tooltip={`The first unresolved stage for this episode — never double-counted across stages.`}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard title="Which stage do dropouts stop at?" description="dropout_stage_label distribution, Development cohort">
            <CountBarChart data={stageData} />
          </ChartCard>
          <ChartCard title="LTFU rate by distance to facility" description="Episode-level field, zero linkage dependency">
            <SegmentRateBarChart rows={distanceRows} />
          </ChartCard>
          <ChartCard title="LTFU rate by connectivity at consult" description="connectivity_quality recorded at consult time">
            <SegmentRateBarChart rows={connectivityRows} />
          </ChartCard>
        </div>
        <ChartCard
          title="LTFU rate by NCD control status"
          description="Most recent NCD screening strictly before the consult (linkage-dependent — see Data Quality page)"
        >
          <SegmentTable rows={ncdControlRows} segmentLabel="NCD control status" />
          <AssociationNote />
        </ChartCard>
        <p className="text-xs text-muted-foreground">
          <strong>Takeaway:</strong> medicine non-collection is the single biggest leak — it accounts for well over half
          of all LTFU, more than reviews and tests combined. That's where an intervention has the most room to matter.
        </p>
        <SeeAlso href="/dropout" label="Dropout Analysis" />
      </section>

      {/* 3. Medicine access */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          n={3}
          title="Medicine access: system failure vs. patient non-collection"
          blurb="When medicine isn't fully dispensed, was that a supply-chain problem or a patient never showing up? Two different metrics, two different interventions."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Medicine Fulfillment Rate"
            value={formatPct(funnel.medicineFulfillmentRate.rate)}
            sub={`${funnel.medicineFulfillmentRate.numerator.toLocaleString()} / ${funnel.medicineFulfillmentRate.denominator.toLocaleString()} · of all prescriptions`}
            tooltip="Fully dispensed / ALL prescriptions generated."
          />
          <KpiCard
            label="Dispensing Success Rate"
            value={formatPct(funnel.dispensingSuccessRate.rate)}
            sub={`${funnel.dispensingSuccessRate.numerator.toLocaleString()} / ${funnel.dispensingSuccessRate.denominator.toLocaleString()} · of prescriptions attempted`}
            tooltip="Fully dispensed / prescriptions with ≥1 recorded dispensing attempt only — a different, higher-base metric than Fulfillment Rate. Never conflate the two."
          />
          <KpiCard
            label="Not advised"
            value={formatPct(makeRate(accessBreakdown.find((a) => a.classification === "not_advised")?.count ?? 0, filteredEpisodes.length).rate)}
            sub="of all filtered episodes"
            tooltip="Medicine was never advised for this episode — outside the medicine-access funnel entirely."
          />
        </div>
        <ChartCard
          title="When medicine access fails, is it the system or the patient?"
          description="medicine_access_classification distribution — a case is only labelled patient-side when facility stock evidence rules out a supply constraint"
        >
          <CountBarChart data={accessChartData} horizontal />
        </ChartCard>
        <p className="text-xs text-muted-foreground">
          <strong>Takeaway:</strong> non-collection isn't automatically the patient&apos;s fault — a meaningful share of
          incomplete medicine access traces back to facility stock-outs or ambiguous evidence, not confirmed
          no-shows. Any intervention aimed only at &quot;patient compliance&quot; would miss the supply-side share entirely.
        </p>
        <SeeAlso href="/medicine-access" label="Medicine Access" />
      </section>

      {/* 4. Lab & review completion */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          n={4}
          title="Lab and review completion"
          blurb="The other two advised-but-often-skipped steps — each with its own eligible denominator, never the full teleconsultation base."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Tests advised"
            value={funnel.testsAdvised.toLocaleString()}
            tooltip="test_advised = 'Yes' among filtered episodes."
          />
          <div className="relative">
            <KpiCard
              label="Test completion rate"
              value={formatPct(funnel.testsCompleted.rate)}
              sub={`${funnel.testsCompleted.numerator.toLocaleString()} / ${funnel.testsCompleted.denominator.toLocaleString()}`}
              tooltip="Results available / test-advised — linkage-dependent, see badge."
            />
            <div className="absolute right-3 top-3">
              <ConfidenceBadge tier="matched" />
            </div>
          </div>
          <KpiCard
            label="Reviews advised"
            value={funnel.reviewsAdvised.toLocaleString()}
            tooltip="review_advised = 'Yes' among filtered episodes."
          />
          <KpiCard
            label="Review completion rate"
            value={formatPct(funnel.reviewsCompleted.rate)}
            sub={`${funnel.reviewsCompleted.numerator.toLocaleString()} / ${funnel.reviewsCompleted.denominator.toLocaleString()}`}
            tooltip="Episodes with ≥1 followup_visits row, out of episodes where a review was advised. Direct key, no linkage dependency."
          />
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Takeaway:</strong> these two funnels aren&apos;t small — together they explain roughly 40% of every
          LTFU case (test-not-completed and review-not-attended combined), and unlike medicine access, review
          completion has zero linkage uncertainty behind it, so this number can be trusted at face value.
        </p>
        <div className="flex gap-3">
          <SeeAlso href="/labs" label="Lab Completion" />
          <SeeAlso href="/reviews" label="Follow-up Reviews" />
        </div>
      </section>

      {/* 5. Outreach */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          n={5}
          title="Outreach: how much, how successful, and a confounding caution"
          blurb="ASHA/CHO outreach already happens at scale — but the completion association it shows can't be read as proof outreach works."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Total outreach actions"
            value={filteredOutreach.length.toLocaleString()}
            tooltip="Rows in outreach_actions.csv whose episode falls within the current filter."
          />
          <KpiCard
            label="Successful contact rate"
            value={successfulContactRate.rate == null ? "—" : formatPct(successfulContactRate.rate)}
            sub={`${successfulContactRate.numerator.toLocaleString()} / ${successfulContactRate.denominator.toLocaleString()}`}
            tooltip="Share of outreach actions where the contact outcome counts as successful (reached and counselled/promised follow-up/family reached)."
          />
          <KpiCard
            label="Still-LTFU, with ≥1 successful contact"
            value={outreachAssociation.withContact.rate == null ? "—" : formatPct(outreachAssociation.withContact.rate)}
            sub={`n=${outreachAssociation.withContact.denominator.toLocaleString()}, Development at-risk`}
            tooltip="Among Development-cohort at-risk episodes with ≥1 successful outreach contact, the share still lost to follow-up."
          />
          <KpiCard
            label="Still-LTFU, no successful contact"
            value={outreachAssociation.withoutContact.rate == null ? "—" : formatPct(outreachAssociation.withoutContact.rate)}
            sub={`n=${outreachAssociation.withoutContact.denominator.toLocaleString()}, Development at-risk`}
            tooltip="Among Development-cohort at-risk episodes with no successful outreach contact, the share still lost to follow-up."
          />
        </div>
        <AssociationNote text="Episodes with a successful outreach contact show a HIGHER still-LTFU rate than episodes without one. Read this as outreach being targeted at patients who already looked harder to reach — not as evidence outreach fails. Comparing the two groups directly is confounded by design." />
        <p className="text-xs text-muted-foreground">
          <strong>Takeaway:</strong> outreach volume and reach are measurable today; effectiveness is not, from this
          comparison alone. A defensible answer needs either a randomized/staggered rollout or a model-based control
          for who gets targeted — not a raw before/after on the current data.
        </p>
        <SeeAlso href="/outreach" label="Outreach Effectiveness" />
      </section>

      {/* 6. Prior engagement */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          n={6}
          title="Does prior healthcare engagement predict follow-up?"
          blurb="A candidate signal for a future risk model: how much contact a patient already had with the system before this consult."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard
            label="Prior interactions, LTFU group"
            value={priorEngagement.ltfuMean == null ? "—" : priorEngagement.ltfuMean.toFixed(2)}
            sub="mean prior_relevant_interactions"
            tooltip="Mean count of prior NCD follow-up / screening / OPD visits before consult_date, among Development episodes eventually lost to follow-up, patient-link resolved only."
          />
          <KpiCard
            label="Prior interactions, completed group"
            value={priorEngagement.completedMean == null ? "—" : priorEngagement.completedMean.toFixed(2)}
            sub="mean prior_relevant_interactions"
            tooltip="Same, among Development episodes that completed every advised step."
          />
          <KpiCard
            label="Link-resolved episodes compared"
            value={priorEngagement.n.toLocaleString()}
            sub="of Development cohort"
            tooltip="Episodes with history_link_status='matched' — episodes with an unresolved patient link are excluded, never treated as zero prior visits."
          />
        </div>
        <AssociationNote text="Association only, and a candidate feature for a future model — not a fitted model output, and not a causal claim about prior engagement." />
        <SeeAlso href="/history" label="Historical Behaviour" />
      </section>

      {/* 7. What's next */}
      <section className="flex flex-col gap-3">
        <SectionHeading n={7} title="What's next" blurb="Not yet built — the gap between this dashboard and a deployed intervention." />
        <ChartCard title="Roadmap" description="Plain status, not a data finding — see MODEL_FEATURE_AUDIT.md and P1_FIXES.md for full detail">
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>
              <strong>Risk model:</strong> a leakage-safe, consult-time-only feature table already exists
              (<code className="text-xs">processed/model_features_consult_time.csv</code>) with the real outcome label —
              no model has been trained on it yet.
            </li>
            <li>
              <strong>Action queue / prioritization:</strong> once a risk score exists, rank at-risk patients by
              risk × reachability × distance so ASHA/CHO time goes to the highest-value contact first — not built yet.
            </li>
            <li>
              <strong>Intervention effectiveness measurement:</strong> the current outreach-vs-completion comparison is
              confounded (Section 5) — a real answer needs a staggered rollout or a model-based control, not a raw
              before/after.
            </li>
            <li>
              <strong>Cost/feasibility framing:</strong> outreach-actions-per-at-risk-episode is a rough proxy for
              health-worker time cost today; a prioritized queue should be evaluated against it directly once built.
            </li>
          </ul>
        </ChartCard>
      </section>
    </div>
  )
}
