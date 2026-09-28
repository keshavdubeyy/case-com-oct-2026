# Metric Definitions — Data-Driven Follow-Up Assurance Dashboard

Every metric below is implemented once in `scripts/lib/metrics.py` (preprocessing side) and mirrored by a single shared TypeScript selector in `lib/metrics.ts` (UI side, operating on the already-joined episode fact table) — no metric is recomputed ad hoc inside a chart component. Unit of analysis is **episode** unless a row explicitly says **patient**. All rate metrics are reported with their denominator alongside; any segment with denominator < 20 is flagged low-sample in the UI rather than hidden.

## 0. Cohort rule (applies to every metric on this page)

`cohort = DEVELOPMENT` if `consult_date <= 2026-06-30`, else `EVALUATION`. **Every LTFU / dropout / completion-rate metric filters to DEVELOPMENT only**, because `lost_to_followup_label` and `dropout_stage_label` are blank for EVALUATION by design. EVALUATION episodes appear only in volume/context KPIs (episode counts, care-advised counts) that don't depend on the outcome label. This rule is centralized in one function (`isOutcomeEligible(episode)`), not re-implemented per page.

---

## 1. Overview page

| KPI | Numerator | Denominator | Source |
|---|---|---|---|
| Total patients | count of `patient_360_reference` rows | — | patient_360_reference |
| Total teleconsultation episodes | count of `episode_outcomes` rows | — | episode_outcomes |
| Development cohort episodes | count where `cohort = DEVELOPMENT` | — | episode_outcomes |
| Evaluation cohort episodes | count where `cohort = EVALUATION` | — | episode_outcomes |
| Lost-to-follow-up rate | count where `cohort=DEVELOPMENT AND lost_to_followup_label=1` | count where `cohort=DEVELOPMENT` | episode_outcomes |
| Completed-care rate | count where `cohort=DEVELOPMENT AND lost_to_followup_label=0` | count where `cohort=DEVELOPMENT` | episode_outcomes |
| Episodes requiring action | DEVELOPMENT episodes with `lost_to_followup_label=1` **plus** any EVALUATION episode currently flagged at-risk by outreach cadence rules (defined in §9) | — | episode_outcomes + outreach_actions |

`lost_to_followup_label`: 1 = any required care component (medicine/test/review, whichever were advised) remained incomplete; 0 = every advised component was completed. This is the dataset's own definition (data_dictionary.csv), used verbatim — the dashboard never redefines it.

---

## 2. Care Journey (eligible-denominator funnels)

Every stage below is only counted against patients/episodes for whom that stage was **advised** — never against the full teleconsultation base, per the brief's explicit instruction.

| Stage | Numerator definition | Denominator definition |
|---|---|---|
| Medicine advised | `medicine_advised = 'Yes'` | all episodes |
| Prescription generated | episode has ≥1 row in `prescriptions` (by `teleconsult_id`) | medicine advised |
| Medicine dispensed (any) | linked `medicine_dispensing.dispense_status IN ('Dispensed','Partially dispensed')` for ≥1 prescription line | prescription generated |
| Medicine fully dispensed | `dispense_status = 'Dispensed'` for **all** dispensing rows of the episode's prescriptions, and every prescription line has ≥1 dispensing row | prescription generated |
| Medicine partially dispensed | ≥1 dispensing row has `partial_fill = 1` or `dispense_status = 'Partially dispensed'`, and not fully dispensed | prescription generated |
| Medicine not received | either zero dispensing rows exist for the episode's prescriptions, or all attempts are `dispense_status = 'Not dispensed due to stock'` | prescription generated |
| Tests advised | `test_advised = 'Yes'` | all episodes |
| Tests completed | linked `lab_tests.test_status = 'Available'` (via patient-entity link, see §Linkage — **flagged as linkage-dependent** in the UI) | tests advised |
| Reviews advised | `review_advised = 'Yes'` | all episodes |
| Reviews completed | episode has ≥1 row in `followup_visits` | reviews advised |

`Medicine Fulfillment Rate = medicine fully dispensed / prescription generated` (not `/ all teleconsultations`), matching the brief's worked example exactly. **This is a different metric from the Dispensing Success Rate defined in §4** (fully dispensed / prescriptions with ≥1 dispensing *attempt* only) — the two were previously conflated under one "Medicine Completion Rate" label and displayed as a single number; they are now named and shown distinctly everywhere in the UI (see `VALIDATION_REPORT.md` MED-01 and `P1_FIXES.md`). Because `lab_tests` has no direct episode key, "tests completed" is the one funnel stage carrying linkage uncertainty; the funnel visualization marks it distinctly (dashed segment + tooltip disclosure) rather than presenting it with the same confidence as the medicine/review stages, which are 100% directly keyed.

