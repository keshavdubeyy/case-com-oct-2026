import type { Rate } from "@/lib/types"

/** A rate is never rendered without its N -- every usage across the
 * dashboard goes through this component instead of formatting a bare %. */
export function RateText({ rate, className }: { rate: Rate; className?: string }) {
  if (rate.rate == null) {
    return <span className={className}>— (n=0)</span>
  }
  return (
    <span className={className}>
      {(rate.rate * 100).toFixed(1)}%{" "}
      <span className="text-muted-foreground tabular-nums">
        ({rate.numerator.toLocaleString()} / {rate.denominator.toLocaleString()})
      </span>
    </span>
  )
}

export function formatPct(rate: number | null): string {
  return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`
}
