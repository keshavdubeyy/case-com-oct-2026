"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface SelectOption {
  value: string
  label: string
}

export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[] | SelectOption[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const normalized: SelectOption[] = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o))
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="justify-between gap-1.5">
            {label}
            {value.length > 0 ? (
              <Badge variant="secondary" className="px-1 text-[10px]">
                {value.length}
              </Badge>
            ) : null}
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-56 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">{label}</span>
          {value.length > 0 ? (
            <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => onChange([])}>
              Clear
            </Button>
          ) : null}
        </div>
        <ScrollArea className="h-64">
          <div className="flex flex-col gap-0.5 p-2">
            {normalized.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox checked={value.includes(opt.value)} onCheckedChange={() => toggle(opt.value)} />
                <span className="truncate">{opt.label}</span>
              </label>
            ))}
            {normalized.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">No options</p> : null}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
