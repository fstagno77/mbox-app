from pec_parser.subject_cleaner import clean_subject


def test_strip_posta_certificata():
    assert clean_subject("POSTA CERTIFICATA: Hello World") == "Hello World"


def test_strip_re():
    assert clean_subject("Re: Hello World") == "Hello World"


def test_strip_r():
    assert clean_subject("R: Hello World") == "Hello World"


def test_strip_re_re():
    result = clean_subject("Re: Re:Oggetto: test message")
    assert result == "test message"


def test_collapse_whitespace():
    result = clean_subject("Subject with\r\n tabs\tand spaces")
    assert "\r" not in result
    assert "\n" not in result
    assert "\t" not in result


def test_empty():
    assert clean_subject("") == ""


def test_combined_prefix():
    result = clean_subject("POSTA CERTIFICATA: Re: Something")
    assert result == "Something"
