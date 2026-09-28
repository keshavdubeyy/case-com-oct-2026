"use client"

import * as React from "react"

import { SegmentRateBarChart } from "@/components/charts/segment-rate-bar-chart"
import { SegmentTable } from "@/components/dashboard/segment-table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Episode } from "@/lib/types"
import { segmentBreakdown } from "@/lib/metrics"

export interface Dimension {
  key: string
  label: string
  keyFn: (e: Episode) => string | null | undefined
  order?: string[]
}

/** Shared "pick a dimension, see N / LTFU rate / completion rate" explorer --
 * used by both the Dropout Analysis and Patient Segments pages so the two
 * don't diverge into two different breakdown UIs for the same underlying
 * segmentBreakdown() aggregation. */
export function DimensionExplorer({ episodes, dimensions, defaultKey }: { episodes: Episode[]; dimensions: Dimension[]; defaultKey?: string }) {
  const [key, setKey] = React.useState(defaultKey ?? dimensions[0]?.key)
  const dim = dimensions.find((d) => d.key === key) ?? dimensions[0]

  const rows = React.useMemo(() => {
    const r = segmentBreakdown(episodes, dim.keyFn)
    if (dim.order) {
      return [...r].sort((a, b) => dim.order!.indexOf(a.segment) - dim.order!.indexOf(b.segment))
    }
    return r
  }, [episodes, dim])

  return (
    <div className="flex flex-col gap-3">
      <Select value={dim.key} onValueChange={(v) => v && setKey(v)}>
        <SelectTrigger size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {dimensions.map((d) => (
            <SelectItem key={d.key} value={d.key}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SegmentRateBarChart rows={rows} />
      <SegmentTable rows={rows} segmentLabel={dim.label} />
    </div>
  )
}
