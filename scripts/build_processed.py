"""
Phase 3: preprocessing + linkage pipeline.

Reads raw CSVs from Infinum_2026_Candidate_Dataset_Pack/ (never modified),
runs patient-entity linkage (lib/linkage.py) and village-geography resolution
(lib/geo_resolve.py), joins everything into one denormalized episode-level
fact table plus a handful of auxiliary tables, and writes JSON the Next.js
app reads client-side for interactive filtering (public/data/*.json) plus
CSV/parquet audit trails under processed/.

Run: ./.venv/bin/python scripts/build_processed.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from lib.geo_resolve import build_village_resolver
from lib.linkage import PatientIndex, aggregate_by_source_id, link_table

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "Infinum_2026_Candidate_Dataset_Pack"
PROCESSED = ROOT / "processed"
PUBLIC_DATA = ROOT / "public" / "data"
COHORT_CUTOFF = pd.Timestamp("2026-06-30")
DATA_MAX_DATE = pd.Timestamp("2026-08-25")  # small buffer past latest observed date, used as "today" proxy for overdue calc

AGE_BINS = [-1, 17, 29, 44, 59, 200]
AGE_LABELS = ["<18", "18-29", "30-44", "45-59", "60+"]
DIST_BINS = [-1, 5, 10, 20, 100000]
DIST_LABELS = ["0-5km", "5-10km", "10-20km", ">20km"]

SUCCESSFUL_CONTACT_OUTCOMES = {"Reached; promised follow-up", "Reached; counselled", "Family member reached"}


def load_raw() -> dict[str, pd.DataFrame]:
    files = [
        "patient_360_reference",
        "teleconsultations",
        "ncd_screening",
        "prescriptions",
        "medicine_dispensing",
        "medicine_stock_status",
        "lab_tests",
        "followup_visits",
        "visit_history",
        "outreach_actions",
        "facility_reference",
        "geography_reference",
        "episode_outcomes",
    ]
    raw = {f: pd.read_csv(RAW / f"{f}.csv") for f in files}
    date_cols = {
        "teleconsultations": ["consult_date"],
        "ncd_screening": ["screening_date", "next_followup_due"],
        "prescriptions": ["prescription_date"],
        "medicine_dispensing": ["dispense_date"],
        "medicine_stock_status": ["snapshot_month"],
        "lab_tests": ["order_date", "sample_date", "result_date"],
        "followup_visits": ["visit_date"],
        "visit_history": ["visit_date"],
        "outreach_actions": ["action_date"],
        "episode_outcomes": ["consult_date"],
    }
    for tbl, cols in date_cols.items():
        for c in cols:
            raw[tbl][c] = pd.to_datetime(raw[tbl][c], errors="coerce")
    return raw


LINKAGE_SOURCES = [
    # (source_system, table_key, id_col, name_col, mobile_col, village_col, age_col, gender_col, block_col)
    ("teleconsultations", "teleconsultations", "tele_source_patient_id", "patient_name", "mobile", "village", "age", "gender", "block"),
    ("ncd_screening", "ncd_screening", "ncd_source_patient_id", "patient_name", "mobile", "village", "age", "gender", "block"),
    ("prescriptions", "prescriptions", "rx_source_patient_id", "patient_name", "mobile", "village", None, None, None),
    ("medicine_dispensing", "medicine_dispensing", "pharm_source_patient_id", "patient_name", "mobile", "village", None, None, None),
    ("lab_tests", "lab_tests", "lab_source_patient_id", "patient_name", "mobile", "village", None, None, None),
    ("followup_visits", "followup_visits", "visit_source_patient_id", "patient_name", "mobile", "village", None, None, None),
    ("visit_history", "visit_history", "visit_source_patient_id", "patient_name", "mobile", "village", None, None, None),
    ("outreach_actions", "outreach_actions", "outreach_source_patient_id", "patient_name", "mobile", "village", None, None, None),
]


def run_all_linkage(raw: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """Returns {table_key: row-level linkage DataFrame aligned 1:1 (by position) with raw[table_key]}."""
    patients = raw["patient_360_reference"]
    index = PatientIndex(patients)
    results = {}
    for source_system, table_key, id_col, name_col, mobile_col, village_col, age_col, gender_col, block_col in LINKAGE_SOURCES:
        df = raw[table_key]
        work = pd.DataFrame(
            {
                id_col: df[id_col],
                name_col: df[name_col],
                mobile_col: df[mobile_col],
                village_col: df[village_col],
            }
        )
        work["__age"] = df[age_col] if age_col else np.nan
        work["__gender"] = df[gender_col] if gender_col else None
        work["__block"] = df[block_col] if block_col else None

        # tables without their own age/gender/block (prescriptions, dispensing,
        # lab_tests, followup_visits, visit_history, outreach_actions) fall
        # through to PatientIndex.candidates_no_demographics inside link_table
        # (mobile-last4 / first-name-token blocking) -- see linkage.py.
        import time

        t0 = time.time()
        res = link_table(work, id_col, name_col, mobile_col, village_col, "__age", "__gender", "__block", index, source_system)
        print(f"  linked {table_key}: {len(res)} rows in {time.time() - t0:.1f}s", flush=True)
        results[table_key] = res
    return results


def write_linkage_outputs(link_results: dict[str, pd.DataFrame]):
    summary_rows = []
    for source_system, table_key, id_col, *_ in LINKAGE_SOURCES:
        agg = aggregate_by_source_id(link_results[table_key])
        agg["source_system"] = source_system
        summary_rows.append(agg)
    summary = pd.concat(summary_rows, ignore_index=True)
    summary = summary[["source_system", "source_patient_id", "predicted_patient_id", "confidence", "tier", "n_rows"]]
    summary.to_csv(PROCESSED / "linkage_summary.csv", index=False)

    stats = []
    for source_system, table_key, *_ in LINKAGE_SOURCES:
        agg = summary[summary["source_system"] == source_system]
        n = len(agg)
        by_tier = agg["tier"].value_counts().to_dict()
        stats.append(
            {
                "source_system": source_system,
                "distinct_source_ids": n,
                "high": int(by_tier.get("high", 0)),
                "medium": int(by_tier.get("medium", 0)),
                "ambiguous": int(by_tier.get("ambiguous", 0)),
                "unmatched": int(by_tier.get("unmatched", 0)),
                "linked_pct": round(100 * (by_tier.get("high", 0) + by_tier.get("medium", 0)) / n, 2) if n else 0,
            }
        )
    return stats


def resolve_geography(raw: dict[str, pd.DataFrame]) -> pd.DataFrame:
    resolver = build_village_resolver(raw["geography_reference"])
    tele = raw["teleconsultations"]
    resolved = tele.apply(lambda r: resolver(r["village"], r["block"]), axis=1, result_type="expand")
    resolved.columns = ["village_id_resolved", "village_resolved", "village_match_score"]
    return resolved


def classify_medicine_access(prescriptions: pd.DataFrame, dispensing: pd.DataFrame, stock: pd.DataFrame) -> pd.DataFrame:
    """One row per teleconsult_id with medicine-journey fields (see METRICS.md #2, #4)."""
    presc_by_tc = prescriptions.groupby("teleconsult_id").agg(
        prescription_ids=("prescription_id", lambda s: list(s.unique())),
        n_medicine_lines=("prescription_line_id", "count"),
        prescription_date=("prescription_date", "min"),
        rx_facility_id=("facility_id", "first"),
    )

    disp = dispensing.copy()
    disp["dispense_month"] = disp["dispense_date"].values.astype("datetime64[M]")
    stock_lookup = stock.set_index(["facility_id", "medicine_name", "snapshot_month"])["stock_status"]

    disp_by_presc = disp.groupby("prescription_id").agg(
        n_dispense_rows=("dispense_id", "count"),
        any_dispensed=("dispense_status", lambda s: (s.isin(["Dispensed", "Partially dispensed"])).any()),
        all_dispensed=("dispense_status", lambda s: (s == "Dispensed").all()),
        any_partial=("partial_fill", lambda s: (s == 1).any()),
        any_stockout_flag=("stockout_flag", lambda s: (s == 1).any()),
        any_not_dispensed_stock=("dispense_status", lambda s: (s == "Not dispensed due to stock").any()),
    )
    # Per-MEDICINE dispensing coverage (medicine_dispensing.csv has no
    # prescription_line_id -- medicine_name is the finest join key available).
    # Needed because disp_by_presc's n_dispense_rows/all_dispensed are
    # aggregated across the whole prescription_id: a prescription with 2
    # medicine lines where only 1 medicine ever got a (fully-dispensed)
    # dispensing row would otherwise satisfy "n_dispense_rows>0 and
    # all_dispensed" and be misclassified "fully dispensed" even though the
    # second medicine was never dispensed at all. Fixed per a fixture test
    # written for VALIDATION_REPORT.md Step 6 (tests/test_medicine_logic.py)
    # that caught this -- confirmed to affect 209 real multi-line
    # prescriptions in this dataset; see P1_FIXES.md.
    disp_meds_by_presc: dict[str, set[str]] = {pid: set(g) for pid, g in disp.groupby("prescription_id")["medicine_name"]}

    records = []
    for tc_id, row in presc_by_tc.iterrows():
        rx_ids = row["prescription_ids"]
        sub = disp_by_presc.reindex(rx_ids)
        has_any_dispense_row = sub["n_dispense_rows"].fillna(0).sum() > 0

        # facility-month stock context at prescription time, for the medicines on this prescription
        med_names = prescriptions.loc[prescriptions["prescription_id"].isin(rx_ids), "medicine_name"].unique()
        dispensed_med_names: set[str] = set()
        for rid in rx_ids:
            dispensed_med_names |= disp_meds_by_presc.get(rid, set())
        all_meds_have_dispense_row = set(med_names) <= dispensed_med_names

        fully = (
            has_any_dispense_row
            and bool(sub["all_dispensed"].fillna(False).all())
            and bool((sub["n_dispense_rows"].fillna(0) > 0).all())
            and all_meds_have_dispense_row
        )
        any_partial = bool(sub["any_partial"].fillna(False).any())
        any_dispensed_any = bool(sub["any_dispensed"].fillna(False).any())
        stockout_evidence = bool(sub["any_stockout_flag"].fillna(False).any()) or bool(sub["any_not_dispensed_stock"].fillna(False).any())

        month = pd.Timestamp(row["prescription_date"]).to_period("M").to_timestamp()
        facility_low_stock = False
        for med in med_names:
            status = stock_lookup.get((row["rx_facility_id"], med, month))
            if status in ("Low stock", "Reorder raised"):
                facility_low_stock = True

        if fully:
            outcome = "completed"
            classification = "completed"
        elif not has_any_dispense_row:
            outcome = "medicine not received"
            classification = "system_stockout" if (stockout_evidence or facility_low_stock) else (
                "patient_no_collection_attempt" if not facility_low_stock else "indeterminate"
            )
            # zero attempts with clean stock -> non-collection; ambiguous evidence (partial signals) -> indeterminate handled below
            if not stockout_evidence and not facility_low_stock:
                classification = "patient_no_collection_attempt"
        elif any_partial or (any_dispensed_any and not fully):
            outcome = "partial dispensing"
            classification = "system_stockout" if stockout_evidence or facility_low_stock else "indeterminate"
        else:
            outcome = "medicine not received"
            classification = "system_stockout" if (stockout_evidence or facility_low_stock) else "indeterminate"

        records.append(
            {
                "teleconsult_id": tc_id,
                "prescription_generated": True,
                "n_medicine_lines": int(row["n_medicine_lines"]),
                "medicine_outcome": outcome,
                "medicine_fully_dispensed": bool(fully),
                # Whether >=1 dispensing row was ever recorded for this episode's
                # prescription (teleconsult_id <-> prescription_id is 1:1 in this
                # dataset, verified: max 1 distinct prescription_id per
                # teleconsult_id). This is the denominator for the
                # attempts-based "Dispensing Success Rate" (METRICS.md #4),
                # kept distinct from "Medicine Fulfillment Rate" (METRICS.md #2,
                # denominator = all prescriptions generated) -- see
                # VALIDATION_REPORT.md MED-01 / P1_FIXES.md.
                "medicine_dispensing_attempted": bool(has_any_dispense_row),
                "medicine_access_classification": classification,
            }
        )
    return pd.DataFrame(records)


def build_lab_journey(tele_linked: pd.DataFrame, lab_tests: pd.DataFrame, lab_link: pd.DataFrame) -> pd.DataFrame:
    """Associates lab_tests rows to episodes via resolved patient identity + a
    consult-date window, since lab_tests carries no direct episode/teleconsult key."""
    lab = lab_tests.copy()
    lab["predicted_patient_id"] = lab_link["predicted_patient_id"].values
    lab["link_tier"] = lab_link["tier"].values
    lab_matched = lab[lab["predicted_patient_id"].notna()].copy()
    lab_matched = lab_matched.sort_values("order_date")

    candidates_by_patient: dict[str, list[int]] = {}
    for i, pid in enumerate(lab_matched["predicted_patient_id"].values):
        candidates_by_patient.setdefault(pid, []).append(i)
    lab_rows = lab_matched.reset_index(drop=True)

    used = np.zeros(len(lab_rows), dtype=bool)
    records = []
    tele_eligible = tele_linked[tele_linked["test_advised"] == "Yes"].sort_values("consult_date")
    for _, ep in tele_eligible.iterrows():
        pid = ep["predicted_patient_id"]
        result = {
            "teleconsult_id": ep["teleconsult_id"],
            "lab_link_status": "linkage_unresolved" if pd.isna(pid) else "no_match_in_window",
            "test_status": None,
            "test_name": None,
            "lab_type": None,
            "order_date": None,
            "sample_date": None,
            "result_date": None,
        }
        if pd.notna(pid):
            idxs = candidates_by_patient.get(pid, [])
            best = None
            for i in idxs:
                if used[i]:
                    continue
                od = lab_rows.loc[i, "order_date"]
                if pd.isna(od):
                    continue
                delta = (od - ep["consult_date"]).days
                if -3 <= delta <= 45:
                    if best is None or abs(delta) < abs(best[1]):
                        best = (i, delta)
            if best is not None:
                i = best[0]
                used[i] = True
                result["lab_link_status"] = "matched"
                result["test_status"] = lab_rows.loc[i, "test_status"]
                result["test_name"] = lab_rows.loc[i, "test_name"]
                result["lab_type"] = lab_rows.loc[i, "lab_type"]
                result["order_date"] = lab_rows.loc[i, "order_date"]
                result["sample_date"] = lab_rows.loc[i, "sample_date"]
                result["result_date"] = lab_rows.loc[i, "result_date"]
        records.append(result)
    return pd.DataFrame(records)


def build_historical_behavior(tele_linked: pd.DataFrame, visit_history: pd.DataFrame, vh_link: pd.DataFrame) -> pd.DataFrame:
    vh = visit_history.copy()
    vh["predicted_patient_id"] = vh_link["predicted_patient_id"].values
    prior_pool = vh[(vh["episode_id"].isna()) & (vh["predicted_patient_id"].notna())].copy()
    prior_pool = prior_pool.sort_values("visit_date")

    by_patient: dict[str, pd.DataFrame] = {pid: g for pid, g in prior_pool.groupby("predicted_patient_id")}

    records = []
    for _, ep in tele_linked.iterrows():
        pid = ep["predicted_patient_id"]
        consult_date = ep["consult_date"]
        if pd.isna(pid):
            records.append(
                {
                    "teleconsult_id": ep["teleconsult_id"],
                    "history_link_status": "linkage_unresolved",
                    "visits_prior_30d": None,
                    "visits_prior_60d": None,
                    "visits_prior_90d": None,
                    "prior_followup_reviews": None,
                    "prior_referrals": None,
                    "prior_relevant_interactions": None,
                }
            )
            continue
        g = by_patient.get(pid)
        if g is None or g.empty:
            prior = g.iloc[0:0] if g is not None else vh.iloc[0:0]
        else:
            prior = g[g["visit_date"] < consult_date]
        records.append(
            {
                "teleconsult_id": ep["teleconsult_id"],
                "history_link_status": "matched",
                "visits_prior_30d": int((prior["visit_date"] >= consult_date - pd.Timedelta(days=30)).sum()),
                "visits_prior_60d": int((prior["visit_date"] >= consult_date - pd.Timedelta(days=60)).sum()),
                "visits_prior_90d": int((prior["visit_date"] >= consult_date - pd.Timedelta(days=90)).sum()),
                "prior_followup_reviews": int((prior["visit_type"] == "Follow-up review").sum()),
                "prior_referrals": int((prior["referral_flag"] == "Yes").sum()),
                "prior_relevant_interactions": int(prior["visit_type"].isin(["NCD follow-up", "Screening visit", "OPD visit"]).sum()),
            }
        )
    return pd.DataFrame(records)


def build_ncd_context(tele_linked: pd.DataFrame, ncd_screening: pd.DataFrame, ncd_link: pd.DataFrame) -> pd.DataFrame:
    ncd = ncd_screening.copy()
    ncd["predicted_patient_id"] = ncd_link["predicted_patient_id"].values
    ncd_matched = ncd[ncd["predicted_patient_id"].notna()].sort_values("screening_date")
    by_patient = {pid: g for pid, g in ncd_matched.groupby("predicted_patient_id")}

    records = []
    for _, ep in tele_linked.iterrows():
        pid = ep["predicted_patient_id"]
        rec = {
            "teleconsult_id": ep["teleconsult_id"],
            "ncd_status": None,
            "ncd_control_status": None,
            "ncd_screening_link_status": "linkage_unresolved",
        }
        if pd.notna(pid):
            g = by_patient.get(pid)
            if g is not None:
                # Strict '<' (not '<='): dates in this dataset carry no
                # time-of-day, so a screening recorded on the SAME calendar
                # date as the teleconsultation could in reality have happened
                # after the consult (e.g. an in-person HWC screening later
                # that day) -- an inclusive '<=' risked leaking same-day
                # post-consult information into a consult-time feature. Fixed
                # per VALIDATION_REPORT.md Part 8 / P1_FIXES.md; matches the
                # strict '<' already used for visit_history in
                # build_historical_behavior().
                prior = g[g["screening_date"] < ep["consult_date"]]
                if not prior.empty:
                    rec["ncd_status"] = prior.iloc[-1]["ncd_status"]
                    rec["ncd_control_status"] = prior.iloc[-1]["control_status"]
                    rec["ncd_screening_link_status"] = "matched"
                else:
                    rec["ncd_screening_link_status"] = "no_prior_screening"
        records.append(rec)
    return pd.DataFrame(records)


def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)

    print("Loading raw data...")
    raw = load_raw()

    print("Running patient-entity linkage across 8 source systems...")
    link_results = run_all_linkage(raw)
    linkage_stats = write_linkage_outputs(link_results)
    print("Linkage stats:", json.dumps(linkage_stats, indent=2))

    print("Resolving village geography...")
    geo_resolved = resolve_geography(raw)

    tele = raw["teleconsultations"].copy()
    tele_link = link_results["teleconsultations"]
    tele["predicted_patient_id"] = tele_link["predicted_patient_id"].values
    tele["patient_link_confidence"] = tele_link["confidence"].values
    tele["patient_link_tier"] = tele_link["tier"].values
    tele = pd.concat([tele.reset_index(drop=True), geo_resolved.reset_index(drop=True)], axis=1)

    print("Classifying medicine access...")
    med = classify_medicine_access(raw["prescriptions"], raw["medicine_dispensing"], raw["medicine_stock_status"])

    print("Building lab journey (patient-link + date-window match)...")
    lab_journey = build_lab_journey(tele, raw["lab_tests"], link_results["lab_tests"])

    print("Building historical behaviour features...")
    hist = build_historical_behavior(tele, raw["visit_history"], link_results["visit_history"])

    print("Building NCD screening context...")
    ncd_ctx = build_ncd_context(tele, raw["ncd_screening"], link_results["ncd_screening"])

    # review completion, direct via episode_id
    fu = raw["followup_visits"]
    fu_agg = fu.groupby("episode_id").agg(review_completed_count=("visit_id", "count"), first_review_date=("visit_date", "min"))

    # outreach, direct via episode_id
    out = raw["outreach_actions"].copy()
    out["is_successful_contact"] = out["contact_outcome"].isin(SUCCESSFUL_CONTACT_OUTCOMES)
    out_agg = out.groupby("episode_id").agg(
        outreach_count=("outreach_id", "count"),
        successful_contact_count=("is_successful_contact", "sum"),
    )

    outcomes = raw["episode_outcomes"].copy()
    outcomes["cohort_derived"] = np.where(outcomes["consult_date"] <= COHORT_CUTOFF, "DEVELOPMENT", "EVALUATION")

    facility = raw["facility_reference"].rename(columns={"district": "facility_district", "block": "facility_block"})
    patients = raw["patient_360_reference"]

    fact = outcomes.merge(tele, on="teleconsult_id", suffixes=("", "_tele"))
    fact = fact.merge(med, on="teleconsult_id", how="left")
    fact = fact.merge(lab_journey, on="teleconsult_id", how="left")
    fact = fact.merge(hist, on="teleconsult_id", how="left")
    fact = fact.merge(ncd_ctx, on="teleconsult_id", how="left")
    fact = fact.merge(fu_agg, on="episode_id", how="left")
    fact = fact.merge(out_agg, on="episode_id", how="left")
    fact = fact.merge(facility, on="facility_id", how="left")
    fact = fact.merge(
        raw["geography_reference"][["village_id", "road_access", "mobile_connectivity", "population"]].rename(
            columns={"village_id": "village_id_resolved"}
        ),
        on="village_id_resolved",
        how="left",
    )
    fact = fact.merge(
        patients[["patient_id", "vulnerability_group", "household_id", "known_ncd_status"]].rename(columns={"patient_id": "predicted_patient_id"}),
        on="predicted_patient_id",
        how="left",
        suffixes=("", "_ref"),
    )

    fact["prescription_generated"] = fact["prescription_generated"].fillna(False)
    fact["medicine_dispensing_attempted"] = fact["medicine_dispensing_attempted"].fillna(False)
    fact["medicine_access_classification"] = np.where(
        fact["medicine_advised"] == "No", "not_advised", fact["medicine_access_classification"].fillna("not_advised")
    )
    fact["review_completed"] = fact["review_completed_count"].fillna(0) > 0
    fact["outreach_count"] = fact["outreach_count"].fillna(0).astype(int)
    fact["successful_contact_count"] = fact["successful_contact_count"].fillna(0).astype(int)

    fact["age_group"] = pd.cut(fact["age"], bins=AGE_BINS, labels=AGE_LABELS)
    fact["distance_bucket"] = pd.cut(fact["distance_to_facility_km"], bins=DIST_BINS, labels=DIST_LABELS)

    fact["days_consult_to_review"] = (fact["first_review_date"] - fact["consult_date"]).dt.days
    fact["review_overdue"] = (
        fact["review_advised"].eq("Yes")
        & ~fact["review_completed"]
        & fact["review_due_days"].notna()
        & ((DATA_MAX_DATE - fact["consult_date"]).dt.days > fact["review_due_days"])
    )

    fact["at_risk_no_outcome_needed"] = (
        (fact["medicine_advised"].eq("Yes") & ~fact["medicine_fully_dispensed"].fillna(False))
        | (fact["test_advised"].eq("Yes") & (fact["test_status"] != "Available"))
        | (fact["review_advised"].eq("Yes") & ~fact["review_completed"])
    )

    print("Writing episode fact table...")
    episode_cols = [
        "episode_id", "teleconsult_id", "consult_date", "cohort", "lost_to_followup_label", "dropout_stage_label",
        "predicted_patient_id", "patient_link_confidence", "patient_link_tier",
        "gender", "age", "age_group",
        "district", "block", "village", "village_resolved", "village_id_resolved", "village_match_score",
        "road_access", "mobile_connectivity", "population",
        "distance_to_facility_km", "distance_bucket", "connectivity_quality",
        "facility_id", "facility_name", "facility_type", "facility_district", "facility_block", "network_context", "latitude", "longitude", "cho_count", "asha_linked_count",
        "chief_complaint", "diagnosis_group", "consult_mode", "duration_min", "preferred_language",
        "medicine_advised", "prescription_generated", "n_medicine_lines", "medicine_outcome", "medicine_fully_dispensed", "medicine_dispensing_attempted", "medicine_access_classification",
        "test_advised", "lab_link_status", "test_status", "test_name", "lab_type", "order_date", "sample_date", "result_date",
        "review_advised", "review_due_days", "review_completed", "days_consult_to_review", "review_overdue",
        "outreach_count", "successful_contact_count", "at_risk_no_outcome_needed",
        "vulnerability_group", "household_id", "known_ncd_status", "ncd_status", "ncd_control_status", "ncd_screening_link_status",
        "history_link_status", "visits_prior_30d", "visits_prior_60d", "visits_prior_90d",
        "prior_followup_reviews", "prior_referrals", "prior_relevant_interactions",
    ]
    out_fact = fact[episode_cols].copy()
    for c in out_fact.columns:
        if pd.api.types.is_datetime64_any_dtype(out_fact[c]):
            out_fact[c] = out_fact[c].dt.strftime("%Y-%m-%d")
    out_fact = out_fact.astype(object).where(pd.notnull(out_fact), None)

    out_fact.to_csv(PROCESSED / "episode_fact.csv", index=False)
    # columnar JSON: {columns:[...], rows:[[...], ...]} instead of one object
    # per row -- record-oriented JSON repeats all 71 column names on every one
    # of 5,516 rows (~7MB of pure key overhead); the UI's data loader
    # reconstructs row objects client-side from this cheaply.
    columnar = {"columns": list(out_fact.columns), "rows": out_fact.values.tolist()}
    (PUBLIC_DATA / "episodes.json").write_text(json.dumps(columnar, default=str))

    print("Writing auxiliary tables...")
    facilities_out = raw["facility_reference"].astype(object).where(pd.notnull(raw["facility_reference"]), None)
    (PUBLIC_DATA / "facilities.json").write_text(json.dumps(facilities_out.to_dict(orient="records")))

    geo_out = raw["geography_reference"].astype(object).where(pd.notnull(raw["geography_reference"]), None)
    (PUBLIC_DATA / "geography.json").write_text(json.dumps(geo_out.to_dict(orient="records")))

    stock = raw["medicine_stock_status"].copy()
    stock["snapshot_month"] = stock["snapshot_month"].dt.strftime("%Y-%m-%d")
    stock = stock.astype(object).where(pd.notnull(stock), None)
    (PUBLIC_DATA / "medicine_stock.json").write_text(json.dumps(stock.to_dict(orient="records")))

    outreach_out = raw["outreach_actions"].copy()
    outreach_out["is_successful_contact"] = outreach_out["contact_outcome"].isin(SUCCESSFUL_CONTACT_OUTCOMES)
    outreach_out["action_date"] = outreach_out["action_date"].dt.strftime("%Y-%m-%d")
    outreach_out = outreach_out.merge(outcomes[["episode_id", "cohort_derived", "lost_to_followup_label"]], on="episode_id", how="left")
    outreach_out = outreach_out.astype(object).where(pd.notnull(outreach_out), None)
    outreach_columnar = {"columns": list(outreach_out.columns), "rows": outreach_out.values.tolist()}
    (PUBLIC_DATA / "outreach_actions.json").write_text(json.dumps(outreach_columnar, default=str))

    dq = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "cohort_cutoff": str(COHORT_CUTOFF.date()),
        "row_counts": {k: int(len(v)) for k, v in raw.items()},
        "linkage_stats": linkage_stats,
        "village_resolution": {
            "n_operational_villages_raw": int(raw["teleconsultations"]["village"].nunique()),
            "n_canonical_villages": int(raw["geography_reference"]["village"].nunique()),
            "resolved_pct": round(100 * float((geo_resolved["village_id_resolved"].notna()).mean()), 2),
            "mean_match_score": round(float(geo_resolved["village_match_score"].mean()), 3),
        },
        "lab_linkage": {
            "test_advised_episodes": int((tele["test_advised"] == "Yes").sum()),
            "matched": int((lab_journey["lab_link_status"] == "matched").sum()),
            "linkage_unresolved": int((lab_journey["lab_link_status"] == "linkage_unresolved").sum()),
            "no_match_in_window": int((lab_journey["lab_link_status"] == "no_match_in_window").sum()),
        },
        "history_linkage": {
            "total_episodes": int(len(hist)),
            "matched": int((hist["history_link_status"] == "matched").sum()),
            "linkage_unresolved": int((hist["history_link_status"] == "linkage_unresolved").sum()),
        },
    }
    (PUBLIC_DATA / "data_quality.json").write_text(json.dumps(dq, indent=2, default=str))
    (PROCESSED / "data_quality.json").write_text(json.dumps(dq, indent=2, default=str))

    print("Done. Wrote:")
    for p in sorted(PUBLIC_DATA.glob("*.json")):
        print(" ", p, f"{p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
