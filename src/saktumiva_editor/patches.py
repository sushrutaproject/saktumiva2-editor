"""Saktumiva's code is served unchanged except for the patches in saktumiva-patches.json.

They are applied in memory as the files are served, so the submodule stays a clean
checkout of upstream. If a patch no longer fits (Saktumiva has changed), the file is
served as it is and a warning is printed; the regression tests catch this first.
"""

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH_FILE = HERE / 'saktumiva-patches.json'
SAKTUMIVA_DIR = HERE / 'app' / 'saktumiva'


@lru_cache(maxsize=1)
def load_patches():
    data = json.loads(PATCH_FILE.read_text(encoding='utf-8'))
    out = {}
    for p in data['patches']:
        out.setdefault(p['file'], []).append(p)
    return out


def apply(rel: str, text: str):
    """Return (patched text, list of problems) for the Saktumiva file `rel` (e.g. 'lib/apparatus.mjs')."""
    problems = []
    for p in load_patches().get(rel, []):
        matches = list(re.finditer(p['find'], text))
        if len(matches) != 1:
            problems.append(f"patch for {rel} ({p['why'][:60]}…) matches {len(matches)} times, expected once")
            continue
        m = matches[0]
        text = text[:m.start()] + p['replace'] + text[m.end():]
    return text, problems


_warned = set()


def serve(rel: str, path: Path) -> bytes:
    """The bytes to serve for a Saktumiva file, patched if a patch is defined for it."""
    if rel not in load_patches():
        return path.read_bytes()
    text, problems = apply(rel, path.read_text(encoding='utf-8'))
    for msg in problems:
        if msg not in _warned:
            _warned.add(msg)
            print(f'Warning: {msg}. The editor may not apply script notes correctly.', file=sys.stderr)
    return text.encode('utf-8')


def check_all():
    """Problems with any patch against the Saktumiva copy in use (empty = all fine)."""
    problems = []
    for rel in load_patches():
        f = SAKTUMIVA_DIR / rel
        if not f.exists():
            problems.append(f'{rel} is missing from the Saktumiva copy (is the submodule checked out?)')
            continue
        problems += apply(rel, f.read_text(encoding='utf-8'))[1]
    return problems
