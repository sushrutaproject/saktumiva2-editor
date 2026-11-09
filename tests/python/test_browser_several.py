"""Several passages at once, in a real browser (Playwright, Chromium).

Skipped unless Playwright is installed:  pip install playwright && python -m playwright install chromium
(or with Google Chrome installed, which is used if Playwright's own Chromium is missing).
"""
import pytest

sync_api = pytest.importorskip('playwright.sync_api')

SECTION = '03-su.sa'
SLOW = 90_000   # collating a passage afresh in the browser


@pytest.fixture(scope='module')
def browser():
    with sync_api.sync_playwright() as p:
        b = None
        for kw in ({}, {'channel': 'chrome'}):
            try:
                b = p.chromium.launch(**kw)
                break
            except Exception:  # noqa: BLE001 - no browser of this kind installed
                continue
        if b is None:
            pytest.skip('no Chromium or Chrome for Playwright')
        yield b
        b.close()


@pytest.fixture
def page(browser, server, sushruta):
    st, r = server.post('/api/open', {'folder': str(sushruta / SECTION)})
    assert st == 200, r
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
    pg = ctx.new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.goto(server.base + '/')
    pg.wait_for_function('window.__editor && window.__editor.S.current')
    pg.wait_for_selector('.pitem[data-id="SS.3.1.1"]')
    yield pg
    ctx.close()


def item(page, pid):
    return page.locator(f'.pitem[data-id="{pid}"]')


def selection(page):
    return page.evaluate('[...window.__editor.S.selection]')


def wait_ready(page, n):
    page.wait_for_function(f'document.querySelector("#collate-status").textContent === "all {n} passages ready"', timeout=SLOW)


def test_shift_click_shows_a_range_with_headings_apparatus_and_witnesses(page):
    item(page, 'SS.3.1.1').click()
    item(page, 'SS.3.1.3').click(modifiers=['Shift'])
    assert selection(page) == ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.3']
    assert page.locator('#passage-id').inner_text() == 'SS.3.1.1 – SS.3.1.3'
    # the text: one section per passage, in document order, each headed by its id
    assert page.locator('#passage .mpass').evaluate_all('els => els.map(e => e.dataset.id)') == ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.3']
    assert page.locator('#passage .mhead .mopen').all_inner_texts() == ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.3']
    # the editing tools for one passage give way to the way back
    assert page.locator('#reading-tools').is_hidden() and page.locator('#btn-single').is_visible()
    assert page.locator('.pitem.selected').count() == 3
    # the apparatus, grouped under each passage, fills in as each passage is ready
    wait_ready(page, 3)
    groups = page.locator('#apparatus .appgroup')
    assert groups.evaluate_all('els => els.map(e => e.dataset.id)') == ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.3']
    for pid in ['SS.3.1.1', 'SS.3.1.3']:
        g = page.locator(f'#apparatus .appgroup[data-id="{pid}"]')
        assert g.locator('.app').count() > 0
        assert g.locator('.app').first.get_attribute('data-key').startswith(pid + '|')
        assert g.locator('.rdg .use').count() > 0                      # "use" / "omit" as for one passage
    assert page.locator('#apparatus .minor').count() > 0              # minor readings
    assert 'A = ' in page.locator('#multi-legend').inner_text()       # one legend for all
    assert page.locator('.ghead .mstatus.ok').count() == 3
    # notes of the passages shown, under their ids
    assert page.locator('#notes .notegroup[data-id="SS.3.1.1"] .note').count() >= 1
    # witnesses: each witness's text of every passage shown
    assert page.locator('#wit-scope').inner_text() == 'these passages'
    wa = page.locator('#witnesses .wit[data-siglum="A"]')
    assert wa.locator('.wseg').evaluate_all('els => els.map(e => e.dataset.id)') == ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.3']
    assert page.locator('#witnesses .wit button', has_text='edit').count() == 0   # corrected one passage at a time


def test_ctrl_click_adds_and_removes_single_passages(page):
    item(page, 'SS.3.1.1').click()
    item(page, 'SS.3.1.4').click(modifiers=['Control'])
    item(page, 'SS.3.2.1').click(modifiers=['Control'])
    assert selection(page) == ['SS.3.1.1', 'SS.3.1.4', 'SS.3.2.1']
    assert page.locator('#passage-id').inner_text() == 'SS.3.1.1, SS.3.1.4, SS.3.2.1'
    assert page.locator('#btn-several').get_attribute('aria-pressed') == 'true'
    item(page, 'SS.3.1.4').click(modifiers=['Control'])
    assert selection(page) == ['SS.3.1.1', 'SS.3.2.1']
    # with "Show several" on, the tick boxes do the same without a key
    page.locator('.pitem[data-id="SS.3.1.2"] .pcheck').click()
    assert selection(page) == ['SS.3.1.1', 'SS.3.1.2', 'SS.3.2.1']
    # a plain click still shows just that passage
    item(page, 'SS.3.1.2').click()
    assert selection(page) == ['SS.3.1.2']
    assert page.locator('#passage .mpass').count() == 0


