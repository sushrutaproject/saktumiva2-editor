"""Projects, sections and their configuration.

A *section* is one folder holding an edition file and the witness transcriptions collated
with it (TEI, as .xml or any other extension). Its settings are in  editor.config.json.

A *project* is a folder of sections, e.g. a git repository with one folder per chapter.
It may have a  saktumiva-project.json  that says where the sections are and gives defaults
for every section's editor.config.json:

    {
      "name": "Rasendramaṅgala",
      "sections": ["chapter*", "commentary"],
      "fileExtensions": [".xml", ".txt"],
      "editionPattern": "provisional[-_]edition",
      "defaults": {"extraIgnoreTags": ["trailer"], "apparatus": {"normlem": true}}
    }

Every key is optional. Without the file, any folder (the project folder itself or one level
below it) that has an editor.config.json, a saktumiva.config.json or at least two TEI files
is a section.
"""

import json
import os
import re
import time
from pathlib import Path

from . import paths

CONFIG_NAME = 'editor.config.json'
PROJECT_NAME = 'saktumiva-project.json'
SAKTUMIVA_CONFIG = 'saktumiva.config.json'

DEFAULT_EXTENSIONS = ['.xml', '.txt', '.tei']
DEFAULT_EDITION_PATTERN = r'edition|^ed[-_.]'
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'alignments', '_site', '.github'}
MAX_FILES_SCANNED = 400


# ------------------------------------------------------------------ files

def is_tei(path: Path) -> bool:
    try:
        with open(path, 'rb') as f:
            head = f.read(4096)
    except OSError:
        return False
    return re.search(rb'<(\w+:)?TEI[\s>]', head) is not None


def has_apparatus(path: Path) -> bool:
    """A file already published with Saktumiva's apparatus (an output, not a witness)."""
    try:
        return '<standOff type="apparatus"' in path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return False


def tei_files(folder: Path, extensions=None):
    exts = {e.lower() for e in (extensions or DEFAULT_EXTENSIONS)}
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return []
    out = []
    for n in names[:MAX_FILES_SCANNED]:
        p = folder / n
        if p.suffix.lower() in exts and p.is_file() and not n.endswith('.saving') and is_tei(p):
            out.append(n)
    return out


# ------------------------------------------------------------------ project

def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def find_project_root(folder: Path) -> Path:
    """The folder with saktumiva-project.json above `folder`, else its git root, else its parent."""
    folder = folder.resolve()
    for p in [folder, *folder.parents][:4]:
        if (p / PROJECT_NAME).exists():
            return p
    for p in [folder, *folder.parents]:
        if (p / '.git').exists():
            return p
    return folder.parent if folder.parent != folder else folder


def project_settings(root: Path) -> dict:
    data = read_json(root / PROJECT_NAME)
    return data if isinstance(data, dict) else {}


def project_name(root: Path) -> str:
    return project_settings(root).get('name') or root.name


def section_info(folder: Path, root: Path, proj: dict) -> dict:
    cfg = read_json(folder / CONFIG_NAME)
    configured = isinstance(cfg, dict)
    teis = None if configured else tei_files(folder, proj.get('fileExtensions'))
    rel = os.path.relpath(folder, root)
    info = {'path': str(folder), 'rel': '.' if rel == '.' else rel.replace(os.sep, '/'),
            'name': folder.name, 'configured': configured}
    if configured:
        info['edition'] = cfg.get('edition')
        info['witnesses'] = len(cfg.get('witnesses') or [])
        missing = [f for f in [cfg.get('edition')] + list(cfg.get('witnesses') or []) if not f or not (folder / f).exists()]
        if missing:
            info['problem'] = f'files named in {CONFIG_NAME} are missing: {", ".join(map(str, missing))}'
    else:
        info['teiFiles'] = len(teis)
    return info


def discover(path: Path) -> dict:
    """The sections in a project folder (or the project a section folder belongs to)."""
    path = path.expanduser().resolve()
    if not path.is_dir():
        raise FileNotFoundError(f'Folder not found: {path}')
    # a section folder given directly: show its whole project
    root = path
    if not (path / PROJECT_NAME).exists() and is_section(path, {}) and not any_subsections(path, {}):
        root = find_project_root(path)
    proj = project_settings(root)
    found = []
    if proj.get('sections'):
        for pat in proj['sections']:
            found += [p for p in sorted(root.glob(pat)) if p.is_dir()]
    else:
        if is_section(root, proj):
            found.append(root)
        for p in subdirs(root):
            if is_section(p, proj):
                found.append(p)
    seen, sections = set(), []
    for f in found:
        if f not in seen:
            seen.add(f)
            sections.append(section_info(f, root, proj))
    return {'root': str(root), 'name': proj.get('name') or root.name, 'hasProjectFile': (root / PROJECT_NAME).exists(),
            'sections': sections, 'requested': str(path)}


def subdirs(folder: Path):
    try:
        return [p for p in sorted(folder.iterdir()) if p.is_dir() and p.name not in SKIP_DIRS and not p.name.startswith('.')]
    except OSError:
        return []


