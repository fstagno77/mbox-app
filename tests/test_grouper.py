import mailbox
import os
import pytest

from pec_parser.pec_extractor import parse_pec_message
from pec_parser.grouper import group_emails

MBOX_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test.mbox")


@pytest.fixture
def parsed_emails():
    mbox = mailbox.mbox(MBOX_PATH)
    results = []
    for i, msg in enumerate(mbox):
        parsed = parse_pec_message(msg, i)
        if parsed:
            results.append(parsed)
    mbox.close()
    return results


def test_grouping_produces_groups(parsed_emails):
    groups = group_emails(parsed_emails)
    assert len(groups) > 0


def test_all_emails_assigned(parsed_emails):
    groups = group_emails(parsed_emails)
    all_ids = set()
    for g in groups:
        for eid in g.email_ids:
            assert eid not in all_ids, "Email {} in multiple groups".format(eid)
            all_ids.add(eid)
    assert len(all_ids) == 19


def test_multi_email_groups_exist(parsed_emails):
    groups = group_emails(parsed_emails)
    multi = [g for g in groups if len(g.email_ids) > 1]
    assert len(multi) >= 2, "Expected at least 2 multi-email groups"


def test_group_count_reasonable(parsed_emails):
    groups = group_emails(parsed_emails)
    # Should be roughly 8-14 groups
    assert 5 <= len(groups) <= 17
