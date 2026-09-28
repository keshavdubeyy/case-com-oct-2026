"use client"

import * as React from "react"

import {
  loadDataQuality,
  loadEpisodes,
  loadFacilities,
  loadGeography,
  loadLabLinkageDiagnostics,
  loadMedicineStock,
  loadOutreachActions,
} from "@/lib/data"
import { applyFilters, DEFAULT_FILTERS, deriveFilterOptions, type FilterOptions, type Filters } from "@/lib/filters"
import type { DataQuality, Episode, Facility, Geography, LabLinkageDiagnostics, MedicineStockRow, OutreachAction } from "@/lib/types"

interface DashboardData {
  loading: boolean
  error: string | null
  episodes: Episode[]
  filteredEpisodes: Episode[]
  outreach: OutreachAction[]
  facilities: Facility[]
  geography: Geography[]
  medicineStock: MedicineStockRow[]
  dataQuality: DataQuality | null
  labLinkageDiagnostics: LabLinkageDiagnostics | null
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  options: FilterOptions
}

const Ctx = React.createContext<DashboardData | null>(null)

export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [episodes, setEpisodes] = React.useState<Episode[]>([])
  const [outreach, setOutreach] = React.useState<OutreachAction[]>([])
  const [facilities, setFacilities] = React.useState<Facility[]>([])
  const [geography, setGeography] = React.useState<Geography[]>([])
  const [medicineStock, setMedicineStock] = React.useState<MedicineStockRow[]>([])
  const [dataQuality, setDataQuality] = React.useState<DataQuality | null>(null)
  const [labLinkageDiagnostics, setLabLinkageDiagnostics] = React.useState<LabLinkageDiagnostics | null>(null)
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      loadEpisodes(),
      loadOutreachActions(),
      loadFacilities(),
      loadGeography(),
      loadMedicineStock(),
      loadDataQuality(),
      loadLabLinkageDiagnostics(),
    ])
      .then(([ep, out, fac, geo, stock, dq, labDiag]) => {
        if (cancelled) return
        setEpisodes(ep)
        setOutreach(out)
        setFacilities(fac)
        setGeography(geo)
        setMedicineStock(stock)
        setDataQuality(dq)
        setLabLinkageDiagnostics(labDiag)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredEpisodes = React.useMemo(() => applyFilters(episodes, filters), [episodes, filters])
  const options = React.useMemo(() => deriveFilterOptions(episodes), [episodes])

  const value: DashboardData = {
    loading,
    error,
    episodes,
    filteredEpisodes,
    outreach,
    facilities,
    geography,
    medicineStock,
    dataQuality,
    labLinkageDiagnostics,
    filters,
    setFilters,
    options,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDashboardData(): DashboardData {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error("useDashboardData must be used inside DashboardDataProvider")
  return ctx
}
