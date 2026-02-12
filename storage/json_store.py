"""Save/load catalog and email data as JSON files."""

import hashlib
import json
import os
import shutil
from datetime import datetime
from typing import List, Optional, Dict

from pec_parser.models import ParsedEmail, EmailGroup
import config


def generate_source_id(source_file: str) -> str:
    """Generate a unique source ID from filename + timestamp."""
    raw = source_file + datetime.now().isoformat()
    return "src_" + hashlib.md5(raw.encode()).hexdigest()[:12]


def save_catalog(sources: List[Dict]):
    """Save the full hierarchical catalog: catalog.json + individual email JSONs.

    Each source dict must have:
        source_id, source_file, uploaded_at, email_count,
        groups (list of group dicts), emails_summary (list of summary dicts),
        _emails (list of ParsedEmail objects, used to write individual JSONs, then stripped)
    """
    os.makedirs(config.DATA_DIR, exist_ok=True)
    os.makedirs(config.EMAILS_DIR, exist_ok=True)

    total_emails = sum(s["email_count"] for s in sources)

    # Write individual email JSONs (dedup by email_id)
    written = set()
    for source in sources:
        for email in source.pop("_emails", []):
            if email.email_id not in written:
                path = os.path.join(config.EMAILS_DIR, email.email_id + ".json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(email.to_dict(), f, ensure_ascii=False, indent=2)
                written.add(email.email_id)

    catalog = {
        "total_emails": total_emails,
        "total_sources": len(sources),
        "sources": sources,
    }

    with open(config.CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)


def load_catalog() -> Optional[Dict]:
    """Load catalog.json if it exists."""
    if not os.path.exists(config.CATALOG_PATH):
        return None
    with open(config.CATALOG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_email(email_id: str) -> Optional[Dict]:
    """Load a single email JSON by ID."""
    path = os.path.join(config.EMAILS_DIR, email_id + ".json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def delete_source(source_id: str) -> bool:
    """Delete a source and its exclusive email data.

    1. Load catalog, find and remove the source
    2. Collect email_ids exclusive to the removed source
    3. Delete their JSON files and attachment dirs
    4. Delete uploaded .mbox file if it exists
    5. Save updated catalog
    Returns True if source was found and deleted.
    """
    catalog = load_catalog()
    if catalog is None:
        return False

    sources = catalog.get("sources", [])
    target = None
    remaining = []
    for s in sources:
        if s["source_id"] == source_id:
            target = s
        else:
            remaining.append(s)

    if target is None:
        return False

    # email_ids in the removed source
    removed_ids = set()
    for summary in target.get("emails_summary", []):
        removed_ids.add(summary["email_id"])

    # email_ids still referenced by remaining sources
    kept_ids = set()
    for s in remaining:
        for summary in s.get("emails_summary", []):
            kept_ids.add(summary["email_id"])

    # Only delete emails exclusive to the removed source
    exclusive_ids = removed_ids - kept_ids
    for eid in exclusive_ids:
        email_path = os.path.join(config.EMAILS_DIR, eid + ".json")
        if os.path.exists(email_path):
            os.remove(email_path)
        att_dir = os.path.join(config.ATTACHMENTS_DIR, eid)
        if os.path.isdir(att_dir):
            shutil.rmtree(att_dir)

    # Delete uploaded .mbox file
    mbox_path = os.path.join(config.UPLOADS_DIR, target["source_file"])
    if os.path.exists(mbox_path):
        os.remove(mbox_path)

    # Save updated catalog
    catalog["sources"] = remaining
    catalog["total_sources"] = len(remaining)
    catalog["total_emails"] = sum(s["email_count"] for s in remaining)

    with open(config.CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    return True
