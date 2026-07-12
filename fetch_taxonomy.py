"""
fetch_taxonomy.py — build the ToS;DR case taxonomy.

The taxonomy is the full set of ToS;DR "cases": reusable classifications like
"They can share your data with third parties" with a severity classification
and weight. This is the knowledge base we later embed into Pinecone.

Reliability note: the ToS;DR API rate-limits. This script distinguishes a
GENUINE gap (server clearly says "no case here") from a TRANSIENT failure
(timeout / 429 / 5xx). Transient failures are retried with backoff and, if they
still fail, re-tried in a second pass at the end — never silently dropped. Only
genuine gaps count toward the early-stop, and any case that can't be resolved is
reported loudly so the taxonomy is never quietly incomplete.

This script needs NO API keys — the ToS;DR API is public.

    python scripts/fetch_taxonomy.py

Output: data/tosdr_cases.json
"""

import argparse
import json
import os
import re
import time

import requests

API_BASE = "https://api.tosdr.org"
EDIT_BASE = "https://edit.tosdr.org"          # Phoenix editor — used only for topic names
OUTPUT_PATH = os.path.join("data", "tosdr_cases.json")

VALID_CLASSIFICATIONS = {"good", "neutral", "bad", "blocker"}
PROBE_IDS = [122, 182, 234]

REQUEST_DELAY = 0.15          # seconds between requests (gentler, to avoid rate limits)
REQUEST_TIMEOUT = 15
MAX_RETRIES = 5               # per request, with exponential backoff
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Accept": "application/json", "User-Agent": "ToSGuardian/1.0"})
    return s


def extract_case(payload: dict | None) -> dict | None:
    """Normalise a case response into our flat record, or None if not a usable case."""
    if not isinstance(payload, dict):
        return None
    obj = payload.get("parameters", payload)
    if not isinstance(obj, dict):
        return None

    case_id = obj.get("id")
    title = (obj.get("title") or "").strip()
    description = (obj.get("description") or "").strip()
    if not isinstance(case_id, int) or not title:
        return None

    return {
        "case_id": case_id,
        "title": title,
        "description": description,
        "classification": obj.get("classification"),
        "weight": obj.get("weight"),
        "topic_id": obj.get("topic_id"),
        "topic_name": None,
    }


def fetch_case(session: requests.Session, url: str, case_id: int):
    """
    Fetch one case id. Returns a tuple:
        ("hit",   case_dict)  — a valid case exists here
        ("empty", None)       — the server clearly has no case here (genuine gap)
        ("error", None)       — transient failure, exhausted retries (UNKNOWN)
    """
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, params={"id": case_id}, timeout=REQUEST_TIMEOUT)
        except requests.RequestException:
            time.sleep(min(0.5 * (2 ** attempt), 20))
            continue

        if resp.status_code == 200:
            try:
                data = resp.json()
            except ValueError:
                time.sleep(min(0.5 * (2 ** attempt), 20))
                continue
            case = extract_case(data)
            return ("hit", case) if case else ("empty", None)

        if resp.status_code == 404:
            return ("empty", None)

        if resp.status_code in TRANSIENT_STATUS:
            retry_after = resp.headers.get("Retry-After")
            delay = min(int(retry_after), 30) if (retry_after or "").isdigit() \
                else min(0.5 * (2 ** attempt), 20)
            time.sleep(delay)
            continue

        # Any other status (403, etc.) — treat as transient/unknown, keep it safe.
        time.sleep(min(0.5 * (2 ** attempt), 20))

    return ("error", None)


def is_junk(case: dict) -> bool:
    title = case["title"].lower()
    desc = case["description"].lower()
    if title == "none":
        return True
    if "do not select this case" in desc:
        return True
    if not case["description"]:
        return True
    return False


def find_working_endpoint(session: requests.Session) -> str:
    for version in ("case/v1", "case/v2"):
        url = f"{API_BASE}/{version}"
        for pid in PROBE_IDS:
            outcome, case = fetch_case(session, url, pid)
            if outcome == "hit":
                print(f"Using case endpoint: /{version}")
                return url
    raise RuntimeError(
        "Could not reach the ToS;DR case API on /case/v1 or /case/v2. "
        "Check https://api.tosdr.org and https://docs.tosdr.org."
    )


