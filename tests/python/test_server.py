import json
import os
import subprocess
from urllib.parse import quote

from saktumiva_editor.server import Handler


def setup_and_open(server, folder, **cfg):
    st, info = server.get('/api/setup?path=' + quote(str(folder)))
    assert st == 200
    config = {**info['config'], **cfg}
    st, r = server.post('/api/setup', {'folder': str(folder), 'config': config})
    assert st == 200, r
    st, r = server.post('/api/open', {'folder': str(folder)})
    assert st == 200, r


def test_chooser_until_a_section_is_open(server):
    st, page = server.get('/')
    assert st == 200 and b'chooser.mjs' in page
    st, r = server.get('/api/config')
    assert st == 409 and r['noFolder']


def test_setup_open_and_save(server, rasendra):
    folder = rasendra / 'chapter1'
    st, r = server.post('/api/open', {'folder': str(folder)})
    assert st == 409 and r['needsSetup']
    setup_and_open(server, folder)
    assert (folder / 'editor.config.json').exists()
    log = subprocess.run(['git', 'log', '--format=%s'], cwd=rasendra, capture_output=True, text=True).stdout
    assert 'section set up' in log

    st, info = server.get('/api/config')
    assert st == 200 and info['section'] == 'chapter1' and info['git']
    ed = info['config']['edition']
    st, raw = server.get('/project/' + ed)
    text = raw.decode()
    hdr = {'X-Saktumiva-Folder': quote(info['folder'])}
    new = text.replace('natvā', 'natvāX', 1)
    st, r = server.post('/api/save', {'file': ed, 'baseMtime': info['mtimes'][ed], 'content': new, 'message': 'test edit'}, headers=hdr)
    assert st == 200 and r['commit'], r
    assert (folder / ed).read_bytes() == new.encode('utf-8')   # written exactly as sent, line endings too
    # the file is now newer than what the page loaded: refused
    st, r = server.post('/api/save', {'file': ed, 'baseMtime': info['mtimes'][ed], 'content': text}, headers=hdr)
    assert st == 409 and r['conflict']


def test_save_refuses_bad_xml_and_duplicate_ids(server, rasendra):
    folder = rasendra / 'chapter1'
    setup_and_open(server, folder)
    st, info = server.get('/api/config')
    ed = info['config']['edition']
    base = info['mtimes'][ed]
    st, r = server.post('/api/save', {'file': ed, 'baseMtime': base, 'content': '<TEI><unclosed></TEI>'})
    assert st == 422
    dup = '<TEI xmlns="http://www.tei-c.org/ns/1.0"><p xml:id="a"/><p xml:id="a"/></TEI>'
    st, r = server.post('/api/save', {'file': ed, 'baseMtime': base, 'content': dup})
    assert st == 422 and 'duplicate' in r['errors'][0]
    st, r = server.post('/api/save', {'file': '../../etc/passwd', 'baseMtime': base, 'content': dup})
    assert st == 400


def test_window_on_another_section_cannot_save(server, rasendra, sushruta):
    setup_and_open(server, rasendra / 'chapter1')
    st, info = server.get('/api/config')
    st, r = server.post('/api/open', {'folder': str(sushruta / '03-su.sa')})
    assert st == 200
    ed = info['config']['edition']
    st, r = server.post('/api/save', {'file': ed, 'baseMtime': info['mtimes'][ed], 'content': '<TEI/>'},
                        headers={'X-Saktumiva-Folder': quote(info['folder'])})
    assert st == 409 and r['stale']
    st, r = server.get('/project/' + ed, headers={'X-Saktumiva-Folder': quote(info['folder'])})
    assert st == 409


def test_setup_needs_an_edition(server, rasendra):
    folder = rasendra / 'chapter2'
    st, r = server.post('/api/setup', {'folder': str(folder), 'config': {'edition': None, 'witnesses': ['l_london_ch2.txt']}})
    assert st == 422 and 'no edition file is chosen' in r['errors']
    assert not (folder / 'editor.config.json').exists()
    st, r = server.post('/api/setup', {'folder': str(folder), 'config': {'edition': 'l_london_ch2.txt', 'witnesses': ['g_gondal_34_ch2.txt']}})
    assert st == 200


def test_settings_keep_project_defaults_out_of_the_section_file(server, rasendra):
    (rasendra / 'saktumiva-project.json').write_text(json.dumps({'defaults': {'extraIgnoreTags': ['trailer']}}), encoding='utf-8')
    folder = rasendra / 'chapter1'
    setup_and_open(server, folder)
    st, r = server.post('/api/config', {'apparatus': {'normlem': False}})
    assert st == 200
    own = json.loads((folder / 'editor.config.json').read_text(encoding='utf-8'))
    assert own['apparatus'] == {'normlem': False}
    assert 'trailer' not in own.get('extraIgnoreTags', [])


def test_project_and_browse_api(server, rasendra):
    st, r = server.get('/api/project?path=' + quote(str(rasendra)))
    assert st == 200 and [s['rel'] for s in r['sections']] == ['chapter1', 'chapter2']
    st, r = server.get('/api/browse?path=' + quote(str(rasendra)))
    assert st == 200 and {d['name'] for d in r['dirs']} == {'chapter1', 'chapter2'}
    assert all(d['section'] for d in r['dirs'])


def test_serves_patched_saktumiva_and_nothing_else_of_it(server):
    st, body = server.get('/saktumiva/lib/apparatus.mjs')
    assert st == 200 and b'opts.equivalent(id, newstr, lemma)' in body
    st, _ = server.get('/saktumiva/editmode/openseadragon/openseadragon.min.mjs')
    assert st == 200
    st, _ = server.get('/saktumiva/readme.md')
    assert st == 403