---

## 3. Dropout Analysis (DEVELOPMENT cohort only)

- **Overall LTFU rate**, **LTFU count**: as in §1, restricted to whatever segment filter is active.
- **dropout_stage_label distribution**: value-counts of the field, DEVELOPMENT only, always shown with total N.
- **% of LTFU attributable to each stage** = count(`dropout_stage_label = X`) / count(`lost_to_followup_label = 1`), for X in {Medicine not collected, Review not attended, Test not completed}. `dropout_stage_label` is defined as the *first unresolved stage* — episodes are not double-counted across stages.
- Breakdown dimensions (diagnosis, age group, gender, facility, village, district, distance bucket, connectivity, road access, vulnerability group, NCD status, NCD control status) are all pre-joined onto the episode fact table (see `PROCESSING.md`/pipeline) so every breakdown is a `groupBy` over one flat table, not a per-page join.
- Age group buckets: `<18, 18-29, 30-44, 45-59, 60+` (computed from `teleconsultations.age`, the source-record age at consult time — not the reference `age_as_of_2026`, to avoid mixing a 2026-anchored age with a historical consult date).
- Distance buckets: `0-5km, 5-10km, 10-20km, >20km` from `distance_to_facility_km` (episode-level, direct field, no linkage dependency).

**No causal language**: every breakdown chart title is phrased as an association ("LTFU rate is higher among X") never causation ("X causes dropout"), and a fixed disclosure line ("Association only — not a causal estimate") is rendered on every Dropout Analysis and Segments chart via a shared `<AssociationNote>` component, not typed per-chart.

---

## 4. Medicine Access

