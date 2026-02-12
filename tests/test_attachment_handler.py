import mailbox
import os
import shutil
import pytest

from pec_parser.pec_extractor import parse_pec_message, _find_pec_parts
from pec_parser.attachment_handler import save_attachments
import config

MBOX_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test.mbox")


@pytest.fixture
def clean_attachments():
    """Clean attachment directory before/after test."""
    if os.path.exists(config.ATTACHMENTS_DIR):
        shutil.rmtree(config.ATTACHMENTS_DIR)
    os.makedirs(config.ATTACHMENTS_DIR, exist_ok=True)
    yield
    # Don't clean after — let test_json_store use them


def test_save_attachments(clean_attachments):
    mbox = mailbox.mbox(MBOX_PATH)
    total_saved = 0
    for i, msg in enumerate(mbox):
        parsed = parse_pec_message(msg, i)
        if parsed and parsed.attachments:
            _, inner_msg = _find_pec_parts(msg)
            if inner_msg:
                saved = save_attachments(inner_msg, parsed.email_id)
                total_saved += len(saved)
                # Verify files exist on disk
                att_dir = os.path.join(config.ATTACHMENTS_DIR, parsed.email_id)
                for fname in saved:
                    fpath = os.path.join(att_dir, fname)
                    assert os.path.exists(fpath), "Attachment {} not found".format(fpath)
                    assert os.path.getsize(fpath) > 0
    mbox.close()
    assert total_saved >= 1, "Expected at least 1 attachment saved"
