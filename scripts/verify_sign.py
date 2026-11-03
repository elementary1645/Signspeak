"""Record one human sign check in the hp-v1 registry. This command verifies nothing itself.

  python -m scripts.verify_sign HELLO --link URL [--reference-id ID]   # step 1: unlock collection
  python -m scripts.verify_sign HELLO                                   # step 2: human review (prompts)
  python -m scripts.verify_sign HELLO --revoke                          # undo approval; retrain

See docs/HOW_TO_VERIFY_A_SIGN.md.
"""
import argparse
from datetime import date
import json
from backend.app import dataset
from backend.app.vocabulary import check_reference_url
from backend.live.vocab import LiveSignReview, live_entries, verified


def load():
    entries = json.loads(dataset.VOCABULARY.read_text(encoding='utf-8'))
    live_entries(entries)
    return entries


def save(entries):
    verified(entries)  # never write a registry the gate would reject
    tmp = dataset.VOCABULARY.with_suffix('.tmp')
    tmp.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    tmp.replace(dataset.VOCABULARY)


def find(entries, label):
    for entry in entries:
        if entry.get('label') == label and entry.get('pipeline') == 'hp-v1':
            return entry
    raise ValueError(f'{label} is not an hp-v1 candidate in {dataset.VOCABULARY}')


def set_link(label, url, reference_id=None, entries=None):
    entries = load() if entries is None else entries
    entry = find(entries, label)
    if entry.get('verified') is True and url != entry.get('reference_url'):
        raise ValueError('Already verified with a different reference; --revoke first, then recollect')
    check_reference_url(url)
    entry['reference_url'] = url
    entry['reference_id'] = reference_id or entry.get('reference_id') or url
    save(entries)
    return entry


def approve(label, answers, entries=None):
    """answers: dict of the human's answers. Raises if the gate rejects them."""
    entries = load() if entries is None else entries
    entry = find(entries, label)
    candidate = dict(entry, **answers, verified=True, pipeline='hp-v1', label=label)
    LiveSignReview.model_validate(candidate)
    entry.update(candidate)
    save(entries)
    return entry


def revoke(label, entries=None):
    entries = load() if entries is None else entries
    entry = find(entries, label)
    entry.update(verified=False, human_inspected=False, official_source_confirmed=False)
    save(entries)
    return entry


def ask_bool(question):
    while True:
        answer = input(f'{question} [y/n]: ').strip().lower()
        if answer in ('y', 'yes', 'n', 'no'):
            return answer.startswith('y')


def interview(entry):
    print(f"\nReviewing {entry['label']}\nReference: {entry.get('reference_url') or '(none: run with --link first)'}")
    if not entry.get('reference_url'):
        raise ValueError('Set the exact official link first with --link')
    typed = input('Type WATCHED if you personally watched this exact official video just now: ').strip()
    if typed != 'WATCHED':
        raise ValueError('Not approved: a human must watch the exact reference')
    answers = {
        'human_inspected': True,
        'official_source_confirmed': ask_bool('Is the link an official ISLRTC dictionary entry/video for this meaning?'),
        'hand_count': 2 if ask_bool('Does the sign use two hands?') else 1,
        'motion_required': ask_bool('Does the sign involve movement (not just a held handshape)?'),
        'relative_hand_position_required': ask_bool('Does it depend on where the hands are relative to each other?'),
        'body_cues_required': ask_bool('Does it touch or point to a body location (chest, chin, head...)?'),
        'facial_cues_required': ask_bool('Is a facial expression/mouthing REQUIRED for the meaning?'),
        'reviewer': input('Your pseudonym (letters, digits, _ or -): ').strip(),
        'reviewed_on': date.today().isoformat(),
        'notes': input('How to sign it, in your words (>= 10 chars; signers read this): ').strip(),
    }
    if not answers['official_source_confirmed']:
        raise ValueError('Not approved: only official references are admitted')
    if answers['facial_cues_required']:
        raise ValueError('Not approved: hp-v1 cannot see faces; leave this sign out')
    return answers


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('label')
    parser.add_argument('--link', help='exact official entry/video URL')
    parser.add_argument('--reference-id', help='official entry id/title, if shown')
    parser.add_argument('--revoke', action='store_true')
    args = parser.parse_args()
    try:
        if args.revoke:
            revoke(args.label)
            print(f'{args.label}: approval revoked. Retrain before serving a model.')
        elif args.link:
            set_link(args.label, args.link, args.reference_id)
            print(f'{args.label}: link saved. It now appears on /collect (training still refuses it until verified).')
        else:
            entry = approve(args.label, interview(find(load(), args.label)))
            print(f"{entry['label']}: VERIFIED by {entry['reviewer']} on {entry['reviewed_on']}. Restart the server.")
    except (ValueError, OSError) as exc:
        parser.exit(2, f'Not changed: {exc}\n')


if __name__ == '__main__':
    main()
