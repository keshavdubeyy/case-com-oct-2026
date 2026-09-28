"use client"

import { useMemo } from "react"
import type { ReactNode } from "react"

import { ChartCard } from "@/components/dashboard/chart-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatPct } from "@/components/dashboard/rate-text"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  LOW_SAMPLE_THRESHOLD,
  careJourneyFunnel,
  developmentOnly,
  dropoutStageBreakdown,
  ltfuRate,
  medicineAccessBreakdown,
  segmentBreakdown,
  type SegmentRow,
} from "@/lib/metrics"
import type { Episode, OutreachAction } from "@/lib/types"

const SUCCESSFUL_CONTACT = new Set(["Reached; promised follow-up", "Reached; counselled", "Family member reached"])

interface Problem {
  n: number
  title: string
  evidence: ReactNode
  evidenceShort: string
  implication: string
}

/** Reliable (n >= LOW_SAMPLE_THRESHOLD) rows only, sorted by LTFU rate. */
function reliableSorted(rows: SegmentRow[]): SegmentRow[] {
  return rows.filter((r) => r.episodeCount >= LOW_SAMPLE_THRESHOLD && r.ltfuRate != null).sort((a, b) => (b.ltfuRate ?? 0) - (a.ltfuRate ?? 0))
}

function rate(rows: OutreachAction[]): number | null {
  if (rows.length === 0) return null
  return rows.filter((r) => r.is_successful_contact).length / rows.length
}

function ProblemCard({ n, title, evidence, implication }: Problem) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-xs font-semibold text-destructive">
            {n}
          </span>
          <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        </div>
        <div className="space-y-1 pl-9 text-xs text-muted-foreground">{evidence}</div>
        <p className="pl-9 text-xs">
          <span className="font-medium text-foreground">Implication: </span>
          {implication}
        </p>
      </CardContent>
    </Card>
  )
}

