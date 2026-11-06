import json

from saktumiva_editor import project


def test_discovers_rasendramangala_chapters(rasendra):
    found = project.discover(rasendra)
    assert [s['rel'] for s in found['sections']] == ['chapter1', 'chapter2']
    assert all(not s['configured'] for s in found['sections'])
    assert found['sections'][0]['teiFiles'] == 9


def test_guess_for_txt_tei_files(rasendra):
    cfg = project.guess_config(rasendra / 'chapter1')
    assert cfg['edition'] == 'provisional_edition_ch1.txt'
    assert len(cfg['witnesses']) == 8 and 'l_london_ch1.txt' in cfg['witnesses']
    assert cfg['settingsFrom'] is None
    assert cfg['publishStylesheet'] is None and cfg['publishPolyfill'] is False


def test_no_edition_guessed_when_names_do_not_say(rasendra):
    cfg = project.guess_config(rasendra / 'chapter2')
    assert cfg['edition'] is None
    assert sorted(cfg['witnesses']) == ['g_gondal_34_ch2.txt', 'l_london_ch2.txt']
    assert 'no edition file is chosen' in project.config_problems(rasendra / 'chapter2', cfg)


def test_guess_reproduces_sushruta_config(sushruta):
    folder = sushruta / '03-su.sa'
    real = json.loads((folder / 'editor.config.json').read_text(encoding='utf-8'))
    cfg = project.guess_config(folder)
    assert cfg['edition'] == real['edition']
    assert cfg['witnesses'] == real['witnesses']
    assert cfg['settingsFrom'].startswith('alignments/')


def test_published_file_is_not_a_witness(sushruta):
    folder = sushruta / '03-su.sa'
    (folder / 'editor.config.json').unlink()
    (folder / 'provisional-edition_sarirasthana.xml').write_text(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text/><standOff type="apparatus"/></TEI>')
    cfg = project.guess_config(folder)
    assert cfg['edition'] == 'provisional-edition_sarirasthana_new.xml'
    assert cfg['publishTo'] == 'provisional-edition_sarirasthana.xml'
    assert 'provisional-edition_sarirasthana.xml' not in cfg['witnesses']


def test_project_file_lists_sections_and_gives_defaults(rasendra):
    (rasendra / 'saktumiva-project.json').write_text(json.dumps({
        'name': 'Rasendramaṅgala', 'sections': ['chapter1'],
        'defaults': {'extraIgnoreTags': ['trailer'], 'apparatus': {'showMinor': False}}}))
    found = project.discover(rasendra)
    assert found['name'] == 'Rasendramaṅgala'
    assert [s['rel'] for s in found['sections']] == ['chapter1']
    folder = rasendra / 'chapter1'
    project.write_config(folder, project.guess_config(folder))
    own = json.loads((folder / 'editor.config.json').read_text(encoding='utf-8'))
    cfg = project.load_config(folder)
    assert cfg['extraIgnoreTags'] == ['trailer']
    assert 'apparatus' not in own and 'extraIgnoreTags' not in own
    assert cfg['apparatus'] == {'showMinor': False}
    own['extraIgnoreTags'] = ['note']
    project.write_config(folder, own)
    assert project.load_config(folder)['extraIgnoreTags'] == ['note']   # the section's own setting wins


def test_section_folder_shows_its_whole_project(sushruta):
    found = project.discover(sushruta / '03-su.sa')
    assert found['root'] == str(sushruta)
    assert [s['rel'] for s in found['sections']] == ['03-su.sa']


def test_recent_projects(rasendra, tmp_path):
    project.remember(rasendra, rasendra / 'chapter1')
    project.remember(rasendra, rasendra / 'chapter2')
    items = project.recent()
    # one entry per section, most recent first
    assert [it['sectionName'] for it in items] == ['chapter2', 'chapter1'] and items[0]['exists']
    project.remember(rasendra, rasendra / 'chapter1')
    assert [it['sectionName'] for it in project.recent()] == ['chapter1', 'chapter2']
    # at most six
    for i in range(8):
        (tmp_path / f's{i}').mkdir()
        project.remember(tmp_path, tmp_path / f's{i}')
    items = project.recent()
    assert len(items) == project.RECENT_MAX == 6 and items[0]['sectionName'] == 's7'
    project.forget(items[0]['section'])
    assert [it['sectionName'] for it in project.recent()][:2] == ['s6', 's5']

def test_preferences():
    assert project.prefs() == {}
    project.set_prefs({'witnessOrder': ['K', 'N', 'H', 'A'], 'unknown': 1})
    assert project.prefs() == {'witnessOrder': ['K', 'N', 'H', 'A']}
    project.set_prefs({'stemma': {'proportional': False, 'lines': 'square'}})
    assert project.prefs()['stemma'] == {'proportional': False, 'lines': 'square'}
    project.set_prefs({'nexus': {'normalize': True, 'mergeGroups': False, 'gapsSignificant': False, 'corrections': 'pc'}})
    assert project.prefs()['nexus']['corrections'] == 'pc'
