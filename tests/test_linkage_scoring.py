"""Patient-entity linkage scoring fixture tests (VALIDATION_REPORT.md Step 6,
"Linkage scoring"). Exercises the actual scripts/lib/linkage.py PatientIndex +
link_table against a small synthetic canonical-patient table -- deterministic
by construction (no real data, no RNG), so these pin down the scoring
formula and threshold behaviour rather than any property of the real dataset.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from lib.linkage import HIGH_THRESHOLD, MEDIUM_THRESHOLD, PatientIndex, link_table  # noqa: E402


def make_index():
    patients = pd.DataFrame(
        [
            {"patient_id": "P001", "canonical_name": "Ravi Kumar", "gender": "M", "block": "Balanagar", "village": "Kondamallepally", "age_as_of_2026": 40, "masked_mobile": "XXXXXX1234"},
            {"patient_id": "P002", "canonical_name": "Ravi Kumar", "gender": "M", "block": "Balanagar", "village": "Bodajanampet", "age_as_of_2026": 41, "masked_mobile": "XXXXXX5678"},
            {"patient_id": "P003", "canonical_name": "Sunita Devi", "gender": "F", "block": "Chandur", "village": "Chandur", "age_as_of_2026": 35, "masked_mobile": "XXXXXX9999"},
        ]
    )
    return PatientIndex(patients)


def link_one(name, mobile, village, age, gender, block, index):
    work = pd.DataFrame(
        [{"src_id": "S1", "name": name, "mobile": mobile, "village": village, "__age": age, "__gender": gender, "__block": block}]
    )
    return link_table(work, "src_id", "name", "mobile", "village", "__age", "__gender", "__block", index, "test_source").iloc[0]


def test_clear_high_confidence_match():
    """Exact name, exact mobile-last-4, exact village, exact age -> a
    near-perfect score, well above HIGH_THRESHOLD, and no other candidate is
    close (P002 shares the name but differs on village/age/mobile)."""
    index = make_index()
    result = link_one("Ravi Kumar", "9999991234", "Kondamallepally", 40, "M", "Balanagar", index)
    assert result["tier"] == "high"
    assert result["predicted_patient_id"] == "P001"
    assert result["confidence"] >= HIGH_THRESHOLD


def test_medium_confidence_match():
    """Right name and block, but mobile and village both miss and age is off
    by several years -> score should land in the medium band, still matched
    to the best (only real) candidate."""
    index = make_index()
    result = link_one("Sunita Devi", None, "Wrong Village", 30, "F", "Chandur", index)
    assert MEDIUM_THRESHOLD <= result["confidence"] < HIGH_THRESHOLD
    assert result["tier"] == "medium"
    assert result["predicted_patient_id"] == "P003"


def test_ambiguous_when_top_two_candidates_are_within_margin():
    """P001 and P002 share a name and block; with no mobile/village/age signal
    to discriminate between them, both should score identically and the
    ambiguity margin must downgrade the match to 'ambiguous' rather than
    picking one arbitrarily."""
    index = make_index()
    result = link_one("Ravi Kumar", None, "", None, "M", "Balanagar", index)
    assert result["tier"] == "ambiguous"
    assert result["predicted_patient_id"] is None


def test_unmatched_when_no_candidate_scores_above_medium_threshold():
    """A record with a different name, different block, and no matching
    mobile/village/age against every candidate should score below
    MEDIUM_THRESHOLD and be left unmatched -- never forced onto a guess."""
    index = make_index()
    result = link_one("Totally Different Name", "0000000000", "Nowhere", 90, "F", "Nalgonda", index)
    assert result["tier"] == "unmatched"
    assert result["predicted_patient_id"] is None


def test_missing_fields_are_rescaled_not_penalized_as_zero():
    """A record with mobile/village missing entirely must have those weights
    dropped from the denominator (rescaled), not scored as an automatic 0 --
    otherwise a record with legitimately-missing fields could never reach
    high confidence even with a perfect name/age match."""
    index = make_index()
    result = link_one("Sunita Devi", None, "", 35, "F", "Chandur", index)
    # Only name (0.45) + age (0.15) contribute, rescaled over 0.60 -- both
    # are a perfect match here, so the rescaled score should still be 1.0.
    assert result["confidence"] == 1.0
    assert result["tier"] == "high"