export default function ProblemsPage() {
  const { loading, error, filteredEpisodes, outreach, dataQuality, labLinkageDiagnostics } = useDashboardData()

  const dev = useMemo(() => developmentOnly(filteredEpisodes), [filteredEpisodes])
  const ltfu = useMemo(() => ltfuRate(filteredEpisodes), [filteredEpisodes])
  const stageBreakdown = useMemo(() => dropoutStageBreakdown(filteredEpisodes), [filteredEpisodes])
  const funnel = useMemo(() => careJourneyFunnel(filteredEpisodes), [filteredEpisodes])
  const accessBreakdown = useMemo(() => medicineAccessBreakdown(filteredEpisodes), [filteredEpisodes])

  const vulnerabilityRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.vulnerability_group)), [filteredEpisodes])
  const diagnosisRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.diagnosis_group)), [filteredEpisodes])
  const facilityRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.facility_name)), [filteredEpisodes])
  const ageRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.age_group)), [filteredEpisodes])
  const genderRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.gender)), [filteredEpisodes])

  const filteredOutreach = useMemo(() => {
    const ids = new Set(filteredEpisodes.map((e) => e.episode_id))
    return outreach.filter((o) => ids.has(o.episode_id))
  }, [outreach, filteredEpisodes])

  const outreachByConnectivity = useMemo(() => {
    const byEp = new Map<string, Episode>(filteredEpisodes.map((e) => [e.episode_id, e]))
    const groups = new Map<string, OutreachAction[]>()
    for (const o of filteredOutreach) {
      const ep = byEp.get(o.episode_id)
      const key = ep?.connectivity_quality ?? "Unknown"
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(o)
    }
    return Array.from(groups.entries()).map(([connectivity, rows]) => ({ connectivity, n: rows.length, rate: rate(rows) }))
  }, [filteredOutreach, filteredEpisodes])

  const outreachByDistance = useMemo(() => {
    const byEp = new Map<string, Episode>(filteredEpisodes.map((e) => [e.episode_id, e]))
    const groups = new Map<string, OutreachAction[]>()
    for (const o of filteredOutreach) {
      const ep = byEp.get(o.episode_id)
      const key = ep?.distance_bucket ?? "Unknown"
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(o)
    }
    return Array.from(groups.entries()).map(([distance, rows]) => ({ distance, n: rows.length, rate: rate(rows) }))
  }, [filteredOutreach, filteredEpisodes])

  const actionsPerAtRisk = useMemo(() => {
    const atRisk = filteredEpisodes.filter((e) => e.at_risk_no_outcome_needed).length
    return atRisk > 0 ? filteredOutreach.length / atRisk : null
  }, [filteredOutreach, filteredEpisodes])

  const outreachAssociation = useMemo(() => {
    const devAtRisk = filteredEpisodes.filter((e) => e.cohort === "DEVELOPMENT" && e.at_risk_no_outcome_needed)
    const withContact = devAtRisk.filter((e) => e.successful_contact_count > 0)
    const withoutContact = devAtRisk.filter((e) => e.successful_contact_count === 0)
    const rateOf = (rows: Episode[]) => (rows.length ? rows.filter((e) => e.lost_to_followup_label === 1).length / rows.length : null)
    return { withContact: rateOf(withContact), withoutContact: rateOf(withoutContact), nWith: withContact.length, nWithout: withoutContact.length }
  }, [filteredEpisodes])

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

  const linkedPcts = dataQuality.linkage_stats.map((s) => s.linked_pct)
  const linkedMin = Math.min(...linkedPcts)
  const linkedMax = Math.max(...linkedPcts)

  const indeterminateCount = accessBreakdown.find((a) => a.classification === "indeterminate")?.count ?? 0
  const indeterminatePct = funnel.medicineAdvised > 0 ? (100 * indeterminateCount) / funnel.medicineAdvised : 0

  const connRates = outreachByConnectivity.filter((r) => r.rate != null)
  const connMin = connRates.length ? Math.min(...connRates.map((r) => r.rate!)) : null
  const connMax = connRates.length ? Math.max(...connRates.map((r) => r.rate!)) : null
  const distRates = outreachByDistance.filter((r) => r.rate != null)
  const distMin = distRates.length ? Math.min(...distRates.map((r) => r.rate!)) : null
  const distMax = distRates.length ? Math.max(...distRates.map((r) => r.rate!)) : null

  const topVuln = vulnerabilityRows[0]
  const generalVuln = vulnerabilityRows.find((r) => r.segment === "General") ?? vulnerabilityRows[vulnerabilityRows.length - 1]
  const topDiag = diagnosisRows[0]
  const bottomDiag = diagnosisRows[diagnosisRows.length - 1]
  const topFac = facilityRows[0]
  const bottomFac = facilityRows[facilityRows.length - 1]
  const topAge = ageRows[0]
  const bottomAge = ageRows[ageRows.length - 1]

  const problems: Problem[] = [
    {
      n: 1,
      title: "Records don't link on their own — 8 systems, 8 local patient IDs, no crosswalk supplied",
      evidenceShort: `Linkage confidence ranges ${linkedMin.toFixed(1)}–${linkedMax.toFixed(1)}% (high+medium) across 8 source systems; lab_tests.csv carries no episode key at all.`,
      evidence: (
        <>
          <p>
            High/medium-confidence linkage ranges <strong>{linkedMin.toFixed(1)}%–{linkedMax.toFixed(1)}%</strong> across the
            8 operational source systems (`patient_360_reference.csv` is the only canonical table).
          </p>
          {labLinkageDiagnostics ? (
            <p>
              `lab_tests.csv` has no episode/teleconsult key — matched via identity + a date window; the matching is
              measurably order-sensitive for{" "}
              <strong>{labLinkageDiagnostics.order_sensitivity_of_actual_assignments.order_sensitive_pct_of_matched.toFixed(1)}%</strong>{" "}
              of matched assignments.
            </p>
          ) : null}
        </>
      ),
      implication: "Any solution needs a confidence-tiered identity-resolution layer as a first-class output, not a silent join.",
    },
    {
      n: 2,
      title: "Lost-to-follow-up is large, and breaks in three distinct, unevenly-sized stages",
      evidenceShort: `${formatPct(ltfu.rate)} LTFU overall; medicine ${stageBreakdown[0]?.pctOfLtfu ? formatPct(stageBreakdown[0].pctOfLtfu) : "—"} of LTFU, review ${stageBreakdown[1]?.pctOfLtfu ? formatPct(stageBreakdown[1].pctOfLtfu) : "—"}, test ${stageBreakdown[2]?.pctOfLtfu ? formatPct(stageBreakdown[2].pctOfLtfu) : "—"}.`,
      evidence: (
        <>
          <p>
            <strong>{formatPct(ltfu.rate)}</strong> of Development episodes ({ltfu.numerator.toLocaleString()} of{" "}
            {ltfu.denominator.toLocaleString()}) are lost to follow-up.
          </p>
          {stageBreakdown.map((s) => (
            <p key={s.stage}>
              {s.stage}: {s.count.toLocaleString()} episodes ({s.pctOfLtfu == null ? "—" : formatPct(s.pctOfLtfu)} of all LTFU)
            </p>
          ))}
        </>
      ),
      implication: "A single generic reminder can't address this — medicine collection alone is the majority of the problem and needs its own intervention.",
    },
    {
      n: 3,
      title: "Risk concentrates sharply by comorbidity, vulnerability group, and facility — not evenly across the population",
      evidenceShort:
        topDiag && bottomDiag
          ? `Diagnosis: ${topDiag.segment} ${formatPct(topDiag.ltfuRate)} vs ${bottomDiag.segment} ${formatPct(bottomDiag.ltfuRate)}. Facility spread ${topFac ? formatPct(topFac.ltfuRate) : "—"} to ${bottomFac ? formatPct(bottomFac.ltfuRate) : "—"}.`
          : "Insufficient reliable segments in current filter.",
      evidence: (
        <>
          {topDiag && bottomDiag ? (
            <p>
              Diagnosis: <strong>{topDiag.segment}</strong> {formatPct(topDiag.ltfuRate)} LTFU vs.{" "}
              <strong>{bottomDiag.segment}</strong> {formatPct(bottomDiag.ltfuRate)} (n≥{LOW_SAMPLE_THRESHOLD} each).
            </p>
          ) : null}
          {topVuln ? (
            <p>
              Vulnerability group: <strong>{topVuln.segment}</strong> {formatPct(topVuln.ltfuRate)} LTFU
              {generalVuln && generalVuln.segment !== topVuln.segment ? ` vs. General ${formatPct(generalVuln.ltfuRate)}` : ""}.
            </p>
          ) : null}
          {topFac && bottomFac ? (
            <p>
              Facility (all n≥{LOW_SAMPLE_THRESHOLD}): <strong>{topFac.segment}</strong> {formatPct(topFac.ltfuRate)} vs.{" "}
              <strong>{bottomFac.segment}</strong> {formatPct(bottomFac.ltfuRate)} — a {facilityRows.length}-facility spread.
            </p>
          ) : null}
        </>
      ),
      implication: "Risk model must include diagnosis-comorbidity and vulnerability fields; the facility spread needs an operational review, not just a model.",
    },
    {
      n: 4,
      title: "Medicine-access failure cause is genuinely ambiguous in a meaningful share of cases",
      evidenceShort: `${indeterminateCount.toLocaleString()} episodes (${indeterminatePct.toFixed(1)}% of medicine-advised) classified 'indeterminate' — evidence doesn't clearly point to patient or supply side.`,
      evidence: (
        <p>
          <strong>{indeterminateCount.toLocaleString()}</strong> medicine-advised episodes ({indeterminatePct.toFixed(1)}%) are
          classified `indeterminate` — stock evidence is ambiguous or missing, so the pipeline correctly refuses to default to
          patient-side blame, but that also means no clear action is implied.
        </p>
      ),
      implication: "The solution needs an explicit policy for the indeterminate case (e.g. default to a supply-chain check first), not silence.",
    },
    {
      n: 5,
      title: "No predictive model or dropout-risk score exists anywhere in the pipeline",
      evidenceShort: "processed/model_features_consult_time.csv exists (leakage-safe, real target_ltfu label) but nothing has been trained on it.",
      evidence: (
        <p>
          A leakage-safe, consult-time-only feature table already exists with a real, balanced outcome label — but no model,
          dropout-stage classifier, or risk score has been built from it (see `MODEL_FEATURE_AUDIT.md`).
        </p>
      ),
      implication: "This is the single largest gap between what exists today and what the case asks for — the concrete next deliverable.",
    },
    {
      n: 6,
      title: "No action queue or prioritization logic exists to guide health workers",
      evidenceShort: "submission_template_action_queue.csv ships as an empty header-only template — nobody has filled it in yet.",
      evidence: (
        <p>
          `submission_template_action_queue.csv` (episode_id, priority, recommended_action, assigned_cadre) is header-only.
          Without a risk score, every at-risk patient today gets roughly the same, unweighted attention.
        </p>
      ),
      implication: "Once a risk score exists (Problem 5), rank at-risk patients by risk × reachability × distance so worker time goes to the highest-value contact first.",
    },
    {
      n: 7,
      title: "Outreach today looks reactive, not risk-targeted — and the raw comparison is confounded",
      evidenceShort: `Still-LTFU rate: ${outreachAssociation.withContact == null ? "—" : formatPct(outreachAssociation.withContact)} with a successful contact vs ${outreachAssociation.withoutContact == null ? "—" : formatPct(outreachAssociation.withoutContact)} without.`,
      evidence: (
        <p>
          Development at-risk episodes with ≥1 successful outreach contact show a{" "}
          <strong>{outreachAssociation.withContact == null ? "—" : formatPct(outreachAssociation.withContact)}</strong> still-LTFU
          rate (n={outreachAssociation.nWith}) vs.{" "}
          <strong>{outreachAssociation.withoutContact == null ? "—" : formatPct(outreachAssociation.withoutContact)}</strong> for
          those with none (n={outreachAssociation.nWithout}) — higher, not lower, because outreach today reaches patients
          reactively, after they already look hard to reach.
        </p>
      ),
      implication: "A prioritization model should be evaluated against this reactive baseline honestly, via a staggered rollout or model-based control — not a raw before/after.",
    },
    {
      n: 8,
      title: "Outreach channel isn't adapted to connectivity or distance — despite that being an explicit case constraint",
      evidenceShort:
        connMin != null && connMax != null
          ? `Contact success rate ${formatPct(connMin)}–${formatPct(connMax)} across connectivity tiers — essentially flat.`
          : "Insufficient outreach rows in current filter.",
      evidence: (
        <>
          {connMin != null && connMax != null ? (
            <p>
              Outreach contact-success rate is <strong>{formatPct(connMin)}–{formatPct(connMax)}</strong> across connectivity
              tiers (Good/Fair/Poor) — essentially flat, not lower where connectivity is worse.
            </p>
          ) : null}
          {distMin != null && distMax != null ? (
            <p>
              Same pattern by distance band: <strong>{formatPct(distMin)}–{formatPct(distMax)}</strong> across all buckets.
            </p>
          ) : null}
          <p>Action-method mix (home visit / phone call / WhatsApp-SMS) is nearly identical regardless of connectivity tier.</p>
        </>
      ),
      implication: "A rules-based, connectivity-aware channel router (route low-connectivity/low-end-phone patients to home visits, not SMS) is buildable today, no model required.",
    },
    {
      n: 9,
      title: "Health-worker time is spent without risk-weighting",
      evidenceShort: actionsPerAtRisk == null ? "—" : `${actionsPerAtRisk.toFixed(2)} outreach actions per at-risk episode, unweighted by risk.`,
      evidence: (
        <p>
          <strong>{actionsPerAtRisk == null ? "—" : actionsPerAtRisk.toFixed(2)}</strong> outreach actions per at-risk episode
          today, applied roughly uniformly rather than concentrated on the highest-risk, most-reachable patients.
        </p>
      ),
      implication: "A risk-ranked queue is the direct lever to spend the same worker-hours more effectively — but it needs the model from Problem 5 first.",
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Problems"
        description="Every problem the data points to, stated plainly with its evidence — the analytical basis for the solution design. See PROBLEM_ANALYSIS.md for the full write-up. Responds to the filters above like every other page; segment comparisons (Problem 3) only use groups with at least 20 episodes."
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {problems.map((p) => (
          <ProblemCard key={p.n} {...p} />
        ))}
      </div>

      <ChartCard title="All problems, evidence, and implication" description="Same numbers as the cards above, in one table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Problem</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Implication</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {problems.map((p) => (
              <TableRow key={p.n}>
                <TableCell className="text-xs font-semibold text-destructive">{p.n}</TableCell>
                <TableCell className="max-w-xs text-xs font-medium whitespace-normal">{p.title}</TableCell>
                <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">{p.evidenceShort}</TableCell>
                <TableCell className="max-w-xs text-xs whitespace-normal">{p.implication}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  )
}