def enumerate_cases(session: requests.Session, url: str, max_id: int, miss_limit: int):
    """
    Walk ids upward. Only GENUINE empties count toward early-stop; transient
    errors are recorded for a retry pass and never end the scan or drop a case.
    Returns (cases, error_ids).
    """
    cases: list[dict] = []
    error_ids: list[int] = []
    consecutive_empty = 0

    for case_id in range(1, max_id + 1):
        outcome, case = fetch_case(session, url, case_id)
        time.sleep(REQUEST_DELAY)

        if outcome == "hit":
            cases.append(case)
            consecutive_empty = 0
            if len(cases) % 25 == 0:
                print(f"  ...collected {len(cases)} cases (last id {case_id})")
        elif outcome == "empty":
            consecutive_empty += 1
            if cases and consecutive_empty >= miss_limit:
                print(f"Stopped at id {case_id}: {miss_limit} consecutive genuine empties.")
                break
        else:  # error — unknown, don't let it end the scan or count as a gap
            error_ids.append(case_id)
            consecutive_empty = 0

    return cases, error_ids


def retry_errors(session: requests.Session, url: str, error_ids: list[int]):
    """Second pass over transient failures. Returns (recovered_cases, still_failing)."""
    recovered: list[dict] = []
    still_failing: list[int] = []
    if not error_ids:
        return recovered, still_failing

    print(f"Retrying {len(error_ids)} ids that failed transiently...")
    for case_id in error_ids:
        outcome, case = fetch_case(session, url, case_id)
        time.sleep(REQUEST_DELAY * 2)  # extra gentle on the retry pass
        if outcome == "hit":
            recovered.append(case)
        elif outcome == "error":
            still_failing.append(case_id)
        # "empty" on retry = genuinely no case, fine to drop
    return recovered, still_failing


def fetch_topic_name(session: requests.Session, topic_id: int) -> str | None:
    """Resolve topic_id -> name via the Phoenix topic page <title>."""
    try:
        resp = session.get(f"{EDIT_BASE}/topics/{topic_id}",
                           headers={"Accept": "text/html"}, timeout=REQUEST_TIMEOUT)
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None
    m = re.search(r"<title>(.*?)</title>", resp.text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    tm = re.match(r"Topic\s+(.*?)\s*\(", m.group(1).strip())
    return tm.group(1).strip() if tm and tm.group(1).strip() else None


def resolve_topics(session: requests.Session, cases: list[dict]) -> None:
    topic_ids = sorted({c["topic_id"] for c in cases if isinstance(c["topic_id"], int)})
    if not topic_ids:
        return
    print(f"Resolving {len(topic_ids)} unique topic names...")
    names: dict[int, str] = {}
    for tid in topic_ids:
        name = fetch_topic_name(session, tid)
        if name:
            names[tid] = name
        time.sleep(REQUEST_DELAY)
    for c in cases:
        c["topic_name"] = names.get(c["topic_id"])
    print(f"Resolved {len(names)}/{len(topic_ids)} topic names.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch the ToS;DR case taxonomy.")
    parser.add_argument("--max-id", type=int, default=800)
    parser.add_argument("--miss-limit", type=int, default=150,
                        help="Stop after this many consecutive GENUINE empties.")
    args = parser.parse_args()

    session = make_session()
    url = find_working_endpoint(session)

    print("Fetching cases...")
    cases, error_ids = enumerate_cases(session, url, args.max_id, args.miss_limit)

    recovered, still_failing = retry_errors(session, url, error_ids)
    cases.extend(recovered)
    # De-dupe by case_id (a recovered id could overlap in edge cases) and sort.
    cases = list({c["case_id"]: c for c in cases}.values())
    cases.sort(key=lambda c: c["case_id"])

    print(f"Fetched {len(cases)} raw cases "
          f"(recovered {len(recovered)} on retry, {len(still_failing)} unresolved).")

    kept = [c for c in cases if not is_junk(c)]
    dropped = len(cases) - len(kept)

    resolve_topics(session, kept)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(kept, f, ensure_ascii=False, indent=2)

    by_class: dict[str, int] = {}
    for c in kept:
        by_class[c["classification"] or "unknown"] = \
            by_class.get(c["classification"] or "unknown", 0) + 1
    missing_topics = sum(1 for c in kept if not c["topic_name"])
    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)

    print("\n--- Summary ---")
    print(f"Kept:    {len(kept)} cases")
    print(f"Dropped: {dropped} junk/placeholder cases")
    print("By classification:")
    for k in sorted(by_class):
        print(f"  {k:<10} {by_class[k]}")
    unexpected = set(by_class) - VALID_CLASSIFICATIONS - {"unknown"}
    if unexpected:
        print(f"NOTE: unexpected classifications: {sorted(unexpected)}")
    if missing_topics:
        print(f"NOTE: {missing_topics} cases still have no topic_name.")
    if still_failing:
        print(f"WARNING: {len(still_failing)} ids never resolved (rate limits). "
              f"Re-run to recover them: {still_failing[:20]}{'...' if len(still_failing) > 20 else ''}")
    print(f"Saved -> {OUTPUT_PATH}  ({size_mb:.3f} MB)")
    if size_mb > 50:
        print("WARNING: file exceeds the 50 MB knowledge-base limit.")


if __name__ == "__main__":
    main()