import {
  Activity,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  MessageSquareMore,
  Pill,
  Stethoscope,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Episode, TimelineEvent } from "@/lib/types"

const EVENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ncd_screening: Activity,
  teleconsultation: Stethoscope,
  prescription: Pill,
  dispensing: Pill,
  dispensing_gap: Pill,
  lab_order: FlaskConical,
  lab_result: FlaskConical,
  lab_pending: FlaskConical,
  review_visit: ClipboardList,
  review_due: ClipboardList,
  outreach: MessageSquareMore,
}

/** Event types whose LABEL (not just detail) signals something didn't
 * happen -- rendered in the destructive color so a broken step is visually
 * distinct from a completed one, without needing to read every line. */
const GAP_EVENT_TYPES = new Set(["dispensing_gap", "lab_pending", "review_due"])

/** Plain-language stand-in for the linkage-confidence tier (see
 * scripts/lib/linkage.py) -- "Record match: reliable/probable/unclear/not
 * found" instead of the raw tier name, so a non-technical reader doesn't
 * need the Data Quality page's explanation to understand a badge here. */
const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Record match: reliable",
  medium: "Record match: probable",
  ambiguous: "Record match: unclear",
  unmatched: "Record match: not found",
  matched: "Record match: reliable",
  no_match_in_window: "Record match: not found nearby",
  linkage_unresolved: "Record match: uncertain",
}

function formatDate(d: string): string {
  if (!d) return "Date unknown"
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

function isFailure(e: TimelineEvent): boolean {
  if (GAP_EVENT_TYPES.has(e.event_type)) return true
  const l = e.label.toLowerCase()
  return l.includes("not received") || l.includes("not collected") || l.includes("not attended") || l.includes("not found") || l.includes("not completed") || l.includes("not available") || l.includes("missed")
}

const STAGE_PLAIN: Record<string, string> = {
  "Medicine not collected": "they did not collect their medicine",
  "Review not attended": "they missed their follow-up visit",
  "Test not completed": "they did not complete their test",
}

export function PatientJourneyTimeline({ episode, events }: { episode: Episode; events: TimelineEvent[] }) {
  const sorted = [...events].sort((a, b) => (a.event_date || "9999").localeCompare(b.event_date || "9999"))
  const isLtfu = episode.cohort === "DEVELOPMENT" && episode.lost_to_followup_label === 1
  const isCompleted = episode.cohort === "DEVELOPMENT" && episode.lost_to_followup_label === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>
            <strong className="text-foreground">{episode.episode_id}</strong> · {episode.gender === "F" ? "Female" : "Male"}, age {episode.age}
          </span>
          <span>{episode.diagnosis_group}</span>
          <span>
            {episode.village_resolved ?? episode.village}, {episode.district}
          </span>
          <span>{episode.facility_name}</span>
          <span>{episode.distance_to_facility_km.toFixed(1)} km to facility</span>
          <span>Connectivity: {episode.connectivity_quality}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          <Badge variant={episode.patient_link_tier === "high" ? "secondary" : "outline"} className="text-[10px]">
            {CONFIDENCE_LABEL[episode.patient_link_tier] ?? "Record match: uncertain"}
          </Badge>
        </div>
      </div>

      <div className="relative flex flex-col gap-0 pl-2">
        <div className="absolute top-2 bottom-2 left-[13px] w-px bg-border" aria-hidden />
        {sorted.map((e, i) => {
          const Icon = EVENT_ICON[e.event_type] ?? Activity
          const failure = isFailure(e)
          return (
            <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
              <div
                className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 bg-background ${
                  failure ? "border-destructive text-destructive" : "border-primary text-primary"
                }`}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="flex flex-col gap-0.5 pt-0.5">
                <div className="text-[11px] font-medium text-muted-foreground">{formatDate(e.event_date)}</div>
                <div className={`text-sm font-medium ${failure ? "text-destructive" : "text-foreground"}`}>{e.label}</div>
                {e.detail ? <div className="text-xs text-muted-foreground">{e.detail}</div> : null}
                {e.confidence ? (
                  <Badge variant="outline" className="mt-0.5 w-fit text-[10px] text-muted-foreground">
                    {CONFIDENCE_LABEL[e.confidence] ?? "Record match: uncertain"}
                  </Badge>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 rounded-lg border p-3">
        {isLtfu ? <XCircle className="size-5 shrink-0 text-destructive" /> : isCompleted ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : null}
        <div className="text-sm">
          <span className="font-semibold">What happened: </span>
          {episode.cohort === "EVALUATION" ? (
            <span>
              We don&apos;t know yet — this patient&apos;s consultation is too recent, and the organizers haven&apos;t
              released the outcome.{" "}
              {episode.at_risk_no_outcome_needed
                ? "Based on what we can see so far, this patient has an open gap in their care."
                : "Based on what we can see so far, there's no open gap in their care yet."}
            </span>
          ) : isLtfu ? (
            <span className="font-medium text-destructive">
              This patient did not complete their care — {STAGE_PLAIN[episode.dropout_stage_label ?? ""] ?? "their care journey was not completed"}.
            </span>
          ) : (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">This patient completed everything the doctor advised.</span>
          )}
        </div>
      </div>
    </div>
  )
}
