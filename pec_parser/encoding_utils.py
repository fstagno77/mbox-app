import re
from typing import Optional, List
from email.header import decode_header
from email.utils import parseaddr, getaddresses


def decode_header_value(raw: Optional[str]) -> str:
    """Decode an RFC 2047 encoded header value to a Unicode string."""
    if not raw:
        return ""
    parts = decode_header(raw)
    decoded_parts = []
    for data, charset in parts:
        if isinstance(data, bytes):
            decoded_parts.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            decoded_parts.append(data)
    return "".join(decoded_parts).strip()


def decode_payload(part) -> str:
    """Decode an email part's payload to a Unicode string."""
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")


def extract_email_address(raw: Optional[str]) -> str:
    """Extract just the email address from a header like 'Name <addr>'."""
    if not raw:
        return ""
    decoded = decode_header_value(raw)
    _, addr = parseaddr(decoded)
    return addr or decoded


def extract_all_recipients(msg) -> List[str]:
    """Extract all recipient addresses from To and Cc headers."""
    addrs = []
    for header_name in ("To", "Cc"):
        raw = msg.get(header_name, "")
        if raw:
            decoded = decode_header_value(raw)
            for _, addr in getaddresses([decoded]):
                if addr:
                    addrs.append(addr)
    return addrs


def safe_filename(name: Optional[str]) -> str:
    """Sanitize a filename for safe filesystem storage."""
    if not name:
        return "unnamed"
    decoded = decode_header_value(name)
    decoded = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", decoded)
    decoded = decoded.strip(". ")
    return decoded or "unnamed"
