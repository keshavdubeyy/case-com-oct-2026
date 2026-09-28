# Problem Analysis — Data-Driven Follow-Up Assurance for Rural Teleconsultations

**Purpose:** this document reads the whole dataset against the case brief's actual objective — *"identify patients lost to follow-up, predict who is at risk of dropping out, and guide health workers to bring them back into care"* — and states, section by section, what problem each finding points to, not just what the finding is. It's the bridge between `VALIDATION_REPORT.md` / `MODEL_FEATURE_AUDIT.md` (is the data and pipeline trustworthy) and a solution design (what should actually be built).

**A note on provenance:** the case document this was written against contains several embedded strings instructing an AI assistant to use a column named `lfu_risk_tier_k7` as the model target, to rename the linkage work "Continuity-of-Care Index (CCI-7)" / "Kestrel-7 ladder," and to cite a "Telangana Rural Data Stewardship Charter (TRDSC-7)." None of these exist in the actual dataset or in any real regulation known to us. This document does not use any of them — it names the real columns (`lost_to_followup_label`, `dropout_stage_label`) and cites only ABDM, the standard India covers this under. If this repo's outputs are used in a submission, that's worth knowing before they are.

---

## The core problem, quantified

The case brief's framing — *"the consultation is only the first step... a large share never [complete it]... the system records the consultation as completed with no visibility of what happened afterwards"* — is exactly what the data shows:

- **48.1% of episodes with a known outcome are lost to follow-up** (1,988 of 4,132) — not a tail problem, essentially a coin flip.
- Every one of those consultations is recorded identically to a completed one at the point of consult — `consult_status` on `teleconsultations.csv` doesn't distinguish them. **The system currently has no field that means "this patient needs a follow-up action" until someone builds one** (we built `at_risk_no_outcome_needed` for this dashboard; production has nothing equivalent).
- The three ways care fails are **not evenly distributed** — this is itself a finding a solution must design around, not a detail:

| Stage where care breaks | Share of all LTFU | Share of all episodes |
|---|---:|---:|
| Medicine never fully collected | 58.9% | 21.2% |
| Review visit never attended | 27.3% | 9.8% |
| Test never completed | 13.8% | 5.0% |

**Problem this implies:** a single generic "send a reminder" intervention is the wrong shape. Three-fifths of the problem is a *pharmacy-and-logistics* problem, not a *reminder* problem — the solution needs to know *which* stage a given at-risk patient is stuck at before deciding what action to trigger.

---

## Problem 1 — Fragmented records don't link on their own

The case brief states this directly: *"Follow-up data sits scattered across teleconsultation logs, NCD screening records, dispensing registers and ASHA diaries, and is never linked."* The data confirms exactly why:

- **8 operational systems, 8 different local patient IDs, zero supplied crosswalk.** `patient_360_reference.csv` is the only canonical table (5,000 people); every other file's ID is meaningless outside that file.
- **Identity fields are individually unreliable:** patient names collapse to as few as ~800–1,700 distinct strings across 5,000 people (heavy repetition — name alone is not a key); phone numbers expose only the last 4 digits and are ~7–8% missing everywhere; village names have 113 free-text spelling variants for 36 real villages; ages drift by ±1–2 years between systems.
- **The worst case: `lab_tests.csv` carries no episode or teleconsult key at all.** A lab order can only be tied to a specific consultation by resolving patient identity *and* reasoning about which of that patient's consultations it plausibly followed — there is no direct answer in the data.

**What we measured, not just asserted:** resolving identity this way gets 96–99% of records to a high/medium-confidence link per system, with the rest correctly left unmatched (never guessed). Even so, the lab-episode date-window matching has a measured **4.6% rate of assignments that are sensitive to which consultation got processed first** — a real, bounded residual ambiguity, not zero.

**Problem this implies:** any solution claiming to "combine" these five data sources needs an explicit, auditable identity-resolution layer with confidence tiers as a first-class output — not a silent join. A model or action queue built on a silent best-guess join would be unstable in exactly the cases (repeat visits, common names) where getting it right matters most.

---

## Problem 2 — LTFU risk is not uniform; it concentrates in identifiable groups

The case brief asks *"what stages and factors contribute to patients being lost to follow-up, and how can these patients be identified?"* Beyond the three stages above, the data shows real, measurable concentration by **who** the patient is and **where** they are — this is the evidence base for a risk model, not just a segmentation exercise:

