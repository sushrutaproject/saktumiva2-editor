"""From the text to the apparatus and back, and reading a hand-corrected alignment again, in a real browser.

Skipped unless Playwright is installed (see test_browser_several.py).
"""
import pytest

sync_api = pytest.importorskip('playwright.sync_api')

from test_browser_several import SECTION, SLOW, browser, page  # noqa: E402,F401 - fixtures


def open_passage(page, pid):
    page.evaluate('id => window.__editor.openPassage(id)', pid)
    page.wait_for_function(
        """id => { const S = window.__editor.S, r = S.results.get(id);
                   return S.current === id && r && document.querySelector('#collate-status').textContent
                     && !document.querySelector('#collate-status').textContent.startsWith('collating'); }""",
        arg=pid, timeout=SLOW)


def status(page):
    return page.locator('#collate-status').inner_text()


def settle(page):
    """Wait until scrolling has stopped and the browser has worked out again what is under the pointer."""
    page.evaluate("""() => new Promise(done => { const c = document.querySelector('#centre'); let last = -1, same = 0;
        const tick = () => { same = c.scrollTop === last ? same + 1 : 0; last = c.scrollTop; same > 12 ? done() : requestAnimationFrame(tick); };
        tick(); })""")
    page.wait_for_timeout(150)


# the entries that look picked out: framed, or with their "↑ text" button showing
FRAMED = """() => [...document.querySelectorAll('#apparatus .app')].filter(a => {
    const b = a.querySelector('.totext');
    return getComputedStyle(a).borderTopColor !== 'rgba(0, 0, 0, 0)' || (b && getComputedStyle(b).visibility === 'visible');
  }).map(a => a.dataset.key)"""

# the middle of the lemma of apparatus entry i, in the text
LEMMA_POINT = """i => { const S = window.__editor.S, r = S.appRanges[i].range;
    const h = new Range(); h.setStart(S.t2h.get(r.startContainer), r.startOffset); h.setEnd(S.t2h.get(r.endContainer), r.endOffset);
    const b = h.getClientRects()[0]; return [b.left + b.width / 2, b.top + b.height / 2]; }"""


def test_after_a_jump_only_the_entry_jumped_to_is_picked_out(page):
    """Clicking a word scrolls to its apparatus entry. The pointer stays where it was, and another entry may
    arrive under it: that one used to be framed too, with its own "↑ text" button, and looked like the target."""
    page.set_viewport_size({'width': 1400, 'height': 520})
    open_passage(page, 'SS.3.4.96')
    keys = page.evaluate('window.__editor.S.appRanges.map(a => a.key)')
    assert len(keys) >= 2
    # room to scroll, whatever the fonts of this machine
    page.evaluate("document.querySelector('#centre').style.paddingBottom = '100vh'")
    last = len(keys) - 1
    x, y = page.evaluate(LEMMA_POINT, last)
    page.mouse.click(x, y)
    settle(page)
    target = page.locator(f'#apparatus .app[data-key="{keys[last]}"]')
    assert 'focus' in target.get_attribute('class')
    # it can be seen whole
    box, height = target.bounding_box(), page.viewport_size['height']
    assert box['y'] >= 0 and box['y'] + box['height'] <= height
    # now another entry comes to lie under the pointer, which has not moved
    page.evaluate("""([key, y]) => { const a = document.querySelector(`#apparatus .app[data-key="${key}"]`).getBoundingClientRect();
        document.querySelector('#centre').scrollTop += a.top + a.height / 2 - y; }""", [keys[0], y])
    settle(page)
    under = page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.closest('.app')?.dataset.key ?? null", [x, y])
    assert under == keys[0], 'the test needs another entry under the pointer'
    assert page.evaluate(FRAMED) == [keys[last]]
    assert page.locator('#witnesses .wit.hl').count() == 0
    # pointing at an entry (moving the pointer) does pick it out, as before
    page.mouse.move(x + 3, y + 2)
    assert sorted(page.evaluate(FRAMED)) == sorted([keys[0], keys[last]])
    assert 'pointed' in page.locator(f'#apparatus .app[data-key="{keys[0]}"]').get_attribute('class')
    # and its "↑ text" goes back to its own lemma
    page.locator(f'#apparatus .app[data-key="{keys[0]}"] .totext').click()
    assert page.locator('#apparatus .app.focus').get_attribute('data-key') == keys[0]


