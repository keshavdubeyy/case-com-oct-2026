# Model Results — Dropout-Risk Prediction

**Phase 2 of the plan: link records (done) → predict dropout (this document) → design an intervention (next).** Trained and evaluated by `scripts/train_dropout_model.py` against `processed/model_features_consult_time.csv` — the leakage-safe, consult-time-only table audited in `MODEL_FEATURE_AUDIT.md`. The real target columns, `target_ltfu` (binary) and `target_dropout_stage` (4-class), are used throughout; no fabricated column name was used (see the note on injected instructions in `PROBLEM_ANALYSIS.md`).

Run: `.venv/bin/python scripts/train_dropout_model.py`. Full machine-readable output: `processed/model_metrics.json`.

---

## Headline result

| Model | Metric | 5-fold CV | Time-based holdout (train on Jan–early Jun, validate on last ~3 weeks of Jun) |
|---|---|---:|---:|
| Logistic Regression | ROC-AUC | **0.703** | 0.680 |
| Logistic Regression | PR-AUC | 0.663 | 0.651 |
| Gradient Boosting (HistGBM) | ROC-AUC | 0.673 | 0.672 |
| Gradient Boosting (HistGBM) | PR-AUC | 0.631 | 0.621 |

**Logistic regression is the better model here**, not gradient boosting — worth stating plainly rather than assuming the fancier model wins. With ~4,100 training rows and mostly categorical, fairly linear-acting features, the simpler model generalizes at least as well and is far more interpretable, which matters for a tool health workers and program staff need to trust.

**The time-based holdout result is close to the cross-validated result** (0.68 vs 0.70) — a real, if modest, sign that performance should hold up reasonably on EVALUATION, which is entirely later in time than any DEVELOPMENT row. This is a more honest generalization check than random cross-validation alone, because it mimics the actual future-prediction setting.

**Read the absolute number honestly: ROC-AUC ≈ 0.70 is modest, not strong.** It means the model separates at-risk from not-at-risk noticeably better than chance, but there's a lot of overlap — this is a prioritization aid, not a diagnosis. Section below explains a large part of *why* it's not higher.

---

## The most important caveat: part of this "skill" is mechanical, not risk

`target_ltfu = 1` iff **any advised** component (medicine/test/review) was left incomplete — the dataset's own definition, used verbatim. That means an episode where **nothing was advised** is LTFU=0 by construction, not because the patient did anything differently. We checked this directly:

| Components advised (medicine + test + review) | Episodes | LTFU rate |
|---:|---:|---:|
| 0 | 174 | **0.0%** |
| 1 | 1,236 | 33.3% |
| 2 | 1,946 | 53.7% |
| 3 | 776 | 68.6% |

This is a clean, near-monotonic staircase — largely arithmetic (more required steps = more chances for one to fail), not a discovered clinical risk factor. And indeed, `medicine_advised` / `test_advised` / `review_advised` are the top 3 features by permutation importance in the full model. **To separate genuine risk signal from this mechanical effect, we re-ran the same model with those three flags removed:**

| | Full model (GBM) | Reduced model (GBM, care-plan flags removed) |
|---|---:|---:|
| ROC-AUC | 0.673 | **0.604** |

**About a third of the full model's discrimination comes from simply counting how many components were advised.** The remaining 0.604 AUC (vs. 0.5 = chance) is the genuinely useful part: real, if modest, predictive signal from *who the patient is and where they are*, independent of how many care steps their visit required.

**Practically:** the care-plan flags are legitimately known at consult time and are fine to keep as inputs — a health worker prioritization tool genuinely should know "this patient has 3 things to complete, not 1." Just don't read "medicine_advised is the #1 risk factor" as "advising medicine causes dropout" — it's closer to "the more asked of a patient, the more can go wrong," which is a different, less actionable insight than a demographic or geographic risk factor.

---

## What actually predicts dropout, once the mechanical effect is set aside

From the reduced-feature model (care-plan flags removed), by permutation importance:

| Feature | Importance |
|---|---:|
| `distance_to_facility_km` | 0.0451 |
| `review_due_days`¹ | 0.0425 |
| `block` | 0.0062 |
| `gender` | 0.0043 |
| `vulnerability_group` | 0.0041 |
| `age` | 0.0038 |
| `village` | 0.0028 |
| `facility_id` | 0.0007 |

