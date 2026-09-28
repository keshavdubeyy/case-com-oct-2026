"""Dataset-integrity tests (VALIDATION_REPORT.md Step 6, "Dataset integrity").

Guards against a future pipeline change silently altering row counts, grain,
or the cohort split -- every value here was independently recomputed from raw
data in VALIDATION_REPORT.md Part 2 and matched the case brief's stated
baseline exactly.
"""
from __future__ import annotations


def test_total_episode_count(episode_outcomes):
    assert len(episode_outcomes) == 5516


def test_episode_ids_unique(episode_outcomes):
    assert episode_outcomes["episode_id"].nunique() == 5516
    assert episode_outcomes["episode_id"].isna().sum() == 0
    assert episode_outcomes.duplicated(subset="episode_id").sum() == 0


def test_cohort_split(episode_outcomes):
    counts = episode_outcomes["cohort"].value_counts()
    assert counts["DEVELOPMENT"] == 4132
    assert counts["EVALUATION"] == 1384


def test_cohort_reproducible_from_consult_date(episode_outcomes):
    """The cohort label must be exactly `consult_date <= 2026-06-30`, not an
    independently-stored value that could drift out of sync with the rule."""
    cutoff = episode_outcomes["consult_date"] <= "2026-06-30"
    recomputed = cutoff.map({True: "DEVELOPMENT", False: "EVALUATION"})
    assert (episode_outcomes["cohort"] == recomputed).all()


def test_episode_fact_grain_matches_source(episode_fact, episode_outcomes):
    """The processed fact table must be exactly 1 row per episode -- no join
    in the pipeline may fan out or drop rows."""
    assert len(episode_fact) == len(episode_outcomes)
    assert episode_fact["episode_id"].nunique() == len(episode_outcomes)
    assert episode_fact.duplicated(subset="episode_id").sum() == 0
    assert set(episode_fact["episode_id"]) == set(episode_outcomes["episode_id"])


def test_episode_fact_cohort_split_unchanged(episode_fact):
    counts = episode_fact["cohort"].value_counts()
    assert counts["DEVELOPMENT"] == 4132
    assert counts["EVALUATION"] == 1384


def test_no_fully_duplicated_raw_rows():
    import pandas as pd

    from pathlib import Path

    RAW = Path(__file__).resolve().parent.parent / "Infinum_2026_Candidate_Dataset_Pack"

    files = [
        "patient_360_reference.csv",
        "teleconsultations.csv",
        "ncd_screening.csv",
        "prescriptions.csv",
        "medicine_dispensing.csv",
        "medicine_stock_status.csv",
        "lab_tests.csv",
        "followup_visits.csv",
        "visit_history.csv",
        "outreach_actions.csv",
        "facility_reference.csv",
        "geography_reference.csv",
        "episode_outcomes.csv",
    ]
    for f in files:
        df = pd.read_csv(RAW / f)
        assert df.duplicated().sum() == 0, f"{f} has fully-duplicated rows"
