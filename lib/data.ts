import type { DataQuality, Episode, Facility, Geography, LabLinkageDiagnostics, MedicineStockRow, OutreachAction } from "./types"

interface Columnar {
  columns: string[]
  rows: unknown[][]
}

/** Reconstructs row objects from the {columns, rows} format written by
 * scripts/build_processed.py (chosen over record-oriented JSON because it
 * cuts payload size by ~3x -- column names aren't repeated per row). */
function fromColumnar<T>(data: Columnar): T[] {
  const { columns, rows } = data
  return rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i]
    return obj as T
  })
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export async function loadEpisodes(): Promise<Episode[]> {
  return fromColumnar<Episode>(await getJson<Columnar>("/data/episodes.json"))
}

export async function loadOutreachActions(): Promise<OutreachAction[]> {
  return fromColumnar<OutreachAction>(await getJson<Columnar>("/data/outreach_actions.json"))
}

export async function loadFacilities(): Promise<Facility[]> {
  return getJson<Facility[]>("/data/facilities.json")
}

export async function loadGeography(): Promise<Geography[]> {
  return getJson<Geography[]>("/data/geography.json")
}

export async function loadMedicineStock(): Promise<MedicineStockRow[]> {
  return getJson<MedicineStockRow[]>("/data/medicine_stock.json")
}

export async function loadDataQuality(): Promise<DataQuality> {
  return getJson<DataQuality>("/data/data_quality.json")
}

export async function loadLabLinkageDiagnostics(): Promise<LabLinkageDiagnostics> {
  return getJson<LabLinkageDiagnostics>("/data/lab_linkage_diagnostics.json")
}
