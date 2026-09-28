"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function parseIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function DateRangeFilter({
  start,
  end,
  onChange,
  fallbackMonth,
}: {
  start: string | null
  end: string | null
  onChange: (next: { start: string | null; end: string | null }) => void
  /** Month to open the calendar on when no range is selected yet (e.g. the latest date in the underlying data), so it doesn't default to today's month if that falls outside the data. */
  fallbackMonth?: Date
}) {
  const range: DateRange | undefined = React.useMemo(() => {
    const from = parseIsoDate(start)
    const to = parseIsoDate(end)
    return from || to ? { from, to } : undefined
  }, [start, end])

  const label = range?.from
    ? range.to
      ? `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`
      : format(range.from, "MMM d, yyyy")
    : "Date range"

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn("gap-1.5 font-normal", !range?.from && "text-muted-foreground")}
          >
            <CalendarIcon className="size-4" />
            {label}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={range?.from ?? fallbackMonth}
          selected={range}
          onSelect={(next) =>
            onChange({
              start: next?.from ? toIsoDate(next.from) : null,
              end: next?.to ? toIsoDate(next.to) : null,
            })
          }
        />
      </PopoverContent>
    </Popover>
  )
}
