import json
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))
FIXTURES = ROOT / 'tests' / 'fixtures'


@pytest.fixture(autouse=True)
def editor_home(tmp_path, monkeypatch):
    """The editor's own files (recent projects, cache) go to a temporary folder."""
    monkeypatch.setenv('SAKTUMIVA_EDITOR_HOME', str(tmp_path / 'home'))
    return tmp_path / 'home'


def git_init(folder: Path):
    subprocess.run(['git', 'init', '-q'], cwd=folder, check=True)
    subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], cwd=folder, check=True)
    subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'start'], cwd=folder, check=True)


@pytest.fixture
def rasendra(tmp_path):
    """A project like wujastyk/Rasendramangala: chapter folders of .txt TEI files, not set up."""
    root = tmp_path / 'Rasendramangala'
    ch1 = root / 'chapter1'
    shutil.copytree(FIXTURES / 'rasendramangala-ch1' / 'section', ch1)
    (ch1 / 'editor.config.json').unlink()
    ch2 = root / 'chapter2'
    ch2.mkdir()
    for f in ['l_london_ch1.txt', 'g_gondal_34_ch1.txt']:
        shutil.copy(ch1 / f, ch2 / f.replace('ch1', 'ch2'))
    (root / 'README.md').write_text('# Rasendramangala\n', encoding='utf-8')
    (root / 'quick_start.txt').write_text('not TEI\n', encoding='utf-8')
    git_init(root)
    return root


@pytest.fixture
def sushruta(tmp_path):
    """A project like Sushrutasamhita_Saktumiva2: numbered section folders with editor.config.json."""
    root = tmp_path / 'Saktumiva2'
    shutil.copytree(FIXTURES / 'sushruta-sarira' / 'section', root / '03-su.sa')
    (root / 'assets').mkdir()
    git_init(root)
    return root


class Client:
    def __init__(self, port):
        self.port = port
        self.base = f"http://127.0.0.1:{port}"

    def request(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        h = {'Content-Type': 'application/json'} if data is not None else {}
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw, status, ctype = r.read(), r.status, r.headers.get('Content-Type', '')
        except urllib.error.HTTPError as e:
            raw, status, ctype = e.read(), e.code, e.headers.get('Content-Type', '')
        if 'json' in ctype:
            return status, json.loads(raw.decode())
        return status, raw

    def get(self, path, **kw):
        return self.request('GET', path, **kw)

    def post(self, path, body, **kw):
        return self.request('POST', path, body, **kw)


@pytest.fixture
def server():
    from saktumiva_editor.server import Handler, make_server
    Handler.folder = None
    srv, port = make_server(0, tries=1)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield Client(port)
    srv.shutdown()
    srv.server_close()
    Handler.folder = None
