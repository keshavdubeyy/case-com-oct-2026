INFINUM 2026 — DATA-DRIVEN FOLLOW-UP ASSURANCE FOR RURAL TELECONSULTATIONS
Synthetic Competition Dataset

POPULATION
5,000 synthetic patients. All names, identifiers, facilities, locations, clinical values and events are invented for this case competition.

OBJECTIVE
Integrate fragmented rural healthcare data to identify patients lost to follow-up, predict dropout risk, and help CHOs/ASHAs prioritize timely actions after teleconsultation.

COHORTS
DEVELOPMENT — consult_date on or before 30-Jun-2026. Outcomes are visible in episode_outcomes.csv.
EVALUATION — consult_date from 01-Jul-2026 through 15-Aug-2026. Outcomes are blank and retained by organizers.

RECORD-LINKAGE DESIGN
Each operational system has its own source_patient_id. There is no candidate crosswalk. Names, phones, ages and village strings contain intentional typos, formatting changes, missing values and small discrepancies. The patient_360_reference table is the canonical entity table teams should link source identities to.

IMPORTANT MODELING NOTE
When predicting evaluation outcomes, avoid using events that occurred after the point at which the prediction is meant to be made. Teams should explicitly define their prediction time and prevent temporal leakage.

ETHICS / GOVERNANCE
This is not clinical data and must not be used for patient care. Teams should discuss privacy, role-based access, minimum-necessary data, fairness, explainability, audit trails and safe escalation.
