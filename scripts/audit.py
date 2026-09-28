"""
Phase 1 data audit: inspect every raw CSV in the Infinum dataset pack.
Read-only — never writes to the raw data directory. Emits a machine-readable
JSON summary to processed/_audit.json for the DATA_AUDIT.md writeup, plus
prints a human-readable report to stdout.
"""
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

RAW_DIR = Path(__file__).resolve().parent.parent / "Infinum_2026_Candidate_Dataset_Pack"
OUT_PATH = Path(__file__).resolve().parent.parent / "processed" / "_audit.json"

FILES = [
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

DATE_HINTS = ("date", "_due", "snapshot")


def profile_column(s: pd.Series):
    n = len(s)
    nulls = int(s.isna().sum())
    out = {
        "dtype": str(s.dtype),
        "null_count": nulls,
        "null_pct": round(100 * nulls / n, 2) if n else None,
        "n_unique": int(s.nunique(dropna=True)),
    }
    non_null = s.dropna()
    if len(non_null) == 0:
        return out
    # try numeric
    numeric = pd.to_numeric(non_null, errors="coerce")
    is_mostly_numeric = numeric.notna().mean() > 0.98 and s.dtype == object
    if pd.api.types.is_numeric_dtype(s) or is_mostly_numeric:
        vals = numeric.dropna()
        if len(vals):
            out["min"] = float(vals.min())
            out["max"] = float(vals.max())
            out["mean"] = round(float(vals.mean()), 3)
    else:
        vc = non_null.astype(str).value_counts().head(8)
        out["top_values"] = {str(k): int(v) for k, v in vc.items()}
    if out["n_unique"] <= 15:
        vc = non_null.astype(str).value_counts()
        out["value_counts"] = {str(k): int(v) for k, v in vc.items()}
    return out


def looks_like_date(colname, s: pd.Series):
    if not any(h in colname.lower() for h in DATE_HINTS):
        return None
    parsed = pd.to_datetime(s, errors="coerce")
    valid = parsed.notna()
    if valid.sum() == 0:
        return None
    return {
        "parseable_pct": round(100 * valid.mean(), 2),
        "min_date": str(parsed.min()) if valid.any() else None,
        "max_date": str(parsed.max()) if valid.any() else None,
    }


def main():
    report = {}
    for fname in FILES:
        path = RAW_DIR / fname
        df = pd.read_csv(path, dtype=str, keep_default_na=True, na_values=["", "NA", "NaN", "null"])
        rows, cols = df.shape
        col_reports = {}
        for c in df.columns:
            prof = profile_column(df[c])
            date_info = looks_like_date(c, df[c])
            if date_info:
                prof["date_range"] = date_info
            col_reports[c] = prof
        dup_rows = int(df.duplicated().sum())
        report[fname] = {
            "rows": rows,
            "cols": cols,
            "columns": list(df.columns),
            "duplicate_full_rows": dup_rows,
            "column_profile": col_reports,
        }
        print(f"\n=== {fname} === rows={rows} cols={cols} dup_rows={dup_rows}")
        for c, p in col_reports.items():
            extra = ""
            if "value_counts" in p:
                extra = f" vals={p['value_counts']}"
            elif "top_values" in p:
                extra = f" top={p['top_values']}"
            if "date_range" in p:
                extra += f" date={p['date_range']}"
            if "min" in p:
                extra += f" range=[{p['min']},{p['max']}] mean={p.get('mean')}"
            print(f"  {c:28s} dtype={p['dtype']:8s} null={p['null_pct']}% uniq={p['n_unique']}{extra}")

    # cross-file id checks
    print("\n=== ID overlap checks ===")
    tele = pd.read_csv(RAW_DIR / "teleconsultations.csv", dtype=str)
    outcomes = pd.read_csv(RAW_DIR / "episode_outcomes.csv", dtype=str)
    presc = pd.read_csv(RAW_DIR / "prescriptions.csv", dtype=str)
    disp = pd.read_csv(RAW_DIR / "medicine_dispensing.csv", dtype=str)
    labs = pd.read_csv(RAW_DIR / "lab_tests.csv", dtype=str)
    fu = pd.read_csv(RAW_DIR / "followup_visits.csv", dtype=str)
    vh = pd.read_csv(RAW_DIR / "visit_history.csv", dtype=str)
    out_ = pd.read_csv(RAW_DIR / "outreach_actions.csv", dtype=str)
    stock = pd.read_csv(RAW_DIR / "medicine_stock_status.csv", dtype=str)
    fac = pd.read_csv(RAW_DIR / "facility_reference.csv", dtype=str)
    geo = pd.read_csv(RAW_DIR / "geography_reference.csv", dtype=str)
    p360 = pd.read_csv(RAW_DIR / "patient_360_reference.csv", dtype=str)

    checks = {
        "teleconsult_id: teleconsultations vs episode_outcomes": (set(tele.teleconsult_id), set(outcomes.teleconsult_id)),
        "teleconsult_id: prescriptions -> teleconsultations": (set(presc.teleconsult_id.dropna()), set(tele.teleconsult_id)),
        "prescription_id: dispensing -> prescriptions": (set(disp.prescription_id.dropna()), set(presc.prescription_id)),
        "episode_id: followup_visits vs outreach_actions": (set(fu.episode_id.dropna()), set(out_.episode_id.dropna())),
        "episode_id: followup_visits vs episode_outcomes": (set(fu.episode_id.dropna()), set(outcomes.episode_id)),
        "episode_id: outreach_actions vs episode_outcomes": (set(out_.episode_id.dropna()), set(outcomes.episode_id)),
        "episode_id: visit_history vs episode_outcomes": (set(vh.episode_id.dropna()), set(outcomes.episode_id)),
        "facility_id: teleconsultations -> facility_reference": (set(tele.facility_id.dropna()), set(fac.facility_id)),
        "facility_id: prescriptions -> facility_reference": (set(presc.facility_id.dropna()), set(fac.facility_id)),
        "facility_id: dispensing -> facility_reference": (set(disp.facility_id.dropna()), set(fac.facility_id)),
        "facility_id: stock -> facility_reference": (set(stock.facility_id.dropna()), set(fac.facility_id)),
        "facility_id: labs -> facility_reference": (set(labs.facility_id.dropna()), set(fac.facility_id)),
        "facility_id: outreach -> facility_reference": (set(out_.facility_id.dropna()), set(fac.facility_id)),
        "village_id: patient_360 -> geography_reference": (set(p360.village_id.dropna()), set(geo.village_id)),
    }
    overlap_report = {}
    for label, (a, b) in checks.items():
        inter = a & b
        overlap_report[label] = {
            "left_n": len(a), "right_n": len(b), "intersection": len(inter),
            "left_not_in_right": len(a - b),
        }
        print(f"  {label}: left={len(a)} right={len(b)} intersect={len(inter)} left_missing_from_right={len(a-b)}")

    # patient counts per source_patient_id column across operational tables (no crosswalk given)
    print("\n=== source_patient_id cardinality per table (no crosswalk to patient_360) ===")
    src_id_cols = {
        "teleconsultations.csv": "tele_source_patient_id",
        "ncd_screening.csv": "ncd_source_patient_id",
        "prescriptions.csv": "rx_source_patient_id",
        "medicine_dispensing.csv": "pharm_source_patient_id",
        "lab_tests.csv": "lab_source_patient_id",
        "followup_visits.csv": "visit_source_patient_id",
        "visit_history.csv": "visit_source_patient_id",
        "outreach_actions.csv": "outreach_source_patient_id",
    }
    src_id_report = {}
    for fname, col in src_id_cols.items():
        df = pd.read_csv(RAW_DIR / fname, dtype=str)
        n_unique = df[col].nunique()
        src_id_report[fname] = {"col": col, "rows": len(df), "n_unique_source_ids": int(n_unique)}
        print(f"  {fname}: {col} rows={len(df)} unique_ids={n_unique}")

    report["_cross_file_overlap"] = overlap_report
    report["_source_id_cardinality"] = src_id_report

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nWrote audit JSON -> {OUT_PATH}")


if __name__ == "__main__":
    main()
