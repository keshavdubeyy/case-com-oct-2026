"use client"

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import { CountBarChart } from "@/components/charts/count-bar-chart"
import { SegmentRateBarChart } from "@/components/charts/segment-rate-bar-chart"
import { ChartCard } from "@/components/dashboard/chart-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { PatientJourneyTimeline } from "@/components/dashboard/patient-journey-timeline"
import { formatPct } from "@/components/dashboard/rate-text"
import { RiskPredictionCard, type NormalizedPrediction } from "@/components/dashboard/risk-prediction-card"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { loadEpisodePredictions, loadEpisodeTimeline, loadOofPredictions } from "@/lib/data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DISTANCE_BUCKET_ORDER,
  LOW_SAMPLE_THRESHOLD,
  careJourneyFunnel,
  developmentOnly,
  dropoutStageBreakdown,
  ltfuRate,
  medicineAccessBreakdown,
  orderBy,
  segmentBreakdown,
  type SegmentRow,
} from "@/lib/metrics"
import type { Episode, EpisodePrediction, OofPrediction, OutreachAction, TimelineEvent } from "@/lib/types"

interface Problem {
  n: number
  title: string
  evidence: ReactNode
  evidenceShort: string
  implication: string
}

/** Each finding follows the same 4-question shape: what we found, what it
 * means, why it matters (folded into "means" to keep sentences short), and
 * whether we can act on it now. */
interface Finding {
  n: number
  headline: string
  whatWeFound: ReactNode
  whatItMeans: ReactNode
  whatWeCanDo?: ReactNode
  evidence: ReactNode
  tag: "We can act on this" | "Needs more evidence" | "Scale of the problem"
}

const TAG_VARIANT: Record<Finding["tag"], "secondary" | "outline" | "destructive"> = {
  "We can act on this": "secondary",
  "Needs more evidence": "destructive",
  "Scale of the problem": "outline",
}

function FindingCard({ n, headline, whatWeFound, whatItMeans, whatWeCanDo, evidence, tag }: Finding) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
              {n}
            </span>
            <h3 className="text-sm font-semibold leading-snug">{headline}</h3>
          </div>
          <Badge variant={TAG_VARIANT[tag]} className="shrink-0 text-[10px]">
            {tag}
          </Badge>
        </div>
        <div className="space-y-1.5 pl-9 text-xs">
          <div className="text-muted-foreground">{whatWeFound}</div>
          <div className="text-muted-foreground">{whatItMeans}</div>
          {whatWeCanDo ? (
            <div>
              <span className="font-medium text-foreground">What we can do with this: </span>
              <span className="text-muted-foreground">{whatWeCanDo}</span>
            </div>
          ) : null}
        </div>
        <div className="pl-9">{evidence}</div>
      </CardContent>
    </Card>
  )
}

/** Curated, real patients chosen to each show a different outcome -- not
 * picked to look better than the data is, just varied enough to show the
 * full range of journeys. Anyone can look up any other episode_id instead. */
const EXAMPLE_EPISODES = [
  { id: "E0002150", label: "Patient who didn't collect medicine" },
  { id: "E0000006", label: "Patient who missed a review visit" },
  { id: "E0000030", label: "Patient who missed a test" },
  { id: "E0000004", label: "Patient who completed their care" },
]

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

function GroupHeading({ letter, title, blurb }: { letter: string; title: string; blurb: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b pb-2">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {letter}
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
    </div>
  )
}

interface PatientExplorerState {
  selectedId: string
  setSelectedId: (id: string) => void
  lookupInput: string
  setLookupInput: (v: string) => void
  lookupError: string | null
  handleLookup: () => void
}

/** The patient picker (curated examples + free lookup) shared by Section A's
 * timeline and Section C's risk prediction -- picking a patient here updates
 * both, so "here's their story" and "here's what the model would have
 * flagged" are visibly the same person, not two disconnected demos. */