def is_section(folder: Path, proj: dict) -> bool:
    if (folder / CONFIG_NAME).exists() or (folder / SAKTUMIVA_CONFIG).exists():
        return True
    return len(tei_files(folder, proj.get('fileExtensions'))) >= 2


def any_subsections(folder: Path, proj: dict) -> bool:
    return any(is_section(p, proj) for p in subdirs(folder))


# ------------------------------------------------------------------ section config

def guess_config(folder: Path, proj: dict = None) -> dict:
    """A first editor.config.json for a section folder, from the files in it."""
    folder = folder.resolve()
    if proj is None:
        proj = project_settings(find_project_root(folder))
    files = tei_files(folder, proj.get('fileExtensions'))
    outputs = [f for f in files if has_apparatus(folder / f)]
    sk = read_json(folder / SAKTUMIVA_CONFIG) or {}
    pattern = re.compile(proj.get('editionPattern') or DEFAULT_EDITION_PATTERN, re.I)
    candidates = [f for f in files if pattern.search(f) and f not in outputs]
    # several candidates: a working copy (…_new, …_working) is the one edited
    candidates.sort(key=lambda f: (not re.search(r'[-_](new|working|draft)\b', Path(f).stem, re.I), f))
    edition = candidates[0] if candidates else None
    witnesses = [f for f in files if f != edition and f not in outputs]
    adir = sk.get('alignmentsdir') or 'alignments'
    aligns = sorted((folder / adir).glob('*.xml')) if (folder / adir).is_dir() else []
    cfg = {
        'edition': edition,
        'witnesses': witnesses,
        'alignmentsDir': adir,
        'settingsFrom': os.path.relpath(aligns[0], folder).replace(os.sep, '/') if aligns else None,
        'extraIgnoreTags': [],
        'apparatus': {'normlem': True, 'mergerdgs': True},
        'writeAlignments': True,
    }
    published = [f for f in outputs if pattern.search(f)]
    if published:
        cfg['publishTo'] = published[0]
    has_xsl = (folder / 'edition.xsl').exists()
    cfg['publishStylesheet'] = 'edition.xsl' if has_xsl else None
    cfg['publishPolyfill'] = has_xsl
    # settings the project gives for all its sections are not repeated here (see load_config)
    for k in proj.get('defaults') or {}:
        if k not in ('edition', 'witnesses'):
            cfg.pop(k, None)
    return cfg


def merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def candidate_files(folder: Path, proj: dict = None) -> list:
    """TEI files a section's edition and witnesses can be chosen from (for the setup screen)."""
    if proj is None:
        proj = project_settings(find_project_root(folder))
    return [{'name': f, 'apparatus': has_apparatus(folder / f)} for f in tei_files(folder, proj.get('fileExtensions'))]


def read_section_config(folder: Path):
    """The section's own editor.config.json (None if there is none)."""
    data = read_json(folder / CONFIG_NAME)
    return data if isinstance(data, dict) else None


def load_config(folder: Path, create: bool = True) -> dict:
    """The section's settings: the project's defaults, overridden by its editor.config.json."""
    own = read_section_config(folder)
    if own is None:
        if not create:
            raise FileNotFoundError(f'{folder / CONFIG_NAME} does not exist')
        own = guess_config(folder)
        write_config(folder, own)
        print(f'Created {folder / CONFIG_NAME} -- please check it.')
    defaults = project_settings(find_project_root(folder)).get('defaults') or {}
    return merge(defaults, own)


def write_config(folder: Path, cfg: dict):
    path = folder / CONFIG_NAME
    tmp = path.with_name(path.name + '.saving')
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def config_problems(folder: Path, cfg: dict) -> list:
    out = []
    if not cfg.get('edition'):
        out.append('no edition file is chosen')
    files = [cfg.get('edition')] + list(cfg.get('witnesses') or [])
    missing = [f for f in files if f and not (folder / f).exists()]
    if missing:
        out.append(f'files named in {CONFIG_NAME} are missing: {", ".join(missing)}')
    if not cfg.get('witnesses'):
        out.append('no witness files are chosen')
    for f in files:
        if f and (Path(f).is_absolute() or '..' in Path(f).parts):
            out.append(f'{f}: files must be inside the section folder')
    return out


# ------------------------------------------------------------------ recent projects

def _recent_file() -> Path:
    return paths.config_dir() / 'recent.json'


def recent() -> list:
    data = read_json(_recent_file())
    items = data if isinstance(data, list) else []
    for it in items:
        it['exists'] = Path(it.get('section') or it.get('root') or '').is_dir()
    return items


def remember(root: Path, section: Path):
    items = [it for it in recent() if it.get('root') != str(root)]
    items.insert(0, {'root': str(root), 'name': project_name(root), 'section': str(section),
                     'sectionName': section.name, 'opened': time.strftime('%Y-%m-%d %H:%M')})
    for it in items:
        it.pop('exists', None)
    f = _recent_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(items[:15], indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def forget(root: str):
    items = [it for it in recent() if it.get('root') != root]
    for it in items:
        it.pop('exists', None)
    f = _recent_file()
    if f.exists():
        f.write_text(json.dumps(items, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
