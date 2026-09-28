"""
Phase 7: per-episode raw-event timeline, for the "Problem 1: link the
fragmented records" demonstration -- proves linkage works by reconstructing
one real patient's actual dated journey across every source system, not just
aggregate percentages.

For every episode, joins the RAW (not pre-aggregated) events from every
source system that touches it:

  NCD screening (patient-entity linked, most recent strictly before consult)
    -> Teleconsultation (the episode's own anchor record)
    -> Prescription issued (direct key: teleconsult_id)
    -> Medicine dispensing, one row per attempt (direct key: prescription_id)
    -> Lab order/sample/result (already resolved per-episode in episode_fact.csv)
    -> Review / follow-up visit (direct key: episode_id)
    -> Outreach actions, one row per attempt (direct key: episode_id)

This does NOT change any existing metric or the episode_fact.csv schema --
it's a new, additive, read-only view over the same already-linked data, at
event grain instead of episode-aggregate grain.

Run: ./.venv/bin/python scripts/build_episode_timeline.py
Writes: processed/episode_timeline.csv, public/data/episode_timeline.json
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


def row_level_link(table_key: str, id_col: str, index: PatientIndex) -> pd.DataFrame:
    """Mirrors run_all_linkage() in build_processed.py for one table --
    needed here (rather than reusing processed/linkage_summary.csv) because
    that file is aggregated by source_patient_id and can disagree slightly
    with the row-level result build_processed.py actually uses (see
    scripts/lab_linkage_diagnostics.py's note on the same issue)."""
    df = pd.read_csv(RAW / f"{table_key}.csv")
    work = pd.DataFrame(
        {id_col: df[id_col], "patient_name": df["patient_name"], "mobile": df["mobile"], "village": df["village"]}
    )
    work["__age"] = np.nan
    work["__gender"] = None
    work["__block"] = None
    link = link_table(work, id_col, "patient_name", "mobile", "village", "__age", "__gender", "__block", index, table_key)
    df = df.copy()
    df["predicted_patient_id"] = link["predicted_patient_id"].values
    df["patient_link_tier"] = link["tier"].values
    return df


def main():
    ef = pd.read_csv(PROCESSED / "episode_fact.csv", parse_dates=["consult_date", "order_date", "sample_date", "result_date"])
    tele = pd.read_csv(RAW / "teleconsultations.csv", parse_dates=["consult_date"])
    presc = pd.read_csv(RAW / "prescriptions.csv", parse_dates=["prescription_date"])
    disp = pd.read_csv(RAW / "medicine_dispensing.csv", parse_dates=["dispense_date"])
    fu = pd.read_csv(RAW / "followup_visits.csv", parse_dates=["visit_date"])
    out = pd.read_csv(RAW / "outreach_actions.csv", parse_dates=["action_date"])
    patients = pd.read_csv(RAW / "patient_360_reference.csv")

    print("Linking ncd_screening at row level (for per-patient screening dates)...")
    index = PatientIndex(patients)
    ncd = row_level_link("ncd_screening", "ncd_source_patient_id", index)
    ncd["screening_date"] = pd.to_datetime(ncd["screening_date"])
    ncd_matched = ncd[ncd["predicted_patient_id"].notna()].sort_values("screening_date")
    ncd_by_patient = {pid: g for pid, g in ncd_matched.groupby("predicted_patient_id")}

    events = []

    def add(episode_id, event_date, event_type, label, detail, confidence=None):
        events.append(
            {
                "episode_id": episode_id,
                "event_date": None if pd.isna(event_date) else pd.Timestamp(event_date).strftime("%Y-%m-%d"),
                "event_type": event_type,
                "label": label,
                "detail": detail,
                "confidence": confidence,
            }
        )

    presc_by_tc = {tc: g for tc, g in presc.groupby("teleconsult_id")}
    fu_by_ep = {ep: g for ep, g in fu.groupby("episode_id")}
    out_by_ep = {ep: g for ep, g in out.groupby("episode_id")}
    tele_by_tc = tele.set_index("teleconsult_id")

    print(f"Building timeline for {len(ef)} episodes...")
    for _, ep in ef.iterrows():
        episode_id = ep["episode_id"]
        tc_id = ep["teleconsult_id"]
        consult_date = ep["consult_date"]
        pid = ep["predicted_patient_id"]

        # 1. NCD screening -- most recent strictly before consult, same rule
        # as build_ncd_context() (fixed to strict '<' per P1_FIXES.md #3).
        if pd.notna(pid) and pid in ncd_by_patient:
            prior = ncd_by_patient[pid]
            prior = prior[prior["screening_date"] < consult_date]
            if not prior.empty:
                row = prior.iloc[-1]
                control_label = {
                    "Uncontrolled": "not well controlled",
                    "Controlled": "well controlled",
                    "Borderline": "borderline control",
                }.get(row["control_status"], str(row["control_status"]).lower())
                screening_place = str(row["screening_type"]).replace(" screening", "").lower()
                if pd.notna(row["ncd_status"]):
                    ncd_detail = f"Found {row['ncd_status']}, {control_label}. (Checked at a {screening_place} screening.)"
                else:
                    ncd_detail = f"No diabetes or blood pressure problem found. (Checked at a {screening_place} screening.)"
                add(
                    episode_id, row["screening_date"], "ncd_screening", "Health check-up",
                    ncd_detail,
                    confidence=row["patient_link_tier"],
                )

        # 2. Teleconsultation -- the anchor event, direct key, no linkage dependency.
        t = tele_by_tc.loc[tc_id] if tc_id in tele_by_tc.index else None
        if t is not None:
            advised = [x for x, yes in [("medicine", ep["medicine_advised"] == "Yes"), ("a test", ep["test_advised"] == "Yes"), ("a review visit", ep["review_advised"] == "Yes")] if yes]
            detail = f"Reason for visit: {t['chief_complaint']}. Diagnosis: {ep['diagnosis_group']}"
            if pd.notna(ep.get("ncd_control_status")):
                detail += f" ({ep['ncd_control_status'].lower()})"
            detail += ". "
            detail += f"Doctor advised: {', '.join(advised)}." if advised else "Nothing further was advised."
            add(episode_id, consult_date, "teleconsultation", "Video/phone consultation with doctor", detail)

        # 3. Prescription -- direct key (teleconsult_id -> prescription_id is
        # 1:1 in this dataset, verified in scripts/build_processed.py).
        rx_ids: list[str] = []
        if tc_id in presc_by_tc:
            lines = presc_by_tc[tc_id]
            rx_ids = list(lines["prescription_id"].unique())
            meds = ", ".join(lines["medicine_name"].tolist())
            add(episode_id, lines["prescription_date"].iloc[0], "prescription", "Medicine prescribed", f"Doctor prescribed: {meds}.")

        # 4. Dispensing -- one event per attempt, direct key (prescription_id).
        if rx_ids:
            d = disp[disp["prescription_id"].isin(rx_ids)].sort_values("dispense_date")
            if d.empty:
                add(
                    episode_id, consult_date, "dispensing_gap", "Medicine not collected",
                    "Medicine was prescribed, but there is no record showing that the patient received it.",
                )
            else:
                status_label = {
                    "Dispensed": "Medicine collected",
                    "Partially dispensed": "Medicine partly collected",
                    "Not dispensed due to stock": "Medicine not available (out of stock)",
                }
                for _, row in d.iterrows():
                    label = status_label.get(row["dispense_status"], f"Medicine {row['dispense_status'].lower()}")
                    note = " (partly filled)" if row["partial_fill"] == 1 else (" (out of stock)" if row["stockout_flag"] == 1 else "")
                    add(episode_id, row["dispense_date"], "dispensing", label, f"{row['medicine_name']}{note}")

        # 5. Lab -- already resolved per-episode in episode_fact.csv (patient
        # link + date-window match, see build_lab_journey()); reused here
        # rather than re-deriving, since that IS the production result.
        if ep["test_advised"] == "Yes":
            if ep["lab_link_status"] == "matched":
                add(episode_id, ep["order_date"], "lab_order", "Test ordered", f"Test: {ep['test_name']}.", confidence="matched")
                if pd.notna(ep["result_date"]):
                    add(episode_id, ep["result_date"], "lab_result", "Test result received", f"Test: {ep['test_name']}.", confidence="matched")
                else:
                    add(
                        episode_id, consult_date, "lab_pending", "Test result not yet available",
                        f"{ep['test_name']} was ordered, but no result has been recorded.",
                        confidence="matched",
                    )
            else:
                add(
                    episode_id, consult_date, "lab_pending", "Test record not found",
                    "We could not find a matching lab record for this patient's test.",
                    confidence=ep["lab_link_status"],
                )

        # 6. Review visit -- direct key (episode_id).
        if episode_id in fu_by_ep:
            for _, row in fu_by_ep[episode_id].iterrows():
                detail = f"Result: {row['clinical_status']}."
                if row["referral_flag"] == "Yes":
                    detail += " Patient was referred for further care."
                add(episode_id, row["visit_date"], "review_visit", "Follow-up visit happened", detail)
        elif ep["review_advised"] == "Yes":
            due = consult_date + pd.Timedelta(days=int(ep["review_due_days"])) if pd.notna(ep["review_due_days"]) else None
            detail = (
                f"A follow-up visit was expected about {int(ep['review_due_days'])} days after the consultation, but it did not happen."
                if pd.notna(ep["review_due_days"])
                else "A follow-up visit was advised, but it did not happen."
            )
            add(episode_id, due if due is not None else consult_date, "review_due", "Follow-up visit missed", detail)

        # 7. Outreach -- one event per attempt, direct key (episode_id).
        if episode_id in out_by_ep:
            for _, row in out_by_ep[episode_id].iterrows():
                add(
                    episode_id, row["action_date"], "outreach", f"Health worker tried to reach patient: {row['action_method'].lower()}",
                    f"Result: {row['contact_outcome']}. Contacted by: {row['cadre']}. Reason for contact: {row['followup_reason']}.",
                )

    events_df = pd.DataFrame(events)
    events_df["event_date"] = events_df["event_date"].fillna("")
    events_df = events_df.sort_values(["episode_id", "event_date"])
    events_df.to_csv(PROCESSED / "episode_timeline.csv", index=False)

    # NaN (e.g. a null `confidence`) serializes as the bare token `NaN`,
    # which Python's json module accepts but JS's JSON.parse rejects outright
    # -- convert to real nulls first, matching build_processed.py's pattern.
    json_ready = events_df.astype(object).where(pd.notnull(events_df), None)

    PROCESSED.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    columnar = {"columns": list(json_ready.columns), "rows": json_ready.values.tolist()}
    (PUBLIC_DATA / "episode_timeline.json").write_text(json.dumps(columnar, default=str))

    print(f"Wrote {len(events_df)} events across {events_df['episode_id'].nunique()} episodes")
    print(f"  {PROCESSED / 'episode_timeline.csv'}")
    print(f"  {PUBLIC_DATA / 'episode_timeline.json'} ({(PUBLIC_DATA / 'episode_timeline.json').stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
