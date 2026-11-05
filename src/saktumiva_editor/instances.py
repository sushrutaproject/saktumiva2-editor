"""Find copies of the editor that are already running on this computer."""

import json
import urllib.request


def probe(port: int, timeout: float = 0.6):
    """The state of a Saktumiva editor on 127.0.0.1:`port`, or None if the port holds something else (or nothing)."""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/state', timeout=timeout) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    # 'app' is sent from 0.4.1; older editors are recognised by the fields only they send
    if data.get('app') != 'saktumiva-editor' and not ({'version', 'folder', 'install'} <= data.keys()):
        return None
    return {'port': port, 'version': data.get('version'), 'folder': data.get('folder')}


def find_running(start: int, tries: int = 10) -> list:
    """Editors running on the ports this one would use."""
    return [s for p in range(start, start + tries) if (s := probe(p))]
