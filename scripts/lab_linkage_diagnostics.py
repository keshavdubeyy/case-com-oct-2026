"""
Phase 4b: lab-to-episode linkage ambiguity diagnostics (read-only).

Requested by the P1 fix list in VALIDATION_REPORT.md ("Quantify lab-to-episode
ambiguity" -- Part 6 / P1). Does NOT change scripts/build_processed.py's
assignment algorithm (build_lab_journey): this script re-derives the same
patient-link + [-3,+45]-day-window + greedy-nearest-date + one-time-use
assignment, in the same chronological-episode order, purely to instrument it
with the one piece of information the production pipeline doesn't keep
downstream (which lab_record_id, specifically, got assigned to which
episode), so the ambiguity that assignment resolved can be measured.

Run: ./.venv/bin/python scripts/lab_linkage_diagnostics.py
Writes: processed/lab_linkage_diagnostics.json, public/data/lab_linkage_diagnostics.json
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from lib.linkage import PatientIndex, link_table

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "Infinum_2026_Candidate_Dataset_Pack"
PROCESSED = ROOT / "processed"
PUBLIC_DATA = ROOT / "public" / "data"

WINDOW_MIN_DAYS = -3
WINDOW_MAX_DAYS = 45


def main():
    ef = pd.read_csv(PROCESSED / "episode_fact.csv", parse_dates=["consult_date"])

    # IMPORTANT: build_lab_journey() in build_processed.py uses the ROW-LEVEL
    # linkage output (link_results["lab_tests"], one score per raw row), NOT
    # the by-source-id AGGREGATED processed/linkage_summary.csv (which can
    # differ slightly -- aggregate_by_source_id() takes a modal/consensus
    # match across a source id's rows). To reproduce the production matched
    # count exactly, this diagnostic re-scores lab_tests row-by-row the same
    # way run_all_linkage() does, rather than reusing the aggregated summary.
    patients = pd.read_csv(RAW / "patient_360_reference.csv")
    index = PatientIndex(patients)

    lab = pd.read_csv(RAW / "lab_tests.csv", parse_dates=["order_date", "sample_date", "result_date"])
    lab_work = pd.DataFrame(
        {
            "lab_source_patient_id": lab["lab_source_patient_id"],
            "patient_name": lab["patient_name"],
            "mobile": lab["mobile"],
            "village": lab["village"],
        }
    )
    lab_work["__age"] = np.nan
    lab_work["__gender"] = None
    lab_work["__block"] = None
    lab_row_link = link_table(
        lab_work, "lab_source_patient_id", "patient_name", "mobile", "village", "__age", "__gender", "__block", index, "lab_tests"
    )
    lab["predicted_patient_id"] = lab_row_link["predicted_patient_id"].values
    lab_matched = lab[lab.predicted_patient_id.notna()].copy()

    # Only test_advised episodes with a resolved patient link ever compete for
    # a lab record (mirrors build_lab_journey's tele_eligible filter exactly).
    eligible_eps = ef[(ef.test_advised == "Yes") & (ef.predicted_patient_id.notna())].copy()
    eligible_eps = eligible_eps.sort_values("consult_date").reset_index(drop=True)

    # ---- 1. Patients with >=2 test-advised episodes whose [-3,+45]-day
    #         windows around consult_date overlap each other. This is a
    #         property of the episodes alone (whether they could ever compete
    #         for the same calendar-date lab order), independent of whether a
    #         matching lab record actually exists. ----
    overlap_patient_ids: set[str] = set()
    overlap_episode_pairs = 0
    for pid, g in eligible_eps.groupby("predicted_patient_id"):
        if len(g) < 2:
            continue
        g = g.sort_values("consult_date")
        dates = g["consult_date"].tolist()
        starts = [d + pd.Timedelta(days=WINDOW_MIN_DAYS) for d in dates]
        ends = [d + pd.Timedelta(days=WINDOW_MAX_DAYS) for d in dates]
        for i in range(len(dates)):
            for j in range(i + 1, len(dates)):
                if starts[j] <= ends[i] and starts[i] <= ends[j]:
                    overlap_episode_pairs += 1
                    overlap_patient_ids.add(pid)

    # ---- 2. For every lab record with a resolved patient, which test-advised
    #         episodes of that same patient fall inside this lab record's
    #         eligible window? (order_date - consult_date in [-3,+45]) ----
    candidates_by_patient: dict[str, pd.DataFrame] = {pid: g for pid, g in eligible_eps.groupby("predicted_patient_id")}

    lab_eligible_episode_counts = []
    lab_to_eligible_episodes: dict[int, list[str]] = {}
    for idx, row in lab_matched.iterrows():
        pid = row["predicted_patient_id"]
        od = row["order_date"]
        if pd.isna(od):
            lab_eligible_episode_counts.append(0)
            continue
        g = candidates_by_patient.get(pid)
        if g is None:
            lab_eligible_episode_counts.append(0)
            continue
        delta_days = (od - g["consult_date"]).dt.days
        eligible = g[(delta_days >= WINDOW_MIN_DAYS) & (delta_days <= WINDOW_MAX_DAYS)]
        lab_eligible_episode_counts.append(len(eligible))
        if len(eligible) > 1:
            lab_to_eligible_episodes[row["lab_record_id"]] = eligible["episode_id"].tolist()

    lab_matched["n_eligible_episodes"] = lab_eligible_episode_counts
    labs_contested = lab_matched[lab_matched.n_eligible_episodes > 1]
    episodes_competing_for_a_lab: set[str] = set()
    for eps in lab_to_eligible_episodes.values():
        episodes_competing_for_a_lab.update(eps)

    # ---- 3. Re-run the EXACT same greedy nearest-date / one-time-use
    #         assignment as build_lab_journey(), but keep lab_record_id so we
    #         can tell, for every assignment actually made, whether the lab
    #         record it consumed was ALSO eligible for a different episode of
    #         the same patient (i.e. genuinely order-sensitive). ----
    lab_matched_sorted = lab_matched.sort_values("order_date").reset_index(drop=True)
    used = np.zeros(len(lab_matched_sorted), dtype=bool)
    candidates_by_patient_idx: dict[str, list[int]] = {}
    for i, pid in enumerate(lab_matched_sorted["predicted_patient_id"].values):
        candidates_by_patient_idx.setdefault(pid, []).append(i)

    assignments = []
    for _, ep in eligible_eps.iterrows():
        pid = ep["predicted_patient_id"]
        idxs = candidates_by_patient_idx.get(pid, [])
        best = None
        for i in idxs:
            if used[i]:
                continue
            od = lab_matched_sorted.loc[i, "order_date"]
            if pd.isna(od):
                continue
            delta = (od - ep["consult_date"]).days
            if WINDOW_MIN_DAYS <= delta <= WINDOW_MAX_DAYS:
                if best is None or abs(delta) < abs(best[1]):
                    best = (i, delta)
        if best is not None:
            i = best[0]
            used[i] = True
            assignments.append(
                {
                    "episode_id": ep["episode_id"],
                    "lab_record_id": lab_matched_sorted.loc[i, "lab_record_id"],
                    "n_eligible_episodes_for_this_lab": lab_matched_sorted.loc[i, "n_eligible_episodes"],
                }
            )

    assignments_df = pd.DataFrame(assignments)
    n_matched = len(assignments_df)
    n_order_sensitive = int((assignments_df["n_eligible_episodes_for_this_lab"] > 1).sum()) if n_matched else 0

    # sanity check against the production pipeline's own matched count
    production_matched = int((ef["lab_link_status"] == "matched").sum())

    result = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "method_note": (
            "Re-derives build_lab_journey()'s exact patient-link + [-3,+45]-day-window + "
            "greedy-nearest-date + one-time-use assignment (unchanged), instrumented to keep "
            "lab_record_id so contested/order-sensitive assignments can be counted. Does not "
            "modify the production assignment algorithm."
        ),
        "reproduction_check": {
            "production_pipeline_matched_count": production_matched,
            "diagnostics_reproduction_matched_count": n_matched,
            "matches_production": production_matched == n_matched,
        },
        "window_overlap": {
            "patients_with_overlapping_test_advised_windows": len(overlap_patient_ids),
            "overlapping_episode_pairs": overlap_episode_pairs,
            "note": "Counts patients with >=2 test-advised episodes whose [-3,+45]-day windows around consult_date overlap each other -- a structural precondition for ambiguity, independent of whether a real lab record exists in the overlap.",
        },
        "lab_record_contention": {
            "lab_records_with_resolved_patient": len(lab_matched),
            "lab_records_eligible_for_more_than_one_episode": int(len(labs_contested)),
            "episodes_competing_for_at_least_one_contested_lab_record": len(episodes_competing_for_a_lab),
        },
        "order_sensitivity_of_actual_assignments": {
            "total_matched_assignments": n_matched,
            "order_sensitive_assignments": n_order_sensitive,
            "order_sensitive_pct_of_matched": round(100 * n_order_sensitive / n_matched, 2) if n_matched else 0.0,
            "note": "Of the lab records actually assigned, how many were also eligible (within window) for >=1 other test-advised episode of the same patient -- i.e. could plausibly have been assigned differently under a different episode-processing order.",
        },
    }

    PROCESSED.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (PROCESSED / "lab_linkage_diagnostics.json").write_text(json.dumps(result, indent=2, default=str))
    (PUBLIC_DATA / "lab_linkage_diagnostics.json").write_text(json.dumps(result, indent=2, default=str))

    print(json.dumps(result, indent=2, default=str))
    print("\nWrote processed/lab_linkage_diagnostics.json and public/data/lab_linkage_diagnostics.json")


if __name__ == "__main__":
    main()
