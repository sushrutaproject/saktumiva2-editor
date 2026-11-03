import json
import sys

from saktumiva_editor import __version__, patches, updates


import pytest


@pytest.fixture(autouse=True)
def no_token(monkeypatch):
    monkeypatch.setattr(updates, 'github_token', lambda: None)


def test_version_order():
    p = updates.parse_version
    assert p('v0.2.0') > p('0.1.9') > p('0.1') == p('v0.1.0')
    assert p('1.0.0rc1') < p('1.0.0') < p('1.0.1')
    assert p('nonsense') < p('0.0.1')


class FakeResponse:
    def __init__(self, data):
        self.data = json.dumps(data).encode()

    def read(self):
        return self.data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


RELEASE = {'tag_name': 'v99.0.0', 'html_url': 'https://github.com/x/releases/tag/v99.0.0', 'body': 'New things',
           'published_at': '2027-01-01T00:00:00Z', 'assets': [
               {'name': 'saktumiva_editor-99.0.0-py3-none-any.whl', 'browser_download_url': 'https://dl/whl'},
               {'name': f'saktumiva-editor-99.0.0-{updates.platform_tag()}.zip', 'browser_download_url': 'https://dl/exe'}]}


def test_newer_release_for_pipx(monkeypatch):
    monkeypatch.setattr(updates.urllib.request, 'urlopen', lambda req, timeout: FakeResponse(RELEASE))
    monkeypatch.setattr(updates, 'install_kind', lambda: 'pipx')
    r = updates.check()
    assert r['newer'] and r['latest'] == '99.0.0' and r['current'] == __version__
    assert r['how']['command'] == 'pipx install --force https://dl/whl'


def test_newer_release_for_executable(monkeypatch):
    monkeypatch.setattr(updates.urllib.request, 'urlopen', lambda req, timeout: FakeResponse(RELEASE))
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    r = updates.check()
    assert r['kind'] == 'executable' and r['how']['url'] == 'https://dl/exe'


def test_same_version_is_up_to_date(monkeypatch):
    monkeypatch.setattr(updates.urllib.request, 'urlopen',
                        lambda req, timeout: FakeResponse({**RELEASE, 'tag_name': f'v{__version__}'}))
    r = updates.check()
    assert r['newer'] is False and 'how' not in r


def test_offline(monkeypatch):
    def fail(req, timeout):
        raise updates.urllib.error.URLError('no network')
    monkeypatch.setattr(updates.urllib.request, 'urlopen', fail)
    assert 'no network' in updates.check()['error']


def test_patches_fit_the_submodule():
    assert patches.check_all() == []


def test_patch_must_match_exactly_once():
    text, problems = patches.apply('lib/apparatus.mjs', 'nothing to patch here')
    assert text == 'nothing to patch here' and problems
    once = 'x; if(newstr === lemma) { y'
    text, problems = patches.apply('lib/apparatus.mjs', once)
    assert not problems and 'opts.equivalent(id, newstr, lemma)' in text
    _, problems = patches.apply('lib/apparatus.mjs', once + once)
    assert problems


def test_private_or_unreleased(monkeypatch):
    def fail(req, timeout):
        raise updates.urllib.error.HTTPError(updates.API, 404, 'Not Found', {}, None)
    monkeypatch.setattr(updates.urllib.request, 'urlopen', fail)
    r = updates.check()
    assert r['newer'] is False and 'private' in r['note']


def test_token_is_sent(monkeypatch):
    seen = {}
    def fake(req, timeout):
        seen['auth'] = req.get_header('Authorization')
        return FakeResponse({**RELEASE, 'tag_name': f'v{__version__}'})
    monkeypatch.setattr(updates, 'github_token', lambda: 'abc')
    monkeypatch.setattr(updates.urllib.request, 'urlopen', fake)
    updates.check()
    assert seen['auth'] == 'Bearer abc'