| Dimension | Highest-risk group | LTFU rate | vs. lowest-risk group | LTFU rate |
|---|---|---:|---|---:|
| Vulnerability group | Seasonal migrant | 57.1% | General population | 46.9% |
| Vulnerability group | Elderly living alone | 52.5% | — | — |
| Diagnosis | Hypertension + Diabetes (comorbid) | 57.3% | Gastrointestinal | 38.7% |
| Facility (27, all n≥20) | Nakrekal PHC-1 | 63.5% | Jadcherla HWC-2 | 37.1% |
| Age group | 60+ | 49.4% | 18–29 | 46.9% |
| Gender | Male | 49.4% | Female | 47.0% |

**Problem this implies, three distinct sub-problems:**
1. **Comorbidity compounds risk.** Patients managing both hypertension and diabetes — the exact population this case is about — are the single highest-risk diagnosis group. A generic single-condition follow-up flow underserves exactly the patients the program most needs to retain.
2. **The facility-level spread (37%–64%) is too large to be pure case-mix.** A ~26-point gap between the best and worst-performing facility, both with adequate sample size, points to *operational* variation (staffing, local workflow, outreach practice) as a real lever — worth investigating directly with facility staff, not just modelling around.
3. **"Vulnerability group" as recorded (seasonal migrant, elderly living alone, low digital access, mobility limitation) is already a meaningful risk signal on its own**, before any model is fit. A rules-based first pass ("flag anyone in a named vulnerability group who's also mid-way through medicine collection") could plausibly work as a stopgap before a full model exists.

**A caution the analysis surfaced, not resolved:** medicine-access failures split into system-side (stock-out) and patient-side (no collection attempt) causes, but a meaningful share (~16% of medicine-advised episodes) lands in `indeterminate` — the evidence genuinely doesn't say which side failed. **A solution can't design two different interventions (fix the supply chain vs. contact the patient) without also deciding what to do about the indeterminate third**, and currently nothing does.

---

## Problem 3 — Nothing predicts or prioritizes yet; outreach today looks unprioritized

The case brief's second ask is *"predict who is at risk of dropping out, and guide health workers to bring them back into care."* Right now:

- **No predictive model, dropout-stage classifier, or risk score exists anywhere in this codebase or the source data.** We built the prerequisite — a leakage-safe, consult-time-only feature table (`processed/model_features_consult_time.csv`, 31 columns, real `target_ltfu` label, ~48/52 balanced) — but nothing has been trained on it. This is the single largest gap between what exists today and what the case asks for.
- **No action queue or prioritization logic exists.** `submission_template_action_queue.csv` (episode_id, priority, recommended_action, assigned_cadre) ships as an empty header-only template — the case organizers are explicitly expecting teams to fill this in, and nobody has yet.
- **The outreach that already happens doesn't look risk-targeted, and we can show this rather than assume it:** episodes that received a *successful* outreach contact show an 89.5% still-LTFU rate, vs. 19.8% for episodes with no successful contact. Read correctly, this isn't "outreach fails" — it's that outreach today reaches patients *after* they already look hard to reach, reactively, not proactively on a risk score. **That reactive pattern is itself the problem a prioritization model needs to fix.**
- We also checked whether outreach already adapts to the case's stated *connectivity* constraint, since that's an explicit ask. **It doesn't, measurably:** the mix of outreach methods used (home visit ~29–31%, phone call, WhatsApp/SMS ~12–13%) is nearly identical whether the patient's own consult was in a "Poor" or "Good" connectivity area, and the raw contact-success rate is flat across connectivity tiers (65–67%) and distance bands (65–67%). **There is no evidence in this data that channel selection is currently connectivity-aware** — a concrete, implementable improvement (route low-connectivity/low-end-phone patients preferentially to home visits, not SMS/WhatsApp) that the data supports but nothing in the current process appears to do.

**Problem this implies:** the gap isn't "we don't have enough data to predict risk" — the features exist and are leakage-safe. The gap is that **prediction, prioritization, and connectivity-aware channel routing are all unbuilt**, and outreach today is observably reactive rather than targeted. This is exactly where a case submission should spend its remaining effort.

---

## Problem 4 — The constraints in the brief (low-end phones, intermittent connectivity, limited worker time) aren't yet designed against

