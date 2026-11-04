"""hp-v2-8fps: 16 actual frames (~2 seconds), no temporal resampling or invented frames.

The spatial representation and 474 summary statistics are shared with hp-v1. Motion
energy remains per observed step (not velocity); models are consequently incompatible.
"""
import numpy as np
from . import features as spatial
from .capture import PROTOCOLS, validate_timing
from .hand_validation import assess_hands, assess_sequence, assignment

SCHEMA = 'hp-v2-8fps'
CAPTURE_PROTOCOL = 'hp-v2-8fps-timed-1'
FPS = PROTOCOLS[CAPTURE_PROTOCOL]['fps']
WINDOW = PROTOCOLS[CAPTURE_PROTOCOL]['window']
PERIOD_MS = 1000 / FPS
FRAME_DIM = spatial.FRAME_DIM
SUMMARY_DIM = spatial.SUMMARY_DIM
mirror = spatial.mirror


def assessed_vector(assessment):
    """Feature vector of one hand-evidence assessment (its accepted hands and sides only)."""
    return spatial.frame_vector(assessment['frame'], assignment=assignment(assessment))


def frame_vector(frame):
    """Single frame with no history. Sequences must use latest_window/assess_sequence."""
    return assessed_vector(assess_hands(frame))


def latest_window(frames, vectors=None, assessments=None):
    """Latest 16 observed source samples. Reject gaps/rate violations, never fill holes.

    Hand evidence comes from the sequence verdict over all of `frames` (a whole take), or
    from `assessments` already made by a live HandEvidenceTracker. Cached vectors are used
    only when every selected frame holds exactly its accepted hands.
    """
    selected = frames[-WINDOW:]
    validate_timing(selected, CAPTURE_PROTOCOL)
    assessed = (assess_sequence(frames) if assessments is None else list(assessments))[-len(selected):]
    if vectors is not None and all(len(a['frame']['hands']) == len(f['hands']) for a, f in zip(assessed, selected)):
        return np.asarray(vectors[-WINDOW:], dtype=float)
    return np.asarray([assessed_vector(a) for a in assessed])


def take_windows(frames):
    validate_timing(frames, CAPTURE_PROTOCOL)  # exact-count contract, no jittered copies
    return [latest_window(frames)]


def summarize(window):
    return spatial.summarize(window, count=WINDOW)
