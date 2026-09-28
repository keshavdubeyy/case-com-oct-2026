"""Cohort-protection tests (VALIDATION_REPORT.md Step 6, "Cohort protection").

lib/metrics.ts's developmentOnly()/ltfuRate()/careCompletionRate()/
dropoutStageBreakdown() are TypeScript and have no test runner in this repo
yet (see P1_FIXES.md); these tests instead pin down the DATA-LEVEL guarantee
every one of those functions depends on: EVALUATION rows must never carry a
non-null outcome label, so no arithmetic mistake (treating a null as 0, or
forgetting a cohort filter) can silently pull EVALUATION rows into an LTFU,
completion-rate, or dropout-stage calculation. A regression in the null
guarantee here would corrupt every rate metric on the dashboard.
"""
from __future__ import annotations

import pandas as pd


def test_evaluation_rows_never_carry_ltfu_label(episode_fact):
    ev = episode_fact[episode_fact["cohort"] == "EVALUATION"]
    assert ev["lost_to_followup_label"].isna().all()


def test_evaluation_rows_never_carry_dropout_stage(episode_fact):
    ev = episode_fact[episode_fact["cohort"] == "EVALUATION"]
    assert ev["dropout_stage_label"].isna().all()


def test_ltfu_rate_unaffected_by_forgetting_the_cohort_filter(episode_fact):
    """If a future implementation forgot the `cohort=DEVELOPMENT` filter but
    correctly treated the null label as missing (not 0), the LTFU rate must
    be identical either way -- this is the safety net the null-not-zero
    contract provides."""
    dev = episode_fact[episode_fact["cohort"] == "DEVELOPMENT"]
    rate_filtered_first = (dev["lost_to_followup_label"] == 1).mean()

    # "Forgot to filter": compute over ALL episodes, but rely on pandas' NaN
    # comparison semantics (NaN == 1 is False, so this would be WRONG if
    # dropout counts weren't also scoped to non-null rows).
    all_eps = episode_fact
    naive_rate = (all_eps["lost_to_followup_label"] == 1).sum() / all_eps["lost_to_followup_label"].notna().sum()

    assert rate_filtered_first == naive_rate


def test_dropout_stage_breakdown_never_counts_evaluation(episode_fact):
    dev = episode_fact[episode_fact["cohort"] == "DEVELOPMENT"]
    for stage in ["Medicine not collected", "Review not attended", "Test not completed", "Completed care journey"]:
        dev_count = (dev["dropout_stage_label"] == stage).sum()
        all_count = (episode_fact["dropout_stage_label"] == stage).sum()
        # Since EVALUATION rows are always null for this field, counting over
        # ALL episodes must equal counting over DEVELOPMENT only.
        assert dev_count == all_count


def test_at_risk_flag_does_not_require_the_outcome_label(episode_fact):
    """at_risk_no_outcome_needed is the one flag explicitly designed to be
    computable on EVALUATION rows (METRICS.md #9) -- it must be populated
    (non-null boolean) for EVALUATION episodes too, unlike every
    outcome-label-derived field."""
    ev = episode_fact[episode_fact["cohort"] == "EVALUATION"]
    assert ev["at_risk_no_outcome_needed"].isin([True, False]).all()
