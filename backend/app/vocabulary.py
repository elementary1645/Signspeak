"""Human review is an explicit data requirement, never inferred from a word match."""
from datetime import date
import hashlib
import json
from typing import Literal
from urllib.parse import urlparse
from pydantic import BaseModel, ConfigDict, Field, model_validator


def check_reference_url(url):
    """Shared by hands-v1 and hp-v1 gates: one exact HTTPS entry, never an index/channel."""
    source = urlparse(url)
    if source.scheme != 'https' or not source.hostname or source.username or source.password:
        raise ValueError('An exact HTTPS reference URL is required')
    if source.path.rstrip('/').endswith(('listpage.php', 'index.php', 'isl-dictionary')) or '/channel/' in source.path:
        raise ValueError('Use an exact entry/video reference, not an index or channel')


class SignReview(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    label: str = Field(pattern=r'^[A-Z][A-Z0-9_]{0,47}$')
    verified: bool
    static: bool
    hand_count: Literal[1, 2]
    reference_id: str = Field(min_length=1, max_length=200)
    reference_url: str = Field(min_length=1, max_length=1000)
    reviewer: str = Field(pattern=r'^[A-Za-z0-9_-]{1,48}$')
    reviewed_on: str
    human_inspected: Literal[True]
    official_source_confirmed: Literal[True]
    motion_required: bool
    facial_cues_required: bool
    body_cues_required: bool
    relative_hand_position_required: bool
    hands_v1_suitable: bool
    notes: str = Field(min_length=10, max_length=4000)

    @model_validator(mode='after')
    def admission(self):
        reviewed = date.fromisoformat(self.reviewed_on)
        if reviewed > date.today():
            raise ValueError('Review date cannot be in the future')
        check_reference_url(self.reference_url)
        # Provenance of YouTube/Drive entries is attested by the human, not inferred by URL.
        if self.verified and (not self.static or self.motion_required or self.facial_cues_required
                or self.body_cues_required or self.relative_hand_position_required or not self.hands_v1_suitable):
            raise ValueError('Cannot admit a sign requiring cues absent from hands-v1')
        return self


def verified_entries(entries):
    if not isinstance(entries, list):
        raise ValueError('Vocabulary registry must be a list')
    admitted = {}
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('label'), str):
            raise ValueError('Malformed vocabulary entry')
        if entry['label'] in seen:
            raise ValueError('Duplicate vocabulary label')
        seen.add(entry['label'])
        # hp-v1 entries have their own gate (backend/live/vocab.py); never admit them here.
        if entry.get('pipeline', 'hands-v1') != 'hands-v1' or entry.get('verified') is not True:
            continue
        review = SignReview.model_validate(entry)
        admitted[review.label] = review.model_dump()
    return admitted


def fingerprint(entries):
    return hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
