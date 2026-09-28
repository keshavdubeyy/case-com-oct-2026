# P1 Fixes — Applied After `VALIDATION_REPORT.md`

This document records every fix applied in response to the P1 items in `VALIDATION_REPORT.md` Part 13's master gap list, plus one additional correctness bug found while building the test suite requested for Step 6 (not in the original P1 list — flagged and fixed transparently below, not silently). All numbers were recomputed from the rebuilt `processed/episode_fact.csv` after each fix; the pipeline was re-run with `.venv/bin/python scripts/build_processed.py` (and `scripts/lab_linkage_diagnostics.py` for Part 4).

---

## 1. Medicine Access metric inconsistency (MED-01) — FIXED

**Before:** one KPI card labeled "Medicine Completion Rate" showed 59.85% (2,519/4,209 — fully dispensed / **all** prescriptions generated) under a tooltip that falsely claimed to be "METRICS.md #4 dispensing completion rate" (which is actually defined as fully dispensed / prescriptions with **≥1 dispensing attempt only**, a different and higher number).

**After:**
- `scripts/build_processed.py::classify_medicine_access()` now emits a new episode-level field, `medicine_dispensing_attempted` (bool — was ≥1 dispensing row of any kind ever recorded for this prescription).
- `lib/metrics.ts::careJourneyFunnel()` now returns two clearly-named, never-conflated rates: `medicineFulfillmentRate` (fully dispensed / all generated) and `dispensingSuccessRate` (fully dispensed / attempted only), plus a bridging `medicineDispensingAttempted` rate.
- `app/medicine-access/page.tsx` shows both as separate KPI cards ("Medicine Fulfillment Rate" and "Dispensing Success Rate"), each with a tooltip naming the other and warning not to conflate them.
- `app/care-journey/page.tsx`'s funnel card is relabeled "Medicine Fulfillment Rate" (was "Medicine Completion Rate") with a tooltip pointing to the Medicine Access page for the attempts-based number.
- `METRICS.md` §2 and §4 rewritten to document both metrics by name, with an explicit "never render one under the other's label" note.

**Values** (after both this fix and the medicine-classification bug fix below):

| Metric | Numerator | Denominator | Value |
|---|---:|---:|---:|
| Medicine Fulfillment Rate | 2,310 | 4,209 | **54.88%** |
| Dispensing Success Rate (among attempts) | 2,310 | 3,231 | **71.49%** |

## 2. Partial-fill denominator inconsistency (MED-02) — RESOLVED (documentation fix)

**Before:** METRICS.md described "Partial-fill rate" as `count(partial_fill=1) / count(dispensing rows)` — a row-level formula using `medicine_dispensing.csv` directly — but the actual implementation was, and remains, episode-level (`medicine_outcome='partial dispensing'` / prescription generated). `medicine_dispensing.csv` rows are never shipped to the client, so the row-level formula was never implementable without a larger data-plumbing change.

**Resolution:** rather than build new plumbing to ship dispensing rows to the client for one rate, METRICS.md §4 was corrected to document the metric that actually exists (episode-level, prescription-generated denominator — the same denominator basis as the other funnel stages), and the Medicine Access page's tooltip was updated to state this explicitly and note the correction. No behavior changed; the documentation now matches the code.

## 3. NCD temporal leakage risk — FIXED

**Before:** `build_ncd_context()` used `screening_date <= consult_date` (inclusive) to pick the most recent prior NCD screening — a same-day screening could, in a dataset with no time-of-day granularity, have actually happened after the consult.

**Fix:** changed to strict `screening_date < consult_date` in `scripts/build_processed.py::build_ncd_context()`, matching the strict `<` already used for `visit_history`-based features.

**Measured effect:** rebuilt the pipeline and diffed `ncd_control_status` (now also `ncd_status`, newly added — see Step 7) old vs. new, episode-by-episode:

- **9 of 5,516 episodes changed (0.16%).**
- 7 episodes: a same-day screening that used to populate the field now correctly shows no qualifying prior screening (null).
- 2 episodes: a same-day screening was previously selected as "most recent"; with same-day excluded, an actually-earlier screening is now selected instead, changing the value (`Borderline → Controlled` and `Controlled → Borderline`).

