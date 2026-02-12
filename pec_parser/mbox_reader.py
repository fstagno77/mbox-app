"""Orchestrator: parse mbox file -> extract all data -> save to JSON."""

import mailbox
import os
from datetime import datetime

from pec_parser.pec_extractor import parse_pec_message, _find_pec_parts
from pec_parser.grouper import group_emails
from pec_parser.attachment_handler import save_attachments
from storage.json_store import save_catalog, load_catalog, generate_source_id
import config


def _build_source_entry(source_id, source_file, emails, uploaded_at=None):
    """Build a source dict from parsed emails."""
    groups = group_emails(emails)
    if uploaded_at is None:
        uploaded_at = datetime.now().strftime("%d/%m/%Y %H:%M")
    return {
        "source_id": source_id,
        "source_file": source_file,
        "uploaded_at": uploaded_at,
        "email_count": len(emails),
        "groups": [g.to_dict() for g in groups],
        "emails_summary": [
            {
                "email_id": e.email_id,
                "subject": e.subject,
                "sender": e.sender,
                "date": e.date,
                "clean_subject": e.clean_subject,
                "attachment_count": len(e.attachments),
                "pec_provider": e.pec_provider,
                "source_file": e.source_file,
            }
            for e in emails
        ],
        "_emails": emails,
    }


def _parse_mbox_emails(mbox_path):
    """Parse an mbox file and return list of ParsedEmail + source_name."""
    source_name = os.path.basename(mbox_path)
    mbox = mailbox.mbox(mbox_path)

    emails = []
    for i, msg in enumerate(mbox):
        parsed = parse_pec_message(msg, i, source_file=source_name)
        if parsed is None:
            continue

        _, inner_msg = _find_pec_parts(msg)
        if inner_msg is not None:
            save_attachments(inner_msg, parsed.email_id)

        emails.append(parsed)

    mbox.close()
    return emails, source_name


def process_mbox(mbox_path=None):
    """Parse the mbox file, create a source entry, save catalog.

    If a catalog already exists and contains a source with the same source_file,
    it gets updated. Otherwise a new source is appended.
    """
    path = mbox_path or config.MBOX_PATH
    emails, source_name = _parse_mbox_emails(path)

    catalog = load_catalog()
    existing_sources = catalog.get("sources", []) if catalog else []

    # Check if source_file already exists
    found = False
    for i, s in enumerate(existing_sources):
        if s["source_file"] == source_name:
            source_id = s["source_id"]
            uploaded_at = s["uploaded_at"]
            existing_sources[i] = _build_source_entry(
                source_id, source_name, emails, uploaded_at
            )
            found = True
            break

    if not found:
        source_id = generate_source_id(source_name)
        entry = _build_source_entry(source_id, source_name, emails)
        existing_sources.append(entry)

    save_catalog(existing_sources)
    return emails, existing_sources


def process_mbox_incremental(mbox_path):
    """Parse a new mbox, append as a NEW source to the catalog.

    Returns (new_emails, source_entry).
    """
    emails, source_name = _parse_mbox_emails(mbox_path)

    source_id = generate_source_id(source_name)
    entry = _build_source_entry(source_id, source_name, emails)

    catalog = load_catalog()
    existing_sources = catalog.get("sources", []) if catalog else []
    existing_sources.append(entry)

    save_catalog(existing_sources)

    # Return a clean copy of entry (without _emails which was popped by save_catalog)
    # Re-read the source from the saved catalog
    catalog = load_catalog()
    saved_entry = None
    for s in catalog.get("sources", []):
        if s["source_id"] == source_id:
            saved_entry = s
            break

    return emails, saved_entry
