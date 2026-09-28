import { Info } from "lucide-react"

/** Fixed disclosure line, rendered identically everywhere a chart shows a
 * correlation -- never typed per-chart, so the wording can't drift and
 * causal language can't sneak into one page but not another. */
export function AssociationNote({ text = "Association only — not a causal estimate." }: { text?: string }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Info className="size-3 shrink-0" />
      <span>{text}</span>
    </div>
  )
}