def test_click_on_a_lemma_that_follows_another_without_a_space(page):
    """Two parts of one word as two entries (as after splitting a column in "Correct alignment"): the caret
    between them belongs to both, and the first used to win whichever letter was clicked."""
    open_passage(page, 'SS.3.4.96')
    keys = page.evaluate('window.__editor.S.appRanges.map(a => a.key)')
    # make the first two entries the two halves of one word of the text
    pts = page.evaluate("""() => {
        const S = window.__editor.S, doc = S.doc;
        const w = doc.createTreeWalker(S.byId.get('SS.3.4.96'), NodeFilter.SHOW_TEXT);
        let tn = null, m = null;
        while (w.nextNode()) { m = /[a-z]{6,}/.exec(w.currentNode.data); if (m && S.t2h.has(w.currentNode)) { tn = w.currentNode; break; } }
        const a = m.index, mid = a + 3, b = a + m[0].length;
        const mk = (s, e) => { const r = doc.createRange(); r.setStart(tn, s); r.setEnd(tn, e); return r; };
        S.appRanges[0].range = mk(a, mid); S.appRanges[1].range = mk(mid, b);
        for (const x of S.appRanges.slice(2)) x.range = null;
        const h = S.t2h.get(tn);
        const box = i => { const r = new Range(); r.setStart(h, i); r.setEnd(h, i + 1); return r.getClientRects()[0]; };
        const before = box(mid - 1), after = box(mid);
        return {lastOfFirst: [before.right - 1, before.top + before.height / 2], firstOfSecond: [after.left + 1, after.top + after.height / 2]};
    }""")
    focused = "() => document.querySelector('#apparatus .app.focus')?.dataset.key ?? null"
    page.mouse.click(*pts['firstOfSecond'])
    assert page.evaluate(focused) == keys[1]
    page.mouse.click(*pts['lastOfFirst'])
    assert page.evaluate(focused) == keys[0]


def test_a_corrected_alignment_is_used_again_when_a_witness_has_scribal_corrections(page, sushruta):
    """H has a correction (<add>/<del>) in SS.3.4.90cd, so the alignment has rows "Hac" and "Hpc" and none called "H".
    The editor took H to be missing from the saved alignment, collated afresh, and said that the corrected
    alignment "no longer fits its text" although nothing had changed."""
    pid = 'SS.3.4.90cd'
    open_passage(page, pid)
    assert status(page).startswith('collated')          # the fixture has no alignment file for this passage
    rows = page.evaluate('id => window.__editor.S.results.get(id).res.rows', pid)
    assert 'Hac' in rows and 'Hpc' in rows and 'H' not in rows
    # correct the alignment by hand: join two columns
    page.locator('#btn-align').click()
    page.wait_for_selector('#al-table button[data-op="merge"]')
    page.locator('#al-table button[data-op="merge"]').first.click()
    assert page.locator('#btn-al-save').is_enabled()
    page.locator('#btn-al-save').click()
    page.wait_for_function('document.querySelector("#aligner").hidden')
    assert status(page) == 'from your corrected alignment'
    entries = page.locator('#apparatus .app').all_inner_texts()
    assert 'hand-corrected' in (sushruta / SECTION / 'alignments' / f'{pid}.xml').read_text(encoding='utf-8')
    # start again: the saved file is read, and used
    page.reload()
    page.wait_for_function('window.__editor && window.__editor.S.current')
    open_passage(page, pid)
    assert status(page) == 'from your corrected alignment'
    assert page.locator('#apparatus .error').count() == 0
    assert 'no longer fits' not in page.locator('#apparatus').inner_text()
    assert page.locator('#apparatus .app').all_inner_texts() == entries
    assert page.evaluate('id => window.__editor.S.results.get(id).res.source', pid) == 'file'
