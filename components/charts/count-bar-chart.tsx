"use client"

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { CATEGORICAL, CHART_AXIS, CHART_GRID } from "@/lib/chart-colors"

export interface CountDatum {
  label: string
  value: number
  denominator?: number
}

interface TooltipPayloadItem {
  payload: CountDatum
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const pct = d.denominator ? ` (${((d.value / d.denominator) * 100).toFixed(1)}%)` : ""
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium">{d.label}</div>
      <div className="text-muted-foreground">
        {d.value.toLocaleString()}
        {pct}
      </div>
    </div>
  )
}

/** Vertical categorical bar chart -- distributions like dropout stage,
 * medicine-access classification, action method, contact outcome. Fixed hue
 * order per category index; x-axis already labels categories so no legend
 * box is added (a single series needs none per the skill's accessibility
 * rule). */
export function CountBarChart({
  data,
  height = 220,
  horizontal = false,
}: {
  data: CountDatum[]
  height?: number
  horizontal?: boolean
}) {
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 30)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={CHART_GRID} />
          <XAxis type="number" stroke={CHART_AXIS} fontSize={11} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={160} stroke={CHART_AXIS} fontSize={11} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={CATEGORICAL[i % CATEGORICAL.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 16, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={CHART_GRID} />
        <XAxis dataKey="label" stroke={CHART_AXIS} fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis stroke={CHART_AXIS} fontSize={11} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={CATEGORICAL[i % CATEGORICAL.length]} />
          ))}
          <LabelList dataKey="value" position="top" fontSize={10} fill="var(--muted-foreground)" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
