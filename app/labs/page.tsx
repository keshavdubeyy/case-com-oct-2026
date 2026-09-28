"use client"

import { useMemo, useState } from "react"
import { HelpCircle } from "lucide-react"

import { AssociationNote } from "@/components/dashboard/association-note"
import { ConfidenceBadge, LowSampleBadge } from "@/components/dashboard/confidence-badge"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { RateText, formatPct } from "@/components/dashboard/rate-text"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { careJourneyFunnel, DISTANCE_BUCKET_ORDER, LOW_SAMPLE_THRESHOLD } from "@/lib/metrics"
import { makeRate, type Episode, type Rate } from "@/lib/types"

/** A KpiCard variant for cards whose value is a rate, so the percentage is
 * never rendered without its N -- mirrors KpiCard's layout exactly, but the
 * "value" slot is RateText (JSX) rather than a plain string. */
function RateKpiCard({
  label,
  rate,
  tooltip,
  badge,
}: {
  label: string
  rate: Rate
  tooltip: string
  badge?: React.ReactNode
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <span>{label}</span>
          <Tooltip>
            <TooltipTrigger render={<HelpCircle className="size-3 shrink-0 cursor-help" />} />
            <TooltipContent className="max-w-64 text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          <RateText rate={rate} />
        </div>
        {badge ? <div className="mt-0.5">{badge}</div> : null}
      </CardContent>
    </Card>
  )
}

interface LabSegmentRow {
  segment: string
  ordered: number
  completed: number
  rate: Rate
}

/** Groups test-advised episodes by a dimension and computes the
 * METRICS.md #5 completion rate (results available / test-advised) within
 * each group. Local to this page -- lib/metrics.ts is shared and not to be
 * edited here. */
function labCompletionBreakdown(testAdvised: Episode[], keyFn: (e: Episode) => string | null | undefined): LabSegmentRow[] {
  const groups = new Map<string, Episode[]>()
  for (const e of testAdvised) {
    const key = keyFn(e) ?? "Unknown"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }
  return Array.from(groups.entries())
    .map(([segment, rows]) => {
      const completed = rows.filter((r) => r.test_status === "Available").length
      return { segment, ordered: rows.length, completed, rate: makeRate(completed, rows.length) }
    })
    .sort((a, b) => b.ordered - a.ordered)
}

function medianDays(episodes: Episode[], fromKey: "order_date" | "sample_date", toKey: "sample_date" | "result_date") {
  const diffs: number[] = []
  for (const e of episodes) {
    const a = e[fromKey]
    const b = e[toKey]
    if (a && b) {
      const diff = (new Date(b).getTime() - new Date(a).getTime()) / 86400000
      if (Number.isFinite(diff)) diffs.push(diff)
    }
  }
  diffs.sort((x, y) => x - y)
  const n = diffs.length
  if (n === 0) return { median: null as number | null, n: 0 }
  const mid = Math.floor(n / 2)
  const median = n % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid]
  return { median, n }
}

interface BreakdownDimension {
  key: string
  label: string
  keyFn: (e: Episode) => string | null | undefined
  order?: readonly string[]
}

const DIMENSIONS: BreakdownDimension[] = [
  { key: "facility_name", label: "Facility", keyFn: (e) => e.facility_name },
  { key: "lab_type", label: "Lab type", keyFn: (e) => e.lab_type },
  { key: "village", label: "Village", keyFn: (e) => e.village_resolved ?? e.village },
  { key: "distance_bucket", label: "Distance", keyFn: (e) => e.distance_bucket, order: DISTANCE_BUCKET_ORDER },
  { key: "diagnosis_group", label: "Diagnosis", keyFn: (e) => e.diagnosis_group },
  { key: "connectivity_quality", label: "Connectivity", keyFn: (e) => e.connectivity_quality },
]

