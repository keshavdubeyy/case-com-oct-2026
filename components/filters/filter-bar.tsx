"use client"

import * as React from "react"
import { ListFilter, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { DateRangeFilter } from "@/components/filters/date-range-filter"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { MultiSelectFilter } from "@/components/filters/multi-select-filter"
import { activeFilterCount, DEFAULT_FILTERS } from "@/lib/filters"

export function FilterBar() {
  const { filters, setFilters, options, filteredEpisodes, episodes } = useDashboardData()
  const count = activeFilterCount(filters)
  const advancedCount =
    count - (filters.dateStart || filters.dateEnd ? 1 : 0) - (filters.cohort !== "ALL" ? 1 : 0) - (filters.ltfuStatus !== "ALL" ? 1 : 0)

  const calendarFallbackMonth = React.useMemo(() => {
    let max: string | null = null
    for (const e of episodes) {
      if (!max || e.consult_date > max) max = e.consult_date
    }
    if (!max) return undefined
    // Two-month calendar; back up one month so the visible range ends on the latest data.
    const date = new Date(`${max}T00:00:00`)
    date.setMonth(date.getMonth() - 1)
    return date
  }, [episodes])

  return (
    <>
      <Select value={filters.cohort} onValueChange={(v) => setFilters((f) => ({ ...f, cohort: v as typeof f.cohort }))}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Cohort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All cohorts</SelectItem>
          <SelectItem value="DEVELOPMENT">Development</SelectItem>
          <SelectItem value="EVALUATION">Evaluation</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.ltfuStatus} onValueChange={(v) => setFilters((f) => ({ ...f, ltfuStatus: v as typeof f.ltfuStatus }))}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="LTFU status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Any outcome</SelectItem>
          <SelectItem value="LTFU">Lost to follow-up</SelectItem>
          <SelectItem value="COMPLETED">Completed care</SelectItem>
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-auto" />

      <DateRangeFilter
        start={filters.dateStart}
        end={filters.dateEnd}
        onChange={({ start, end }) => setFilters((f) => ({ ...f, dateStart: start, dateEnd: end }))}
        fallbackMonth={calendarFallbackMonth}
      />

      <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-auto" />

      <Sheet>
        <SheetTrigger
          render={
            <Button variant="outline" className="gap-1.5">
              <ListFilter className="size-4" />
              More filters
              {advancedCount > 0 ? (
                <Badge variant="secondary" className="px-1 text-[10px]">
                  {advancedCount}
                </Badge>
              ) : null}
            </Button>
          }
        />
        <SheetContent>
          <SheetHeader>
            <SheetTitle>More filters</SheetTitle>
            <SheetDescription>Narrow the dashboard down by geography, demographics, and clinical status.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-6 pb-6">
            <FilterSection title="Geography">
              <MultiSelectFilter label="District" options={options.district} value={filters.district} onChange={(v) => setFilters((f) => ({ ...f, district: v }))} />
              <MultiSelectFilter label="Block" options={options.block} value={filters.block} onChange={(v) => setFilters((f) => ({ ...f, block: v }))} />
              <MultiSelectFilter label="Village" options={options.village} value={filters.village} onChange={(v) => setFilters((f) => ({ ...f, village: v }))} />
              <MultiSelectFilter
                label="Facility"
                options={options.facility.map((f) => ({ value: f.id, label: f.name }))}
                value={filters.facility}
                onChange={(v) => setFilters((f) => ({ ...f, facility: v }))}
              />
            </FilterSection>

            <FilterSection title="Demographics">
              <MultiSelectFilter label="Gender" options={options.gender} value={filters.gender} onChange={(v) => setFilters((f) => ({ ...f, gender: v }))} />
              <MultiSelectFilter label="Age group" options={options.ageGroup} value={filters.ageGroup} onChange={(v) => setFilters((f) => ({ ...f, ageGroup: v }))} />
            </FilterSection>

            <FilterSection title="Clinical">
              <MultiSelectFilter label="Diagnosis" options={options.diagnosis} value={filters.diagnosis} onChange={(v) => setFilters((f) => ({ ...f, diagnosis: v }))} />
              <MultiSelectFilter label="NCD status" options={options.ncdStatus} value={filters.ncdStatus} onChange={(v) => setFilters((f) => ({ ...f, ncdStatus: v }))} />
              <MultiSelectFilter label="Control status" options={options.controlStatus} value={filters.controlStatus} onChange={(v) => setFilters((f) => ({ ...f, controlStatus: v }))} />
              <MultiSelectFilter label="Dropout stage" options={options.dropoutStage} value={filters.dropoutStage} onChange={(v) => setFilters((f) => ({ ...f, dropoutStage: v }))} />
            </FilterSection>

            <FilterSection title="Access">
              <MultiSelectFilter label="Distance" options={options.distanceBucket} value={filters.distanceBucket} onChange={(v) => setFilters((f) => ({ ...f, distanceBucket: v }))} />
              <MultiSelectFilter label="Connectivity" options={options.connectivity} value={filters.connectivity} onChange={(v) => setFilters((f) => ({ ...f, connectivity: v }))} />
              <MultiSelectFilter label="Road access" options={options.roadAccess} value={filters.roadAccess} onChange={(v) => setFilters((f) => ({ ...f, roadAccess: v }))} />
            </FilterSection>
          </div>
        </SheetContent>
      </Sheet>

      {count > 0 ? (
        <Button variant="ghost" className="gap-1 text-muted-foreground" onClick={() => setFilters(DEFAULT_FILTERS)}>
          <X className="size-4" />
          Clear {count} filter{count === 1 ? "" : "s"}
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="tabular-nums">
          {filteredEpisodes.length.toLocaleString()} / {episodes.length.toLocaleString()} episodes
        </Badge>
      </div>
    </>
  )
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
