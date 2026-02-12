from dataclasses import dataclass, field, asdict
from typing import Optional, List


@dataclass
class Attachment:
    filename: str
    content_type: str
    size: int
    content_id: Optional[str] = None
    is_inline: bool = False

    def to_dict(self):
        return asdict(self)


@dataclass
class ParsedEmail:
    email_id: str
    message_id: str
    subject: str
    sender: str
    recipients: List[str]
    date: str
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    attachments: List[Attachment] = field(default_factory=list)
    pec_provider: Optional[str] = None
    pec_type: Optional[str] = None
    pec_date: Optional[str] = None
    clean_subject: Optional[str] = None
    source_file: Optional[str] = None

    def to_dict(self):
        d = asdict(self)
        d["attachments"] = [a.to_dict() for a in self.attachments]
        return d


@dataclass
class EmailGroup:
    group_id: str
    label: str
    email_ids: List[str] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)