¹ `review_due_days` still carries a residual echo of "was a review advised" (it's a sentinel value when not advised) even with `review_advised` itself removed — so its importance here is partly the same mechanical effect in a different column, not purely a clinical signal. Treat it with the same caution as the care-plan flags.

**The one clear, robust, genuinely actionable finding: distance to facility.** It's the top or near-top predictor in *every* version of the model (full, reduced, and in the logistic regression coefficients, `+0.42`, one of the largest coefficients of any kind). This corroborates the segment-level finding already on the `/problems` and `/findings` pages — greater distance associates with higher LTFU — but now with model-based confirmation that it holds up even controlling for everything else in the table.

Beyond distance, the signal is real but thin: `vulnerability_group`, `age`, `gender`, and geography (`block`/`village`/`facility_id`) all contribute a little. **Historical engagement (`visits_prior_30/60/90d`, `prior_relevant_interactions`) and NCD status/control barely move the needle** in this model — smaller than expected given the association shown on the Historical Behaviour page. That page's finding was a raw two-group comparison; once distance, geography, and care-plan complexity are all in the same model, the historical-engagement signal mostly gets absorbed rather than adding independent predictive value.

**Logistic regression's per-village and per-facility coefficients should not be over-read.** With 36 villages and 27 facilities split across ~4,100 training rows, several of the largest individual coefficients (e.g. `village_Devarakonda`, `facility_id_FAC013`) are estimated from small samples and are more likely overfit noise than a real village-specific effect — the `/findings` and `/problems` pages' segment tables (which show N alongside every rate) are the more trustworthy source for facility- or village-specific claims, not these individual coefficients.

---

## Predicting *which* stage, not just *whether* — a real limitation

A second model was trained on `target_dropout_stage` (4-class, includes "Completed care journey"):

| Class | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| Completed care journey | 0.592 | 0.704 | 0.643 | 2,144 |
| Medicine not collected | 0.440 | 0.449 | 0.445 | 1,170 |
| Review not attended | 0.239 | **0.105** | 0.146 | 543 |
| Test not completed | 0.192 | **0.106** | 0.136 | 275 |

Macro-F1: **0.343**. Overall accuracy 51.3%.

**Be honest about this: the model is reasonably useful for the two largest classes (completed / medicine-not-collected) and close to useless for the two smaller ones.** Only ~1 in 10 "Review not attended" or "Test not completed" episodes gets correctly flagged as that specific stage. This isn't a tuning failure — with only 543 and 275 positive examples respectively, and no feature in this table that specifically distinguishes "will fail at review" from "will fail at test" (both draw on similar distance/geography/history signal), there isn't enough separating information here yet.

**Because of this, and because the two models (binary LTFU and 4-class stage) were trained independently and disagreed on 19.9% of EVALUATION rows before being reconciled (see below), the binary LTFU model is the primary, trustworthy signal. `predicted_dropout_stage` should be read as a lower-confidence secondary hint, most reliable for the "medicine not collected" case, and treated skeptically for "review"/"test."**

---

## A correctness fix made during this pass: reconciling the two models' outputs

The binary and stage models were trained separately, so nothing guaranteed they'd agree — checked directly, and initially **19.9% of EVALUATION rows had `predicted_lost_to_followup=1` alongside `predicted_dropout_stage='Completed care journey'`** (or the reverse), which would be a confusing, self-contradictory output to hand a health worker. Fixed in `scripts/train_dropout_model.py`: `predicted_dropout_stage` is now **derived** to agree with the (better-performing) binary model — forced to `Completed care journey` when `predicted_lost_to_followup=0`, and otherwise the stage model's most likely *failure* stage (renormalized over the 3 non-completed classes) when `predicted_lost_to_followup=1`. Guarded going forward by `tests/test_predictions.py::test_predicted_stage_consistent_with_predicted_label`.

---

## Predictions produced

**`processed/episode_predictions.csv`** — 1,384 rows, one per EVALUATION episode, exact column shape of `Infinum_2026_Candidate_Dataset_Pack/submission_template_episode_predictions.csv` (`episode_id, risk_probability, predicted_lost_to_followup, predicted_dropout_stage, priority_tier`). The raw template file itself was not modified.

| | Count |
|---|---:|
| Predicted lost to follow-up (1) | 661 |
| Predicted completed (0) | 723 |
| Predicted stage: Medicine not collected | 480 |
| Predicted stage: Review not attended | 126 |
| Predicted stage: Test not completed | 55 |
| Predicted stage: Completed care journey | 723 |
| Priority tier: High / Medium / Low | 461 / 461 / 462 |

**`priority_tier` is a simple, transparent rule, not another model:** terciles of `risk_probability` across the scored population (bottom third Low, middle third Medium, top third High). Deliberately not fitted or optimized — a health worker or program manager should be able to see exactly why a patient landed in a tier.

**`processed/model_oof_predictions.csv`** — out-of-fold DEVELOPMENT predictions (real label known, prediction made without that row in its own training fold) — for our own calibration and error-analysis, not a submission artifact.

---

## Limitations carried over from earlier phases, still true here

- **Linkage confidence is heuristic, not validated** (`VALIDATION_REPORT.md` LNK-01) — `patient_link_tier`/`patient_link_confidence` are model inputs, so any linkage error propagates into the risk score.
- **DEVELOPMENT vs. EVALUATION distribution shift in historical-engagement features** (`MODEL_FEATURE_AUDIT.md`) — since those features contribute only a little to this model, the risk is limited, but not zero.
- **The lab-linkage 4.6% order-sensitivity and the ~16% "indeterminate" medicine-failure share** don't directly enter this model (all excluded post-consult fields), but they're why `target_ltfu` itself isn't a perfectly clean label at the margins.
- **This model has not been checked for fairness/bias across vulnerability groups, gender, or geography** beyond reporting their raw importance — before operational use, at minimum check whether error rates (false-negative rate in particular — a missed at-risk patient) are similar across `vulnerability_group` and `district`, since a model that systematically misses one group would defeat the purpose of a targeting tool.

## Next step

This closes Phase 2 (predict) with an honest, moderate-but-real result and a reconciled, submission-shaped output. Phase 3 — design an intervention health workers can actually use — is the natural next step: turn `episode_predictions.csv` and `priority_tier` into an actual action queue (`submission_template_action_queue.csv`'s shape), which was Problem 6 in `PROBLEM_ANALYSIS.md` and is still unbuilt.
