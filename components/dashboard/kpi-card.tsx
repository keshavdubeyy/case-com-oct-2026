import { HelpCircle } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function KpiCard({
  label,
  value,
  sub,
  tooltip,
  className,
}: {
  label: string
  value: string
  sub?: string
  tooltip: string
  className?: string
}) {
  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="flex flex-col gap-1 px-4">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <span>{label}</span>
          <Tooltip>
            <TooltipTrigger render={<HelpCircle className="size-3 shrink-0 cursor-help" />} />
            <TooltipContent className="max-w-64 text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}
