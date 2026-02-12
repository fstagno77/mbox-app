"""Extract and save email attachments to disk."""

import os
from typing import List

from pec_parser.encoding_utils import safe_filename
from pec_parser.pec_extractor import PEC_INFRA_FILES
import config


def save_attachments(inner_msg, email_id: str) -> List[str]:
    """Extract attachments from inner email and save to data/attachments/<email_id>/."""
    att_dir = os.path.join(config.ATTACHMENTS_DIR, email_id)
    saved = []

    if not inner_msg.is_multipart():
        return saved

    for part in inner_msg.walk():
        if part.get_content_maintype() == "multipart":
            continue

        filename = part.get_filename()
        if not filename:
            # Check if it's an inline image with Content-ID
            cd = str(part.get("Content-Disposition", ""))
            cid = part.get("Content-ID", "")
            if "inline" in cd.lower() and part.get_content_type().startswith("image/"):
                ext = part.get_content_type().split("/")[1]
                filename = "inline_{}".format(cid.strip("<>") or "image") + "." + ext
            else:
                continue

        if filename.lower() in PEC_INFRA_FILES:
            continue

        safe_name = safe_filename(filename)
        payload = part.get_payload(decode=True)
        if payload is None:
            continue

        os.makedirs(att_dir, exist_ok=True)

        # Handle duplicate filenames
        target = os.path.join(att_dir, safe_name)
        if os.path.exists(target):
            base, ext = os.path.splitext(safe_name)
            counter = 1
            while os.path.exists(target):
                target = os.path.join(att_dir, "{}_{:d}{}".format(base, counter, ext))
                counter += 1

        with open(target, "wb") as f:
            f.write(payload)
        saved.append(os.path.basename(target))

    return saved
