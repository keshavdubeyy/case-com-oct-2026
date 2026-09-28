"""Village-name resolution: maps noisy operational village strings to the
36 canonical villages in geography_reference.csv, blocked by block (already
a clean categorical field on every operational table) so this needs no
patient-entity linkage at all -- it's a separate, lighter-weight problem."""
from __future__ import annotations

from difflib import SequenceMatcher

import pandas as pd

from .linkage import normalize_village

RESOLVE_THRESHOLD = 0.55


def build_village_resolver(geography: pd.DataFrame):
    by_block: dict[str, list[tuple[str, str, str]]] = {}
    for _, row in geography.iterrows():
        by_block.setdefault(row["block"], []).append(
            (row["village_id"], row["village"], normalize_village(row["village"]))
        )

    cache: dict[tuple[str, str], tuple[str | None, str | None, float]] = {}

    def resolve(raw_village: str, block: str) -> tuple[str | None, str | None, float]:
        key = (raw_village, block)
        if key in cache:
            return cache[key]
        norm = normalize_village(raw_village)
        candidates = by_block.get(block, [])
        best = (None, None, 0.0)
        for vid, vname, vnorm in candidates:
            if norm == vnorm:
                best = (vid, vname, 1.0)
                break
            score = SequenceMatcher(None, norm, vnorm).ratio()
            if score > best[2]:
                best = (vid, vname, score)
        if best[2] < RESOLVE_THRESHOLD:
            result = (None, None, round(best[2], 3))
        else:
            result = (best[0], best[1], round(best[2], 3))
        cache[key] = result
        return result

    return resolve
