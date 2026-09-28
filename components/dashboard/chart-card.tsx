import * as React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** Every chart on every page renders inside this so titles stay consistent
 * (phrased as a question or finding, per the design direction) and the N /
 * caveat line has one place to live. */
export function ChartCard({
  title,
  description,
  denominatorNote,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  denominatorNote?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="px-4">
        {children}
        {denominatorNote ? <p className="mt-2 text-[11px] text-muted-foreground">{denominatorNote}</p> : null}
      </CardContent>
    </Card>
  )
}
