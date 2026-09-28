/**
 * Mirrors the column order written by scripts/build_processed.py
 * (`episode_cols`) exactly. If that list changes, this must change too —
 * there is no runtime schema check, so keep them in sync by hand.
 */
export interface Episode {
  episode_id: string
  teleconsult_id: string
  consult_date: string // YYYY-MM-DD
  cohort: "DEVELOPMENT" | "EVALUATION"
  lost_to_followup_label: 0 | 1 | null
  dropout_stage_label:
    | "Completed care journey"
    | "Medicine not collected"
    | "Review not attended"
    | "Test not completed"
    | null

  predicted_patient_id: string | null
  patient_link_confidence: number
  patient_link_tier: "high" | "medium" | "ambiguous" | "unmatched"

  gender: "M" | "F"
  age: number
  age_group: "<18" | "18-29" | "30-44" | "45-59" | "60+"

  district: string
  block: string
  village: string
  village_resolved: string | null
  village_id_resolved: string | null
  village_match_score: number

  road_access: string | null
  mobile_connectivity: string | null
  population: number | null

  distance_to_facility_km: number
  distance_bucket: "0-5km" | "5-10km" | "10-20km" | ">20km"
  connectivity_quality: "Good" | "Fair" | "Poor"

  facility_id: string
  facility_name: string
  facility_type: "PHC" | "HWC"
  facility_district: string
  facility_block: string
  network_context: string
  latitude: number
  longitude: number
  cho_count: number
  asha_linked_count: number

  chief_complaint: string
  diagnosis_group: string
  consult_mode: "Audio" | "Video" | "Assisted video"
  duration_min: number
  preferred_language: string

  medicine_advised: "Yes" | "No"
  prescription_generated: boolean
  n_medicine_lines: number | null
  medicine_outcome: "completed" | "medicine not received" | "partial dispensing" | null
  medicine_fully_dispensed: boolean | null
  /** True if >=1 dispensing row was ever recorded for this episode's prescription
   * (teleconsult_id <-> prescription_id is 1:1 in this dataset). Denominator for
   * dispensingSuccessRate() -- see lib/metrics.ts and VALIDATION_REPORT.md MED-01. */
  medicine_dispensing_attempted: boolean
  medicine_access_classification:
    | "completed"
    | "system_stockout"
    | "patient_no_collection_attempt"
    | "indeterminate"
    | "not_advised"

  test_advised: "Yes" | "No"
  lab_link_status: "matched" | "no_match_in_window" | "linkage_unresolved" | null
  test_status: "Available" | "Ordered-not-completed" | null
  test_name: string | null
  lab_type: "External lab" | "Hub lab" | "Facility lab" | null
  order_date: string | null
  sample_date: string | null
  result_date: string | null

  review_advised: "Yes" | "No"
  review_due_days: number | null
  review_completed: boolean
  days_consult_to_review: number | null
  review_overdue: boolean

  outreach_count: number
  successful_contact_count: number
  at_risk_no_outcome_needed: boolean

  vulnerability_group: string | null
  household_id: string | null
  known_ncd_status: string | null
  /** Most recent NCD status from a screening strictly BEFORE consult_date (see ncd_control_status). */
  ncd_status: string | null
  ncd_control_status: string | null
  ncd_screening_link_status: "matched" | "no_prior_screening" | "linkage_unresolved" | null

  history_link_status: "matched" | "linkage_unresolved"
  visits_prior_30d: number | null
  visits_prior_60d: number | null
  visits_prior_90d: number | null
  prior_followup_reviews: number | null
  prior_referrals: number | null
  prior_relevant_interactions: number | null
}

export interface OutreachAction {
  outreach_id: string
  outreach_source_patient_id: string
  patient_name: string
  mobile: string | null
  village: string
  action_date: string
  action_method: string
  contact_outcome: string
  cadre: "ASHA" | "CHO"
  facility_id: string
  episode_id: string
  followup_reason: string
  is_successful_contact: boolean
  cohort_derived: "DEVELOPMENT" | "EVALUATION"
  lost_to_followup_label: 0 | 1 | null
}

export interface Facility {
  facility_id: string
  facility_name: string
  facility_type: "PHC" | "HWC"
  district: string
  block: string
  latitude: number
  longitude: number
  network_context: string
  cho_count: number
  asha_linked_count: number
}

