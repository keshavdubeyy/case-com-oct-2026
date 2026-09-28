import { Link2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const TIER_LABEL: Record<string, string> = {
  high: "High-confidence link",
  medium: "Medium-confidence link",
  ambiguous: "Ambiguous match",
  unmatched: "Unresolved link",
  matched: "Matched",
  no_match_in_window: "No match in date window",
  linkage_unresolved: "Patient link unresolved",
}

const TIER_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  high: "secondary",
  medium: "outline",
  ambiguous: "destructive",
  unmatched: "destructive",
  matched: "secondary",
  no_match_in_window: "outline",
  linkage_unresolved: "destructive",
}

/** Every metric that depends on patient-entity resolution or the lab
 * date-window match carries this badge instead of being presented with the
 * same certainty as a directly-keyed metric. Links back to the Data Quality
 * page's explanation of the method rather than re-explaining it inline. */
export function ConfidenceBadge({ tier, note }: { tier: string; note?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={TIER_VARIANT[tier] ?? "outline"} className="gap-1 text-[10px]">
            <Link2 className="size-2.5" />
            {TIER_LABEL[tier] ?? tier}
          </Badge>
        }
      />
      <TooltipContent className="max-w-64 text-xs">
        {note ?? "Linked via patient-entity resolution (name + mobile + village + age scoring). See the Data Quality & Record Linkage page for method and confidence distribution."}
      </TooltipContent>
    </Tooltip>
  )
}

export function LowSampleBadge({ n }: { n: number }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            low sample
          </Badge>
        }
      />
      <TooltipContent className="max-w-56 text-xs">
        Denominator is only {n} — treat this rate as indicative, not reliable.
      </TooltipContent>
    </Tooltip>
  )
}
