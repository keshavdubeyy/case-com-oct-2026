"""
Phase 5: consult-time (leakage-safe) modelling feature table.

Builds processed/model_features_consult_time.csv: one row per teleconsultation
episode, containing ONLY variables available at or before the consult itself,
per VALIDATION_REPORT.md Part 8 and the P1 fix list. This does NOT train a
model -- see MODEL_FEATURE_AUDIT.md for the feature-by-feature audit and
distribution report that must be reviewed before any model is trained on it.

Run: ./.venv/bin/python scripts/build_model_features.py
(requires processed/episode_fact.csv to already exist -- run
scripts/build_processed.py first, or `npm run build:processed`)
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "processed"

# Columns explicitly excluded even though they exist on episode_fact.csv --
# every one of these is either the label itself or derived from an event that
# only exists after the consult. Listed here (not just omitted) so a future
# column-list edit can be checked against this set by test_model_features.py.
EXCLUDED_POST_CONSULT_COLUMNS = {
    "lost_to_followup_label",
    "dropout_stage_label",
    "medicine_outcome",
    "medicine_fully_dispensed",
    "medicine_dispensing_attempted",
    "medicine_access_classification",
    "n_medicine_lines",  # derived from prescriptions, but only informative once dispensing is observed alongside it; excluded for caution -- see MODEL_FEATURE_AUDIT.md
    "prescription_generated",
    "lab_link_status",
    "test_status",
    "test_name",
    "lab_type",
    "order_date",
    "sample_date",
    "result_date",
    "review_completed",
    "days_consult_to_review",
    "review_overdue",
    "outreach_count",
    "successful_contact_count",
    "at_risk_no_outcome_needed",
}


def main():
    fact_path = PROCESSED / "episode_fact.csv"
    if not fact_path.exists():
        raise SystemExit(f"{fact_path} not found -- run scripts/build_processed.py first")

    fact = pd.read_csv(fact_path, parse_dates=["consult_date"])

    # Reliability gate: vulnerability_group comes from patient_360_reference
    # via probabilistic patient-entity linkage. Per the case brief's explicit
    # instruction ("do not fabricate a match when confidence is low"), only
    # carry it into the modelling table for high/medium-confidence links --
    # ambiguous/unmatched episodes get null, not a value from a low-trust link.
    reliably_linked = fact["patient_link_tier"].isin(["high", "medium"])
    vulnerability_group = fact["vulnerability_group"].where(reliably_linked, None)

    model = pd.DataFrame(
        {
            # --- identifiers / context (not model inputs) ---
            "episode_id": fact["episode_id"],
            "teleconsult_id": fact["teleconsult_id"],
            "consult_date": fact["consult_date"].dt.strftime("%Y-%m-%d"),
            "cohort": fact["cohort"],
            # --- patient / consult context ---
            "age": fact["age"],
            "gender": fact["gender"],
            "diagnosis_group": fact["diagnosis_group"],
            "district": fact["district"],
            "block": fact["block"],
            # village_resolved (36 canonical villages), not the raw
            # free-text `village` field (113 noisy spelling variants of the
            # same 36 villages) -- see MODEL_FEATURE_AUDIT.md.
            "village": fact["village_resolved"],
            "facility_id": fact["facility_id"],
            "distance_to_facility_km": fact["distance_to_facility_km"],
            "connectivity_quality": fact["connectivity_quality"],
            "road_access": fact["road_access"],
            "vulnerability_group": vulnerability_group,
            # --- care-plan information known during consultation ---
            "medicine_advised": fact["medicine_advised"],
            "test_advised": fact["test_advised"],
            "review_advised": fact["review_advised"],
            "review_due_days": fact["review_due_days"],
            # --- historical behaviour (strictly before consult_date; null,
            # not 0, when the patient link didn't clear the confidence
            # threshold -- see history_link_status on episode_fact.csv) ---
            "visits_prior_30d": fact["visits_prior_30d"],
            "visits_prior_60d": fact["visits_prior_60d"],
            "visits_prior_90d": fact["visits_prior_90d"],
            "prior_followup_reviews": fact["prior_followup_reviews"],
            "prior_referrals": fact["prior_referrals"],
            "prior_relevant_interactions": fact["prior_relevant_interactions"],
            # --- clinical context: most recent NCD screening STRICTLY
            # before consult_date (screening_date < consult_date, fixed in
            # build_processed.py::build_ncd_context() -- see P1_FIXES.md) ---
            "prior_ncd_status": fact["ncd_status"],
            "prior_control_status": fact["ncd_control_status"],
            # --- linkage / data-quality metadata ---
            "patient_link_tier": fact["patient_link_tier"],
            "patient_link_confidence": fact["patient_link_confidence"],
            # --- targets: populated for DEVELOPMENT only, null for
            # EVALUATION by construction (episode_fact.csv already carries
            # them null there) -- never a model feature, only ever a label ---
            "target_ltfu": fact["lost_to_followup_label"],
            "target_dropout_stage": fact["dropout_stage_label"],
        }
    )

    # Defensive check: none of the excluded post-consult columns leaked in
    # under a different name than expected.
    leaked = EXCLUDED_POST_CONSULT_COLUMNS & set(model.columns)
    assert not leaked, f"post-consult columns leaked into model table: {leaked}"

    # Defensive check: EVALUATION rows must never carry a target.
    eval_rows = model[model["cohort"] == "EVALUATION"]
    assert eval_rows["target_ltfu"].isna().all(), "EVALUATION rows must not carry target_ltfu"
    assert eval_rows["target_dropout_stage"].isna().all(), "EVALUATION rows must not carry target_dropout_stage"

    model = model.astype(object).where(pd.notnull(model), None)

    out_path = PROCESSED / "model_features_consult_time.csv"
    model.to_csv(out_path, index=False)

    print(f"Wrote {out_path}")
    print(f"  rows: {len(model)}")
    print(f"  columns: {len(model.columns)}")
    print(f"  DEVELOPMENT rows: {(model['cohort'] == 'DEVELOPMENT').sum()}")
    print(f"  EVALUATION rows: {(model['cohort'] == 'EVALUATION').sum()}")
    print(f"  target_ltfu non-null: {model['target_ltfu'].notna().sum()} (should equal DEVELOPMENT row count)")


if __name__ == "__main__":
    main()