def test_back_to_one_passage(page):
    item(page, 'SS.3.1.1').click()
    item(page, 'SS.3.1.2').click(modifiers=['Shift'])
    # the heading of a passage opens it alone, with all the editing tools
    page.locator('#passage .mhead[data-id="SS.3.1.2"] .mopen').click()
    assert selection(page) == ['SS.3.1.2']
    assert page.locator('#passage-id').inner_text() == 'SS.3.1.2'
    assert page.locator('#reading-tools').is_visible() and page.locator('#multi-tools').is_hidden()
    assert page.locator('#wit-scope').inner_text() == 'this passage'
    page.wait_for_selector('#apparatus .app, #apparatus p', timeout=SLOW)
    assert page.locator('#apparatus .appgroup').count() == 0
    # "Show one passage", and Esc
    item(page, 'SS.3.1.1').click(modifiers=['Shift'])
    assert len(selection(page)) == 2
    page.locator('#btn-single').click()
    assert len(selection(page)) == 1
    item(page, 'SS.3.1.3').click(modifiers=['Shift'])
    page.locator('#passage').click(position={'x': 5, 'y': 5})
    page.keyboard.press('Escape')
    assert len(selection(page)) == 1
    # turning "Show several" off also goes back to one passage
    item(page, 'SS.3.1.1').click(modifiers=['Shift'])
    page.locator('#btn-several').click()
    assert len(selection(page)) == 1
    assert page.locator('#btn-several').get_attribute('aria-pressed') == 'false'
    # editing tools are refused politely in the several-passages view
    item(page, 'SS.3.1.2').click(modifiers=['Shift'])
    page.keyboard.press('e')
    assert page.evaluate('window.__editor.S.mode') == 'read'
    assert 'heading' in page.locator('#toast').inner_text()


def test_use_a_reading_in_the_combined_apparatus_then_undo_and_save(page, sushruta):
    item(page, 'SS.3.1.1').click()
    item(page, 'SS.3.1.2').click(modifiers=['Shift'])
    wait_ready(page, 2)
    g = page.locator('#apparatus .appgroup[data-id="SS.3.1.1"]')
    rdg = g.locator('.app .rdg').first
    rdg.hover()
    rdg.locator('.use').click()
    assert page.evaluate('window.__editor.S.log.length') == 1
    assert page.evaluate('window.__editor.S.log[0]').startswith('SS.3.1.1:')
    assert page.locator('.pitem[data-id="SS.3.1.1"] .mark.dirty').count() == 1
    assert page.locator('#passage .mhead[data-id="SS.3.1.1"] .mark.dirty').count() == 1
    assert page.locator('#passage .mhead[data-id="SS.3.1.2"] .mark.dirty').count() == 0
    assert selection(page) == ['SS.3.1.1', 'SS.3.1.2']          # still both shown
    page.locator('#btn-undo').click()
    assert page.evaluate('window.__editor.S.log.length') == 0
    assert page.locator('.mark.dirty').count() == 0
    assert selection(page) == ['SS.3.1.1', 'SS.3.1.2']
    page.locator('#btn-redo').click()
    assert page.locator('.pitem[data-id="SS.3.1.1"] .mark.dirty').count() == 1
    page.keyboard.press('Control+s')
    page.wait_for_function('document.querySelector("#status").textContent.startsWith("All saved")')
    assert page.locator('.mark.dirty').count() == 0
    assert selection(page) == ['SS.3.1.1', 'SS.3.1.2']


def test_the_choice_is_remembered_for_the_session(page):
    item(page, 'SS.3.1.2').click()
    item(page, 'SS.3.1.4').click(modifiers=['Shift'])
    page.reload()
    page.wait_for_function('window.__editor && window.__editor.S.selection.length > 1')
    assert selection(page) == ['SS.3.1.2', 'SS.3.1.3', 'SS.3.1.4']
    assert page.locator('#btn-several').get_attribute('aria-pressed') == 'true'
    # back to one passage, with "Show several" still on: that too is remembered
    page.locator('#btn-single').click()
    page.reload()
    page.wait_for_function('window.__editor && window.__editor.S.current')
    assert len(selection(page)) == 1
    assert page.locator('#btn-several').get_attribute('aria-pressed') == 'true'
    assert page.locator('.pitem .pcheck').first.is_visible()