def test_serves_the_stemma_view(server):
    st, page = server.get('/stemma.mjs')
    assert st == 200 and b'export function findStemmata' in page


def test_refuses_other_host_names(server):
    st, _ = server.get('/api/state', headers={'Host': 'attacker.example'})
    assert st == 403
    st, r = server.get('/api/state', headers={'Host': f'localhost:{Handler.port}'})
    assert st == 200 and r['version']


def test_cache_goes_to_the_editor_home(server, rasendra, editor_home):
    setup_and_open(server, rasendra / 'chapter1')
    st, r = server.post('/api/cache', {'block': 'ch1.1', 'key': 'k', 'xml': '<x/>'})
    assert st == 200
    st, body = server.get('/api/cache?block=ch1.1&key=k')
    assert st == 200 and body == b'<x/>'
    assert list((editor_home / 'cache').rglob('ch1.1.json'))
    assert not any(p.name == 'ch1.1.json' for p in rasendra.rglob('*'))


def test_running_copies_are_found(server):
    from saktumiva_editor import instances
    found = instances.find_running(server.port, tries=1)
    assert found and found[0]['port'] == server.port and found[0]['folder'] is None


def test_cli_reuses_a_running_copy(server, monkeypatch, capsys):
    from saktumiva_editor import cli
    opened = []
    monkeypatch.setattr(cli.webbrowser, 'open', opened.append)
    cli.main(['--port', str(server.port)])          # returns at once instead of starting a second server
    assert opened == [f'http://127.0.0.1:{server.port}/'] and 'already running' in capsys.readouterr().out


def test_no_free_port_message():
    from saktumiva_editor.cli import no_port_message
    assert 'other programs' in no_port_message(8800, [])
    msg = no_port_message(8800, [{'port': 8801, 'folder': '/x/03-su.sa', 'version': '0.3.0'}])
    assert '8801' in msg and '03-su.sa' in msg and 'pkill' in msg


def test_cli_does_not_reuse_an_older_copy(server, monkeypatch, capsys):
    from saktumiva_editor import cli, instances
    monkeypatch.setattr(instances, 'find_running', lambda start, tries=10: [{'port': server.port, 'version': '0.1.0', 'folder': None}])
    started = []
    class FakeSrv:
        def serve_forever(self): started.append(True)
        def server_close(self): pass
    monkeypatch.setattr(cli, 'make_server', lambda port: (FakeSrv(), server.port + 1))
    monkeypatch.setattr(cli.webbrowser, 'open', lambda url: None)
    monkeypatch.setattr(cli.threading, 'Timer', lambda *a, **k: type('T', (), {'start': lambda self: None})())
    cli.main(['--port', str(server.port), '--no-browser'])
    out = capsys.readouterr().out
    assert started and 'older copy' in out and '0.1.0' in out


def test_restructure_writes_several_files_in_one_commit_or_none(server, sushruta):
    folder = sushruta / '03-su.sa'
    st, r = server.post('/api/open', {'folder': str(folder)})
    assert st == 200, r
    st, info = server.get('/api/config')
    ed, wit = info['config']['edition'], info['config']['witnesses'][0]
    hdr = {'X-Saktumiva-Folder': quote(info['folder'])}
    texts = {f: (folder / f).read_text(encoding='utf-8') for f in (ed, wit)}
    new = {f: t.replace('</TEI>', '<!-- changed --></TEI>') for f, t in texts.items()}
    body = lambda content, mt=info['mtimes']: {  # noqa: E731
        'files': [{'file': f, 'baseMtime': mt[f], 'content': content[f]} for f in (ed, wit)],
        'removeAlignments': ['SS.3.1.1', 'SS.3.1.2', 'no.such.passage'], 'message': 'SS.3.1.1 + SS.3.1.2 merged'}

    # one unsound file: nothing at all is written
    bad = {ed: new[ed], wit: '<TEI><unclosed></TEI>'}
    st, r = server.post('/api/restructure', body(bad), headers=hdr)
    assert st == 422
    assert (folder / ed).read_text(encoding='utf-8') == texts[ed] and (folder / 'alignments' / 'SS.3.1.1.xml').exists()
    # one file changed on disk meanwhile: nothing is written
    st, r = server.post('/api/restructure', body(new, {**info['mtimes'], wit: '1'}), headers=hdr)
    assert st == 409 and r['conflict'] and wit in r['errors'][0]
    assert (folder / ed).read_text(encoding='utf-8') == texts[ed]
    # only the edition and the witnesses
    st, r = server.post('/api/restructure', {'files': [{'file': 'editor.config.json', 'baseMtime': '1', 'content': '<TEI/>'}]}, headers=hdr)
    assert st == 400

    st, r = server.post('/api/restructure', body(new), headers=hdr)
    assert st == 200 and r['commit'], r
    assert set(r['mtimes']) == {ed, wit}
    assert sorted(r['removed']) == ['alignments/SS.3.1.1.xml', 'alignments/SS.3.1.2.xml']
    for f in (ed, wit):
        assert (folder / f).read_bytes() == new[f].encode('utf-8')
    assert not (folder / 'alignments' / 'SS.3.1.1.xml').exists() and (folder / 'alignments' / 'SS.3.4.96.xml').exists()
    show = subprocess.run(['git', 'show', '--name-status', '--format=%s', 'HEAD'], cwd=sushruta, capture_output=True, text=True).stdout
    assert show.startswith('SS.3.1.1 + SS.3.1.2 merged')
    assert f'M\t03-su.sa/{ed}' in show and f'M\t03-su.sa/{wit}' in show and 'D\t03-su.sa/alignments/SS.3.1.1.xml' in show
    assert subprocess.run(['git', 'status', '--porcelain'], cwd=sushruta, capture_output=True, text=True).stdout.strip() == ''
