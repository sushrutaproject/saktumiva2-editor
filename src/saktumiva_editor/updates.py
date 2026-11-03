"""Check GitHub Releases for a newer version of the editor."""

import json
import os
import platform
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from . import GITHUB_REPO, __version__

API = f'https://api.github.com/repos/{GITHUB_REPO}/releases/latest'
RELEASES_PAGE = f'https://github.com/{GITHUB_REPO}/releases'


def parse_version(v: str):
    """'v1.2.3' -> (1, 2, 3, 1); a pre-release such as '1.3.0rc1' or '1.3.0-beta' sorts before '1.3.0'."""
    m = re.match(r'^\s*v?(\d+(?:\.\d+)*)(.*)$', v or '')
    if not m:
        return (0,)
    nums = [int(x) for x in m.group(1).split('.')]
    while len(nums) < 3:
        nums.append(0)
    return (*nums, 0 if m.group(2).strip(' .-+') else 1)


def install_kind() -> str:
    """How this copy was installed: 'executable', 'pipx', 'source' (a git checkout) or 'pip'."""
    if getattr(sys, 'frozen', False):
        return 'executable'
    if 'pipx' in Path(sys.prefix).parts:
        return 'pipx'
    if (Path(__file__).resolve().parents[2] / '.git').exists():
        return 'source'
    return 'pip'


def platform_tag() -> str:
    """The name part of the release asset built for this computer, e.g. 'macos-arm64'."""
    osname = {'win32': 'windows', 'darwin': 'macos'}.get(sys.platform, 'linux')
    machine = platform.machine().lower()
    arch = {'amd64': 'x86_64', 'x64': 'x86_64', 'aarch64': 'arm64'}.get(machine, machine)
    return f'{osname}-{arch}'


def how_to_update(kind: str, release: dict) -> dict:
    tag = release.get('tag_name', '')
    assets = release.get('assets') or []
    wheel = next((a for a in assets if a['name'].endswith('.whl')), None)
    mine = next((a for a in assets if platform_tag() in a['name']), None)
    if kind == 'executable':
        if mine:
            return {'text': f'Download {mine["name"]}, unpack it and replace this program with the new one.',
                    'url': mine['browser_download_url']}
        return {'text': f'There is no ready-made program for {platform_tag()} in this release. '
                        'Install with pipx instead (see the release page).', 'url': release.get('html_url')}
    if kind == 'source':
        return {'text': 'This copy runs from a git checkout. Update it with:',
                'command': f'git pull && git checkout {tag} && git submodule update --init'}
    target = wheel['browser_download_url'] if wheel else f'git+https://github.com/{GITHUB_REPO}.git@{tag}'
    tool = 'pipx install --force' if kind == 'pipx' else f'{Path(sys.executable).name} -m pip install --upgrade'
    return {'text': 'In a terminal, run:', 'command': f'{tool} {target}'}


def github_token():
    """A GitHub token, needed only while the repository is private: $GITHUB_TOKEN, $GH_TOKEN, or gh's login."""
    for k in ('GITHUB_TOKEN', 'GH_TOKEN'):
        if os.environ.get(k):
            return os.environ[k].strip()
    try:
        r = subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True, timeout=5,
                           **({'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}))
        return r.stdout.strip() if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def check(timeout: float = 8.0) -> dict:
    """{current, latest, newer, notes, page, how} -- or {error} if GitHub cannot be reached."""
    kind = install_kind()
    out = {'current': __version__, 'kind': kind, 'page': RELEASES_PAGE}
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': f'saktumiva-editor/{__version__}'}
    token = github_token()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(API, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            release = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            note = 'No release has been published yet.' if token else (
                'No release has been published yet, or the repository is private: then set GITHUB_TOKEN '
                '(or sign in with the GitHub command-line tool, gh) so that the editor can see it.')
            return {**out, 'latest': None, 'newer': False, 'note': note}
        return {**out, 'error': f'GitHub answered {e.code} {e.reason}'}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {**out, 'error': f'Could not reach GitHub: {getattr(e, "reason", e)}'}
    latest = release.get('tag_name', '')
    newer = parse_version(latest) > parse_version(__version__)
    out.update({'latest': latest.lstrip('v'), 'newer': newer, 'notes': (release.get('body') or '')[:4000],
                'page': release.get('html_url') or RELEASES_PAGE, 'published': (release.get('published_at') or '')[:10]})
    if newer:
        out['how'] = how_to_update(kind, release)
    return out
