"""Strip PEC prefixes, Re:/R:, normalize whitespace for subject grouping."""

import re


# Patterns to strip from the beginning (case-insensitive)
_PREFIX_RE = re.compile(
    r"^(?:POSTA\s+CERTIFICATA:\s*|(?:Re|R|Fwd|I|Oggetto)\s*:\s*)+",
    re.IGNORECASE,
)

# Collapse all whitespace (including \r\n, tabs) to single space
_WHITESPACE_RE = re.compile(r"\s+")


def clean_subject(subject: str) -> str:
    """Clean a subject line for grouping: strip prefixes, normalize whitespace."""
    if not subject:
        return ""
    # Collapse whitespace first
    cleaned = _WHITESPACE_RE.sub(" ", subject).strip()
    # Strip Re:/R:/POSTA CERTIFICATA: prefixes (repeatedly)
    cleaned = _PREFIX_RE.sub("", cleaned).strip()
    return cleaned
