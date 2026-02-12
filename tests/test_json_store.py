import os
import json
import shutil
import pytest

from pec_parser.mbox_reader import process_mbox
from storage.json_store import load_catalog, load_email
import config

MBOX_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test.mbox")


@pytest.fixture(scope="module")
def processed():
    """Process mbox once for all tests in this module."""
    # Clean data dir
    if os.path.exists(config.DATA_DIR):
        shutil.rmtree(config.DATA_DIR)
    emails, sources = process_mbox(MBOX_PATH)
    return emails, sources


def test_catalog_created(processed):
    assert os.path.exists(config.CATALOG_PATH)


def test_catalog_content(processed):
    catalog = load_catalog()
    assert catalog is not None
    assert catalog["total_emails"] == 19
    assert catalog["total_sources"] >= 1
    source = catalog["sources"][0]
    assert len(source["groups"]) >= 5


def test_individual_emails_saved(processed):
    emails, _ = processed
    for email in emails:
        path = os.path.join(config.EMAILS_DIR, email.email_id + ".json")
        assert os.path.exists(path), "Missing JSON for {}".format(email.email_id)


def test_load_email(processed):
    emails, _ = processed
    data = load_email(emails[0].email_id)
    assert data is not None
    assert "subject" in data
    assert "sender" in data


def test_load_nonexistent():
    data = load_email("nonexistent_id")
    assert data is None
