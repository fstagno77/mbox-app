import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MBOX_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test.mbox")


@pytest.fixture
def mbox_path():
    return MBOX_PATH
