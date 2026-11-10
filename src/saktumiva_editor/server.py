"""
Saktumiva editor -- local server.

Serves the editing screen in your web browser and reads/writes the TEI files of one
section folder at a time on your own computer. Nothing is sent anywhere else, except
that "Check for updates" asks GitHub for the latest release, and your browser fetches
manuscript images from the archives' IIIF servers.

Every save:
  * refuses if the file changed on disk since it was loaded,
  * refuses if the new file is not well-formed XML or has duplicate xml:ids,
  * writes the file, then commits it to git if the folder is in a git repo.
Only the Python standard library is used.
"""

import hashlib
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import xml.etree.ElementTree as ET
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__, patches, paths, project, updates
from .project import CONFIG_NAME, load_config

HERE = Path(__file__).resolve().parent
APP_DIR = HERE / 'app'
XMLID = '{http://www.w3.org/XML/1998/namespace}id'
TEI = '{http://www.tei-c.org/ns/1.0}'
BLOCK_RE = r'[A-Za-z0-9_.\-]+'
# Saktumiva files the editor uses; the rest of the submodule is not served
SAKTUMIVA_SERVED = ('saktumiva/lib/', 'saktumiva/editmode/openseadragon/')

mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('application/xml', '.xml')


def publish_target(cfg: dict) -> str:
    """Where the edition with the full apparatus is written (inside the section folder)."""
    if cfg.get('publishTo'):
        return cfg['publishTo']
    stem = Path(cfg.get('edition') or 'edition.xml').stem
    return f'{stem}_with-apparatus.xml'


# ------------------------------------------------------------------ git

