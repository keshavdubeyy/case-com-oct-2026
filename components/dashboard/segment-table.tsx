import { LowSampleBadge } from "@/components/dashboard/confidence-badge"
import { formatPct } from "@/components/dashboard/rate-text"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SegmentRow } from "@/lib/metrics"

/** Denominator (episode count) is always the leftmost data column, per
 * METRICS.md #10 -- a rate is never shown without it, and low-sample rows
 * are flagged rather than hidden. */
export function SegmentTable({ rows, segmentLabel = "Segment" }: { rows: SegmentRow[]; segmentLabel?: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{segmentLabel}</TableHead>
          <TableHead className="text-right">Episodes</TableHead>
          <TableHead className="text-right">LTFU count</TableHead>
          <TableHead className="text-right">LTFU rate</TableHead>
          <TableHead className="text-right">Completion rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.segment}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-1.5">
                {r.segment}
                {r.lowSample ? <LowSampleBadge n={r.episodeCount} /> : null}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.episodeCount.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">{r.ltfuCount.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(r.ltfuRate)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(r.completionRate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
