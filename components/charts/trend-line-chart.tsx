"use client"

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { CATEGORICAL, CHART_AXIS, CHART_GRID } from "@/lib/chart-colors"

/** Multi-series line chart -- one axis only (never dual-axis), legend always
 * present for >=2 series, fixed categorical hue per series key. */
export function TrendLineChart({
  data,
  xKey,
  series,
  height = 240,
  yFormatter,
}: {
  data: Record<string, string | number>[]
  xKey: string
  series: { key: string; label: string }[]
  height?: number
  yFormatter?: (v: number) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={CHART_GRID} />
        <XAxis dataKey={xKey} stroke={CHART_AXIS} fontSize={11} />
        <YAxis stroke={CHART_AXIS} fontSize={11} tickFormatter={yFormatter} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          formatter={(v) => (yFormatter && typeof v === "number" ? yFormatter(v) : v)}
        />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={CATEGORICAL[i % CATEGORICAL.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
