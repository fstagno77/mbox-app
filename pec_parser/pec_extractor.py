"""Core PEC MIME navigation: extract real email content from PEC wrappers."""

import hashlib
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from typing import Optional, Tuple, Dict, List

from pec_parser.encoding_utils import (
    decode_header_value,
    decode_payload,
    extract_email_address,
    extract_all_recipients,
    safe_filename,
)
from pec_parser.models import ParsedEmail, Attachment


# PEC infrastructure files to skip as attachments
PEC_INFRA_FILES = {"smime.p7s", "daticert.xml", "postacert.eml"}


def parse_pec_message(msg, index: int, source_file: str = "") -> Optional[ParsedEmail]:
    """Parse a PEC-wrapped email message and return a ParsedEmail."""
    email_id = "email_{:03d}".format(index)

    # Navigate PEC structure to find daticert.xml and postacert.eml
    daticert_part, inner_msg = _find_pec_parts(msg)

    # Parse daticert.xml for PEC metadata
    pec_meta = _parse_daticert(daticert_part) if daticert_part else {}

    if inner_msg is None:
        # Fallback: treat outer message as the email
        inner_msg = msg

    # Extract headers from inner message
    subject = decode_header_value(inner_msg.get("Subject", ""))
    sender = extract_email_address(inner_msg.get("From", ""))
    recipients = extract_all_recipients(inner_msg)
    message_id = inner_msg.get("Message-ID", "") or msg.get("Message-ID", "")
    date_str = inner_msg.get("Date", "") or msg.get("Date", "")

    # Parse date
    date_display = date_str
    try:
        dt = parsedate_to_datetime(date_str)
        date_display = dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        pass

    # Extract body and attachments from inner message
    body_text, body_html, attachments = _extract_body_and_attachments(inner_msg)

    # Use email_id as a stable hash-based id
    raw_id = message_id or "{}_{}_{}".format(sender, subject, date_str)
    stable_id = "email_" + hashlib.md5(raw_id.encode("utf-8", errors="replace")).hexdigest()[:12]

    return ParsedEmail(
        email_id=stable_id,
        message_id=message_id,
        subject=subject,
        sender=sender,
        recipients=recipients,
        date=date_display,
        body_text=body_text,
        body_html=body_html,
        attachments=attachments,
        pec_provider=pec_meta.get("gestore"),
        pec_type=pec_meta.get("tipo"),
        pec_date=pec_meta.get("data"),
        source_file=source_file or None,
    )


def _find_pec_parts(msg) -> Tuple[Optional[object], Optional[object]]:
    """Navigate PEC MIME tree to find daticert.xml and postacert.eml parts."""
    daticert = None
    postacert = None

    # The outer message is typically multipart/signed
    # Inside is multipart/mixed containing the PEC parts
    mixed_part = _find_mixed_part(msg)
    if mixed_part is None:
        mixed_part = msg

    if not mixed_part.is_multipart():
        return None, None

    for part in mixed_part.get_payload():
        filename = part.get_filename("")
        ct = part.get_content_type()

        if filename == "daticert.xml" or (ct == "application/xml" and not filename):
            daticert = part
        elif filename == "postacert.eml" or ct == "message/rfc822":
            # For message/rfc822, get_payload() returns a list with the inner message
            payload = part.get_payload()
            if isinstance(payload, list) and len(payload) > 0:
                postacert = payload[0]
            elif not isinstance(payload, list):
                postacert = part

    return daticert, postacert


def _find_mixed_part(msg):
    """Find the multipart/mixed part inside the PEC structure."""
    if msg.get_content_type() == "multipart/mixed":
        return msg
    if msg.is_multipart():
        for part in msg.get_payload():
            if part.get_content_type() == "multipart/mixed":
                return part
            # Recurse one more level (e.g., multipart/signed → multipart/mixed)
            if part.is_multipart():
                for sub in part.get_payload():
                    if sub.get_content_type() == "multipart/mixed":
                        return sub
    return None


def _parse_daticert(part) -> Dict[str, str]:
    """Parse daticert.xml to extract PEC metadata."""
    meta = {}
    try:
        xml_data = part.get_payload(decode=True)
        if xml_data is None:
            return meta
        root = ET.fromstring(xml_data)

        meta["tipo"] = root.get("tipo", "")
        meta["errore"] = root.get("errore", "")

        # intestazione
        intestazione = root.find("intestazione")
        if intestazione is not None:
            mittente = intestazione.find("mittente")
            if mittente is not None and mittente.text:
                meta["mittente"] = mittente.text.strip()
            oggetto = intestazione.find("oggetto")
            if oggetto is not None and oggetto.text:
                meta["oggetto"] = oggetto.text.strip()

        # dati
        dati = root.find("dati")
        if dati is not None:
            gestore = dati.find("gestore-emittente")
            if gestore is not None and gestore.text:
                meta["gestore"] = gestore.text.strip()
            data_el = dati.find("data")
            if data_el is not None:
                giorno = data_el.find("giorno")
                ora = data_el.find("ora")
                if giorno is not None and ora is not None:
                    meta["data"] = "{} {}".format(
                        giorno.text.strip() if giorno.text else "",
                        ora.text.strip() if ora.text else "",
                    )
    except ET.ParseError:
        pass
    return meta


def _extract_body_and_attachments(msg) -> Tuple[Optional[str], Optional[str], List[Attachment]]:
    """Extract body text, body HTML, and real attachments from the inner email."""
    body_text = None
    body_html = None
    attachments = []

    if not msg.is_multipart():
        ct = msg.get_content_type()
        if ct == "text/plain":
            body_text = decode_payload(msg)
        elif ct == "text/html":
            body_html = decode_payload(msg)
        return body_text, body_html, attachments

    # Walk all parts
    for part in msg.walk():
        ct = part.get_content_type()
        cd = str(part.get("Content-Disposition", ""))
        filename = part.get_filename()

        # Skip multipart containers
        if part.get_content_maintype() == "multipart":
            continue

        # Skip PEC infrastructure files
        if filename and filename.lower() in PEC_INFRA_FILES:
            continue

        is_attachment = "attachment" in cd.lower() or (filename and "inline" not in cd.lower())
        is_inline_image = "inline" in cd.lower() and ct.startswith("image/")

        if ct == "text/plain" and not is_attachment:
            text = decode_payload(part)
            if text and (body_text is None or len(text) > len(body_text)):
                body_text = text
        elif ct == "text/html" and not is_attachment:
            html = decode_payload(part)
            if html and (body_html is None or len(html) > len(body_html)):
                body_html = html
        elif filename or is_attachment or is_inline_image:
            # It's an attachment
            safe_name = safe_filename(filename)
            payload = part.get_payload(decode=True)
            size = len(payload) if payload else 0
            content_id = part.get("Content-ID", "")
            if content_id:
                content_id = content_id.strip("<>")

            attachments.append(Attachment(
                filename=safe_name,
                content_type=ct,
                size=size,
                content_id=content_id if content_id else None,
                is_inline=is_inline_image,
            ))

    return body_text, body_html, attachments