| Metric | Formula |
|---|---|
| Medicine-advised episodes | count `medicine_advised='Yes'` |
| Prescription count | count of `prescriptions` rows (line-level) / count of distinct `prescription_id` (order-level) — both shown, labelled, never conflated |
| Medicine Fulfillment Rate | fully-dispensed prescriptions / **all** prescriptions generated (§2's funnel rate; includes zero-attempt prescriptions in the denominator) |
| Dispensing attempted | prescriptions with `medicine_dispensing_attempted=true` (≥1 dispensing row of any kind recorded) / all prescriptions generated — the denominator-bridge between the two rates below |
| **Dispensing Success Rate** | fully-dispensed prescriptions / prescriptions with `medicine_dispensing_attempted=true` **only** — always ≥ Medicine Fulfillment Rate, since zero-attempt prescriptions are excluded from this denominator entirely. **This is a distinct metric from Medicine Fulfillment Rate above; never render one under the other's label.** `medicine_dispensing_attempted` is precomputed per episode in `scripts/build_processed.py::classify_medicine_access()` (teleconsult_id↔prescription_id is 1:1 in this dataset, verified, so this is well-defined at episode grain). |
| Partial dispensing rate | episodes with `medicine_outcome='partial dispensing'` / all prescriptions generated — an **episode-level** rate. (An earlier draft of this row described a row-level `count(partial_fill=1)/count(dispensing rows)` formula; that was never implemented and has been corrected here to document the metric that actually exists — see `P1_FIXES.md` MED-02. A true dispensing-row-level partial-fill rate would require shipping `medicine_dispensing.csv` rows to the client, which is out of scope for now.) |
| Stock-out affected prescriptions | prescriptions with ≥1 linked dispensing row where `stockout_flag=1` OR `dispense_status='Not dispensed due to stock'` | / prescription generated |
| Average stock-out days | mean(`medicine_stock_status.stockout_days`) where `stockout_flag_month=1`, grouped by facility/medicine |
| Medicine availability by facility | 1 − (stock-out-months / 8 months observed) per facility, from `medicine_stock_status` |
| Top medicines associated with stock-outs | rank medicines by `stockout_flag_month` count in `medicine_stock_status` |

**Non-compliance vs. system failure distinction** (explicit brief requirement): an episode's medicine outcome is classified as:
- `system_stockout` — any linked dispensing row has `stockout_flag=1` or `dispense_status='Not dispensed due to stock'`, **or** the prescribing facility had `stock_status IN ('Low stock','Reorder raised')` for that medicine in that month;
- `patient_no_collection_attempt` — a prescription exists, zero dispensing rows exist for it, **and** the facility's stock for that medicine/month was `Adequate` (i.e. supply was not the apparent constraint);
- `completed` — fully dispensed.

A case is only ever labelled "patient did not collect" when facility-side stock evidence does not indicate a supply constraint; when stock evidence is ambiguous or missing for that facility/medicine/month, the case is labelled `indeterminate`, never defaulted to patient-side blame. This three/four-way split (not a binary compliance flag) is what's surfaced on the Medicine Access page.

---

## 5. Lab Completion

| Metric | Formula |
|---|---|
| Test-advised episodes | `test_advised='Yes'` count |
| Tests ordered / samples collected / results available | via linked `lab_tests` rows: ordered = linked row exists; sample collected = `sample_date` not null; results available = `test_status='Available'` |
| Test completion rate | results available / test-advised episodes |
| Median order-to-sample time | median(`sample_date - order_date`) days, where both present |
| Median sample-to-result time | median(`result_date - sample_date`) days, where both present |

All `lab_tests` metrics inherit the linkage-confidence caveat from §Care Journey — every lab metric card/chart carries a small "linked via patient-entity resolution, confidence-weighted" badge and a link to the Data Quality page, rather than being presented with the same certainty as directly-keyed metrics.

---

## 6. Follow-up Reviews

| Metric | Formula |
|---|---|
| Review-advised episodes | `review_advised='Yes'` |
| Completed follow-up reviews | episodes with ≥1 `followup_visits` row |
| Review completion rate | completed / review-advised |
| Overdue reviews | review-advised, no `followup_visits` row, **and** `today_proxy (2026-08-25, the data's max observed date + buffer) - consult_date > review_due_days` — only computable where `review_due_days` is non-null |
| Median days consult→review | median(`followup_visits.visit_date - teleconsultations.consult_date`) over episodes with a completed review |

---

## 7. Geography & Access

Distance buckets and connectivity/road-access are joined at two different grains, kept distinct in the UI: `distance_to_facility_km` and `connectivity_quality` are **episode-level** fields on `teleconsultations` (zero linkage dependency); `road_access` and `mobile_connectivity` are **village-level** fields from `geography_reference`, joined via a normalized-village match (see §Linkage) and therefore carry the linkage's village-resolution confidence, not the patient-entity confidence. LTFU rate by village/district uses the episode's own recorded `district`/`block`/`village` string (already clean/categorical for district+block; village free text is normalized before bucketing, with unmatched villages grouped into an explicit "Unresolved village" bucket rather than dropped or mis-assigned). Facility lat/long from `facility_reference` and village lat/long from `geography_reference` power the map.

---

## 8. Facility Analysis

Per facility: teleconsultations (count), unique patients (via entity-resolved `patient_id`, with an "N unresolved" caveat count shown alongside), LTFU rate, medicine/lab/review completion (as defined above, filtered to the facility), outreach actions, contact success rate (§9), medicine stock-out days (sum from `medicine_stock_status`), CHO count / ASHA-linked count (`facility_reference`). Facilities are always shown alongside `network_context`, case volume, and district — explicitly not as a bare sorted leaderboard — per the brief's "no simplistic ranking" instruction; default sort is by district/block, with an optional (clearly labelled) sort-by-LTFU-rate toggle that keeps the contextual columns visible.

---

## 9. Outreach Effectiveness

| Metric | Formula |
|---|---|
| Total outreach actions | count of `outreach_actions` rows |
| Outreach actions per LTFU/at-risk episode | count / count(DEVELOPMENT episodes with `lost_to_followup_label=1`) |
| Action method / contact outcome / cadre / followup_reason distributions | value counts |
| Successful contact rate | count(`contact_outcome` in {'Reached; promised follow-up','Reached; counselled','Family member reached'}) / total outreach actions |
| Post-outreach completion association | for episodes with ≥1 outreach action with a successful contact outcome **before** the relevant completion event (medicine dispensed / lab result / follow-up visit), compare completion rate to episodes with no successful-contact outreach in the same at-risk segment (same dropout-relevant stage) | — labelled "association observed after outreach," never "outreach caused completion," with the comparison group and both rates always shown side by side |

At-risk episode (used for the outreach-per-at-risk-episode ratio and for Overview's "requiring action" KPI on EVALUATION rows, where the true label is unknown): `medicine_advised='Yes' AND no full dispensing` OR `test_advised='Yes' AND no available result` OR `review_advised='Yes' AND no completed review`, evaluated only on fields known without the outcome label (so it's computable for EVALUATION episodes too, unlike `lost_to_followup_label`).

---

## 10. Patient Segments

Table grain: one row per segment value (e.g., one row per district). Columns: episode count, LTFU count, LTFU rate, care-completion rate — **denominator (episode count) is always the leftmost data column**, never a rate shown alone. Segments with N < 20 get a "low sample" badge (grey, not hidden) rather than being dropped, so the page never silently curates which groups are shown.

---

## 11. Historical Behaviour

Computed per **episode** using that episode's own `consult_date` as the point-in-time cutoff, from `visit_history` rows belonging to the *same resolved canonical patient* (via §Linkage) with `visit_date < consult_date` (strict inequality — same-day rows excluded to avoid leakage from the index visit itself):

- `visits_prior_30d`, `visits_prior_60d`, `visits_prior_90d`: count of prior `visit_history` rows within the window.
- `prior_followup_reviews`: count of prior rows with `visit_type='Follow-up review'`.
- `prior_referrals`: count of prior rows with `referral_flag='Yes'`.
- `prior_relevant_interactions`: count of prior rows with `visit_type IN ('NCD follow-up','Screening visit','OPD visit')`.

`ncd_control_status` (surfaced as a Dropout Analysis / Segments breakdown dimension) follows the same strict-inequality rule: the most recent `ncd_screening` row with `screening_date < consult_date` for the resolved patient, evaluated at consult time. (An earlier version used `<=`, inclusive of same-day screenings; corrected to strict `<` because `screening_date`/`consult_date` carry no time-of-day, so a same-day screening could in reality have occurred after the consult — see `VALIDATION_REPORT.md` Part 8 and `P1_FIXES.md`.)

All four feed only into an **association view** (bar/box comparison of these counts between LTFU=1 vs LTFU=0 episodes, DEVELOPMENT cohort only) — the page states these are candidate features for a future model, not a fitted model output, and every value is null (shown as "linkage unresolved," not 0) for episodes whose patient link didn't clear the confidence threshold, so unresolved episodes never silently read as "zero prior visits."

---

## 12. Data Quality & Record Linkage

### Linkage scoring (implemented once in `scripts/linkage.py`)

For each source table's records, candidates from `patient_360_reference` are blocked by `(gender, first-token-of-normalized-village, |age_source − age_as_of_2026| <= 2)`, then scored:

```
score = 0.45 * name_similarity          # difflib SequenceMatcher ratio on normalized (lowercased, whitespace-collapsed) name
      + 0.25 * mobile_last4_match       # 1.0 if last 4 digits match masked_mobile, 0.0 otherwise, excluded from weight renormalization when either mobile is missing
      + 0.15 * village_match            # 1.0 exact normalized village string match, 0.5 same block, 0 otherwise
      + 0.15 * age_closeness            # 1 - min(|age_diff|,5)/5
```
Weights renormalize over the components that have data for that record pair (e.g. mobile missing → renormalize over the remaining 0.75). Best-scoring candidate per source record is kept **only if** `score >= 0.72` (high confidence, auto-linked) or flagged `0.55–0.72` (medium confidence — linked but visually distinguished throughout the UI) or left **unmatched** below 0.55 (`predicted_patient_id` null) — never forced. Records where the top two candidates' scores are within 0.03 of each other are downgraded to `ambiguous` regardless of absolute score, and also left unmatched, per the "no fabricated match" rule.

**These thresholds (0.72 / 0.55 / 0.03) are heuristic, not empirically validated.** This dataset supplies no cross-system patient crosswalk (`README.txt`, `data_dictionary.csv`) — there is no ground-truth "correct match" label against which precision/recall could be measured, so the thresholds could not be calibrated or validated by this team, only chosen as a reasonable, documented, auditable judgment call. "High confidence" means "scored above a threshold chosen without ground truth to check it against," not "independently confirmed correct." The Data Quality & Record Linkage page states this explicitly rather than presenting the tiers as validated (see `VALIDATION_REPORT.md` Part 7 / LNK-01, `P1_FIXES.md`).

### Page contents

Record counts by dataset (§1 table), missing-value percentages (from `_audit.json`), duplicate records (0 found, stated explicitly), unmatched patient records (count + % per source table), linkage confidence distribution (histogram of scores, high/medium/unmatched/ambiguous counts), source-system linkage rates (% high-confidence per table), ambiguous matches (count + a sample table). This page is the single place that documents the method in §Linkage in user-facing language, so every other page can just show a confidence badge that links back here instead of re-explaining the method.

---

## Reusable implementation

- Pipeline side: `scripts/lib/metrics.py` — pure functions taking the joined episode DataFrame + auxiliary tables, one function per numerator/denominator pair above, each returning `{numerator, denominator, rate}` — never a bare float, so the UI can never render a rate without its N.
- UI side: `lib/metrics.ts` — TypeScript mirrors of the same aggregations, operating on the precomputed JSON (the heavy joins happen once in Python at build time; the UI only filters + aggregates the already-flat fact table client-side for interactive filtering).
