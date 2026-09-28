"use client"

import type { ReactNode } from "react"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { CHART_AXIS, CHART_GRID, ltfuStatusColor } from "@/lib/chart-colors"
import type { SegmentRow } from "@/lib/metrics"

interface TooltipPayloadItem {
  payload: SegmentRow
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium">{row.segment}</div>
      <div className="text-muted-foreground">
        LTFU {row.ltfuRate == null ? "—" : `${(row.ltfuRate * 100).toFixed(1)}%`} · {row.ltfuCount}/{row.episodeCount} episodes
      </div>
    </div>
  )
}

/** Horizontal bar chart of LTFU rate by segment, colored by status thresholds
 * (good/warning/serious/critical) rather than categorical hue, since the
 * value being encoded is a rate severity, not a series identity. N is always
 * shown via the direct label and tooltip -- never a bare bar. */
export function SegmentRateBarChart({ rows, height }: { rows: SegmentRow[]; height?: number }) {
  const data = rows.filter((r) => r.episodeCount > 0)
  const h = height ?? Math.max(160, data.length * 32)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={CHART_GRID} />
        <XAxis
          type="number"
          domain={[0, 1]}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          stroke={CHART_AXIS}
          fontSize={11}
        />
        <YAxis type="category" dataKey="segment" width={140} stroke={CHART_AXIS} fontSize={11} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey="ltfuRate" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {data.map((row) => (
            <Cell key={row.segment} fill={ltfuStatusColor(row.ltfuRate)} />
          ))}
          <LabelList
            dataKey="episodeCount"
            position="right"
            formatter={(v: ReactNode) => `n=${v}`}
            fontSize={10}
            fill="var(--muted-foreground)"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
