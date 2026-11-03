"""Vocabulary gate v2 for hp-v1. Human verification stays mandatory; nothing is auto-approved.

One registry file (data/metadata/vocabulary.json) holds both pipelines. Entries with
"pipeline": "hp-v1" are handled here; the hands-v1 gate ignores them and vice versa.
hp-v1 can represent motion, body-relative and relative hand position, so those cues are
ALLOWED. It has no face landmarks, so facial_cues_required=true is still rejected.
"""
from datetime import date
import json
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.app import dataset
from backend.app.vocabulary import check_reference_url, fingerprint

PIPELINE = 'hp-v1'
NONE_LABEL = 'NONE'  # reserved: rest/idle/transition. Collected and trained, never shown or spoken.
LABEL_PATTERN = r'^[A-Z][A-Z0-9_]{0,47}$'


class LiveSignReview(BaseModel):
    """A verified hp-v1 entry. Every field is a human statement about one exact reference."""
    model_config = ConfigDict(extra='forbid', strict=True)
    label: str = Field(pattern=LABEL_PATTERN)
    pipeline: Literal['hp-v1']
    verified: Literal[True]
    reference_url: str = Field(min_length=1, max_length=1000)
    reference_id: str = Field(min_length=1, max_length=200)
    reviewer: str = Field(pattern=r'^[A-Za-z0-9_-]{1,48}$')
    reviewed_on: str
    human_inspected: Literal[True]
    official_source_confirmed: Literal[True]
    hand_count: Literal[1, 2]
    motion_required: bool
    facial_cues_required: bool
    body_cues_required: bool
    relative_hand_position_required: bool
    notes: str = Field(min_length=10, max_length=4000)
    lookup_url: Optional[str] = None

    @model_validator(mode='after')
    def admission(self):
        if self.label == NONE_LABEL:
            raise ValueError('NONE is reserved and cannot be a vocabulary sign')
        if date.fromisoformat(self.reviewed_on) > date.today():
            raise ValueError('Review date cannot be in the future')
        check_reference_url(self.reference_url)
        if self.facial_cues_required:
            raise ValueError('hp-v1 has no face landmarks: signs that require facial cues cannot be admitted')
        return self


def registry():
    entries = json.loads(dataset.VOCABULARY.read_text(encoding='utf-8'))
    if not isinstance(entries, list):
        raise ValueError('Vocabulary registry must be a list')
    return entries


def live_entries(entries=None):
    entries = registry() if entries is None else entries
    out, seen = [], set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('label'), str):
            raise ValueError('Malformed vocabulary entry')
        if entry['label'] in seen:
            raise ValueError(f'Duplicate vocabulary label {entry["label"]}')
        seen.add(entry['label'])
        if entry.get('pipeline') == PIPELINE:
            if entry['label'] == NONE_LABEL:
                raise ValueError('NONE is reserved and cannot be a vocabulary sign')
            out.append(entry)
    return out


def verified(entries=None):
    """{label: entry} for verified hp-v1 signs. An invalid 'verified' entry fails closed."""
    admitted = {}
    for entry in live_entries(entries):
        if entry.get('verified') is True:
            admitted[entry['label']] = LiveSignReview.model_validate(entry).model_dump()
    return admitted


def has_exact_reference(entry):
    try:
        check_reference_url(entry.get('reference_url') or '')
        return True
    except ValueError:
        return False


def collectable(entries=None):
    """Entries a signer may record: an exact official reference link is present.

    Collection may start before verification finishes (so signers can copy the official
    form), but training refuses any label that is not verified.
    """
    admitted = verified(entries)
    return [{'label': e['label'], 'verified': e['label'] in admitted,
             'reference_url': e['reference_url'], 'reference_id': e.get('reference_id') or None,
             'hand_count': e.get('hand_count'), 'notes': e.get('notes') or ''}
            for e in live_entries(entries) if has_exact_reference(e)]


def selection_fingerprint(admitted, labels):
    """Fingerprint of the verified entries a model was trained on (NONE excluded)."""
    return fingerprint({label: admitted[label] for label in sorted(labels) if label != NONE_LABEL})
