import os
import shutil
import pytest

import config
from pec_parser.mbox_reader import process_mbox

# Ensure data exists before importing app
MBOX_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test.mbox")


@pytest.fixture(scope="module")
def client():
    """Create test client and ensure catalog exists."""
    if not os.path.exists(config.CATALOG_PATH):
        process_mbox(MBOX_PATH)

    from app import app
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_index(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"PEC" in resp.data


def test_api_catalog(client):
    resp = client.get("/api/catalog")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["total_emails"] == 19
    assert "sources" in data
    assert len(data["sources"]) >= 1
    # Each source must have groups and emails_summary
    source = data["sources"][0]
    assert "groups" in source
    assert "emails_summary" in source
    assert "source_id" in source
    assert "source_file" in source
    assert source["email_count"] == 19


def test_api_email(client):
    resp = client.get("/api/catalog")
    catalog = resp.get_json()
    email_id = catalog["sources"][0]["emails_summary"][0]["email_id"]

    resp = client.get("/api/email/{}".format(email_id))
    assert resp.status_code == 200
    data = resp.get_json()
    assert "subject" in data
    assert "body_text" in data or "body_html" in data


def test_api_email_not_found(client):
    resp = client.get("/api/email/nonexistent")
    assert resp.status_code == 404


def test_api_search(client):
    resp = client.get("/api/search?q=pec")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "results" in data


def test_api_search_empty(client):
    resp = client.get("/api/search?q=")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["results"] == []


def test_attachment_not_found(client):
    resp = client.get("/attachment/nonexistent/file.pdf")
    assert resp.status_code == 404


def test_api_sources(client):
    resp = client.get("/api/sources")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "sources" in data
    assert len(data["sources"]) >= 1
    for src in data["sources"]:
        assert "source_id" in src
        assert "source_file" in src
        assert "uploaded_at" in src
        assert "email_count" in src
        assert src["email_count"] > 0


def test_api_upload_no_file(client):
    resp = client.post("/api/upload")
    assert resp.status_code == 400
    data = resp.get_json()
    assert "error" in data


def test_api_upload_wrong_extension(client):
    import io
    data = {"file": (io.BytesIO(b"not an mbox"), "test.txt")}
    resp = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_api_upload_mbox(client):
    """Upload the same test.mbox and verify it creates a new source."""
    with open(MBOX_PATH, "rb") as f:
        data = {"file": (f, "uploaded.mbox")}
        resp = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert resp.status_code == 200
    result = resp.get_json()
    assert result["status"] == "ok"
    assert result["new_emails"] == 19
    assert result["source_file"] == "uploaded.mbox"
    assert "source_id" in result
    assert "uploaded_at" in result


def test_api_delete_source(client):
    """Upload an mbox, then delete the source, verify it's gone."""
    with open(MBOX_PATH, "rb") as f:
        data = {"file": (f, "to_delete.mbox")}
        resp = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert resp.status_code == 200
    source_id = resp.get_json()["source_id"]

    # Verify source exists in catalog
    resp = client.get("/api/catalog")
    catalog = resp.get_json()
    source_ids = [s["source_id"] for s in catalog["sources"]]
    assert source_id in source_ids

    # Delete it
    resp = client.delete("/api/sources/{}".format(source_id))
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"

    # Verify it's gone
    resp = client.get("/api/catalog")
    catalog = resp.get_json()
    source_ids = [s["source_id"] for s in catalog["sources"]]
    assert source_id not in source_ids


def test_api_delete_source_not_found(client):
    resp = client.delete("/api/sources/nonexistent")
    assert resp.status_code == 404


def test_catalog_has_source_file(client):
    resp = client.get("/api/catalog")
    data = resp.get_json()
    for source in data["sources"]:
        for summary in source["emails_summary"]:
            assert "source_file" in summary