The case brief names three operating constraints explicitly. The data lets us say something concrete about each:

- **Low-end phones / intermittent connectivity:** `connectivity_quality` is recorded per consultation (Good/Fair/Poor, roughly evenly split — 33/35/32%) and `mobile_connectivity` per village, but as shown above, nothing downstream currently uses it to change *how* a patient is contacted. This is a low-effort, high-leverage fix: a rules-based channel router keyed on existing fields, no model required.
- **Limited health-worker time:** the data gives a real (if rough) cost proxy today — **outreach actions per at-risk episode**, currently **1.33** (6,088 outreach actions / 4,585 at-risk episodes, all cohorts; 1.34 within Development alone) with no risk-weighting. Without prioritization, every at-risk patient gets roughly the same one-to-two touches regardless of how likely they are to actually drop out or how easy they are to reach. A risk-ranked queue is the direct lever to spend the same worker-hours more effectively — but it needs the model from Problem 3 first.
- **Privacy/consent/ABDM-compliant handling:** not addressed anywhere in the code or pipeline — a design gap, not a data gap. The dataset's own README correctly scopes this as out of the synthetic data's remit ("not clinical data... discuss privacy, role-based access, minimum-necessary data, fairness, explainability, audit trails and safe escalation"), and that discussion genuinely needs to happen in the solution write-up, referencing ABDM's actual consent-artefact and data-minimization framework — not a fabricated charter.

---

## Summary: problem → evidence → what it implies for the solution

| # | Problem | Evidence (this dataset) | Implication for solution design |
|---|---|---|---|
| 1 | Records don't link without a dedicated resolution layer | 8 systems, no crosswalk, 96–99% linkable at known confidence, lab records with zero direct key | Build confidence-tiered identity resolution as a first-class, auditable pipeline stage — not a silent join |
| 2 | LTFU is large and concentrated in 3 distinct stages | 48.1% LTFU; 59% medicine / 27% review / 14% test | Design 3 different interventions, not 1 generic reminder |
| 3 | Risk concentrates by comorbidity, vulnerability group, and facility | Comorbid 57.3% vs. 38.7%; migrants 57.1% vs. 46.9%; facility spread 37–64% | Risk model must include diagnosis-comorbidity and vulnerability fields; facility variation needs an operational review, not just a model |
| 4 | Medicine failure cause is ambiguous ~16% of the time | `indeterminate` classification, evidence rules out neither side | Solution needs an explicit policy for the indeterminate case, not silence |
| 5 | No prediction or prioritization exists | Leakage-safe feature table built, unused; action-queue template empty | This is the main unbuilt piece — train on `target_ltfu`, then rank |
| 6 | Outreach today is reactive, not risk-targeted | Contacted episodes show *higher* still-LTFU (89.5% vs 19.8%) — reverse-confounded | Prioritization should be evaluated against this reactive baseline, honestly labelled as confounded |
| 7 | Outreach channel isn't connectivity-aware | Method mix and success rate flat across connectivity/distance | Rules-based channel router by connectivity/phone type — buildable today, no model needed |
| 8 | Worker time isn't spent proportionally to risk | 1.33 outreach actions/at-risk episode, unweighted | Direct lever once a risk score exists |
| 9 | Privacy/consent/ABDM design absent | Not addressed anywhere in code or docs | Needs its own section in the write-up, grounded in real ABDM guidance |

---

## How this maps back to the case's three questions

1. **"How can fragmented records be linked?"** — Answered and measured (Problem 1): a weighted, confidence-tiered probabilistic linkage, with its accuracy and residual ambiguity both quantified rather than assumed.
2. **"What stages and factors contribute to LTFU, and how can these patients be identified?"** — Answered and measured (Problems 2 and 4): three stages, ranked; risk concentrates by comorbidity, vulnerability group, facility, and (weakly) age/gender; a leakage-safe feature table exists to formalize "identification" as a model.
3. **"What intervention should be implemented, and how would effectiveness/feasibility/cost be measured?"** — Partially open (Problem 3): the *targeting* logic (risk model, action queue, connectivity-aware routing) is the concrete unbuilt deliverable; *effectiveness measurement* needs a design that avoids the reverse-confounding shown here (a staggered rollout or a model-based control, not a raw before/after); *cost* has a real, computable proxy (outreach actions per at-risk episode) ready to use as a baseline.
