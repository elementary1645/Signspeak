"""Versioned capture contracts shared verbatim with the browser, never inferred from FPS."""
import json
import math
from pathlib import Path

PROTOCOLS = json.loads((Path(__file__).resolve().parents[2] / 'web/src/lib/captureProtocols.json').read_text())
LEGACY = 'legacy-untagged-hp-v1'


def for_schema(schema):
    for name, spec in PROTOCOLS.items():
        if spec['schema'] == schema:
            return name, spec
    raise ValueError(f'Unsupported feature schema: {schema}')


def validate_timing(frames, protocol):
    if protocol not in PROTOCOLS:
        raise ValueError(f'Unknown capture protocol: {protocol}')
    p = PROTOCOLS[protocol]
    times = [f['t_ms'] for f in frames]
    if not p['minFrames'] <= len(times) <= p['maxFrames'] or not all(
            isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t) and t >= 0 for t in times):
        raise ValueError(f'Take violates {protocol} timing contract: frame count or timestamps')
    gaps = [b - a for a, b in zip(times, times[1:])]
    span = times[-1] - times[0]
    fps = (len(times) - 1) * 1000 / span if span > 0 else 0
    tolerance = p.get('timestampToleranceMs', 0)
    rate_ok = ((len(times) - 1) * 1000 / p['maxFps'] - tolerance <= span
               <= (len(times) - 1) * 1000 / p['minFps'] + tolerance)
    if (not p['minSpanMs'] <= span <= p['maxSpanMs'] or not rate_ok
            or any(g <= 0 or not p['minGapMs'] <= g <= p['maxGapMs'] for g in gaps)):
        raise ValueError(f'Take violates {protocol} timing contract: rate, span or frame gap')
    return fps


def accepted_protocols(schema):
    name, _ = for_schema(schema)
    return [name, LEGACY] if schema == 'hp-v1' else [name]


def require_training_protocol(takes, schema):
    accepted = accepted_protocols(schema)
    for meta, frames in takes:
        protocol = meta.get('capture_protocol') or LEGACY
        if protocol not in accepted:
            raise ValueError(f'Capture protocol {protocol} is incompatible with feature schema {schema}; do not mix takes')
        if protocol != LEGACY:
            validate_timing(frames, protocol)
