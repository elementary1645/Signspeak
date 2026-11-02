import json
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
import numpy as np
from .features import SCHEMA, DIM
from .vocabulary import verified_entries

ROOT = Path(__file__).resolve().parents[2]
VOCABULARY = ROOT / 'data/metadata/vocabulary.json'


def vocabulary():
    entries = json.loads(VOCABULARY.read_text())
    return verified_entries(entries)


class Record(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    schema_version: Literal['hands-v1'] = SCHEMA
    sign_class: str = Field(min_length=1)
    signer_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,48}$')
    session_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,48}$')
    recording_id: str = Field(min_length=1)
    sample_id: str = Field(min_length=1)
    timestamp_ms: int = Field(ge=0)
    hand_count: int = Field(ge=1, le=2)
    features: list[float] = Field(min_length=DIM, max_length=DIM)
    handedness_scores: list[float]
    detection_threshold: float = Field(ge=0, le=1)
    input_mirrored: bool
    vocabulary_reference_id: str

    @model_validator(mode='after')
    def consistent(self):
        x = np.asarray(self.features)
        masks = x[-2:]
        if not np.isfinite(x).all() or not all(v in (0, 1) for v in masks) or sum(masks) != self.hand_count:
            raise ValueError('Nonfinite features or inconsistent presence mask')
        for i, present in enumerate(masks):
            points = x[i*63:(i+1)*63].reshape(21, 3)
            if not present and np.any(points):
                raise ValueError('Absent hand must have zero padding')
            if present and (not np.allclose(points[0], 0) or not np.isclose(np.linalg.norm(points[9]), 1)):
                raise ValueError('Features do not use hands-v1 normalization')
        if len(self.handedness_scores) != self.hand_count or any(not 0.7 <= s <= 1 for s in self.handedness_scores):
            raise ValueError('Unreliable handedness')
        entry = vocabulary().get(self.sign_class)
        if not entry or entry['reference_id'] != self.vocabulary_reference_id or entry['hand_count'] != self.hand_count:
            raise ValueError('Unverified vocabulary or wrong hand count/reference')
        return self
