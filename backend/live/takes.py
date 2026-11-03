"""lm-take-v1: one recorded take = metadata + raw lm-v1 frames. See docs/data_schema.md."""
import hashlib
import json
from pathlib import Path
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from backend.app.vocabulary import check_reference_url
from .features import PERIOD_MS, WINDOW
from .capture import validate_timing
from .hand_validation import POLICY, require_accepted_hands
from .protocol import validate_frames
from .vocab import LABEL_PATTERN, NONE_LABEL

TAKE_SCHEMA = 'lm-take-v1'
PSEUDONYM = r'^[A-Za-z0-9_-]{1,48}$'
MIN_FRAMES = 15
MIN_SPAN_MS = 0.9 * (WINDOW - 1) * PERIOD_MS  # a take must cover (almost) one window
MAX_FRAMES = 200
NONE_PROMPTS = (
    {'id': 'rest', 'text': 'Hands resting in your lap or on the table. Look at the camera.'},
    {'id': 'scratch', 'text': 'Scratch your head or face, then lower your hand.'},
    {'id': 'adjust', 'text': 'Adjust your hair, glasses or clothes.'},
    {'id': 'random', 'text': 'Move your hands randomly. Not a sign.'},
    {'id': 'half', 'text': 'Start any sign and stop halfway.'},
    {'id': 'transition', 'text': 'Raise your hands into signing position, then lower them.'},
    {'id': 'chat', 'text': 'Gesture casually, as if chatting with a friend.'},
    {'id': 'phone', 'text': 'Pretend to check your phone.'},
)
NONE_PROMPT_IDS = {p['id'] for p in NONE_PROMPTS}


class TakeMeta(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_: Literal['lm-take-v1'] = Field(alias='schema')
    frame_schema: Literal['lm-v1']
    take_id: str = Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    label: str = Field(pattern=LABEL_PATTERN)
    signer_id: str = Field(pattern=PSEUDONYM)
    session_id: str = Field(pattern=PSEUDONYM)
    reference_url: Optional[str] = Field(default=None, max_length=1000)
    none_prompt: Optional[str] = None
    app_version: str = Field(min_length=1, max_length=40)
    recorded_at: str = Field(min_length=10, max_length=40)
    capture_ms: int = Field(ge=500, le=5000)
    consent: Literal[True]
    preview_mirrored: bool
    # Optional, added after collection started: older takes without them stay valid.
    capture_protocol: Optional[Literal["hp-v1-timed-1", "hp-v2-8fps-timed-1"]] = None
    hand_validation: Optional[Literal["pose-wrist-v1", "hand-evidence-v2", "hand-evidence-v3"]] = None
    low_fps: Optional[bool] = None
    measured_fps: Optional[float] = Field(default=None, ge=0, le=240)

    @model_validator(mode='after')
    def label_rules(self):
        if self.label == NONE_LABEL:
            if self.reference_url is not None or self.none_prompt not in NONE_PROMPT_IDS:
                raise ValueError('NONE takes have no reference and need a known none_prompt')
        else:
            if self.none_prompt is not None:
                raise ValueError('Only NONE takes have a none_prompt')
            check_reference_url(self.reference_url or '')
        return self


def validate_take(raw):
    """Return (metadata dict, validated frames). Raises ValueError with a readable reason."""
    if not isinstance(raw, dict):
        raise ValueError('Take must be a JSON object')
    frames_raw = raw.get('frames')
    if not isinstance(frames_raw, list) or not MIN_FRAMES <= len(frames_raw) <= MAX_FRAMES:
        raise ValueError(f'Take needs {MIN_FRAMES}-{MAX_FRAMES} frames')
    try:
        meta = TakeMeta.model_validate({k: v for k, v in raw.items() if k != 'frames'})
    except ValidationError as exc:
        raise ValueError(f'Invalid take metadata: {exc.errors()[0]["msg"]} ({exc.errors()[0]["loc"]})') from exc
    frames = validate_frames(frames_raw)
    if frames[-1]['t_ms'] - frames[0]['t_ms'] < MIN_SPAN_MS:
        raise ValueError('Take is too short to cover one recognition window')
    if meta.capture_protocol is not None:
        validate_timing(frames, meta.capture_protocol)
    if meta.capture_protocol == 'hp-v2-8fps-timed-1':
        # The current policy's sequence verdict over this take's own frames only (no pre-take history).
        require_accepted_hands(frames)
    out = meta.model_dump(by_alias=True)
    # Takes recorded under an older observation policy stay readable, but are tagged.
    out['hand_validation_current'] = meta.hand_validation == POLICY['policy']
    return out, frames


def content_hash(raw):
    return hashlib.sha256(json.dumps(raw['frames'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def read_jsonl(path):
    """Yield (line_number, parsed object or ValueError) for each non-empty line."""
    with Path(path).open(encoding='utf-8') as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                yield number, json.loads(line)
            except json.JSONDecodeError as exc:
                yield number, ValueError(f'Not JSON: {exc.msg}')


def load_takes(path):
    """Strictly load a merged takes file: any malformed or duplicate take is an error."""
    takes, ids, hashes = [], set(), set()
    for number, raw in read_jsonl(path):
        if isinstance(raw, ValueError):
            raise ValueError(f'{path}:{number}: {raw}')
        try:
            meta, frames = validate_take(raw)
        except ValueError as exc:
            raise ValueError(f'{path}:{number}: {exc}') from exc
        digest = content_hash(raw)
        if meta['take_id'] in ids or digest in hashes:
            raise ValueError(f'{path}:{number}: duplicate take')
        ids.add(meta['take_id'])
        hashes.add(digest)
        takes.append((meta, frames))
    return takes
