import { CheckCircle2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Episode } from "@/lib/types"

const TIER_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  Low: "outline",
  Medium: "secondary",
  High: "destructive",
}

export interface NormalizedPrediction {
  riskProbability: number
  predictedDropoutStage: string
  priorityTier: string
  /** Only set for DEVELOPMENT episodes, where the real outcome is known and
   * this is an out-of-fold prediction (the model never trained on this row). */
  actual?: { ltfu: 0 | 1; stage: string }
}

/** "Patient risk: 74% / Likely dropout stage: Medicine collection" -- the
 * exact output shape the case brief asked for. Shows the real outcome
 * alongside the prediction whenever it's known (DEVELOPMENT, out-of-fold),
 * rather than only ever demonstrating this on unlabeled data. */
export function RiskPredictionCard({ episode, prediction }: { episode: Episode; prediction: NormalizedPrediction }) {
  const pct = Math.round(prediction.riskProbability * 100)
  const predictedLtfu = prediction.riskProbability >= 0.5
  const actualLtfu = prediction.actual ? prediction.actual.ltfu === 1 : null
  const gotLtfuRight = actualLtfu != null ? predictedLtfu === actualLtfu : null
  const gotStageRight = prediction.actual ? prediction.predictedDropoutStage === prediction.actual.stage : null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Risk of dropout</div>
          <div className={`text-2xl font-semibold tabular-nums ${predictedLtfu ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}>{pct}%</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Likely stage (low-confidence hint)</div>
          <div className="text-sm font-semibold">{prediction.predictedDropoutStage}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Priority</div>
          <Badge variant={TIER_VARIANT[prediction.priorityTier] ?? "outline"} className="mt-1">
            {prediction.priorityTier}
          </Badge>
        </div>
      </div>

      {prediction.actual ? (
        <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-1.5">
            {gotLtfuRight ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-destructive" />}
            <span>
              <strong>What actually happened:</strong> {actualLtfu ? "this patient did not complete their care" : "this patient completed their care"}
              {gotLtfuRight ? " — the model's guess was right" : " — the model's guess was wrong"}
            </span>
          </div>
          {actualLtfu ? (
            <div className="flex items-center gap-1.5 pl-5">
              {gotStageRight ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-destructive" />}
              <span>
                Where they actually stopped: <strong>{prediction.actual.stage}</strong>
                {gotStageRight ? " — the model guessed this correctly too" : " — the model guessed a different stage"}
              </span>
            </div>
          ) : null}
          <p className="pl-5 text-muted-foreground">
            The model did not train on this patient, so this is a fair test, not hindsight. It will not always be right —
            it is moderately useful, not highly accurate (see MODEL_RESULTS.md).
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {episode.cohort === "EVALUATION"
            ? "This patient's consultation is in the evaluation period, so we don't know the real outcome yet. This is a genuine forward-looking guess, not a check against a known answer."
            : "No prediction available for this patient."}
        </p>
      )}
    </div>
  )
}
