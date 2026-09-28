"""Medicine-classification fixture tests (VALIDATION_REPORT.md Step 6,
"Medicine logic"). Exercises the ACTUAL scripts/build_processed.py::
classify_medicine_access() function against small, hand-built fixtures --
not a reimplementation of its logic.

IMPORTANT: the "one of multiple medicines missing" fixture below caught a
real, previously-undetected bug during this test-writing pass: the original
implementation only checked that >=1 dispensing row existed SOMEWHERE for the
whole prescription order, not that EVERY prescribed medicine had one. A
prescription with 2 medicines where only 1 was ever dispensed (and that one
row said 'Dispensed') was incorrectly classified 'completed'. This affected
209 of 4,209 real prescriptions (5.0%) in the dataset -- see P1_FIXES.md for
before/after numbers. The bug is now fixed in classify_medicine_access();
this test guards against it regressing.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from build_processed import classify_medicine_access  # noqa: E402

FACILITY = "FAC001"
MONTH = pd.Timestamp("2026-02-01")


def presc_row(tc_id, presc_id, line_id, medicine, date=pd.Timestamp("2026-02-01")):
    return {
        "prescription_id": presc_id,
        "prescription_line_id": line_id,
        "teleconsult_id": tc_id,
        "medicine_name": medicine,
        "prescription_date": date,
        "facility_id": FACILITY,
    }


def disp_row(dispense_id, presc_id, medicine, status, partial=0, stockout=0, date=pd.Timestamp("2026-02-01")):
    return {
        "dispense_id": dispense_id,
        "prescription_id": presc_id,
        "medicine_name": medicine,
        "dispense_date": date,
        "dispense_status": status,
        "partial_fill": partial,
        "stockout_flag": stockout,
        "facility_id": FACILITY,
    }


def stock_row(medicine, status="Adequate"):
    return {"facility_id": FACILITY, "medicine_name": medicine, "snapshot_month": MONTH, "stock_status": status}


DISP_COLUMNS = ["dispense_id", "prescription_id", "medicine_name", "dispense_date", "dispense_status", "partial_fill", "stockout_flag", "facility_id"]


def empty_disp() -> pd.DataFrame:
    """An empty dispensing frame still needs the real columns -- a bare
    pd.DataFrame([]) has none, which build_processed.py's dtype-sensitive
    column access (disp["dispense_date"].values.astype(...)) can't handle."""
    return pd.DataFrame(columns=DISP_COLUMNS)


def classify_one(prescriptions, dispensing, stock):
    """Run classify_medicine_access on a single-episode fixture and return its one output row as a dict."""
    disp_df = empty_disp() if len(dispensing) == 0 else pd.DataFrame(dispensing)
    out = classify_medicine_access(pd.DataFrame(prescriptions), disp_df, pd.DataFrame(stock))
    assert len(out) == 1
    return out.iloc[0].to_dict()


def test_all_medicines_fully_dispensed():
    presc = [presc_row("TC1", "RX1", "RX1-1", "Metformin"), presc_row("TC1", "RX1", "RX1-2", "Amlodipine")]
    disp = [
        disp_row("D1", "RX1", "Metformin", "Dispensed"),
        disp_row("D2", "RX1", "Amlodipine", "Dispensed"),
    ]
    stock = [stock_row("Metformin"), stock_row("Amlodipine")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_fully_dispensed"] is True
    assert result["medicine_outcome"] == "completed"
    assert result["medicine_access_classification"] == "completed"


def test_one_of_multiple_medicines_missing_is_not_completed():
    """Regression test for the bug found while writing this suite: a
    prescription must NOT be classified 'completed' just because ONE of its
    medicines was fully dispensed while another was never dispensed at all."""
    presc = [presc_row("TC2", "RX2", "RX2-1", "Metformin"), presc_row("TC2", "RX2", "RX2-2", "Amlodipine")]
    disp = [disp_row("D1", "RX2", "Metformin", "Dispensed")]  # Amlodipine: zero dispensing rows
    stock = [stock_row("Metformin"), stock_row("Amlodipine")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_fully_dispensed"] is False
    assert result["medicine_outcome"] != "completed"
    assert result["medicine_access_classification"] != "completed"


def test_partial_fill():
    presc = [presc_row("TC3", "RX3", "RX3-1", "Cetirizine")]
    disp = [disp_row("D1", "RX3", "Cetirizine", "Partially dispensed", partial=1)]
    stock = [stock_row("Cetirizine")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_fully_dispensed"] is False
    assert result["medicine_outcome"] == "partial dispensing"


def test_zero_dispensing_attempt_with_adequate_stock_is_patient_side():
    presc = [presc_row("TC4", "RX4", "RX4-1", "Paracetamol")]
    disp: list[dict] = []  # no dispensing rows at all
    stock = [stock_row("Paracetamol", "Adequate")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_dispensing_attempted"] is False
    assert result["medicine_outcome"] == "medicine not received"
    assert result["medicine_access_classification"] == "patient_no_collection_attempt"


def test_stockout_flag_marks_system_stockout():
    presc = [presc_row("TC5", "RX5", "RX5-1", "Amoxicillin")]
    disp = [disp_row("D1", "RX5", "Amoxicillin", "Not dispensed due to stock", stockout=1)]
    stock = [stock_row("Amoxicillin", "Adequate")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_access_classification"] == "system_stockout"


def test_low_facility_stock_without_a_dispensing_row_marks_system_stockout():
    """Facility-level stock_status alone (no dispensing row at all) must be
    enough to avoid patient-side blame -- per METRICS.md's explicit rule."""
    presc = [presc_row("TC6", "RX6", "RX6-1", "Pantoprazole")]
    disp: list[dict] = []
    stock = [stock_row("Pantoprazole", "Low stock")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_access_classification"] == "system_stockout"


def test_ambiguous_partial_evidence_is_indeterminate_not_patient_blame():
    """A partial-fill case with no explicit stockout signal must be
    'indeterminate', never defaulted to patient-side blame."""
    presc = [presc_row("TC7", "RX7", "RX7-1", "Metformin")]
    disp = [disp_row("D1", "RX7", "Metformin", "Partially dispensed", partial=1, stockout=0)]
    stock = [stock_row("Metformin", "Adequate")]
    result = classify_one(presc, disp, stock)
    assert result["medicine_access_classification"] == "indeterminate"


def test_no_medicine_advised_episodes_are_absent_from_output():
    """classify_medicine_access only ever receives episodes with a
    prescription -- episodes with medicine_advised='No' are joined in later
    (build_processed.py main()) and fall back to 'not_advised'; this just
    guards that an empty prescriptions frame produces an empty output, not an
    error or a spurious row."""
    out = classify_medicine_access(
        pd.DataFrame(columns=["prescription_id", "prescription_line_id", "teleconsult_id", "medicine_name", "prescription_date", "facility_id"]),
        pd.DataFrame(columns=["dispense_id", "prescription_id", "medicine_name", "dispense_date", "dispense_status", "partial_fill", "stockout_flag", "facility_id"]),
        pd.DataFrame(columns=["facility_id", "medicine_name", "snapshot_month", "stock_status"]),
    )
    assert len(out) == 0
