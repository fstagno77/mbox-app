"""Group emails by subject similarity."""

import difflib
import hashlib
from typing import List, Dict

from pec_parser.models import ParsedEmail, EmailGroup
from pec_parser.subject_cleaner import clean_subject
import config


def group_emails(emails: List[ParsedEmail]) -> List[EmailGroup]:
    """Group emails by cleaned subject similarity."""
    threshold = config.GROUPING_THRESHOLD

    # First, clean all subjects
    for email in emails:
        email.clean_subject = clean_subject(email.subject)

    # Group by exact match first
    exact_groups: Dict[str, List[ParsedEmail]] = {}
    for email in emails:
        key = email.clean_subject.lower()
        if key not in exact_groups:
            exact_groups[key] = []
        exact_groups[key].append(email)

    # Now merge fuzzy-similar groups
    group_keys = list(exact_groups.keys())
    merged = [False] * len(group_keys)
    result_groups: List[List[ParsedEmail]] = []

    for i, key_i in enumerate(group_keys):
        if merged[i]:
            continue
        current = list(exact_groups[key_i])
        merged[i] = True

        for j in range(i + 1, len(group_keys)):
            if merged[j]:
                continue
            ratio = difflib.SequenceMatcher(None, key_i, group_keys[j]).ratio()
            if ratio >= threshold:
                current.extend(exact_groups[group_keys[j]])
                merged[j] = True

        result_groups.append(current)

    # Sort groups: multi-email groups first, then singletons; within each, by date
    result_groups.sort(key=lambda g: (-len(g), g[0].date))

    # Build EmailGroup objects
    output = []
    for emails_in_group in result_groups:
        # Use the longest clean subject as the group label
        label = max(
            (e.clean_subject for e in emails_in_group),
            key=len,
        )
        group_id = "group_" + hashlib.md5(label.encode("utf-8", errors="replace")).hexdigest()[:8]
        email_ids = [e.email_id for e in emails_in_group]
        output.append(EmailGroup(group_id=group_id, label=label, email_ids=email_ids))

    return output
