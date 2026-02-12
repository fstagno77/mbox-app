import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MBOX_PATH = os.path.join(BASE_DIR, "test.mbox")
DATA_DIR = os.path.join(BASE_DIR, "data")
CATALOG_PATH = os.path.join(DATA_DIR, "catalog.json")
EMAILS_DIR = os.path.join(DATA_DIR, "emails")
ATTACHMENTS_DIR = os.path.join(DATA_DIR, "attachments")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")

GROUPING_THRESHOLD = 0.85
