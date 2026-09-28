# Model Feature Audit — `processed/model_features_consult_time.csv`

**No model has been trained.** This document audits the leakage-safe, consult-time modelling table built by `scripts/build_model_features.py` from `processed/episode_fact.csv`. Grain: **one row per teleconsultation episode** (5,516 rows = 4,132 DEVELOPMENT + 1,384 EVALUATION, matching the source exactly — verified in `tests/test_model_features.py`).

## Feature-by-feature audit

| Feature | Source | Grain | Available at consult time? | Missingness | Linkage dependency | Leakage risk | Keep/Drop |
|---|---|---|---|---|---|---|---|
| `episode_id`, `teleconsult_id` | episode_outcomes / teleconsultations | episode | Yes (identifiers) | 0% | None | None | Keep (ID, not a feature) |
| `consult_date` | teleconsultations | episode | Yes | 0% | None | None | Keep (context / time-split key, not a feature) |
| `cohort` | derived, `consult_date<=2026-06-30` | episode | Yes | 0% | None | None | Keep (split key, not a feature) |
| `age` | teleconsultations | episode | Yes | 0% | None | None | Keep |
| `gender` | teleconsultations | episode | Yes | 0% | None | None | Keep |
| `diagnosis_group` | teleconsultations | episode | Yes | 0% | None | None | Keep |
| `district`, `block` | teleconsultations | episode | Yes | 0% | None | None | Keep |
| `village` | teleconsultations, resolved via `geography_reference` | episode | Yes | 0% | Low (village-name fuzzy match, 100% resolved, mean score 0.996 — not patient-entity linkage) | None | Keep — **note:** this is `village_resolved` (36 canonical villages), not the raw noisy `village` text (113 variants), substituted deliberately for a usable categorical |
| `facility_id` | teleconsultations | episode | Yes | 0% | None | None | Keep |
| `distance_to_facility_km` | teleconsultations | episode | Yes | 0% | None | None | Keep |
| `connectivity_quality` | teleconsultations | episode | Yes (recorded at consult time) | 0% | None | None | Keep |
| `road_access` | geography_reference (village-level) | episode | Yes | 0% | Low (village-resolution) | None | Keep |
| `vulnerability_group` | patient_360_reference | patient | Yes (static reference attribute) | 0.18% overall; **null for every episode whose `patient_link_tier` is not high/medium** (deliberate reliability gate, verified in `tests/test_model_features.py`) | **High — patient-entity linkage** | None (not derived from an event) | Keep, with the reliability gate always applied |
| `medicine_advised`, `test_advised`, `review_advised` | teleconsultations | episode | Yes (clinician's decision made during the consult) | 0% | None | None | Keep |
| `review_due_days` | teleconsultations | episode | Yes (advised at consult) | 31.96% (null exactly where `review_advised='No'` — a clean eligibility signal, not missing data) | None | None | Keep (impute/flag the structural null, don't treat as missing-at-random) |
| `visits_prior_30d` / `_60d` / `_90d` | visit_history, strictly `visit_date < consult_date` | episode | Yes | 0.18% (10 episodes, `history_link_status='linkage_unresolved'` — null, never coerced to 0) | Medium — patient-entity linkage | None (strict prior-date filter, verified in `tests/test_dataset_integrity.py`-adjacent pipeline code) | Keep — but see "Redundant features" below |
| `prior_followup_reviews` | visit_history | episode | Yes (by definition) | 0.18% | Medium | None | **DROP — always 0** (see "Dead features" below) |
| `prior_referrals` | visit_history | episode | Yes (by definition) | 0.18% | Medium | None | **DROP — always 0** (see "Dead features" below) |
| `prior_relevant_interactions` | visit_history | episode | Yes | 0.18% | Medium | None | Keep |
| `prior_ncd_status` | ncd_screening, strictly `screening_date < consult_date` (fixed — see P1_FIXES.md) | episode | Yes | 52.30% (no qualifying prior screening exists for most episodes — expected, not corruption) | Medium — patient-entity linkage | None (strict `<`, fixed) | Keep, with missingness treated as "no known prior screening," not imputed to a category |
| `prior_control_status` | ncd_screening, same strict rule | episode | Yes | 39.87% | Medium | None | Keep, same caveat |
| `patient_link_tier`, `patient_link_confidence` | derived (linkage.py) | episode | Yes | 0% | Is itself the linkage output | None | Keep as a data-quality/reliability feature, not a clinical one — thresholds are heuristic, not empirically validated (see `VALIDATION_REPORT.md` LNK-01) |
| `target_ltfu` | episode_outcomes | episode | **Label, not a feature** | 25.09% (null for all 1,384 EVALUATION rows, by design) | None | **This IS the outcome** | Label only — never a feature |
| `target_dropout_stage` | episode_outcomes | episode | **Label, not a feature** | 25.09% (same) | None | **This IS the outcome** | Label only — never a feature |

**Explicitly excluded** (present on `episode_fact.csv`, deliberately left out of the modelling table — enforced by an assertion in `scripts/build_model_features.py` and `tests/test_model_features.py`): `medicine_outcome`, `medicine_fully_dispensed`, `medicine_dispensing_attempted`, `medicine_access_classification`, `prescription_generated`, `lab_link_status`, `test_status`, `test_name`, `lab_type`, `order_date`, `sample_date`, `result_date`, `review_completed`, `days_consult_to_review`, `review_overdue`, `outreach_count`, `successful_contact_count`, `at_risk_no_outcome_needed`. Every one of these is either a post-consult event outcome or derived from one.

## Dead features found during this audit (new finding, not previously in `VALIDATION_REPORT.md`)

**`prior_followup_reviews` and `prior_referrals` are structurally always 0 across all 5,516 episodes** (mean = 0.0, std = 0.0, max = 0.0). This is not a pipeline bug — it is a property of the raw dataset:

- Every `visit_history.csv` row with `visit_type='Follow-up review'` (2,575 rows) **always** carries a non-null `episode_id` (confirmed: `DATA_AUDIT.md` §5). The historical-behaviour pipeline's "prior pool" explicitly excludes rows with a non-null `episode_id` (they belong to a specific episode, not to "prior, unlinked history"). So `visit_type='Follow-up review'` can **never** appear in any episode's prior pool, and `prior_followup_reviews` can never be non-zero.
- Similarly, every row with `referral_flag='Yes'` (868 of 13,061) belongs to a `visit_type` that always carries an `episode_id` (Teleconsultation / Follow-up review); the prior pool (NCD follow-up / Screening visit / OPD visit only) is **100% `referral_flag='No'`** (4,970 of 4,970 rows checked). So `prior_referrals` can never be non-zero either.

**Recommendation: drop both from any trained model** (zero variance = zero information, and a naive model or feature-importance tool could otherwise mask a real bug behind an always-present, always-zero column). They are retained in `model_features_consult_time.csv` only because they are named explicitly in the case brief / `METRICS.md` §11's candidate-feature list — removing them from the CSV entirely, rather than flagging them, seemed more likely to hide the finding than surface it.

## Redundant / highly-correlated features

`visits_prior_30d`, `visits_prior_60d`, `visits_prior_90d` are nested windows and, as expected, correlate with each other: `r(30d,60d) = 0.64`, `r(60d,90d) = 0.77`. Not a bug — just note that a linear model would want at most one or two of these, not all three, to avoid redundant collinear inputs (a tree-based model handles this natively). No other numeric feature pair exceeded `|r| = 0.6`.

## DEVELOPMENT vs EVALUATION distribution comparison

Categorical fields (`diagnosis_group`, `connectivity_quality`, `road_access`, `gender`, `medicine_advised`, `test_advised`, `review_advised`) show **no material distribution shift** between cohorts — every category's share differs by at most ~2 percentage points.

The historical-behaviour counts show a **real, moderate shift** worth flagging before training:

| Feature | DEVELOPMENT mean | EVALUATION mean |
|---|---:|---:|
| `visits_prior_30d` | 0.068 | 0.022 |
| `visits_prior_60d` | 0.146 | 0.082 |
| `visits_prior_90d` | 0.226 | 0.155 |
| `prior_relevant_interactions` | 0.727 | 0.945 |

EVALUATION episodes show *fewer* prior teleconsult/follow-up-adjacent visits in the 30/60/90-day windows but *more* prior NCD/screening/OPD interactions than DEVELOPMENT. This could reflect a genuine difference in the synthetic generation process for the two cohorts, or simply less back-history being available/generated for the later calendar period EVALUATION covers. A model trained only on DEVELOPMENT should not assume these historical features carry the same distribution at EVALUATION time — worth a train/eval distribution check (e.g., population stability index) before trusting these features' importance.

`age`, `distance_to_facility_km`, `review_due_days`, and `patient_link_confidence` show no material DEV/EVAL difference (means within ~1–3% of each other).

## Missingness summary

| Column | Null % | Why |
|---|---:|---|
| `review_due_days` | 31.96% | Structural — null exactly where `review_advised='No'` |
| `prior_ncd_status` | 52.30% | No qualifying prior screening for most episodes |
| `prior_control_status` | 39.87% | Same |
| `target_ltfu` / `target_dropout_stage` | 25.09% | EVALUATION rows, by design |
| `vulnerability_group`, `visits_prior_*`, `prior_followup_reviews`, `prior_referrals`, `prior_relevant_interactions` | 0.18% | 10 episodes with `history_link_status`/patient link unresolved |
| Everything else | 0% | Directly-recorded consult-time fields |

## Class balance

**`target_ltfu`** (DEVELOPMENT, n=4,132): 51.89% completed (0) / 48.11% LTFU (1) — close to balanced, no resampling strictly required for a binary classifier, though worth checking per-segment balance later.

**`target_dropout_stage`** (DEVELOPMENT, n=4,132), 4-class:

| Class | Count | % |
|---|---:|---:|
| Completed care journey | 2,144 | 51.89% |
| Medicine not collected | 1,170 | 28.32% |
| Review not attended | 543 | 13.14% |
| Test not completed | 275 | 6.66% |

Meaningfully imbalanced (7.8:1 between the largest and smallest non-completed class) — a future dropout-stage classifier will need class weighting or a stratified evaluation metric (macro-F1, not accuracy) rather than being judged on raw accuracy.

## Potential target-leakage warnings

None found in the columns actually included in this table (see the feature-by-feature table above — every included field is either a static reference attribute, a consult-time decision, or a strictly-prior-to-consult historical aggregate). The two forward-looking cautions carried over from `VALIDATION_REPORT.md` Part 8 are:

1. `at_risk_no_outcome_needed` was deliberately **excluded** from this table — it reads *current* completion state (as of pipeline build time), not a consult-time snapshot, so it would leak future information if used as a feature.
2. `prior_ncd_status` / `prior_control_status` now use strict `<` (fixed — see `P1_FIXES.md`); if this pipeline is ever modified again, re-run `tests/test_dataset_integrity.py` and re-check the same-day-inclusion count before trusting these two columns again.

## Not done in this pass

No model was trained. No feature selection, scaling, encoding, or train/validation split was performed. This document is the pre-modelling gate the case brief and `VALIDATION_REPORT.md` asked for before that work begins.
