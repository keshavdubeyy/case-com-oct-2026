"""
Shared fixtures for the analytical test suite (VALIDATION_REPORT.md Step 6 /
P1 fix list). Run with: npm run test:python  (== ./.venv/bin/pytest tests -v)

These tests exercise the actual pipeline code in scripts/ and scripts/lib/,
not reimplementations of it, so a real regression in linkage scoring or the
medicine-classification logic will fail a test here.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "Infinum_2026_Candidate_Dataset_Pack"
PROCESSED = ROOT / "processed"

# scripts/build_processed.py imports as `from lib.linkage import ...`, which
# only resolves when scripts/ itself is on sys.path (mirrors how it's run:
# `.venv/bin/python scripts/build_processed.py` puts scripts/ at sys.path[0]).
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


@pytest.fixture(scope="session")
def episode_outcomes() -> pd.DataFrame:
    return pd.read_csv(RAW / "episode_outcomes.csv", parse_dates=["consult_date"])


@pytest.fixture(scope="session")
def episode_fact() -> pd.DataFrame:
    path = PROCESSED / "episode_fact.csv"
    if not path.exists():
        pytest.skip(f"{path} not found -- run `npm run build:processed` first")
    return pd.read_csv(path, parse_dates=["consult_date"])


@pytest.fixture(scope="session")
def patient_360() -> pd.DataFrame:
    return pd.read_csv(RAW / "patient_360_reference.csv")
