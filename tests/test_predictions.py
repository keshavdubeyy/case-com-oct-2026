"""Prediction-output tests (Phase 6). Guards the shape and basic sanity of
processed/episode_predictions.csv -- the file meant to be copied into
Infinum_2026_Candidate_Dataset_Pack/submission_template_episode_predictions.csv's
column shape for an actual submission. Does not re-check model quality (that's
processed/model_metrics.json, reported in MODEL_RESULTS.md) -- only that the
output is well-formed and never leaks EVALUATION labels that don't exist.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

PROCESSED = Path(__file__).resolve().parent.parent / "processed"
RAW = Path(__file__).resolve().parent.parent / "Infinum_2026_Candidate_Dataset_Pack"

VALID_STAGES = {"Completed care journey", "Medicine not collected", "Review not attended", "Test not completed"}
VALID_TIERS = {"Low", "Medium", "High"}


@pytest.fixture(scope="module")
def predictions() -> pd.DataFrame:
    path = PROCESSED / "episode_predictions.csv"
    if not path.exists():
        pytest.skip(f"{path} not found -- run `.venv/bin/python scripts/train_dropout_model.py` first")
    return pd.read_csv(path)


@pytest.fixture(scope="module")
def submission_template_columns() -> list[str]:
    return list(pd.read_csv(RAW / "submission_template_episode_predictions.csv", nrows=0).columns)


def test_matches_submission_template_columns(predictions, submission_template_columns):
    assert list(predictions.columns) == submission_template_columns


def test_covers_every_evaluation_episode_exactly_once(predictions, episode_outcomes):
    eval_ids = set(episode_outcomes.loc[episode_outcomes["cohort"] == "EVALUATION", "episode_id"])
    assert set(predictions["episode_id"]) == eval_ids
    assert predictions["episode_id"].duplicated().sum() == 0


def test_no_development_episodes_in_predictions(predictions, episode_outcomes):
    dev_ids = set(episode_outcomes.loc[episode_outcomes["cohort"] == "DEVELOPMENT", "episode_id"])
    assert not (set(predictions["episode_id"]) & dev_ids)


def test_risk_probability_is_a_valid_probability(predictions):
    assert predictions["risk_probability"].between(0, 1).all()
    assert predictions["risk_probability"].notna().all()


def test_predicted_label_is_binary(predictions):
    assert set(predictions["predicted_lost_to_followup"].unique()) <= {0, 1}


def test_predicted_dropout_stage_is_a_known_category(predictions):
    assert set(predictions["predicted_dropout_stage"].unique()) <= VALID_STAGES


def test_priority_tier_is_one_of_three_known_values(predictions):
    assert set(predictions["priority_tier"].dropna().unique()) <= VALID_TIERS


def test_predicted_stage_consistent_with_predicted_label(predictions):
    """predicted_dropout_stage and predicted_lost_to_followup come from two
    independently-trained models and can disagree unless explicitly
    reconciled (measured at 19.9% of rows before this was fixed in
    scripts/train_dropout_model.py) -- guards that reconciliation."""
    not_ltfu = predictions[predictions["predicted_lost_to_followup"] == 0]
    assert (not_ltfu["predicted_dropout_stage"] == "Completed care journey").all()
    is_ltfu = predictions[predictions["predicted_lost_to_followup"] == 1]
    assert (is_ltfu["predicted_dropout_stage"] != "Completed care journey").all()


def test_predicted_label_consistent_with_risk_probability(predictions):
    """predicted_lost_to_followup must be the 0.5-threshold of risk_probability
    -- guards against the two columns being generated from different model
    runs and silently disagreeing."""
    expected = (predictions["risk_probability"] >= 0.5).astype(int)
    assert (predictions["predicted_lost_to_followup"] == expected).all()


@pytest.fixture(scope="module")
def oof_predictions() -> pd.DataFrame:
    path = PROCESSED / "model_oof_predictions.csv"
    if not path.exists():
        pytest.skip(f"{path} not found -- run `.venv/bin/python scripts/train_dropout_model.py` first")
    return pd.read_csv(path)


def test_oof_predictions_only_cover_development(oof_predictions, episode_outcomes):
    dev_ids = set(episode_outcomes.loc[episode_outcomes["cohort"] == "DEVELOPMENT", "episode_id"])
    assert set(oof_predictions["episode_id"]) == dev_ids
    assert oof_predictions["risk_probability_oof"].between(0, 1).all()


def test_oof_predicted_stage_consistent_with_oof_predicted_label(oof_predictions):
    """Same reconciliation guarantee as the EVALUATION predictions (see
    test_predicted_stage_consistent_with_predicted_label), applied to the
    out-of-fold DEVELOPMENT predictions used for the Problems page's
    'predicted vs. actual' demonstration."""
    not_ltfu = oof_predictions[oof_predictions["predicted_lost_to_followup_oof"] == 0]
    assert (not_ltfu["predicted_dropout_stage_oof"] == "Completed care journey").all()
    is_ltfu = oof_predictions[oof_predictions["predicted_lost_to_followup_oof"] == 1]
    assert (is_ltfu["predicted_dropout_stage_oof"] != "Completed care journey").all()


def test_oof_priority_tier_is_one_of_three_known_values(oof_predictions):
    assert set(oof_predictions["priority_tier_oof"].dropna().unique()) <= VALID_TIERS