**Confirmation no post-consult information enters the modelling table:** `scripts/build_model_features.py` sources `prior_ncd_status`/`prior_control_status` directly from these now-strict-`<` fields; `tests/test_model_features.py` and the leakage table in `MODEL_FEATURE_AUDIT.md` both re-verify this.

This is a low-materiality fix (9 episodes, 0.16%) but a real, confirmed one — consistent with the audit's own characterization of this as a minor risk.

## 4. Lab-to-episode ambiguity — QUANTIFIED, not changed

See `LAB_LINKAGE_DIAGNOSTICS.md` for full detail. Summary: 89 of 1,944 matched lab-to-episode assignments (4.58%) are "order-sensitive" (the assigned lab record was also eligible for ≥1 other episode of the same patient). Judged not materially significant enough, on its own, to justify changing the greedy assignment algorithm without further design work — documented as a recommended future improvement (global optimal assignment) instead. The assignment algorithm in `scripts/build_processed.py::build_lab_journey()` was **not modified**.

## 5. Linkage-confidence disclosure — ADDED

`app/data-quality/page.tsx`'s linkage-method explanation now includes an explicit callout: the 0.72/0.55/0.03 thresholds are heuristic, not empirically validated (no ground-truth crosswalk exists in this dataset to validate them against), and "high confidence" means "scored above a threshold chosen without ground truth to check it against," not statistically validated confidence. `METRICS.md` §12 carries the same disclosure.

---

## 6. Additional correctness bug found and fixed (not in the original P1 list)

While building the fixture test explicitly requested for Step 6 ("one of multiple medicines missing"), the test caught a **real, previously-undetected bug**: `classify_medicine_access()` only checked that ≥1 dispensing row existed *somewhere* for the whole prescription order, not that **every prescribed medicine** had one. A prescription with 2+ medicine lines where only one medicine was ever dispensed (and that one dispensing row said `Dispensed`) was incorrectly classified `medicine_fully_dispensed=True` / `completed` — contradicting METRICS.md's own stated definition ("every prescription line has ≥1 dispensing row") and this audit's own earlier (incorrect) claim in `VALIDATION_REPORT.md` Part 5 that this was "verified by construction of the code."

**Measured impact on real data:** 209 of 4,209 prescriptions (5.0%) were affected — all multi-medicine prescriptions where the classification flipped from `completed` to either `system_stockout` (37 cases) or `indeterminate` (172 cases), never to a worse label than the evidence supported.

**Fix:** `classify_medicine_access()` now additionally requires that every distinct `medicine_name` on the prescription has ≥1 dispensing row of its own (`medicine_dispensing.csv` has no `prescription_line_id`, so `medicine_name` is the finest available join key — documented in code).

**Before → after, real-data numbers:**

| Metric | Before (bug present) | After (fixed) |
|---|---:|---:|
| Medicine Fulfillment Rate | 59.85% (2,519/4,209) | **54.88% (2,310/4,209)** |
| Dispensing Success Rate | 77.96% (2,519/3,231) | **71.49% (2,310/3,231)** |
| `medicine_access_classification = completed` | 2,519 | 2,310 |
| `medicine_access_classification = system_stockout` | 327 | 364 |
| `medicine_access_classification = indeterminate` | 517 | 689 |
| Ground-truth cross-check: `dropout_stage_label='Medicine not collected'` reclassified `completed` | 270 of 1,170 (23.1%) | **109 of 1,170 (9.3%)** |

The ground-truth cross-check improving from 23.1% to 9.3% mismatch is itself evidence the fix is correct: some of the episodes the dataset's own label already knew were "Medicine not collected" were exactly the multi-medicine, one-dispensed-one-missing cases this bug was misclassifying.

A regression test (`tests/test_medicine_logic.py::test_one_of_multiple_medicines_missing_is_not_completed`) guards this going forward. The Data Quality page's findings table now discloses this fix.

---

## Verification

- `.venv/bin/pytest tests -v` → **36 passed** (dataset integrity, outcome integrity, medicine logic incl. the regression test above, cohort protection, linkage scoring, model-feature leakage safety).
- `processed/episode_fact.csv` rebuilt and re-verified: still 5,516 rows, 5,516 unique `episode_id`, 4,132/1,384 cohort split unchanged, LTFU/dropout-stage counts unchanged (those come from the dataset's own ground-truth label, untouched by any of the above fixes).
