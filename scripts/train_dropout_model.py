"""
Phase 6: dropout-risk model — train, evaluate honestly, and predict.

Reads processed/model_features_consult_time.csv (the leakage-safe,
consult-time-only table built by scripts/build_model_features.py) and:

  1. Trains a binary lost-to-follow-up model on `target_ltfu` (DEVELOPMENT
     only, where the real label exists) and a 4-class dropout-stage model on
     `target_dropout_stage`.
  2. Evaluates BOTH with stratified 5-fold cross-validation (stable estimate)
     AND a strict time-based holdout (train on earlier consult_date, validate
     on the latest month) -- the second is the honest proxy for how the model
     will generalize to EVALUATION, which is entirely later in time than any
     DEVELOPMENT row.
  3. Reports feature importance (permutation importance for the gradient-
     boosted model, coefficients for logistic regression) -- this is the
     "understand dropout" half of the brief, not just "predict" it.
  4. Fits a final model on all of DEVELOPMENT and scores every EVALUATION
     episode, writing predictions in the exact column shape of
     Infinum_2026_Candidate_Dataset_Pack/submission_template_episode_predictions.csv
     (never overwrites that file itself -- raw dataset files are never
     modified, per VALIDATION_REPORT.md's standing rule).

Run: ./.venv/bin/python scripts/train_dropout_model.py
Writes:
  processed/episode_predictions.csv       (submission-shaped, EVALUATION only)
  processed/model_oof_predictions.csv     (out-of-fold DEVELOPMENT predictions, for our own calibration checks)
  processed/model_metrics.json            (all CV/holdout metrics + feature importances, machine-readable)
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    log_loss,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "processed"
PUBLIC_DATA = ROOT / "public" / "data"
RANDOM_STATE = 42

# Dropped per MODEL_FEATURE_AUDIT.md: structurally always 0 across all 5,516
# episodes in this dataset (a visit_history data-generation artifact, not a
# bug) -- zero variance, zero information, would just be noise/a false sense
# of a feature that "mattered" if left in.
DEAD_FEATURES = ["prior_followup_reviews", "prior_referrals"]

CATEGORICAL = [
    "gender", "diagnosis_group", "district", "block", "village", "facility_id",
    "connectivity_quality", "road_access", "vulnerability_group",
    "medicine_advised", "test_advised", "review_advised",
    "prior_ncd_status", "prior_control_status", "patient_link_tier",
]
NUMERIC = [
    "age", "distance_to_facility_km", "review_due_days",
    "visits_prior_30d", "visits_prior_60d", "visits_prior_90d",
    "prior_relevant_interactions", "patient_link_confidence",
]
# Binary flags added here (not present on the source table) so the model can
# distinguish "0 because genuinely zero" from "0 because the patient link
# never resolved" -- imputing silently would hide that distinction.
ENGINEERED_FLAGS = ["history_unresolved"]

DROPOUT_STAGE_CLASSES = ["Completed care journey", "Medicine not collected", "Review not attended", "Test not completed"]


def load_features() -> pd.DataFrame:
    df = pd.read_csv(PROCESSED / "model_features_consult_time.csv", parse_dates=["consult_date"])
    df = df.drop(columns=DEAD_FEATURES)

    # history_link_status isn't on this table (deliberately excluded as
    # post-consult-adjacent metadata) -- but null visits_prior_* IS exactly
    # the unresolved-link signal, so derive the flag from that instead of
    # re-reading episode_fact.csv.
    df["history_unresolved"] = df["visits_prior_30d"].isna().astype(int)

    # Structural nulls -> explicit categories/sentinels, never silently
    # imputed as if missing-at-random (see MODEL_FEATURE_AUDIT.md missingness table).
    df["prior_ncd_status"] = df["prior_ncd_status"].fillna("No prior screening")
    df["prior_control_status"] = df["prior_control_status"].fillna("No prior screening")
    df["vulnerability_group"] = df["vulnerability_group"].fillna("Unknown / unresolved link")
    for c in ["visits_prior_30d", "visits_prior_60d", "visits_prior_90d", "prior_relevant_interactions"]:
        df[c] = df[c].fillna(0)
    # review_due_days is null exactly where review_advised='No' (see
    # MODEL_FEATURE_AUDIT.md) -- a sentinel below the real range (0-30) lets a
    # tree model split it cleanly; review_advised itself is already a feature
    # so this isn't the only signal carrying that information.
    df["review_due_days"] = df["review_due_days"].fillna(-1)

    return df


def make_pipeline(model) -> Pipeline:
    # HistGradientBoostingClassifier requires dense input -- sparse_output=False.
    pre = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
            ("num", "passthrough", NUMERIC + ENGINEERED_FLAGS),
        ]
    )
    return Pipeline([("pre", pre), ("model", model)])


def logistic_pipeline() -> Pipeline:
    pre = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
            ("num", Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), NUMERIC + ENGINEERED_FLAGS),
        ]
    )
    return Pipeline([("pre", pre), ("model", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=RANDOM_STATE))])


def hgb_pipeline(**kwargs) -> Pipeline:
    return make_pipeline(HistGradientBoostingClassifier(random_state=RANDOM_STATE, **kwargs))


def evaluate_binary_cv(df: pd.DataFrame) -> dict:
    X = df[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS]
    y = df["target_ltfu"].astype(int)

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    results = {}
    oof = {}
    for name, build in [("logistic_regression", logistic_pipeline), ("gradient_boosting", hgb_pipeline)]:
        pipe = build()
        proba = cross_val_predict(pipe, X, y, cv=skf, method="predict_proba")[:, 1]
        oof[name] = proba
        pred = (proba >= 0.5).astype(int)
        prec, rec, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
        results[name] = {
            "roc_auc": round(float(roc_auc_score(y, proba)), 4),
            "pr_auc": round(float(average_precision_score(y, proba)), 4),
            "brier_score": round(float(brier_score_loss(y, proba)), 4),
            "log_loss": round(float(log_loss(y, proba)), 4),
            "precision_at_0.5": round(float(prec), 4),
            "recall_at_0.5": round(float(rec), 4),
            "f1_at_0.5": round(float(f1), 4),
        }
    return results, oof


def evaluate_binary_time_holdout(df: pd.DataFrame) -> dict:
    """Train on the earliest 5 of 6 DEVELOPMENT months, validate on the
    latest month -- the realistic proxy for scoring EVALUATION, which is
    entirely later in time than every DEVELOPMENT row."""
    cutoff = df["consult_date"].quantile(0.85)  # ~last ~15% of DEVELOPMENT by date as the holdout
    train = df[df["consult_date"] <= cutoff]
    holdout = df[df["consult_date"] > cutoff]

    X_train, y_train = train[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS], train["target_ltfu"].astype(int)
    X_holdout, y_holdout = holdout[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS], holdout["target_ltfu"].astype(int)

    results = {}
    for name, build in [("logistic_regression", logistic_pipeline), ("gradient_boosting", hgb_pipeline)]:
        pipe = build()
        pipe.fit(X_train, y_train)
        proba = pipe.predict_proba(X_holdout)[:, 1]
        results[name] = {
            "train_n": len(train),
            "holdout_n": len(holdout),
            "holdout_date_range": f"{holdout['consult_date'].min().date()} to {holdout['consult_date'].max().date()}",
            "roc_auc": round(float(roc_auc_score(y_holdout, proba)), 4),
            "pr_auc": round(float(average_precision_score(y_holdout, proba)), 4),
            "brier_score": round(float(brier_score_loss(y_holdout, proba)), 4),
        }
    return results


def evaluate_stage_cv(df: pd.DataFrame) -> dict:
    X = df[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS]
    y = df["target_dropout_stage"]

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    pipe = hgb_pipeline()
    pred = cross_val_predict(pipe, X, y, cv=skf)
    proba = cross_val_predict(pipe, X, y, cv=skf, method="predict_proba")

    prec, rec, f1, support = precision_recall_fscore_support(y, pred, labels=DROPOUT_STAGE_CLASSES, zero_division=0)
    per_class = {
        cls: {"precision": round(float(p), 4), "recall": round(float(r), 4), "f1": round(float(f), 4), "support": int(s)}
        for cls, p, r, f, s in zip(DROPOUT_STAGE_CLASSES, prec, rec, f1, support)
    }
    macro_f1 = float(f1_score(y, pred, labels=DROPOUT_STAGE_CLASSES, average="macro"))
    metrics = {
        "macro_f1": round(macro_f1, 4),
        "accuracy": round(float((pred == y.values).mean()), 4),
        "per_class": per_class,
        "note": "Multi-class over all 4 dropout_stage_label values (including 'Completed care journey'), DEVELOPMENT cohort, stratified 5-fold CV.",
    }
    return metrics, proba, list(pipe.classes_) if hasattr(pipe, "classes_") else DROPOUT_STAGE_CLASSES


def reconcile_stage(ltfu_pred: np.ndarray, stage_proba: np.ndarray, stage_classes: list[str]) -> np.ndarray:
    """Shared reconciliation logic (see 'A correctness fix' in MODEL_RESULTS.md):
    the binary LTFU model is the better-performing, primary signal, so the
    stage prediction is derived to agree with it rather than shipped as a
    second, independently-trained, possibly-contradictory column."""
    completed_idx = stage_classes.index("Completed care journey")
    failure_idxs = [i for i in range(len(stage_classes)) if i != completed_idx]
    failure_proba = stage_proba[:, failure_idxs]
    best_failure_stage = np.array(stage_classes)[failure_idxs][failure_proba.argmax(axis=1)]
    return np.where(ltfu_pred == 1, best_failure_stage, "Completed care journey")


def feature_importance(df: pd.DataFrame, target_col: str, n_repeats: int = 8) -> list[dict]:
    """Permutation importance on a held-out split of the gradient-boosting
    model -- model-agnostic, and answers 'understand dropout', not just
    'predict' it. Reported at the pre-encoding column level (one importance
    per raw feature, not per one-hot dummy)."""
    from sklearn.model_selection import train_test_split

    X = df[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS]
    y = df[target_col] if target_col == "target_dropout_stage" else df[target_col].astype(int)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=RANDOM_STATE, stratify=y)

    pipe = hgb_pipeline()
    pipe.fit(X_train, y_train)
    result = permutation_importance(pipe, X_test, y_test, n_repeats=n_repeats, random_state=RANDOM_STATE, scoring="roc_auc_ovr" if target_col == "target_dropout_stage" else "roc_auc")

    order = np.argsort(result.importances_mean)[::-1]
    cols = X.columns.tolist()
    return [
        {"feature": cols[i], "importance_mean": round(float(result.importances_mean[i]), 5), "importance_std": round(float(result.importances_std[i]), 5)}
        for i in order
    ]


def logistic_coefficients(df: pd.DataFrame) -> list[dict]:
    """Interpretable companion to the black-box permutation importances --
    signed direction (raises vs lowers LTFU risk), not just magnitude."""
    X = df[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS]
    y = df["target_ltfu"].astype(int)
    pipe = logistic_pipeline()
    pipe.fit(X, y)
    names = pipe.named_steps["pre"].get_feature_names_out()
    coefs = pipe.named_steps["model"].coef_[0]
    order = np.argsort(np.abs(coefs))[::-1][:25]
    return [{"feature": names[i], "coefficient": round(float(coefs[i]), 4), "direction": "raises LTFU risk" if coefs[i] > 0 else "lowers LTFU risk"} for i in order]


CARE_PLAN_FLAGS = ["medicine_advised", "test_advised", "review_advised"]


def care_plan_mechanical_check(dev: pd.DataFrame) -> dict:
    """target_ltfu = 1 iff >=1 ADVISED component was incomplete -- so an
    episode with zero components advised is LTFU=0 by construction (vacuous
    truth), not because the patient did anything right. This means
    medicine_advised/test_advised/review_advised dominating feature
    importance partly reflects this label-definition mechanics, not
    discovered clinical risk. Quantified here so it's reported, not just
    asserted."""
    d = dev.copy()
    d["n_advised"] = (d.medicine_advised == "Yes").astype(int) + (d.test_advised == "Yes").astype(int) + (d.review_advised == "Yes").astype(int)
    by_count = d.groupby("n_advised")["target_ltfu"].agg(["count", "mean"]).reset_index()
    return {
        "note": "LTFU rate by count of advised components (0/1/2/3) -- demonstrates the label is mechanically tied to how many components were advised, before any patient-level risk factor is considered.",
        "by_advised_count": [{"n_advised": int(r["n_advised"]), "n_episodes": int(r["count"]), "ltfu_rate": round(float(r["mean"]), 4)} for _, r in by_count.iterrows()],
    }


def evaluate_reduced_feature_set(df: pd.DataFrame) -> tuple[dict, list[dict]]:
    """Same CV protocol as evaluate_binary_cv(), but with the 3 care-plan
    flags removed -- isolates how much signal survives from genuinely
    patient/context-level risk factors (demographics, geography, historical
    engagement, NCD status) alone, once the mechanical advised-count effect
    is taken out of the picture. This is the more honest 'what makes a
    similar-care-plan patient higher-risk' story for feature importance."""
    reduced_cat = [c for c in CATEGORICAL if c not in CARE_PLAN_FLAGS]
    X = df[reduced_cat + NUMERIC + ENGINEERED_FLAGS]
    y = df["target_ltfu"].astype(int)

    def reduced_pipeline():
        pre = ColumnTransformer(
            transformers=[
                ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), reduced_cat),
                ("num", "passthrough", NUMERIC + ENGINEERED_FLAGS),
            ]
        )
        return Pipeline([("pre", pre), ("model", HistGradientBoostingClassifier(random_state=RANDOM_STATE))])

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    proba = cross_val_predict(reduced_pipeline(), X, y, cv=skf, method="predict_proba")[:, 1]
    pred = (proba >= 0.5).astype(int)
    prec, rec, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    metrics = {
        "features_excluded": CARE_PLAN_FLAGS,
        "roc_auc": round(float(roc_auc_score(y, proba)), 4),
        "pr_auc": round(float(average_precision_score(y, proba)), 4),
        "precision_at_0.5": round(float(prec), 4),
        "recall_at_0.5": round(float(rec), 4),
        "f1_at_0.5": round(float(f1), 4),
        "note": "Compare to ltfu_binary.cv_5fold.gradient_boosting.roc_auc -- the gap between them is roughly how much of the full model's apparent skill comes from the mechanical advised-count effect rather than genuine patient/context risk factors.",
    }

    from sklearn.model_selection import train_test_split as tts

    X_train, X_test, y_train, y_test = tts(X, y, test_size=0.25, random_state=RANDOM_STATE, stratify=y)
    pipe = reduced_pipeline()
    pipe.fit(X_train, y_train)
    result = permutation_importance(pipe, X_test, y_test, n_repeats=8, random_state=RANDOM_STATE, scoring="roc_auc")
    order = np.argsort(result.importances_mean)[::-1]
    cols = X.columns.tolist()
    importance = [
        {"feature": cols[i], "importance_mean": round(float(result.importances_mean[i]), 5), "importance_std": round(float(result.importances_std[i]), 5)}
        for i in order
    ]
    return metrics, importance


