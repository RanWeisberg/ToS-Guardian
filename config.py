"""
config.py — single source of truth for ToS Guardian's configuration.

Every script and the deployed API import their secrets from here, so there is
exactly one place that reads the environment and one place that fails loudly
when something is missing.

Usage:
    import config
    print(config.LLMOD_BASE_URL)
"""

import os
from dotenv import load_dotenv

load_dotenv()  # reads .env in the project root

# Sentinel: a variable that is present but still empty/placeholder counts as unset.
_PLACEHOLDERS = {"", "your-key-here", "changeme"}


def _get(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    if value is not None and value.strip() in _PLACEHOLDERS:
        return None
    return value


# --- LLMod.ai ---
LLMOD_API_KEY = _get("LLMOD_API_KEY")
LLMOD_BASE_URL = _get("LLMOD_BASE_URL")
LLMOD_TEXT_MODEL = _get("LLMOD_TEXT_MODEL", "MB5R2CF-azure/gpt-5.4-mini")
LLMOD_EMBED_MODEL = _get("LLMOD_EMBED_MODEL", "MB5R2CF-azure/text-embedding-3-small")

# --- Pinecone ---
PINECONE_API_KEY = _get("PINECONE_API_KEY")
PINECONE_INDEX_NAME = _get("PINECONE_INDEX_NAME", "tosdr-taxonomy")
PINECONE_CLOUD = _get("PINECONE_CLOUD", "aws")
PINECONE_REGION = _get("PINECONE_REGION", "us-east-1")

# --- Supabase (optional for now; needed once we build the stores) ---
SUPABASE_URL = _get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _get("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = _get("SUPABASE_ANON_KEY")


# Required to do anything at all right now (taxonomy fetch + embedding).
_REQUIRED = {
    "LLMOD_API_KEY": LLMOD_API_KEY,
    "LLMOD_BASE_URL": LLMOD_BASE_URL,
    "PINECONE_API_KEY": PINECONE_API_KEY,
}

_missing = [name for name, val in _REQUIRED.items() if not val]
if _missing:
    raise RuntimeError(
        "Missing required environment variables: "
        + ", ".join(_missing)
        + "\nFill them in your .env file (see .env.example)."
    )


def summary() -> None:
    """Print which vars loaded — names only, never values."""
    all_vars = {
        "LLMOD_API_KEY": LLMOD_API_KEY,
        "LLMOD_BASE_URL": LLMOD_BASE_URL,
        "LLMOD_TEXT_MODEL": LLMOD_TEXT_MODEL,
        "LLMOD_EMBED_MODEL": LLMOD_EMBED_MODEL,
        "PINECONE_API_KEY": PINECONE_API_KEY,
        "PINECONE_INDEX_NAME": PINECONE_INDEX_NAME,
        "PINECONE_CLOUD": PINECONE_CLOUD,
        "PINECONE_REGION": PINECONE_REGION,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
        "SUPABASE_ANON_KEY": SUPABASE_ANON_KEY,
    }
    print("Config loaded:")
    for name, val in all_vars.items():
        print(f"  [{'x' if val else ' '}] {name}")


if __name__ == "__main__":
    summary()
