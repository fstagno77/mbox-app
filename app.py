"""Flask web application for PEC email catalog."""

import os
from flask import Flask, render_template, jsonify, request, send_from_directory, abort

from storage.json_store import load_catalog, load_email, delete_source
from pec_parser.mbox_reader import process_mbox, process_mbox_incremental
import config
from werkzeug.utils import secure_filename

app = Flask(__name__)


def ensure_catalog():
    """Parse mbox if catalog doesn't exist yet."""
    if not os.path.exists(config.CATALOG_PATH):
        process_mbox()


@app.route("/")
def index():
    ensure_catalog()
    return render_template("index.html")


@app.route("/api/catalog")
def api_catalog():
    ensure_catalog()
    catalog = load_catalog()
    if catalog is None:
        return jsonify({"error": "No catalog found"}), 404
    return jsonify(catalog)


@app.route("/api/email/<email_id>")
def api_email(email_id):
    data = load_email(email_id)
    if data is None:
        return jsonify({"error": "Email not found"}), 404
    return jsonify(data)


@app.route("/api/search")
def api_search():
    query = request.args.get("q", "").strip().lower()
    if not query:
        return jsonify({"results": []})

    catalog = load_catalog()
    if catalog is None:
        return jsonify({"results": []})

    # Flatten emails_summary from all sources
    all_summaries = []
    for source in catalog.get("sources", []):
        all_summaries.extend(source.get("emails_summary", []))

    results = []
    seen = set()
    for summary in all_summaries:
        if summary["email_id"] in seen:
            continue
        # Search in subject, sender, clean_subject
        searchable = " ".join([
            summary.get("subject", ""),
            summary.get("sender", ""),
            summary.get("clean_subject", ""),
        ]).lower()

        if query in searchable:
            results.append(summary)
            seen.add(summary["email_id"])
            continue

        # Also search in body text
        email_data = load_email(summary["email_id"])
        if email_data:
            body = " ".join(filter(None, [
                email_data.get("body_text", ""),
                email_data.get("body_html", ""),
            ])).lower()
            if query in body:
                results.append(summary)
                seen.add(summary["email_id"])

    return jsonify({"results": results})


@app.route("/attachment/<email_id>/<filename>")
def download_attachment(email_id, filename):
    att_dir = os.path.join(config.ATTACHMENTS_DIR, email_id)
    if not os.path.isdir(att_dir):
        abort(404)
    # Security: ensure filename doesn't escape the directory
    safe_path = os.path.join(att_dir, filename)
    if not os.path.abspath(safe_path).startswith(os.path.abspath(att_dir)):
        abort(403)
    if not os.path.exists(safe_path):
        abort(404)
    return send_from_directory(att_dir, filename, as_attachment=True)


@app.route("/inline/<email_id>/<filename>")
def inline_attachment(email_id, filename):
    att_dir = os.path.join(config.ATTACHMENTS_DIR, email_id)
    if not os.path.isdir(att_dir):
        abort(404)
    safe_path = os.path.join(att_dir, filename)
    if not os.path.abspath(safe_path).startswith(os.path.abspath(att_dir)):
        abort(403)
    if not os.path.exists(safe_path):
        abort(404)
    return send_from_directory(att_dir, filename, as_attachment=False)


@app.route("/api/reparse", methods=["POST"])
def api_reparse():
    """Force re-parse the mbox file."""
    import shutil
    if os.path.exists(config.DATA_DIR):
        shutil.rmtree(config.DATA_DIR)
    process_mbox()
    return jsonify({"status": "ok"})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """Accept an uploaded .mbox file, save it, and add as new source."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.endswith(".mbox"):
        return jsonify({"error": "Only .mbox files are accepted"}), 400

    filename = secure_filename(f.filename)
    os.makedirs(config.UPLOADS_DIR, exist_ok=True)
    save_path = os.path.join(config.UPLOADS_DIR, filename)
    f.save(save_path)

    new_emails, source_entry = process_mbox_incremental(save_path)

    return jsonify({
        "status": "ok",
        "new_emails": len(new_emails),
        "source_id": source_entry["source_id"],
        "source_file": source_entry["source_file"],
        "uploaded_at": source_entry["uploaded_at"],
    })


@app.route("/api/sources")
def api_sources():
    """Return list of sources with id, file, date, count."""
    catalog = load_catalog()
    if catalog is None:
        return jsonify({"sources": []})

    sources = []
    for s in catalog.get("sources", []):
        sources.append({
            "source_id": s["source_id"],
            "source_file": s["source_file"],
            "uploaded_at": s.get("uploaded_at", ""),
            "email_count": s["email_count"],
        })
    return jsonify({"sources": sources})


@app.route("/api/sources/<source_id>", methods=["DELETE"])
def api_delete_source(source_id):
    """Delete a source and all its exclusive data."""
    deleted = delete_source(source_id)
    if not deleted:
        return jsonify({"error": "Source not found"}), 404
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