export interface Geography {
  village_id: string
  village: string
  district: string
  block: string
  latitude: number
  longitude: number
  population: number
  road_access: string
  mobile_connectivity: string
}

export interface MedicineStockRow {
  stock_record_id: string
  facility_id: string
  snapshot_month: string
  medicine_name: string
  opening_stock: number
  received_qty: number
  dispensed_qty_month: number
  closing_stock: number
  stockout_flag_month: 0 | 1
  stockout_days: number
  stock_status: "Adequate" | "Low stock" | "Reorder raised"
}

/** From scripts/build_episode_timeline.py -- one raw, dated event per row,
 * reconstructing a single episode's journey across every source system that
 * touches it (NCD screening, teleconsultation, prescription, dispensing,
 * lab, review visit, outreach). The "Problem 1: link the fragmented
 * records" demonstration on the Problems page. */
export interface TimelineEvent {
  episode_id: string
  event_date: string // "YYYY-MM-DD", or "" if unknown
  event_type:
    | "ncd_screening"
    | "teleconsultation"
    | "prescription"
    | "dispensing"
    | "dispensing_gap"
    | "lab_order"
    | "lab_result"
    | "lab_pending"
    | "review_visit"
    | "review_due"
    | "outreach"
  label: string
  detail: string
  confidence: string | null
}

/** From scripts/train_dropout_model.py -- one row per EVALUATION episode,
 * exact column shape of submission_template_episode_predictions.csv. */
export interface EpisodePrediction {
  episode_id: string
  risk_probability: number
  predicted_lost_to_followup: 0 | 1
  predicted_dropout_stage: string
  priority_tier: "Low" | "Medium" | "High"
}

/** Out-of-fold DEVELOPMENT predictions -- real, known outcome alongside what
 * the model would have predicted at consult time, never having seen this
 * row during its own training fold. Used for the "predicted vs. actual"
 * demonstration on the Problems page (Section C), not a submission file. */
export interface OofPrediction {
  episode_id: string
  consult_date: string
  target_ltfu: 0 | 1
  target_dropout_stage: string
  risk_probability_oof: number
  predicted_lost_to_followup_oof: 0 | 1
  predicted_dropout_stage_oof: string
  priority_tier_oof: "Low" | "Medium" | "High"
}

export interface LinkageStat {
  source_system: string
  distinct_source_ids: number
  high: number
  medium: number
  ambiguous: number
  unmatched: number
  linked_pct: number
}

/** From scripts/lab_linkage_diagnostics.py -- quantifies the previously-unmeasured
 * ambiguity in the lab-to-episode greedy nearest-date assignment (VALIDATION_REPORT.md
 * Part 6 / LAB_LINKAGE_DIAGNOSTICS.md). Does not reflect a changed assignment algorithm. */
export interface LabLinkageDiagnostics {
  generated_at: string
  method_note: string
  reproduction_check: {
    production_pipeline_matched_count: number
    diagnostics_reproduction_matched_count: number
    matches_production: boolean
  }
  window_overlap: {
    patients_with_overlapping_test_advised_windows: number
    overlapping_episode_pairs: number
    note: string
  }
  lab_record_contention: {
    lab_records_with_resolved_patient: number
    lab_records_eligible_for_more_than_one_episode: number
    episodes_competing_for_at_least_one_contested_lab_record: number
  }
  order_sensitivity_of_actual_assignments: {
    total_matched_assignments: number
    order_sensitive_assignments: number
    order_sensitive_pct_of_matched: number
    note: string
  }
}

export interface DataQuality {
  generated_at: string
  cohort_cutoff: string
  row_counts: Record<string, number>
  linkage_stats: LinkageStat[]
  village_resolution: {
    n_operational_villages_raw: number
    n_canonical_villages: number
    resolved_pct: number
    mean_match_score: number
  }
  lab_linkage: {
    test_advised_episodes: number
    matched: number
    linkage_unresolved: number
    no_match_in_window: number
  }
  history_linkage: {
    total_episodes: number
    matched: number
    linkage_unresolved: number
  }
}

/** {numerator, denominator, rate} -- a rate is never rendered without its N. */
export interface Rate {
  numerator: number
  denominator: number
  rate: number | null
}

export function makeRate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null }
}