function PatientPicker({ selectedId, setSelectedId, lookupInput, setLookupInput, lookupError, handleLookup }: PatientExplorerState) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {EXAMPLE_EPISODES.map((ex) => (
          <Button key={ex.id} size="sm" variant={selectedId === ex.id ? "default" : "outline"} onClick={() => setSelectedId(ex.id)}>
            {ex.label}
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            placeholder="Or type any episode ID…"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            className="h-8 w-48 text-xs"
          />
          <Button size="sm" variant="outline" onClick={handleLookup}>
            Show
          </Button>
        </div>
      </div>
      {lookupError ? <p className="text-xs text-destructive">{lookupError}</p> : null}
    </div>
  )
}

function PatientJourneyDemo({ episodes, selectedId, timeline, timelineError }: { episodes: Episode[]; selectedId: string; timeline: TimelineEvent[] | null; timelineError: string | null }) {
  const episodeById = useMemo(() => new Map(episodes.map((e) => [e.episode_id, e])), [episodes])
  const selectedEpisode = episodeById.get(selectedId)
  const selectedEvents = useMemo(() => (timeline ?? []).filter((e) => e.episode_id === selectedId), [timeline, selectedId])

  if (timelineError) return <p className="text-sm text-destructive">We couldn&apos;t load this patient&apos;s timeline: {timelineError}</p>
  if (!timeline) return <Skeleton className="h-72" />
  if (!selectedEpisode) return <p className="text-sm text-muted-foreground">We couldn&apos;t find that patient in the loaded data.</p>
  return <PatientJourneyTimeline episode={selectedEpisode} events={selectedEvents} />
}

function PredictionDemo({
  episodes,
  selectedId,
  predictions,
  oofPredictions,
  predictionsError,
}: {
  episodes: Episode[]
  selectedId: string
  predictions: EpisodePrediction[] | null
  oofPredictions: OofPrediction[] | null
  predictionsError: string | null
}) {
  const episodeById = useMemo(() => new Map(episodes.map((e) => [e.episode_id, e])), [episodes])
  const selectedEpisode = episodeById.get(selectedId)

  const normalized: NormalizedPrediction | null = useMemo(() => {
    if (!selectedEpisode) return null
    if (selectedEpisode.cohort === "EVALUATION" && predictions) {
      const p = predictions.find((r) => r.episode_id === selectedId)
      if (!p) return null
      return { riskProbability: p.risk_probability, predictedDropoutStage: p.predicted_dropout_stage, priorityTier: p.priority_tier }
    }
    if (selectedEpisode.cohort === "DEVELOPMENT" && oofPredictions) {
      const p = oofPredictions.find((r) => r.episode_id === selectedId)
      if (!p) return null
      return {
        riskProbability: p.risk_probability_oof,
        predictedDropoutStage: p.predicted_dropout_stage_oof,
        priorityTier: p.priority_tier_oof,
        actual: { ltfu: p.target_ltfu, stage: p.target_dropout_stage },
      }
    }
    return null
  }, [selectedEpisode, selectedId, predictions, oofPredictions])

  if (predictionsError) return <p className="text-sm text-destructive">We couldn&apos;t load the prediction for this patient: {predictionsError}</p>
  if (!predictions || !oofPredictions) return <Skeleton className="h-40" />
  if (!selectedEpisode || !normalized) return <p className="text-sm text-muted-foreground">No prediction is available for this patient.</p>
  return <RiskPredictionCard episode={selectedEpisode} prediction={normalized} />
}

export default function ProblemsPage() {
  const { loading, error, episodes, filteredEpisodes, outreach, dataQuality, labLinkageDiagnostics } = useDashboardData()

  // Shared patient selection -- drives both Section A's journey timeline and
  // Section C's risk prediction, so both demos are visibly the same patient.
  const [selectedId, setSelectedId] = useState(EXAMPLE_EPISODES[0].id)
  const [lookupInput, setLookupInput] = useState("")
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [predictions, setPredictions] = useState<EpisodePrediction[] | null>(null)
  const [oofPredictions, setOofPredictions] = useState<OofPrediction[] | null>(null)
  const [predictionsError, setPredictionsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadEpisodeTimeline()
      .then((events) => !cancelled && setTimeline(events))
      .catch((err) => !cancelled && setTimelineError(err instanceof Error ? err.message : String(err)))
    Promise.all([loadEpisodePredictions(), loadOofPredictions()])
      .then(([preds, oof]) => {
        if (cancelled) return
        setPredictions(preds)
        setOofPredictions(oof)
      })
      .catch((err) => !cancelled && setPredictionsError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
    }
  }, [])

  const episodeByIdAll = useMemo(() => new Map(episodes.map((e) => [e.episode_id, e])), [episodes])
  function handleLookup() {
    const id = lookupInput.trim().toUpperCase()
    if (!id) return
    if (!episodeByIdAll.has(id)) {
      setLookupError(`We couldn't find an episode with the ID "${id}".`)
      return
    }
    setLookupError(null)
    setSelectedId(id)
  }

  const dev = useMemo(() => developmentOnly(filteredEpisodes), [filteredEpisodes])
  const ltfu = useMemo(() => ltfuRate(filteredEpisodes), [filteredEpisodes])
  const stageBreakdown = useMemo(() => dropoutStageBreakdown(filteredEpisodes), [filteredEpisodes])
  const funnel = useMemo(() => careJourneyFunnel(filteredEpisodes), [filteredEpisodes])
  const accessBreakdown = useMemo(() => medicineAccessBreakdown(filteredEpisodes), [filteredEpisodes])

  const vulnerabilityRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.vulnerability_group)), [filteredEpisodes])
  const diagnosisRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.diagnosis_group)), [filteredEpisodes])
  const facilityRows = useMemo(() => reliableSorted(segmentBreakdown(filteredEpisodes, (e) => e.facility_name)), [filteredEpisodes])
  const distanceRows = useMemo(
    () => segmentBreakdown(filteredEpisodes, (e) => e.distance_bucket).sort(orderBy(DISTANCE_BUCKET_ORDER)),
    [filteredEpisodes]
  )
  const stageChartData = useMemo(() => stageBreakdown.map((s) => ({ label: s.stage, value: s.count })), [stageBreakdown])
  const accessChartData = useMemo(
    () => accessBreakdown.filter((a) => a.classification !== "not_advised").map((a) => ({ label: a.classification, value: a.count, denominator: funnel.medicineAdvised })),
    [accessBreakdown, funnel.medicineAdvised]
  )

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
    return <div className="p-6 text-sm text-destructive">We couldn&apos;t load the data for this page: {error}</div>
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
  const noCollectionCount = accessBreakdown.find((a) => a.classification === "patient_no_collection_attempt")?.count ?? 0
  const noCollectionPct = funnel.medicineAdvised > 0 ? (100 * noCollectionCount) / funnel.medicineAdvised : 0
  const stockoutCount = accessBreakdown.find((a) => a.classification === "system_stockout")?.count ?? 0
  const stockoutPct = funnel.medicineAdvised > 0 ? (100 * stockoutCount) / funnel.medicineAdvised : 0

  const reliableDistanceRows = distanceRows.filter((r) => r.episodeCount >= LOW_SAMPLE_THRESHOLD && r.ltfuRate != null)
  const nearestDistance = reliableDistanceRows[0]
  const farthestDistance = reliableDistanceRows[reliableDistanceRows.length - 1]

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
  const stage0 = stageBreakdown[0]

  const findings: Finding[] = [
    {
      n: 1,
      headline: "How big is the drop-out problem?",
      whatWeFound: (
        <>
          Within the currently selected filters, <strong className="text-foreground">{ltfu.numerator.toLocaleString()}</strong> of{" "}
          <strong className="text-foreground">{ltfu.denominator.toLocaleString()}</strong> patients ({formatPct(ltfu.rate)}) did not
          complete all the care they were advised.
        </>
      ),
      whatItMeans: "About half of patients are not finishing their care journey. This is a large, common problem — not a rare exception.",
      evidence: (
        <div className="flex gap-6">
          <div>
            <div className="text-2xl font-semibold tabular-nums text-destructive">{formatPct(ltfu.rate)}</div>
            <div className="text-xs text-muted-foreground">Did not complete care</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{formatPct(1 - (ltfu.rate ?? 0))}</div>
            <div className="text-xs text-muted-foreground">Completed care</div>
          </div>
        </div>
      ),
      tag: "Scale of the problem",
    },
    {
      n: 2,
      headline: "Medicine collection is the biggest drop-out point",
      whatWeFound: (
        <>
          Within the current filters, <strong className="text-foreground">{stage0 ? stage0.count.toLocaleString() : "—"}</strong> patients
          who dropped out first stopped at the medicine-collection step — {stage0 ? formatPct(stage0.pctOfLtfu) : "—"} of everyone who
          dropped out. Missed reviews ({stageBreakdown[1] ? formatPct(stageBreakdown[1].pctOfLtfu) : "—"}) and incomplete tests (
          {stageBreakdown[2] ? formatPct(stageBreakdown[2].pctOfLtfu) : "—"}) account for the rest.
        </>
      ),
      whatItMeans: "Medicine pickup is the single most common point where the care journey breaks — more than missed reviews and incomplete tests combined.",
      whatWeCanDo: "This gives us a clear place to focus follow-up efforts first: getting prescribed medicine into patients' hands.",
      evidence: <CountBarChart data={stageChartData} height={140} />,
      tag: "We can act on this",
    },
    {
      n: 3,
      headline: "Did the patient not collect the medicine, or was the medicine unavailable?",
      whatWeFound: (
        <>
          Within the current filters, <strong className="text-foreground">{noCollectionCount.toLocaleString()}</strong> patients (
          {noCollectionPct.toFixed(1)}%) never picked up their medicine even though the facility had stock.{" "}
          <strong className="text-foreground">{stockoutCount.toLocaleString()}</strong> ({stockoutPct.toFixed(1)}%) were affected by a
          real shortage at the facility. For <strong className="text-foreground">{indeterminateCount.toLocaleString()}</strong> (
          {indeterminatePct.toFixed(1)}%), we cannot tell from the data which side the problem was on.
        </>
      ),
      whatItMeans: "Most medicine drop-outs look like a collection problem rather than a supply problem — but a real share is genuinely unclear, and we don't guess when we can't tell.",
      whatWeCanDo: "Use two different follow-up actions: remind patients who didn't collect their medicine, and fix the supply chain where stock was the real issue.",
      evidence: <CountBarChart data={accessChartData} horizontal height={140} />,
      tag: "We can act on this",
    },
    {
      n: 4,
      headline: "Some patient groups and facilities have much higher drop-out rates than others",
      whatWeFound: (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 not-italic sm:grid-cols-3">
          {topDiag && bottomDiag ? (
            <div>
              <div className="text-muted-foreground">By diagnosis</div>
              <div>
                <strong>{topDiag.segment}</strong>: {formatPct(topDiag.ltfuRate)}
              </div>
              <div>
                <strong>{bottomDiag.segment}</strong>: {formatPct(bottomDiag.ltfuRate)}
              </div>
            </div>
          ) : null}
          {topVuln && generalVuln ? (
            <div>
              <div className="text-muted-foreground">By patient group</div>
              <div>
                <strong>{topVuln.segment}</strong>: {formatPct(topVuln.ltfuRate)}
              </div>
              <div>
                <strong>General patients</strong>: {formatPct(generalVuln.ltfuRate)}
              </div>
            </div>
          ) : null}
          {topFac && bottomFac ? (
            <div>
              <div className="text-muted-foreground">By facility ({facilityRows.length} compared, n≥{LOW_SAMPLE_THRESHOLD} each)</div>
              <div>
                <strong>{topFac.segment}</strong>: {formatPct(topFac.ltfuRate)}
              </div>
              <div>
                <strong>{bottomFac.segment}</strong>: {formatPct(bottomFac.ltfuRate)}
              </div>
            </div>
          ) : null}
        </div>
      ),
      whatItMeans: "We see a clear pattern: drop-out is not spread evenly. Certain groups of patients, and certain facilities, are affected much more than others. This is a pattern in the data, not proof of what's causing it.",
      whatWeCanDo: "Patients with multiple conditions or in higher-risk groups can be prioritized for follow-up. Facility differences need a closer look by program staff before deciding what to fix.",
      evidence: <div />,
      tag: "We can act on this",
    },
    {
      n: 5,
      headline: "Patients who live farther away are more likely to drop out",
      whatWeFound: (
        <>
          {nearestDistance && farthestDistance ? (
            <>
              Within the current filters, the drop-out rate rises from {formatPct(nearestDistance.ltfuRate)} for patients living{" "}
              {nearestDistance.segment} from the facility, to {formatPct(farthestDistance.ltfuRate)} for patients living{" "}
              {farthestDistance.segment} away.
            </>
          ) : (
            "There aren't enough patients in the current filters to compare distance groups reliably."
          )}
        </>
      ),
      whatItMeans: "This pattern also shows up in our prediction model, not just in this simple comparison — so distance looks like a real, consistent factor. This does not prove that distance by itself causes drop-out.",
      whatWeCanDo: "Consider a different kind of follow-up for patients who live far away, such as home visits or mobile outreach, instead of the same approach used for everyone.",
      evidence: <SegmentRateBarChart rows={distanceRows} height={140} />,
      tag: "We can act on this",
    },
    {
      n: 6,
      headline: "Outreach results cannot yet tell us whether outreach works",
      whatWeFound: (
        <>
          Within the current filters, patients who a health worker successfully reached had a{" "}
          <strong className="text-foreground">higher</strong> drop-out rate ({outreachAssociation.withContact == null ? "—" : formatPct(outreachAssociation.withContact)}) than patients who were never
          successfully reached ({outreachAssociation.withoutContact == null ? "—" : formatPct(outreachAssociation.withoutContact)}).
        </>
      ),
      whatItMeans: "This does not mean outreach makes things worse. These patients were already harder to follow up, which is exactly why a health worker reached out to them. Comparing the two groups directly is misleading.",
      whatWeCanDo: "We need a fairer test — for example, comparing similar patients with and without outreach — before we can say whether outreach helps.",
      evidence: (
        <div className="flex gap-6">
          <div>
            <div className="text-2xl font-semibold tabular-nums text-destructive">
              {outreachAssociation.withContact == null ? "—" : formatPct(outreachAssociation.withContact)}
            </div>
            <div className="text-xs text-muted-foreground">Still dropped out, successfully reached (n={outreachAssociation.nWith})</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {outreachAssociation.withoutContact == null ? "—" : formatPct(outreachAssociation.withoutContact)}
            </div>
            <div className="text-xs text-muted-foreground">Still dropped out, never reached (n={outreachAssociation.nWithout})</div>
          </div>
        </div>
      ),
      tag: "Needs more evidence",
    },
  ]

  const groupC: Problem[] = [
    {
      n: 1,
      title: "No action queue or prioritization logic exists to guide health workers",
      evidenceShort: "submission_template_action_queue.csv ships as an empty header-only template — nobody has filled it in yet.",
      evidence: (
        <p>
          `submission_template_action_queue.csv` (episode_id, priority, recommended_action, assigned_cadre) is header-only.
          Without a risk score, every at-risk patient today gets roughly the same, unweighted attention.
        </p>
      ),
      implication: "A first risk score already exists (ROC-AUC 0.70, see MODEL_RESULTS.md) — rank at-risk patients by risk × reachability × distance so worker time goes to the highest-value contact first.",
    },
    {
      n: 2,
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
      n: 3,
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
      n: 4,
      title: "Health-worker time is spent without risk-weighting",
      evidenceShort: actionsPerAtRisk == null ? "—" : `${actionsPerAtRisk.toFixed(2)} outreach actions per at-risk episode, unweighted by risk.`,
      evidence: (
        <p>
          <strong>{actionsPerAtRisk == null ? "—" : actionsPerAtRisk.toFixed(2)}</strong> outreach actions per at-risk episode
          today, applied roughly uniformly rather than concentrated on the highest-risk, most-reachable patients.
        </p>
      ),
      implication: "A risk-ranked queue is the direct lever to spend the same worker-hours more effectively — but it needs to be built.",
    },
  ]

  const allProblems = groupC.map((p) => ({ ...p, group: "D" }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Problems"
        description="This page has four parts: A) connecting a patient's scattered records, B) what the data shows about drop-out, C) whether we can identify patients who may drop out, and D) what a real solution still needs. Sections B and D change with the filters above. Sections A and C always show one selected patient, no matter what filters are applied. See PROBLEM_ANALYSIS.md and MODEL_RESULTS.md for the full write-ups."
      />

      <section className="flex flex-col gap-3">
        <GroupHeading
          letter="A"
          title="Can we connect the patient's records?"
          blurb="A patient's information is scattered across different systems — the consultation, the pharmacy, the lab, the health worker's visit log. Here, we bring one patient's records together into a single timeline."
        />
        <ChartCard title="One patient's care journey" description="Pick a patient below, or type in any episode ID. The same patient's risk prediction appears in Section C further down.">
          <div className="flex flex-col gap-3">
            <PatientPicker
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              lookupInput={lookupInput}
              setLookupInput={setLookupInput}
              lookupError={lookupError}
              handleLookup={handleLookup}
            />
            <PatientJourneyDemo episodes={episodes} selectedId={selectedId} timeline={timeline} timelineError={timelineError} />
          </div>
        </ChartCard>
        <ChartCard
          title="Does this work reliably, across everyone — not just this one patient?"
          description="The same kind of matching used above, checked across all 5,516 patients"
        >
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Across all patients, records could be reliably matched between{" "}
              <strong className="text-foreground">{linkedMin.toFixed(1)}%</strong> and{" "}
              <strong className="text-foreground">{linkedMax.toFixed(1)}%</strong> of the time, depending on which system the
              record came from.
            </p>
            <p>
              Lab records are harder to connect because they do not contain the consultation ID. We match them using
              patient details and nearby dates, so some uncertainty remains.
              {labLinkageDiagnostics ? (
                <>
                  {" "}
                  In about{" "}
                  <strong className="text-foreground">
                    {labLinkageDiagnostics.order_sensitivity_of_actual_assignments.order_sensitive_pct_of_matched.toFixed(1)}%
                  </strong>{" "}
                  of matched lab records, the record could plausibly belong to a different, nearby visit by the same patient
                  (see the Data Quality page for detail).
                </>
              ) : null}
            </p>
          </div>
        </ChartCard>
        <div className="rounded-lg border bg-muted/30 p-3 text-xs">
          <span className="font-semibold text-foreground">What this proves: </span>
          <span className="text-muted-foreground">
            We can reconstruct most of a patient&apos;s care journey even though the records come from separate systems.
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading
          letter="B"
          title="What does the data tell us about dropout?"
          blurb="We looked at the data to understand where and why patients drop out of care. Here are the 6 things we found — not 50 charts."
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {findings.map((f) => (
            <FindingCard key={`B-${f.n}`} {...f} />
          ))}
        </div>

        <ChartCard title="What can we actually act on?" description="A direct answer, not left for the reader to guess">
          <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
            <div>
              <Badge variant="secondary" className="mb-1.5 text-[10px]">
                We can act on now
              </Badge>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>Medicine pickup is the biggest drop-out point → prioritize medicine follow-up.</li>
                <li>If stock is unavailable → fix the supply issue instead of blaming the patient.</li>
                <li>Patients living farther away may need a different follow-up approach.</li>
                <li>Patients with multiple conditions or low digital access may need more support.</li>
              </ul>
            </div>
            <div>
              <Badge variant="destructive" className="mb-1.5 text-[10px]">
                We need more evidence
              </Badge>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>Facility differences may come from staffing, workload, geography, or workflow. We need to investigate before deciding the fix.</li>
                <li>Outreach results cannot currently tell us whether outreach works, because outreach is mainly used for patients who are already difficult to follow up.</li>
                <li>Some medicine cases cannot be clearly classified as patient-side or supply-side from the available data.</li>
              </ul>
            </div>
          </div>
        </ChartCard>

        <ChartCard title="The 6 findings, in one table" description="Same numbers as the cards above">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Finding</TableHead>
                <TableHead className="w-32">Tag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((f) => (
                <TableRow key={f.n}>
                  <TableCell className="text-xs font-semibold">{f.n}</TableCell>
                  <TableCell className="max-w-xl text-xs whitespace-normal">{f.headline}</TableCell>
                  <TableCell>
                    <Badge variant={TAG_VARIANT[f.tag]} className="text-[10px]">
                      {f.tag}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading
          letter="C"
          title="Can we identify patients who may drop out?"
          blurb="We also tested whether information available at the time of consultation can help us identify patients who may later drop out."
        />
        <ChartCard
          title="Risk Prediction"
          description="Same patient as Section A above. The prediction uses only what was known during the consultation — age, diagnosis, distance, connectivity, past visits, past NCD check-ups, and what the doctor advised. It never uses anything that happened after the consultation."
        >
          <PredictionDemo episodes={episodes} selectedId={selectedId} predictions={predictions} oofPredictions={oofPredictions} predictionsError={predictionsError} />
        </ChartCard>
        <ChartCard title="How good is this at scale, not just for one patient?" description="The same kind of prediction, checked against every Development patient">
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              The model has a <strong className="text-foreground">moderate</strong> ability to separate patients who later drop
              out from those who complete care (ROC-AUC ≈ 0.70). It is useful as a supporting signal, but it is not accurate
              enough to make decisions on its own.
            </p>
            <p>
              Part of the model&apos;s performance comes from a simple fact: patients who are asked to complete more care
              steps have more opportunities to miss one. So the model should not be treated as a pure measure of patient
              behaviour — see <code className="text-[11px]">MODEL_RESULTS.md</code> for the full breakdown.
            </p>
            <p>
              The model is much less reliable at predicting exactly where a patient will drop out — it&apos;s often wrong
              about which step. The overall drop-out risk is the more useful number; the likely-stage guess is only a weak
              hint, and health workers should not rely on it alone.
            </p>
          </div>
        </ChartCard>
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading letter="D" title="Design an intervention health workers can use" blurb="What's missing to turn a risk score into action — prioritization, channel routing, and honest effectiveness measurement." />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {groupC.map((p) => (
            <ProblemCard key={`D-${p.n}`} {...p} />
          ))}
        </div>
      </section>

      <ChartCard title="Group D problems, evidence, and implication" description="Same numbers as the cards above, in one table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Group</TableHead>
              <TableHead>Problem</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Implication</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allProblems.map((p) => (
              <TableRow key={`${p.group}-${p.n}`}>
                <TableCell className="text-xs font-semibold text-destructive">
                  <Badge variant="outline" className="text-[10px]">
                    {p.group}.{p.n}
                  </Badge>
                </TableCell>
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
