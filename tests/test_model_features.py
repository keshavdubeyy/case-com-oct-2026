"""Leakage-safety tests for processed/model_features_consult_time.csv
(VALIDATION_REPORT.md Step 7). Guards against a future edit to
scripts/build_model_features.py re-introducing a post-consult column or
letting a target leak into EVALUATION rows.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

PROCESSED = Path(__file__).resolve().parent.parent / "processed"

EXCLUDED_COLUMNS = {
    "lost_to_followup_label",
    "dropout_stage_label",
    "medicine_outcome",
    "medicine_fully_dispensed",
    "medicine_dispensing_attempted",
    "medicine_access_classification",
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


@pytest.fixture(scope="module")
def model_features() -> pd.DataFrame:
    path = PROCESSED / "model_features_consult_time.csv"
    if not path.exists():
        pytest.skip(f"{path} not found -- run `.venv/bin/python scripts/build_model_features.py` first")
    return pd.read_csv(path)


def test_grain_is_one_row_per_episode(model_features, episode_fact):
    assert len(model_features) == len(episode_fact)
    assert model_features["episode_id"].nunique() == len(episode_fact)
    assert model_features.duplicated(subset="episode_id").sum() == 0


def test_no_post_consult_columns_present(model_features):
    leaked = EXCLUDED_COLUMNS & set(model_features.columns)
    assert not leaked, f"post-consult columns present in model table: {leaked}"


def test_evaluation_rows_have_no_target(model_features):
    ev = model_features[model_features["cohort"] == "EVALUATION"]
    assert ev["target_ltfu"].isna().all()
    assert ev["target_dropout_stage"].isna().all()


def test_development_rows_all_have_a_target(model_features):
    dev = model_features[model_features["cohort"] == "DEVELOPMENT"]
    assert dev["target_ltfu"].notna().all()
    assert dev["target_dropout_stage"].notna().all()


def test_cohort_split_matches_source(model_features):
    counts = model_features["cohort"].value_counts()
    assert counts["DEVELOPMENT"] == 4132
    assert counts["EVALUATION"] == 1384


def test_vulnerability_group_null_for_low_confidence_links(model_features):
    """vulnerability_group must be null wherever patient_link_tier is not
    high/medium -- it must never carry a value sourced from an
    ambiguous/unmatched patient-entity link."""
    low_confidence = model_features[~model_features["patient_link_tier"].isin(["high", "medium"])]
    assert low_confidence["vulnerability_group"].isna().all()
