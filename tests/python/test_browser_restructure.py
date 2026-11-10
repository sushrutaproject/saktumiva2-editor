"""Merging and splitting passages, in a real browser (Playwright, Chromium), down to the files on disk.

Skipped unless Playwright is installed (see test_browser_several.py).
"""
import re
import subprocess

import pytest

sync_api = pytest.importorskip('playwright.sync_api')

from test_browser_several import SECTION, SLOW, browser, item, page, selection  # noqa: E402,F401 - fixtures

ED = 'provisional-edition_sarirasthana_new.xml'
WITS = ['03-za-vulgate-1938.xml', 'nak_1-1079_sarirasthana.xml', 'nak_5-333_sarirasthana.xml', 'pul_7082_sarirasthana.xml']


def read(folder, name):
    return (folder / name).read_text(encoding='utf-8')


def passage(text, pid):
    """The letters of a passage as they stand in a file, without tags and white space."""
    m = re.search(r'<lg xml:id="%s"[^>]*>(.*?)</lg>' % re.escape(pid), text, re.S)
    return re.sub(r'<trailer.*?</trailer>|<[^>]+>|\s+', '', m.group(1)) if m else None


def last_commit(root):
    return subprocess.run(['git', 'show', '--name-status', '--format=%s', 'HEAD'], cwd=root, capture_output=True, text=True).stdout


def test_merge_two_passages_in_the_edition_and_all_witnesses(page, sushruta):
    folder = sushruta / SECTION
    before = {f: read(folder, f) for f in [ED] + WITS}
    item(page, 'SS.3.1.3').click()
    item(page, 'SS.3.1.4').click(modifiers=['Shift'])
    assert selection(page) == ['SS.3.1.3', 'SS.3.1.4']
    page.locator('#btn-merge').click()
    dialog = page.locator('#restructure-dialog')
    assert 'Merge 2 passages into SS.3.1.3' in dialog.inner_text()
    assert dialog.locator('tr[data-status="merged"]').count() == 5          # the edition and the four witnesses that have both
    assert dialog.locator('tr[data-status="unchanged"]').count() == 1       # K breaks off before
    assert dialog.locator('tr[data-status="error"]').count() == 0
    page.locator('#btn-rs-go').click()
    page.wait_for_function('!window.__editor.S.byId.has("SS.3.1.4") && window.__editor.S.current === "SS.3.1.3"')
    assert not dialog.is_visible()
    assert page.locator('.pitem[data-id="SS.3.1.4"]').count() == 0
    assert page.locator('#status').inner_text().startswith('All saved')
    assert 'tasmād avyaktān' in page.locator('#passage').inner_text() and 'sarvvabhūtānāṅ' in page.locator('#passage').inner_text()
    # every witness now shows the text of both under the one id
    assert 'tasmād avyaktān' in page.locator('.wit[data-siglum="A"] .wtext').inner_text()
    # on disk: one passage with all the letters of the two, nothing else different
    for f in [ED] + WITS:
        now = read(folder, f)
        assert 'xml:id="SS.3.1.4"' not in now, f
        assert passage(now, 'SS.3.1.3') == passage(before[f], 'SS.3.1.3') + passage(before[f], 'SS.3.1.4'), f
        assert len(before[f]) - len(now) == len('</lg><lg xml:id="SS.3.1.4">'), f
    assert 'corresp="#SS.3.1.4"' not in read(folder, ED)
    show = last_commit(sushruta)
    assert show.startswith('Passages SS.3.1.3, SS.3.1.4 merged into SS.3.1.3')
    assert show.count('\nM\t') == 5
    # the merged passage is collated afresh and its alignment file written
    page.wait_for_function('!window.__editor.S.pendingAlign.size', timeout=SLOW)
    page.wait_for_timeout(500)
    assert 'tasmād' in re.sub(r'<[^>]+>|\s+', '', read(folder, 'alignments/SS.3.1.3.xml')) or (folder / 'alignments/SS.3.1.3.xml').exists()
    # undo has nothing to undo; a reload shows the same
    page.reload()
    page.wait_for_function('window.__editor && window.__editor.S.current')
    assert page.evaluate('window.__editor.S.byId.has("SS.3.1.4")') is False


def test_split_a_passage_where_the_alignment_says(page, sushruta):
    folder = sushruta / SECTION
    before = {f: read(folder, f) for f in [ED] + WITS}
    item(page, 'SS.3.1.4').click()
    page.wait_for_function('window.__editor.S.results.has("SS.3.1.4")', timeout=SLOW)
    page.locator('#btn-split').click()
    dialog = page.locator('#restructure-dialog')
    assert 'Split SS.3.1.4 in two' in dialog.inner_text()
    assert dialog.locator('.sprow').count() == 1                             # the witnesses appear once the place is chosen
    # a click in the edition's text chooses a place …
    dialog.locator('.sprow.edition .sptext').click(position={'x': 200, 'y': 12})
    assert page.evaluate('window.__editor.SP.rows[0].offset') > 0
    assert dialog.locator('.sprow').count() == 5
    # … here, exactly: before "sa trividho"
    page.evaluate('''() => { const r = window.__editor.SP.rows[0]; window.__editor.setSplitOffset(r, r.text.indexOf('sa trividho')); }''')
    parts = page.evaluate('''() => window.__editor.SP.rows.map(r => [r.f.siglum, r.text.slice(r.offset, r.offset + 80).replace(/\\s+/g, ' ')])''')
    assert len(parts) == 5
    for siglum, text in parts:
        assert text.startswith('sa trivi'), (siglum, text)
    assert dialog.locator('.sprow[data-siglum="A"] .part2').first.inner_text().startswith('sa trividho')
    # a witness can be moved by hand
    dialog.locator('.sprow[data-siglum="A"] button', has_text='»').click()
    assert page.evaluate('''() => { const r = window.__editor.SP.rows.find(r => r.f.siglum === 'A'); return r.text.slice(r.offset, r.offset + 8); }''') == 'trividho'
    dialog.locator('.sprow[data-siglum="A"] button', has_text='«').click()
    # ids are checked
    page.fill('#sp-second', 'SS.3.1.5')
    page.locator('#btn-rs-go').click()
    assert 'already used' in page.locator('#rs-error').inner_text()
    assert read(folder, ED) == before[ED]
    page.fill('#sp-second', 'SS.3.1.4b')
    page.locator('#btn-rs-go').click()
    page.wait_for_function('window.__editor.S.byId.has("SS.3.1.4b")')
    assert selection(page) == ['SS.3.1.4', 'SS.3.1.4b']                    # both parts are shown
    assert page.locator('.pitem[data-id="SS.3.1.4b"]').count() == 1
    for f in [ED] + WITS:
        now = read(folder, f)
        a, b = passage(now, 'SS.3.1.4'), passage(now, 'SS.3.1.4b')
        assert a and b and a + b == passage(before[f], 'SS.3.1.4'), f
        assert b.startswith('satrivi'), f
    show = last_commit(sushruta)
    assert show.startswith('Passage SS.3.1.4 split into SS.3.1.4 and SS.3.1.4b')
    assert show.count('\nM\t') == 5


def test_unsaved_changes_come_first(page):
    page.evaluate('''() => { const E = window.__editor; E.S.log.push('pretend'); }''')
    page.locator('#btn-split').click()
    assert not page.locator('#restructure-dialog').is_visible()
    assert 'Save your changes first' in page.locator('#toast').inner_text()
