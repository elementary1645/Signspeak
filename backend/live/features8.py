"""hp-v2-8fps: 16 actual frames (~2 seconds), no temporal resampling or invented frames.

The spatial representation and 474 summary statistics are shared with hp-v1. Motion
energy remains per observed step (not velocity); models are consequently incompatible.
"""
import numpy as np
from . import features as spatial
from .capture import PROTOCOLS, validate_timing
from .hand_validation import filter_hands

SCHEMA = 'hp-v2-8fps'
CAPTURE_PROTOCOL = 'hp-v2-8fps-timed-1'
FPS = PROTOCOLS[CAPTURE_PROTOCOL]['fps']
WINDOW = PROTOCOLS[CAPTURE_PROTOCOL]['window']
PERIOD_MS = 1000 / FPS
FRAME_DIM = spatial.FRAME_DIM
SUMMARY_DIM = spatial.SUMMARY_DIM
mirror = spatial.mirror


def frame_vector(frame):
    return spatial.frame_vector(filter_hands(frame))


def latest_window(frames, vectors=None):
    """Latest 16 observed source samples. Reject gaps/rate violations, never fill holes."""
    selected = frames[-WINDOW:]
    validate_timing(selected, CAPTURE_PROTOCOL)
    if vectors is not None and all(len(filter_hands(f)['hands']) == len(f['hands']) for f in selected):
        return np.asarray(vectors[-WINDOW:], dtype=float)
    return np.asarray([frame_vector(f) for f in selected])


def take_windows(frames):
    validate_timing(frames, CAPTURE_PROTOCOL)  # exact-count contract, no jittered copies
    return [latest_window(frames)]


def summarize(window):
    return spatial.summarize(window, count=WINDOW)