function LabBreakdownTable({ rows, segmentLabel }: { rows: LabSegmentRow[]; segmentLabel: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{segmentLabel}</TableHead>
          <TableHead className="text-right">Test-advised</TableHead>
          <TableHead className="text-right">Results available</TableHead>
          <TableHead className="text-right">Completion rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.segment}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-1.5">
                {r.segment}
                {r.ordered < LOW_SAMPLE_THRESHOLD ? <LowSampleBadge n={r.ordered} /> : null}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.ordered.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">{r.completed.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(r.rate.rate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function LabsPage() {
  const { loading, error, filteredEpisodes } = useDashboardData()

  const testAdvised = useMemo(() => filteredEpisodes.filter((e) => e.test_advised === "Yes"), [filteredEpisodes])
  const matched = useMemo(() => testAdvised.filter((e) => e.lab_link_status === "matched"), [testAdvised])
  const noMatchInWindow = useMemo(() => testAdvised.filter((e) => e.lab_link_status === "no_match_in_window"), [testAdvised])
  const linkageUnresolved = useMemo(() => testAdvised.filter((e) => e.lab_link_status === "linkage_unresolved"), [testAdvised])
  const samplesCollected = useMemo(() => matched.filter((e) => e.sample_date != null), [matched])
  const resultsAvailable = useMemo(() => matched.filter((e) => e.test_status === "Available"), [matched])

  const funnel = useMemo(() => careJourneyFunnel(filteredEpisodes), [filteredEpisodes])
  const linkageCoverage = useMemo(() => makeRate(matched.length, testAdvised.length), [matched, testAdvised])

  const orderToSample = useMemo(() => medianDays(testAdvised, "order_date", "sample_date"), [testAdvised])
  const sampleToResult = useMemo(() => medianDays(testAdvised, "sample_date", "result_date"), [testAdvised])

  const breakdowns = useMemo(() => {
    const map = new Map<string, LabSegmentRow[]>()
    for (const dim of DIMENSIONS) {
      const rows = labCompletionBreakdown(testAdvised, dim.keyFn)
      map.set(dim.key, dim.order ? [...rows].sort((a, b) => dim.order!.indexOf(a.segment) - dim.order!.indexOf(b.segment)) : rows)
    }
    return map
  }, [testAdvised])

  const [activeDim, setActiveDim] = useState(DIMENSIONS[0].key)

  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load processed data: {error}</div>
  }

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Lab Completion"
        description="How reliably do advised lab tests turn into collected samples and available results, and where does that break down? Every card and chart below responds to the filters above."
      />

      <AssociationNote text="Lab metrics are computed only for episodes whose patient identity resolved with sufficient confidence and whose lab order fell within a plausible date window after the consult — see the Data Quality page for method and coverage." />

      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center gap-4 px-4">
          <span className="text-xs font-medium text-muted-foreground">Lab record linkage, among test-advised episodes:</span>
          <div className="flex items-center gap-1.5">
            <ConfidenceBadge tier="matched" />
            <span className="text-xs tabular-nums text-muted-foreground">{matched.length.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ConfidenceBadge tier="no_match_in_window" />
            <span className="text-xs tabular-nums text-muted-foreground">{noMatchInWindow.length.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ConfidenceBadge tier="linkage_unresolved" />
            <span className="text-xs tabular-nums text-muted-foreground">{linkageUnresolved.length.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Test-advised episodes"
          value={testAdvised.length.toLocaleString()}
          tooltip="test_advised = 'Yes' among the currently filtered episodes."
        />
        <KpiCard
          label="Tests ordered"
          value={matched.length.toLocaleString()}
          sub={`of ${testAdvised.length.toLocaleString()} test-advised`}
          tooltip="Test-advised episodes whose lab_link_status = 'matched' -- a lab_tests row was found via patient-entity resolution + date-window match, regardless of test_status."
        />
        <KpiCard
          label="Samples collected"
          value={samplesCollected.length.toLocaleString()}
          sub={`of ${matched.length.toLocaleString()} matched`}
          tooltip="Matched episodes whose sample_date is not null."
        />
        <KpiCard
          label="Results available"
          value={resultsAvailable.length.toLocaleString()}
          sub={`of ${matched.length.toLocaleString()} matched`}
          tooltip="Matched episodes whose test_status = 'Available'."
        />
        <RateKpiCard
          label="Test completion rate"
          rate={funnel.testsCompleted}
          tooltip="Results available / test-advised episodes (METRICS.md #5). Denominator is all test-advised episodes, not just matched ones -- an unmatched lab record counts as incomplete."
        />
        <RateKpiCard
          label="Lab record found"
          rate={linkageCoverage}
          tooltip="Matched / test-advised episodes -- the linkage coverage itself, separate from whether the test was actually completed."
          badge={<ConfidenceBadge tier="matched" />}
        />
        <KpiCard
          label="Median order-to-sample time"
          value={orderToSample.median == null ? "—" : `${orderToSample.median.toFixed(1)} days`}
          sub={`n=${orderToSample.n.toLocaleString()} with both dates present`}
          tooltip="Median of (sample_date - order_date) in days, over test-advised episodes where both dates are present. Only matched episodes ever have these dates populated."
        />
        <KpiCard
          label="Median sample-to-result time"
          value={sampleToResult.median == null ? "—" : `${sampleToResult.median.toFixed(1)} days`}
          sub={`n=${sampleToResult.n.toLocaleString()} with both dates present`}
          tooltip="Median of (result_date - sample_date) in days, over test-advised episodes where both dates are present. Only matched episodes ever have these dates populated."
        />
      </div>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium">Where does lab completion vary?</CardTitle>
          <p className="text-xs text-muted-foreground">
            Test completion rate (results available / test-advised) broken down by dimension. Denominators are test-advised
            episode counts, not lab-matched counts, so a low rate can reflect either non-completion or a linkage miss --
            check the linkage summary above before drawing conclusions from a single segment.
          </p>
        </CardHeader>
        <CardContent className="px-4">
          <Tabs value={activeDim} onValueChange={(v) => v && setActiveDim(String(v))}>
            <TabsList>
              {DIMENSIONS.map((d) => (
                <TabsTrigger key={d.key} value={d.key}>
                  {d.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {DIMENSIONS.map((d) => (
              <TabsContent key={d.key} value={d.key}>
                <LabBreakdownTable rows={breakdowns.get(d.key) ?? []} segmentLabel={d.label} />
              </TabsContent>
            ))}
          </Tabs>
          <AssociationNote text="Association only -- differences across segments may reflect facility lab access, distance, or connectivity rather than a causal effect of the dimension itself." />
        </CardContent>
      </Card>
    </div>
  )
}
