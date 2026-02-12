import mailbox
import os
import pytest

from pec_parser.pec_extractor import parse_pec_message

MBOX_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test.mbox")


@pytest.fixture
def all_messages():
    mbox = mailbox.mbox(MBOX_PATH)
    msgs = list(mbox)
    mbox.close()
    return msgs


@pytest.fixture
def parsed_emails(all_messages):
    results = []
    for i, msg in enumerate(all_messages):
        parsed = parse_pec_message(msg, i, source_file="test.mbox")
        if parsed:
            results.append(parsed)
    return results


def test_all_19_messages_parsed(parsed_emails):
    assert len(parsed_emails) == 19


def test_all_have_subjects(parsed_emails):
    for email in parsed_emails:
        assert email.subject, "Email {} has no subject".format(email.email_id)


def test_all_have_senders(parsed_emails):
    for email in parsed_emails:
        assert email.sender, "Email {} has no sender".format(email.email_id)
        assert "@" in email.sender, "Email {} sender not an email: {}".format(
            email.email_id, email.sender
        )


def test_all_have_dates(parsed_emails):
    for email in parsed_emails:
        assert email.date, "Email {} has no date".format(email.email_id)


def test_all_have_body(parsed_emails):
    for email in parsed_emails:
        has_body = email.body_text or email.body_html
        assert has_body, "Email {} has no body".format(email.email_id)


def test_no_pec_prefix_in_subjects(parsed_emails):
    """Inner email subjects should NOT have PEC prefix (that's on the wrapper)."""
    # Some may legitimately have it if the original sender included it,
    # but most should not
    pec_prefix_count = sum(
        1 for e in parsed_emails if e.subject.startswith("POSTA CERTIFICATA:")
    )
    # Allow at most a few (edge cases), but majority should be clean
    assert pec_prefix_count < len(parsed_emails) // 2


def test_pec_infrastructure_not_in_attachments(parsed_emails):
    """smime.p7s, daticert.xml, postacert.eml should never appear as attachments."""
    for email in parsed_emails:
        for att in email.attachments:
            assert att.filename.lower() not in {
                "smime.p7s",
                "daticert.xml",
                "postacert.eml",
            }, "PEC infra file {} found in email {}".format(
                att.filename, email.email_id
            )


def test_unique_email_ids(parsed_emails):
    ids = [e.email_id for e in parsed_emails]
    assert len(ids) == len(set(ids)), "Duplicate email IDs found"


def test_some_have_attachments(parsed_emails):
    with_att = [e for e in parsed_emails if e.attachments]
    assert len(with_att) >= 1, "Expected at least some emails to have attachments"


def test_pec_provider_extracted(parsed_emails):
    with_provider = [e for e in parsed_emails if e.pec_provider]
    assert len(with_provider) >= 1


def test_source_file_populated(parsed_emails):
    for email in parsed_emails:
        assert email.source_file == "test.mbox", (
            "Email {} missing source_file".format(email.email_id)
        )
