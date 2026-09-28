"""
Patient-entity resolution engine.

Links each operational source table's own source_patient_id (noisy name/mobile/
village/age, no supplied crosswalk) to patient_360_reference.patient_id (the
canonical entity table). Implements the scoring formula documented in
METRICS.md > "Linkage scoring".

Design goals, per the case brief:
  - Never fabricate a match when confidence is low -> unmatched records get a
    null predicted_patient_id, not a best-guess one.
  - Keep confidence + method auditable -> every output row carries a score,
    a tier (high/medium/unmatched/ambiguous), and the component scores.
"""
from __future__ import annotations

import re
from collections import defaultdict
from difflib import SequenceMatcher

import numpy as np
import pandas as pd

HIGH_THRESHOLD = 0.72
MEDIUM_THRESHOLD = 0.55
AMBIGUOUS_MARGIN = 0.03


def normalize_name(name: str) -> str:
    if not isinstance(name, str):
        return ""
    s = name.lower().strip()
    s = re.sub(r"[^a-z\s]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def normalize_village(v: str) -> str:
    if not isinstance(v, str):
        return ""
    s = v.lower().strip()
    s = re.sub(r"[^a-z\s]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def last4(mobile) -> str | None:
    if not isinstance(mobile, str):
        return None
    digits = re.sub(r"\D", "", mobile)
    if len(digits) < 4:
        return None
    return digits[-4:]


def name_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


class PatientIndex:
    """Blocks patient_360 by (gender, block) for fast candidate lookup."""

    def __init__(self, patients: pd.DataFrame):
        self.patients = patients.reset_index(drop=True)
        self._name_norm = self.patients["canonical_name"].map(normalize_name).values
        self._village_norm = self.patients["village"].map(normalize_village).values
        self._mobile_last4 = self.patients["masked_mobile"].map(last4).values
        self._age = self.patients["age_as_of_2026"].astype(float).values
        self._gender = self.patients["gender"].values
        self._block = self.patients["block"].values
        self._patient_id = self.patients["patient_id"].values

        self.buckets: dict[tuple, list[int]] = defaultdict(list)
        for i in range(len(self.patients)):
            self.buckets[(self._gender[i], self._block[i])].append(i)

        # secondary indices for tables that carry no age/gender/block of their
        # own (prescriptions, dispensing, lab_tests, followup_visits,
        # visit_history, outreach_actions) -- blocking by (gender, block) is
        # not possible there, and falling back to a full unblocked scan
        # against ~5,000 candidates per row is combinatorially too slow, so
        # these tables instead block by mobile-last4 (near-exact, tiny
        # buckets) with a first-name-token index as a second-choice fallback.
        self.mobile_index: dict[str, list[int]] = defaultdict(list)
        self.first_token_index: dict[str, list[int]] = defaultdict(list)
        for i in range(len(self.patients)):
            m = self._mobile_last4[i]
            if m is not None:
                self.mobile_index[m].append(i)
            tok = self._name_norm[i].split(" ")[0] if self._name_norm[i] else ""
            if tok:
                self.first_token_index[tok].append(i)

    def candidates(self, gender: str, block: str) -> list[int]:
        return self.buckets.get((gender, block), [])

    def candidates_no_demographics(self, mobile_l4: str | None, name_n: str) -> list[int]:
        if mobile_l4 is not None and mobile_l4 in self.mobile_index:
            return self.mobile_index[mobile_l4]
        tok = name_n.split(" ")[0] if name_n else ""
        if tok and tok in self.first_token_index:
            return self.first_token_index[tok]
        return []

    def score(self, idx: int, name_n: str, mobile_l4: str | None, village_n: str, age) -> tuple[float, dict]:
        comps = {}
        weights = {}

        comps["name"] = name_similarity(name_n, self._name_norm[idx])
        weights["name"] = 0.45

        if mobile_l4 is not None and self._mobile_last4[idx] is not None:
            comps["mobile"] = 1.0 if mobile_l4 == self._mobile_last4[idx] else 0.0
            weights["mobile"] = 0.25

        if village_n:
            cand_village = self._village_norm[idx]
            if village_n == cand_village:
                comps["village"] = 1.0
            else:
                comps["village"] = 0.0
            weights["village"] = 0.15

        if age is not None and not (isinstance(age, float) and np.isnan(age)):
            diff = abs(float(age) - self._age[idx])
            comps["age"] = max(0.0, 1.0 - min(diff, 5.0) / 5.0)
            weights["age"] = 0.15

        total_w = sum(weights.values())
        if total_w == 0:
            return 0.0, comps
        score = sum(comps[k] * weights[k] for k in comps) / total_w
        return score, comps

    def patient_id_at(self, idx: int) -> str:
        return self._patient_id[idx]


def link_table(
    df: pd.DataFrame,
    id_col: str,
    name_col: str,
    mobile_col: str,
    village_col: str,
    age_col: str,
    gender_col: str,
    block_col: str,
    index: PatientIndex,
    source_system: str,
) -> pd.DataFrame:
    """Row-level linkage. Returns one row per input row with match result."""
    out_rows = []
    for _, row in df.iterrows():
        name_n = normalize_name(row.get(name_col))
        mobile_l4 = last4(row.get(mobile_col))
        village_n = normalize_village(row.get(village_col))
        age = row.get(age_col)
        gender = row.get(gender_col)
        block = row.get(block_col)

        if pd.notna(gender) and pd.notna(block):
            cand_idx = index.candidates(gender, block)
            # widen search if the (gender, block) bucket is thin, but only
            # within the same gender -- never fall through to an unblocked
            # all-patient scan.
            if len(cand_idx) < 5:
                for (g, b), lst in index.buckets.items():
                    if g == gender and b != block:
                        cand_idx = cand_idx + lst
        else:
            # no demographic columns on this source table -- block on
            # mobile-last4 (near-exact) with first-name-token as fallback,
            # both bounded to small candidate sets.
            cand_idx = index.candidates_no_demographics(mobile_l4, name_n)

        scored = []
        for idx in cand_idx:
            if age is not None and not (isinstance(age, float) and np.isnan(age)):
                if abs(float(age) - index._age[idx]) > 6:
                    continue
            s, comps = index.score(idx, name_n, mobile_l4, village_n, age)
            scored.append((s, idx, comps))

        if not scored:
            out_rows.append(
                {
                    "source_system": source_system,
                    "source_id_col": id_col,
                    "source_patient_id": row.get(id_col),
                    "predicted_patient_id": None,
                    "confidence": 0.0,
                    "tier": "unmatched",
                }
            )
            continue

        scored.sort(key=lambda t: t[0], reverse=True)
        best_score, best_idx, _ = scored[0]
        second_score = scored[1][0] if len(scored) > 1 else -1.0

        if best_score >= HIGH_THRESHOLD:
            tier = "high"
        elif best_score >= MEDIUM_THRESHOLD:
            tier = "medium"
        else:
            tier = "unmatched"

        if tier != "unmatched" and (best_score - second_score) < AMBIGUOUS_MARGIN:
            tier = "ambiguous"

        predicted = index.patient_id_at(best_idx) if tier in ("high", "medium") else None

        out_rows.append(
            {
                "source_system": source_system,
                "source_id_col": id_col,
                "source_patient_id": row.get(id_col),
                "predicted_patient_id": predicted,
                "confidence": round(float(best_score), 4),
                "tier": tier,
            }
        )
    return pd.DataFrame(out_rows)


def aggregate_by_source_id(row_level: pd.DataFrame) -> pd.DataFrame:
    """Collapse row-level matches to one row per distinct source_patient_id,
    taking the modal predicted_patient_id and mean confidence. Kept auditable:
    a source id whose rows disagree on the best match is marked ambiguous."""

    def _agg(g: pd.DataFrame) -> pd.Series:
        matched = g[g["predicted_patient_id"].notna()]
        if matched.empty:
            return pd.Series(
                {
                    "predicted_patient_id": None,
                    "confidence": round(float(g["confidence"].mean()), 4),
                    "tier": "unmatched",
                    "n_rows": len(g),
                }
            )
        mode_counts = matched["predicted_patient_id"].value_counts()
        top_id = mode_counts.index[0]
        agreement = mode_counts.iloc[0] / len(matched)
        conf = round(float(matched.loc[matched["predicted_patient_id"] == top_id, "confidence"].mean()), 4)
        tier = matched.loc[matched["predicted_patient_id"] == top_id, "tier"].mode().iloc[0]
        if agreement < 0.6 and len(matched) > 1:
            tier = "ambiguous"
            top_id = None
        return pd.Series({"predicted_patient_id": top_id, "confidence": conf, "tier": tier, "n_rows": len(g)})

    agg = row_level.groupby("source_patient_id", dropna=False).apply(_agg, include_groups=False).reset_index()
    agg["source_system"] = row_level["source_system"].iloc[0]
    return agg
