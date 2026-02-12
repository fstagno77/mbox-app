from pec_parser.encoding_utils import (
    decode_header_value,
    extract_email_address,
    safe_filename,
)


def test_decode_plain_header():
    assert decode_header_value("Hello World") == "Hello World"


def test_decode_none():
    assert decode_header_value(None) == ""


def test_decode_rfc2047_utf8():
    raw = "=?UTF-8?Q?POSTA_CERTIFICATA:_Re:_caf=C3=A8?="
    result = decode_header_value(raw)
    assert "POSTA CERTIFICATA" in result
    assert "caffè" in result or "cafè" in result


def test_decode_rfc2047_base64():
    raw = "=?UTF-8?B?UE9TVEEgQ0VSVElGSUNBVEE=?="
    result = decode_header_value(raw)
    assert result == "POSTA CERTIFICATA"


def test_extract_email_address_with_name():
    assert extract_email_address("John Doe <john@example.com>") == "john@example.com"


def test_extract_email_address_bare():
    assert extract_email_address("john@example.com") == "john@example.com"


def test_extract_email_address_none():
    assert extract_email_address(None) == ""


def test_safe_filename_special_chars():
    result = safe_filename('file<>:name?.pdf')
    assert "<" not in result
    assert ">" not in result
    assert "?" not in result
    assert result.endswith(".pdf")


def test_safe_filename_rfc2047():
    raw = "=?utf-8?Q?documento=5Fsigned.pdf?="
    result = safe_filename(raw)
    assert "documento" in result
    assert result.endswith(".pdf")


def test_safe_filename_none():
    assert safe_filename(None) == "unnamed"