def git(folder: Path, *args, check=False):
    try:
        return subprocess.run(['git', *args], cwd=folder, capture_output=True, text=True,
                              timeout=30, check=check, **_no_window())
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def _no_window():
    # on Windows, don't flash a console window for every git command
    return {'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {}


def in_git_repo(folder: Path) -> bool:
    r = git(folder, 'rev-parse', '--is-inside-work-tree')
    return bool(r and r.returncode == 0 and r.stdout.strip() == 'true')


# ------------------------------------------------------------------ checks

def check_xml(text: str, name: str):
    """Return list of problems (empty = fine)."""
    try:
        root = ET.fromstring(text.encode('utf-8'))
    except ET.ParseError as e:
        return [f'{name} would not be well-formed XML: {e}']
    seen, dups = set(), set()
    for el in root.iter():
        i = el.get(XMLID)
        if i:
            if i in seen:
                dups.add(i)
            seen.add(i)
    probs = [f'{name}: duplicate xml:id "{d}"' for d in sorted(dups)]
    return probs


def note_warnings(text: str):
    """Warnings (not refusals) about note targets that point nowhere."""
    try:
        root = ET.fromstring(text.encode('utf-8'))
    except ET.ParseError:
        return []
    ids = {el.get(XMLID) for el in root.iter() if el.get(XMLID)}
    out = []
    for so in root.iter(TEI + 'standOff'):
        if so.get('type') == 'apparatus':
            continue
        for n in so.iter(TEI + 'note'):
            for t in (n.get('target') or '').split():
                if t.lstrip('#') not in ids:
                    out.append(f'note target {t} matches no xml:id')
    return out


def check_alignments(aligns: dict):
    errors = []
    for block, xml in aligns.items():
        if not re.fullmatch(BLOCK_RE, block):
            errors.append(f'bad passage id {block!r}')
        else:
            errors += check_xml(xml, f'alignment {block}')
    return errors


# ------------------------------------------------------------------ server

class Handler(SimpleHTTPRequestHandler):
    folder: Path = None          # the section being edited (None: the project chooser is shown)
    port: int = 8800
    lock = threading.Lock()

    def log_message(self, fmt, *args):
        # keep the terminal quiet: only saves and real errors are shown
        msg = fmt % args if args else fmt
        if '/api/save' in msg or (fmt.startswith('code') and args and args[0] not in (404, HTTPStatus.NOT_FOUND)):
            sys.stderr.write(msg + '\n')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self, data: bytes, ctype: str):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def _safe(self, rel: str) -> Path:
        base = self.folder.resolve()
        p = (base / rel).resolve()
        if base not in p.parents and p != base:
            raise PermissionError(rel)
        return p

    # Only pages served by this server may use it: refuse other host names (DNS rebinding)
    # and requests from an editor window still open on a section that is no longer the current one.
    def _host_ok(self) -> bool:
        host = (self.headers.get('Host') or '').lower()
        return host in {f'127.0.0.1:{self.port}', f'localhost:{self.port}', f'[::1]:{self.port}'}

    def _stale(self) -> bool:
        sent = unquote(self.headers.get('X-Saktumiva-Folder') or '')
        return bool(sent) and (self.folder is None or sent != str(self.folder))

    def _refuse_stale(self):
        return self._json({'ok': False, 'stale': True, 'errors': [
            'The editor has been switched to another section in a different window. '
            'Nothing was saved here. Reload this page.']}, 409)

    def translate_path(self, path):
        path = unquote(urlparse(path).path)
        if path in ('', '/'):
            return str(APP_DIR / ('index.html' if self.folder else 'chooser.html'))
        if path == '/choose':
            return str(APP_DIR / 'chooser.html')
        if path.startswith('/project/'):
            if not self.folder:
                raise PermissionError(path)
            return str(self._safe(path[len('/project/'):]))
        p = (APP_DIR / path.lstrip('/')).resolve()
        if APP_DIR not in p.parents:
            raise PermissionError(path)
        rel = p.relative_to(APP_DIR).as_posix()
        if rel.startswith('saktumiva/') and not rel.startswith(SAKTUMIVA_SERVED):
            raise PermissionError(path)
        return str(p)

    def do_GET(self):
        if not self._host_ok():
            return self.send_error(HTTPStatus.FORBIDDEN, 'Unknown host')
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path.startswith('/api/') or u.path.startswith('/project/'):
            if self._stale():
                return self._refuse_stale()
        if u.path == '/api/state':
            return self._json({'app': 'saktumiva-editor', 'version': __version__, 'folder': str(self.folder) if self.folder else None,
                               'section': self.folder.name if self.folder else None,
                               'install': updates.install_kind(), 'patchProblems': patches.check_all()})
        if u.path == '/api/recent':
            return self._json({'recent': project.recent()})
        if u.path == '/api/prefs':
            return self._json({'prefs': project.prefs()})
        if u.path == '/api/browse':
            return self._browse(q.get('path'))
        if u.path == '/api/project':
            try:
                return self._json({'ok': True, **project.discover(Path(q.get('path') or ''))})
            except (FileNotFoundError, OSError) as e:
                return self._json({'ok': False, 'errors': [str(e)]}, 404)
        if u.path == '/api/setup':
            return self._setup_info(q.get('path'))
        if u.path == '/api/update-check':
            return self._json(updates.check())
        if u.path == '/api/config':
            if not self.folder:
                return self._json({'ok': False, 'noFolder': True}, 409)
            cfg = load_config(self.folder)
            files = [cfg.get('edition')] + list(cfg.get('witnesses', []))
            mtimes = {}
            for f in files:
                if f and (self.folder / f).exists():
                    mtimes[f] = str(os.stat(self.folder / f).st_mtime_ns)
            root = project.find_project_root(self.folder)
            return self._json({'config': cfg, 'publishTo': publish_target(cfg), 'folder': str(self.folder),
                               'section': self.folder.name, 'project': project.project_name(root),
                               'mtimes': mtimes, 'git': in_git_repo(self.folder), 'version': __version__})
        if u.path == '/api/cache':
            f = self._cache_file(q.get('block', ''))
            if f and f.exists():
                data = json.loads(f.read_text(encoding='utf-8'))
                if data.get('key') == q.get('key'):
                    return self._body(data['xml'].encode('utf-8'), 'application/xml; charset=utf-8')
            return self.send_error(HTTPStatus.NOT_FOUND)
        if u.path == '/api/history':
            if not self.folder:
                return self._json({'commits': []})
            cfg = load_config(self.folder)
            r = git(self.folder, 'log', '-n', '30', '--date=format:%Y-%m-%d %H:%M',
                    '--format=%h\t%ad\t%s', '--', cfg['edition'])
            lines = [l.split('\t') for l in (r.stdout.splitlines() if r and r.returncode == 0 else [])]
            return self._json({'commits': lines})
        try:
            local = Path(self.translate_path(self.path))
        except PermissionError:
            return self.send_error(HTTPStatus.FORBIDDEN)
        if local.is_file() and APP_DIR / 'saktumiva' in local.parents:
            rel = local.relative_to(APP_DIR / 'saktumiva').as_posix()
            ctype = mimetypes.guess_type(local.name)[0] or 'application/octet-stream'
            return self._body(patches.serve(rel, local), ctype)
        try:
            return super().do_GET()
        except PermissionError:
            self.send_error(HTTPStatus.FORBIDDEN)

    def _cache_file(self, block):
        if not self.folder or not re.fullmatch(BLOCK_RE, block or ''):
            return None
        d = paths.cache_dir() / hashlib.sha1(str(self.folder).encode()).hexdigest()[:12]
        return d / f'{block}.json'

    # ---------------------------------------------------------- project chooser
    def _browse(self, path):
        p = Path(path).expanduser() if path else Path.home()
        try:
            p = p.resolve()
            dirs = [{'name': d.name, 'path': str(d), 'section': project.is_section(d, {})}
                    for d in project.subdirs(p)]
        except OSError as e:
            return self._json({'ok': False, 'errors': [str(e)]}, 404)
        roots = []
        if sys.platform == 'win32':
            roots = [f'{c}:\\' for c in 'CDEFGHIJKLMNOPQRSTUVWXYZ' if os.path.exists(f'{c}:\\')]
        return self._json({'ok': True, 'path': str(p), 'parent': str(p.parent) if p.parent != p else None,
                           'home': str(Path.home()), 'roots': roots, 'dirs': dirs,
                           'here': project.is_section(p, {})})

    def _setup_info(self, path):
        folder = Path(path or '').expanduser().resolve()
        if not folder.is_dir():
            return self._json({'ok': False, 'errors': [f'Folder not found: {folder}']}, 404)
        own = project.read_section_config(folder)
        return self._json({'ok': True, 'folder': str(folder), 'name': folder.name, 'exists': own is not None,
                           'config': own if own is not None else project.guess_config(folder),
                           'files': project.candidate_files(folder)})

    def _setup(self, req):
        folder = Path(req.get('folder') or '').expanduser().resolve()
        if not folder.is_dir():
            return self._json({'ok': False, 'errors': [f'Folder not found: {folder}']}, 404)
        cfg = req.get('config')
        if not isinstance(cfg, dict):
            return self._json({'ok': False, 'errors': ['config must be an object']}, 400)
        own = project.read_section_config(folder) or project.guess_config(folder)
        own.update({k: cfg[k] for k in ('edition', 'witnesses', 'publishTo') if k in cfg})
        if not own.get('publishTo'):
            own.pop('publishTo', None)
        probs = project.config_problems(folder, own)
        if own.get('edition') in own.get('witnesses', []):
            probs.append('the edition cannot also be a witness')
        if own.get('publishTo') and own['publishTo'] in [own.get('edition')] + own.get('witnesses', []):
            probs.append('the published file must not be the edition or a witness')
        if probs:
            return self._json({'ok': False, 'errors': probs}, 422)
        project.write_config(folder, own)
        commit = self._commit([CONFIG_NAME], 'Saktumiva editor: section set up', folder)
        return self._json({'ok': True, 'commit': commit})

    def _open(self, req):
        folder = Path(req.get('folder') or '').expanduser().resolve()
        if not folder.is_dir():
            return self._json({'ok': False, 'errors': [f'Folder not found: {folder}']}, 404)
        if project.read_section_config(folder) is None:
            return self._json({'ok': False, 'needsSetup': True, 'errors': [f'{folder.name} is not set up yet']}, 409)
        probs = project.config_problems(folder, load_config(folder, create=False))
        if probs:
            return self._json({'ok': False, 'needsSetup': True, 'errors': probs}, 422)
        Handler.folder = folder
        project.remember(project.find_project_root(folder), folder)
        print(f'Editing {folder}')
        return self._json({'ok': True, 'folder': str(folder)})

    # ---------------------------------------------------------- writing
    def do_POST(self):
        if not self._host_ok():
            return self.send_error(HTTPStatus.FORBIDDEN, 'Unknown host')
        if (self.headers.get('Content-Type') or '').split(';')[0].strip() != 'application/json':
            return self.send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        u = urlparse(self.path)
        try:
            req = self._read_json()
        except Exception as e:
            return self._json({'ok': False, 'errors': [f'bad request: {e}']}, 400)
        if u.path == '/api/open':
            with self.lock:
                return self._open(req)
        if u.path == '/api/setup':
            with self.lock:
                return self._setup(req)
        if u.path == '/api/prefs':
            if not isinstance(req, dict):
                return self._json({'ok': False, 'errors': ['bad request']}, 400)
            with self.lock:
                return self._json({'ok': True, 'prefs': project.set_prefs(req)})
        if u.path == '/api/recent/forget':
            project.forget(str(req.get('section') or req.get('root') or ''))
            return self._json({'ok': True})
        if self._stale():
            return self._refuse_stale()
        if not self.folder:
            return self._json({'ok': False, 'noFolder': True, 'errors': ['No section is open.']}, 409)
        if u.path == '/api/cache':
            try:
                f = self._cache_file(req.get('block'))
                if f:
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text(json.dumps({'key': req['key'], 'xml': req['xml']}, ensure_ascii=False), encoding='utf-8')
            except Exception as e:
                return self._json({'ok': False, 'error': str(e)}, 400)
            return self._json({'ok': True})
        handlers = {'/api/publish': self._publish, '/api/config': self._set_config, '/api/save': self._save,
                    '/api/restructure': self._restructure,
                    '/api/alignments': lambda r: self._write_alignments(r.get('alignments') or {}, r.get('message'))}
        if u.path not in handlers:
            return self.send_error(HTTPStatus.NOT_FOUND)
        with self.lock:
            return handlers[u.path](req)

    def _publish(self, req):
        cfg = load_config(self.folder)
        target = publish_target(cfg)
        if target == cfg.get('edition') or target in cfg.get('witnesses', []):
            return self._json({'ok': False, 'errors': ['publishTo must not be the edition or a witness file']}, 400)
        try:
            path = self._safe(target)
        except PermissionError:
            return self._json({'ok': False, 'errors': [f'publishTo must be inside the section folder: {target}']}, 400)
        content = req.get('content') or ''
        aligns = req.get('alignments') or {}
        errors = check_xml(content, target) + check_alignments(aligns)
        if errors:
            return self._json({'ok': False, 'errors': errors[:20]}, 422)
        written = []
        if aligns and cfg.get('writeAlignments', True) is not False:
            written += self._store_alignments(cfg, aligns)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + '.saving')
        tmp.write_text(content, encoding='utf-8', newline='')
        os.replace(tmp, path)
        written.append(target)
        commit = self._commit(written, req.get('message') or f'Published {target} with apparatus')
        return self._json({'ok': True, 'target': target, 'written': len(written), 'commit': commit})

    def _set_config(self, req):
        """Store the settings chosen in the editor (collation, apparatus) in editor.config.json."""
        cfg = project.read_section_config(self.folder) or {}
        for key in ('collation', 'apparatus'):
            if key in req:
                if not isinstance(req[key], dict):
                    return self._json({'ok': False, 'errors': [f'{key} must be an object']}, 400)
                cfg[key] = req[key]
        project.write_config(self.folder, cfg)
        commit = self._commit([CONFIG_NAME], 'Editor settings changed')
        return self._json({'ok': True, 'commit': commit})

    def _store_alignments(self, cfg, aligns):
        adir = self._safe(cfg.get('alignmentsDir', 'alignments'))
        adir.mkdir(exist_ok=True)
        written = []
        for block, xml in aligns.items():
            (adir / f'{block}.xml').write_text(xml, encoding='utf-8', newline='')
            written.append(os.path.relpath(adir / f'{block}.xml', self.folder))
        return written

    def _write_alignments(self, aligns, message):
        cfg = load_config(self.folder)
        if cfg.get('writeAlignments', True) is False:
            return self._json({'ok': True, 'written': []})
        errors = check_alignments(aligns)
        if errors:
            return self._json({'ok': False, 'errors': errors}, 422)
        written = self._store_alignments(cfg, aligns)
        commit = self._commit(written, message or 'Alignment files (generated)')
        return self._json({'ok': True, 'written': written, 'commit': commit})

    def _commit(self, written, msg, folder=None):
        folder = folder or self.folder
        if not written or not in_git_repo(folder):
            return None
        ident = []
        who = git(folder, 'config', 'user.email')
        if not (who and who.stdout.strip()):
            ident = ['-c', 'user.name=Saktumiva editor', '-c', 'user.email=editor@localhost']
        git(folder, 'add', '--', *written)
        r = git(folder, *ident, 'commit', '-m', msg.strip(), '--', *written)
        if r and r.returncode == 0:
            h = git(folder, 'rev-parse', '--short', 'HEAD')
            return h.stdout.strip() if h else None
        return None

    def _restructure(self, req):
        """Passages merged or split: the edition and the witness files change together, in one commit.
        Nothing is written unless every file is as the page loaded it and every new text is sound."""
        cfg = load_config(self.folder)
        allowed = [cfg['edition']] + list(cfg.get('witnesses', []))
        files = req.get('files')
        if not isinstance(files, list) or not files:
            return self._json({'ok': False, 'errors': ['no files to save']}, 400)
        names = [f.get('file') if isinstance(f, dict) else None for f in files]
        if any(n not in allowed for n in names) or len(set(names)) != len(names):
            return self._json({'ok': False, 'errors': ['only the edition and witness files can be saved']}, 400)
        if any(not isinstance(f.get('content'), str) for f in files):
            return self._json({'ok': False, 'errors': ['no content to save']}, 400)
        paths = {n: self._safe(n) for n in names}
        changed = [f['file'] for f in files if str(os.stat(paths[f['file']]).st_mtime_ns) != str(f.get('baseMtime'))]
        if changed:
            return self._json({'ok': False, 'conflict': True, 'errors': [
                f'{", ".join(changed)} changed on disk since you opened the section (perhaps in another editor). '
                'Nothing was saved. Reload the page to pick up the new version.']}, 409)
        remove = [str(b) for b in (req.get('removeAlignments') or [])]
        errors = [e for f in files for e in check_xml(f['content'], f['file'])]
        errors += [f'bad passage id {b!r}' for b in remove if not re.fullmatch(BLOCK_RE, b)]
        if errors:
            return self._json({'ok': False, 'errors': errors[:20]}, 422)

        tmps = []
        for f in files:
            tmp = paths[f['file']].with_name(paths[f['file']].name + '.saving')
            tmp.write_text(f['content'], encoding='utf-8', newline='')
            tmps.append((tmp, paths[f['file']]))
        for tmp, path in tmps:
            os.replace(tmp, path)
        written = list(names)
        # the alignment files of passages that no longer exist, or whose text is now different
        removed = []
        if remove and cfg.get('writeAlignments', True):
            adir = self._safe(cfg.get('alignmentsDir', 'alignments'))
            for b in remove:
                p = adir / f'{b}.xml'
                if not p.is_file():
                    continue
                rel = os.path.relpath(p, self.folder)
                tracked = git(self.folder, 'ls-files', '--error-unmatch', '--', rel)
                p.unlink()
                removed.append(rel)
                if tracked and tracked.returncode == 0:
                    written.append(rel)
        commit = self._commit(written, req.get('message') or 'Passages merged or split via Saktumiva editor')
        return self._json({'ok': True, 'mtimes': {n: str(os.stat(paths[n]).st_mtime_ns) for n in names},
                           'written': names, 'removed': removed, 'commit': commit})

    def _save(self, req):
        cfg = load_config(self.folder)
        edition = req.get('file')
        if edition not in [cfg['edition']] + list(cfg.get('witnesses', [])):
            return self._json({'ok': False, 'errors': ['only the edition and witness files can be saved']}, 400)
        path = self._safe(edition)
        cur_mtime = os.stat(path).st_mtime_ns
        if str(cur_mtime) != str(req.get('baseMtime')):
            return self._json({'ok': False, 'conflict': True, 'errors': [
                f'{edition} has changed on disk since you opened it (perhaps in another editor). '
                'Nothing was saved. Reload the page to pick up the new version.']}, 409)
        content = req.get('content')
        if not isinstance(content, str):
            return self._json({'ok': False, 'errors': ['no content to save']}, 400)
        aligns = req.get('alignments') or {}
        errors = check_xml(content, edition) + check_alignments(aligns)
        if errors:
            return self._json({'ok': False, 'errors': errors}, 422)

        written = []
        tmp = path.with_name(path.name + '.saving')
        tmp.write_text(content, encoding='utf-8', newline='')
        os.replace(tmp, path)
        written.append(edition)
        if cfg.get('writeAlignments', True) and aligns:
            written += self._store_alignments(cfg, aligns)

        commit = self._commit(written, req.get('message') or 'Edit via Saktumiva editor')
        return self._json({'ok': True, 'mtime': str(os.stat(path).st_mtime_ns),
                           'written': written, 'commit': commit,
                           'warnings': note_warnings(content)})


def make_server(port: int, tries: int = 10):
    """Bind to 127.0.0.1 on `port`, or the next free port."""
    last = None
    for p in range(port, port + tries):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), Handler)
            Handler.port = srv.server_address[1]     # port 0: any free port (used by the tests)
            return srv, Handler.port
        except OSError as e:
            last = e
    raise OSError(f'No free port between {port} and {port + tries - 1}: {last}')
