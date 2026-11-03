"""Command line: saktumiva-editor [FOLDER] [--port N] [--no-browser] [--check-updates]"""

import argparse
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import quote

from . import __version__, patches, project, updates
from .server import Handler, in_git_repo, make_server

USAGE = """\
Open the Saktumiva editor in your web browser.

  saktumiva-editor                    choose a project (recently used ones are listed)
  saktumiva-editor PROJECT-FOLDER     choose one of the project's sections
  saktumiva-editor SECTION-FOLDER     edit that section straight away

A section folder holds an edition file and the witness transcriptions collated with it.
Its settings are in editor.config.json; the editor helps you make one the first time.
"""


def main(argv=None):
    ap = argparse.ArgumentParser(prog='saktumiva-editor', description=USAGE,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder', nargs='?', type=Path, help='a project or section folder')
    ap.add_argument('--port', type=int, default=8800, help='port to use on 127.0.0.1 (default 8800, or the next free one)')
    ap.add_argument('--no-browser', action='store_true', help="don't open the web browser")
    ap.add_argument('--check-updates', action='store_true', help='check GitHub for a newer version and exit')
    ap.add_argument('--version', action='version', version=f'saktumiva-editor {__version__}')
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):   # folder names with diacritics on a Windows console
        try:
            stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass

    if args.check_updates:
        r = updates.check()
        if r.get('error'):
            sys.exit(r['error'])
        if not r.get('newer'):
            print(f'saktumiva-editor {__version__} is up to date.' + (f' ({r["note"]})' if r.get('note') else ''))
            return
        print(f'Version {r["latest"]} is available (you have {__version__}): {r["page"]}')
        how = r.get('how') or {}
        print(how.get('text', ''), how.get('command') or how.get('url') or '')
        return

    for p in patches.check_all():
        print(f'Warning: {p}', file=sys.stderr)

    start = '/'
    if args.folder:
        folder = args.folder.expanduser().resolve()
        if not folder.is_dir():
            sys.exit(f'Folder not found: {folder}')
        if not project.is_section(folder, {}) or project.any_subsections(folder, {}):
            start = '/choose?project=' + quote(str(folder), safe='')
        elif project.read_section_config(folder) is None:
            # a section that is not set up yet: the setup screen proposes an editor.config.json
            start = '/choose?setup=' + quote(str(folder), safe='')
        else:
            cfg = project.load_config(folder)
            probs = project.config_problems(folder, cfg)
            if probs:
                sys.exit(f'{folder / project.CONFIG_NAME}: ' + '; '.join(probs))
            Handler.folder = folder
            project.remember(project.find_project_root(folder), folder)
            if not in_git_repo(folder):
                print('Note: this folder is not in a git repository, so saves are not versioned.')

    srv, port = make_server(args.port)
    url = f'http://127.0.0.1:{port}{start}'
    what = Handler.folder.name if Handler.folder else 'choose a project'
    print(f'Saktumiva editor {__version__}: {what}\nOpen {url} in your browser (Ctrl+C here to stop).')
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