def assign_priority_tier(risk: pd.Series) -> pd.Series:
    """Simple, transparent rule -- NOT another model. Terciles of the scored
    population, documented here rather than a fitted threshold, so a health
    worker can see exactly why a patient landed in a tier."""
    q1, q2 = risk.quantile([1 / 3, 2 / 3])
    return pd.cut(risk, bins=[-np.inf, q1, q2, np.inf], labels=["Low", "Medium", "High"])


def main():
    df = load_features()
    dev = df[df["cohort"] == "DEVELOPMENT"].reset_index(drop=True)
    evaluation = df[df["cohort"] == "EVALUATION"].reset_index(drop=True)
    print(f"DEVELOPMENT: {len(dev)} rows, EVALUATION: {len(evaluation)} rows")

    print("\n=== 5-fold CV: target_ltfu ===")
    ltfu_cv, oof_proba = evaluate_binary_cv(dev)
    print(json.dumps(ltfu_cv, indent=2))

    print("\n=== Time-based holdout: target_ltfu (train on earlier months, validate on latest) ===")
    ltfu_holdout = evaluate_binary_time_holdout(dev)
    print(json.dumps(ltfu_holdout, indent=2))

    print("\n=== 5-fold CV: target_dropout_stage (4-class) ===")
    stage_cv, stage_oof_proba, stage_classes_cv = evaluate_stage_cv(dev)
    print(json.dumps(stage_cv, indent=2))

    print("\n=== Care-plan mechanical check: is LTFU rate just counting advised components? ===")
    mech_check = care_plan_mechanical_check(dev)
    print(json.dumps(mech_check, indent=2))

    print("\n=== Reduced feature set (excludes medicine/test/review_advised): target_ltfu ===")
    reduced_metrics, reduced_importance = evaluate_reduced_feature_set(dev)
    print(json.dumps(reduced_metrics, indent=2))
    print("Top reduced-model features:")
    for row in reduced_importance[:10]:
        print(f"  {row['feature']:32s} {row['importance_mean']:+.5f} (+/- {row['importance_std']:.5f})")

    print("\n=== Feature importance: target_ltfu (permutation, gradient boosting) ===")
    ltfu_importance = feature_importance(dev, "target_ltfu")
    for row in ltfu_importance[:10]:
        print(f"  {row['feature']:32s} {row['importance_mean']:+.5f} (+/- {row['importance_std']:.5f})")

    print("\n=== Feature importance: target_dropout_stage (permutation, gradient boosting) ===")
    stage_importance = feature_importance(dev, "target_dropout_stage")
    for row in stage_importance[:10]:
        print(f"  {row['feature']:32s} {row['importance_mean']:+.5f} (+/- {row['importance_std']:.5f})")

    print("\n=== Logistic regression coefficients: target_ltfu (top 25 by |coef|) ===")
    coefs = logistic_coefficients(dev)
    for row in coefs[:15]:
        print(f"  {row['feature']:40s} {row['coefficient']:+.4f}  ({row['direction']})")

    # --- Final models, fit on all of DEVELOPMENT, scored on EVALUATION ---
    X_dev = dev[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS]
    y_dev_ltfu = dev["target_ltfu"].astype(int)
    y_dev_stage = dev["target_dropout_stage"]
    X_eval = evaluation[CATEGORICAL + NUMERIC + ENGINEERED_FLAGS]

    final_ltfu_model = hgb_pipeline()
    final_ltfu_model.fit(X_dev, y_dev_ltfu)
    eval_risk = final_ltfu_model.predict_proba(X_eval)[:, 1]

    final_stage_model = hgb_pipeline()
    final_stage_model.fit(X_dev, y_dev_stage)
    eval_stage_proba = final_stage_model.predict_proba(X_eval)
    stage_classes = list(final_stage_model.named_steps["model"].classes_)

    eval_predicted_ltfu = (eval_risk >= 0.5).astype(int)

    # The binary LTFU model (ROC-AUC ~0.70) and the 4-class stage model were
    # trained independently and can disagree on whether an episode is at risk
    # at all -- measured at 19.9% of EVALUATION rows before this fix (e.g.
    # predicted_lost_to_followup=1 alongside predicted_dropout_stage=
    # 'Completed care journey'). Rather than ship two contradictory columns,
    # predicted_dropout_stage is now DERIVED to agree with the binary model
    # (the better-performing, primary signal) via reconcile_stage() -- see
    # MODEL_RESULTS.md "A correctness fix made during this pass".
    eval_stage = reconcile_stage(eval_predicted_ltfu, eval_stage_proba, stage_classes)

    predictions = pd.DataFrame(
        {
            "episode_id": evaluation["episode_id"],
            "risk_probability": np.round(eval_risk, 4),
            "predicted_lost_to_followup": eval_predicted_ltfu,
            "predicted_dropout_stage": eval_stage,
            "priority_tier": assign_priority_tier(pd.Series(eval_risk)),
        }
    )
    predictions.to_csv(PROCESSED / "episode_predictions.csv", index=False)
    print(f"\nWrote {PROCESSED / 'episode_predictions.csv'} ({len(predictions)} rows)")

    # Out-of-fold DEVELOPMENT predictions (from the gradient-boosting CV
    # above) -- for our own calibration / error-analysis, AND for the
    # "predicted vs. actual" demonstration on the Problems page (Section C):
    # showing the model's prediction alongside the real, known outcome for a
    # labeled episode is a stronger proof point than showing it on
    # unlabeled EVALUATION data alone. Not a submission file.
    oof_risk = oof_proba["gradient_boosting"]
    oof_predicted_ltfu = (oof_risk >= 0.5).astype(int)
    oof_stage = reconcile_stage(oof_predicted_ltfu, stage_oof_proba, stage_classes_cv)
    oof_df = pd.DataFrame(
        {
            "episode_id": dev["episode_id"],
            "consult_date": dev["consult_date"].dt.strftime("%Y-%m-%d"),
            "target_ltfu": y_dev_ltfu,
            "target_dropout_stage": y_dev_stage,
            "risk_probability_oof": np.round(oof_risk, 4),
            "predicted_lost_to_followup_oof": oof_predicted_ltfu,
            "predicted_dropout_stage_oof": oof_stage,
            "priority_tier_oof": assign_priority_tier(pd.Series(oof_risk)),
        }
    )
    oof_df.to_csv(PROCESSED / "model_oof_predictions.csv", index=False)
    print(f"Wrote {PROCESSED / 'model_oof_predictions.csv'} ({len(oof_df)} rows)")

    # JSON copies for the Problems page's "predict who is likely to drop out"
    # demonstration (Section C) -- fetched on demand, same pattern as
    # episode_timeline.json, not loaded by every page via DashboardDataProvider.
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    for df_out, name in [(predictions, "episode_predictions"), (oof_df, "model_oof_predictions")]:
        columnar = {"columns": list(df_out.columns), "rows": df_out.values.tolist()}
        (PUBLIC_DATA / f"{name}.json").write_text(json.dumps(columnar, default=str))
        print(f"Wrote {PUBLIC_DATA / f'{name}.json'}")

    metrics = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "n_development": len(dev),
        "n_evaluation": len(evaluation),
        "dropped_dead_features": DEAD_FEATURES,
        "ltfu_binary": {"cv_5fold": ltfu_cv, "time_holdout": ltfu_holdout},
        "care_plan_mechanical_check": mech_check,
        "ltfu_binary_reduced_features": {"metrics": reduced_metrics, "feature_importance": reduced_importance},
        "dropout_stage_multiclass": stage_cv,
        "feature_importance": {"target_ltfu": ltfu_importance, "target_dropout_stage": stage_importance},
        "logistic_coefficients_target_ltfu": coefs,
        "priority_tier_rule": "Terciles of risk_probability across the scored (EVALUATION) population: bottom third Low, middle third Medium, top third High.",
        "eval_predictions_class_balance": {
            "predicted_lost_to_followup_1": int(predictions["predicted_lost_to_followup"].sum()),
            "predicted_lost_to_followup_0": int((predictions["predicted_lost_to_followup"] == 0).sum()),
            "predicted_dropout_stage_counts": predictions["predicted_dropout_stage"].value_counts().to_dict(),
            "priority_tier_counts": predictions["priority_tier"].value_counts().to_dict(),
        },
    }
    (PROCESSED / "model_metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
    print(f"Wrote {PROCESSED / 'model_metrics.json'}")


if __name__ == "__main__":
    main()
