"""Outcome-integrity tests (VALIDATION_REPORT.md Step 6, "Outcome integrity").

Every number here was independently recomputed from raw episode_outcomes.csv
in VALIDATION_REPORT.md Part 2 and matches the case brief's stated baseline
exactly. These tests guard that reconciliation going forward.
"""
from __future__ import annotations


def test_development_outcome_counts(episode_outcomes):
    dev = episode_outcomes[episode_outcomes["cohort"] == "DEVELOPMENT"]
    assert len(dev) == 4132
    assert (dev["lost_to_followup_label"] == 0).sum() == 2144
    assert (dev["lost_to_followup_label"] == 1).sum() == 1988


def test_evaluation_labels_are_blank(episode_outcomes):
    """EVALUATION rows must never carry a populated outcome label -- a
    regression here would mean the withheld label leaked into the source
    join, which every rate metric on the dashboard depends on staying null."""
    ev = episode_outcomes[episode_outcomes["cohort"] == "EVALUATION"]
    assert ev["lost_to_followup_label"].isna().all()
    assert ev["dropout_stage_label"].isna().all()


def test_dropout_stage_counts(episode_outcomes):
    dev = episode_outcomes[episode_outcomes["cohort"] == "DEVELOPMENT"]
    counts = dev["dropout_stage_label"].value_counts()
    assert counts["Completed care journey"] == 2144
    assert counts["Medicine not collected"] == 1170
    assert counts["Review not attended"] == 543
    assert counts["Test not completed"] == 275


def test_dropout_stage_sums_to_ltfu_count(episode_outcomes):
    """dropout_stage_label must be mutually exclusive and exhaustive: the
    three non-completed stages must sum EXACTLY to the LTFU count, with no
    episode double-counted or missing across stages."""
    dev = episode_outcomes[episode_outcomes["cohort"] == "DEVELOPMENT"]
    ltfu_n = int((dev["lost_to_followup_label"] == 1).sum())
    stage_n = int(
        dev["dropout_stage_label"].isin(["Medicine not collected", "Review not attended", "Test not completed"]).sum()
    )
    assert stage_n == ltfu_n == 1988


def test_episode_fact_reconciles_with_source_labels(episode_fact, episode_outcomes):
    merged = episode_fact.merge(episode_outcomes, on="episode_id", suffixes=("_fact", "_source"))
    assert (merged["lost_to_followup_label_fact"].fillna(-1) == merged["lost_to_followup_label_source"].fillna(-1)).all()
    assert (merged["dropout_stage_label_fact"].fillna("<NULL>") == merged["dropout_stage_label_source"].fillna("<NULL>")).all()
