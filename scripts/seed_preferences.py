"""
scripts/seed_preferences.py — seed the general-default preference rows.

Reads the ToS;DR case taxonomy from data/tosdr_cases.json, derives a default
stance for each case from its severity classification, and upserts one general
(all-category) default row per case into Supabase's `preferences` table:

    case_id, category="*", stance=<derived>, source="default"

Stance derivation:
    blocker / bad      -> "care"       (severe by ToS;DR — surface by default)
    neutral / good     -> "dont_care"  (benign — stay quiet unless the user opts in)

Idempotent: keyed on (case_id, category) with an upsert, so re-running updates
the existing rows in place rather than creating duplicates.

    python scripts/seed_preferences.py

Requires a filled .env.local (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) and the
`preferences` table from supabase/schema.sql.
"""

import json
import os
import sys

# This script lives in scripts/; the shared config module lives at the project
# root. Put the root on the import path so `import config` resolves regardless
# of the current working directory.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import config
from supabase import create_client

INPUT_PATH = os.path.join(ROOT, "data", "tosdr_cases.json")
GENERAL_CATEGORY = "*"

# ToS;DR severity -> default stance.
CARE_CLASSIFICATIONS = {"blocker", "bad"}
DONT_CARE_CLASSIFICATIONS = {"neutral", "good"}


def load_cases() -> list[dict]:
    if not os.path.exists(INPUT_PATH):
        sys.exit(f"Missing {INPUT_PATH}. Run fetch_taxonomy.py first.")
    with open(INPUT_PATH, encoding="utf-8") as f:
        cases = json.load(f)
    if not cases:
        sys.exit(f"{INPUT_PATH} is empty.")
    return cases


def derive_stance(classification: str | None) -> str:
    """Map a case's severity classification to a default care/dont_care stance."""
    key = (classification or "").strip().lower()
    if key in CARE_CLASSIFICATIONS:
        return "care"
    if key in DONT_CARE_CLASSIFICATIONS:
        return "dont_care"
    # Unknown/blank classification: be conservative and surface it by default.
    return "care"


def build_rows(cases: list[dict]) -> list[dict]:
    rows = []
    for case in cases:
        case_id = case.get("case_id")
        if case_id is None:
            continue  # a case with no id can't be keyed; skip loudly-ish below
        rows.append(
            {
                "case_id": str(case_id),  # stored as text
                "category": GENERAL_CATEGORY,
                "stance": derive_stance(case.get("classification")),
                "source": "default",
            }
        )
    return rows


def main() -> None:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        sys.exit(
            "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local."
        )

    cases = load_cases()
    print(f"Loaded {len(cases)} cases from {INPUT_PATH}.")

    rows = build_rows(cases)
    skipped = len(cases) - len(rows)
    if skipped:
        print(f"Skipped {skipped} case(s) with no case_id.")

    care = sum(1 for r in rows if r["stance"] == "care")
    dont = len(rows) - care
    print(f"Derived stances: {care} care, {dont} dont_care.")

    client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)

    # Upsert on the (case_id, category) unique key: re-running updates in place.
    resp = (
        client.table("preferences")
        .upsert(rows, on_conflict="case_id,category")
        .execute()
    )
    written = len(resp.data) if getattr(resp, "data", None) is not None else len(rows)
    print(f"Upserted {written} general-default preference row(s).")
    print("Done.")


if __name__ == "__main__":
    main()
