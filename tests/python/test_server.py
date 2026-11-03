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
