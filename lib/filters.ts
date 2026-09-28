import type { Episode } from "./types"

export interface Filters {
  dateStart: string | null
  dateEnd: string | null
  cohort: "ALL" | "DEVELOPMENT" | "EVALUATION"
  district: string[]
  block: string[]
  village: string[]
  facility: string[]
  gender: string[]
  ageGroup: string[]
  diagnosis: string[]
  ncdStatus: string[]
  controlStatus: string[]
  distanceBucket: string[]
  connectivity: string[]
  roadAccess: string[]
  ltfuStatus: "ALL" | "LTFU" | "COMPLETED"
  dropoutStage: string[]
}

export const DEFAULT_FILTERS: Filters = {
  dateStart: null,
  dateEnd: null,
  cohort: "ALL",
  district: [],
  block: [],
  village: [],
  facility: [],
  gender: [],
  ageGroup: [],
  diagnosis: [],
  ncdStatus: [],
  controlStatus: [],
  distanceBucket: [],
  connectivity: [],
  roadAccess: [],
  ltfuStatus: "ALL",
  dropoutStage: [],
}

/** What the dashboard opens with -- distinct from DEFAULT_FILTERS (the true
 * empty state "Clear filters" resets to), so clearing filters doesn't just
 * bounce back to this preset. */
export const INITIAL_FILTERS: Filters = {
  ...DEFAULT_FILTERS,
  diagnosis: ["Hypertension+Diabetes"],
}

function matches(value: string | null | undefined, selected: string[]): boolean {
  if (selected.length === 0) return true
  return value != null && selected.includes(value)
}

export function applyFilters(episodes: Episode[], f: Filters): Episode[] {
  return episodes.filter((e) => {
    if (f.dateStart && e.consult_date < f.dateStart) return false
    if (f.dateEnd && e.consult_date > f.dateEnd) return false
    if (f.cohort !== "ALL" && e.cohort !== f.cohort) return false
    if (!matches(e.district, f.district)) return false
    if (!matches(e.block, f.block)) return false
    if (!matches(e.village_resolved ?? e.village, f.village)) return false
    if (!matches(e.facility_id, f.facility)) return false
    if (!matches(e.gender, f.gender)) return false
    if (!matches(e.age_group, f.ageGroup)) return false
    if (!matches(e.diagnosis_group, f.diagnosis)) return false
    if (!matches(e.known_ncd_status, f.ncdStatus)) return false
    if (!matches(e.ncd_control_status, f.controlStatus)) return false
    if (!matches(e.distance_bucket, f.distanceBucket)) return false
    if (!matches(e.connectivity_quality, f.connectivity)) return false
    if (!matches(e.road_access, f.roadAccess)) return false
    if (f.ltfuStatus === "LTFU" && e.lost_to_followup_label !== 1) return false
    if (f.ltfuStatus === "COMPLETED" && e.lost_to_followup_label !== 0) return false
    if (!matches(e.dropout_stage_label, f.dropoutStage)) return false
    return true
  })
}

export function activeFilterCount(f: Filters): number {
  let n = 0
  if (f.dateStart || f.dateEnd) n++
  if (f.cohort !== "ALL") n++
  if (f.ltfuStatus !== "ALL") n++
  for (const key of [
    "district",
    "block",
    "village",
    "facility",
    "gender",
    "ageGroup",
    "diagnosis",
    "ncdStatus",
    "controlStatus",
    "distanceBucket",
    "connectivity",
    "roadAccess",
    "dropoutStage",
  ] as const) {
    if (f[key].length > 0) n++
  }
  return n
}

export interface FilterOptions {
  district: string[]
  block: string[]
  village: string[]
  facility: { id: string; name: string }[]
  gender: string[]
  ageGroup: string[]
  diagnosis: string[]
  ncdStatus: string[]
  controlStatus: string[]
  distanceBucket: string[]
  connectivity: string[]
  roadAccess: string[]
  dropoutStage: string[]
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort()
}

export function deriveFilterOptions(episodes: Episode[]): FilterOptions {
  const facilityMap = new Map<string, string>()
  for (const e of episodes) facilityMap.set(e.facility_id, e.facility_name)
  return {
    district: uniqueSorted(episodes.map((e) => e.district)),
    block: uniqueSorted(episodes.map((e) => e.block)),
    village: uniqueSorted(episodes.map((e) => e.village_resolved ?? e.village)),
    facility: Array.from(facilityMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    gender: uniqueSorted(episodes.map((e) => e.gender)),
    ageGroup: ["<18", "18-29", "30-44", "45-59", "60+"],
    diagnosis: uniqueSorted(episodes.map((e) => e.diagnosis_group)),
    ncdStatus: uniqueSorted(episodes.map((e) => e.known_ncd_status)),
    controlStatus: uniqueSorted(episodes.map((e) => e.ncd_control_status)),
    distanceBucket: ["0-5km", "5-10km", "10-20km", ">20km"],
    connectivity: uniqueSorted(episodes.map((e) => e.connectivity_quality)),
    roadAccess: uniqueSorted(episodes.map((e) => e.road_access)),
    dropoutStage: uniqueSorted(episodes.map((e) => e.dropout_stage_label)),
  }
}
