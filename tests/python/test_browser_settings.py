"""Settings: normalizations that cannot both apply, in a real browser.

Skipped unless Playwright is installed (see test_browser_several.py).
"""
import json

import pytest

sync_api = pytest.importorskip('playwright.sync_api')

from test_browser_several import SECTION, browser, page  # noqa: E402,F401 - fixtures

NAMES = """() => window.__editor.S.collator.filtersnames.filter(n => /avagraha/.test(n))"""


def box(page, name):
    return page.locator('#settings-form label.chk', has_text=name).filter(
        has=page.locator('xpath=ancestor::details[1]/summary[starts-with(normalize-space(), "Sanskrit")]')).locator('input')


def test_remove_avagrahas_overrides_avagrahas_to_short_a_and_settings_says_so(page, sushruta):
    page.locator('#btn-info').click()
    warning = page.locator('#set-filter-conflicts')
    short_a, remove = box(page, 'avagrahas to short a'), box(page, 'remove avagrahas')
    assert short_a.is_checked() and not remove.is_checked()
    assert warning.is_hidden()

    # ticking the second one brings the warning at once; unticking it takes the warning away
    remove.check()
    assert warning.is_visible()
    text = warning.inner_text()
    assert '“remove avagrahas” is ticked together with' in text and '“avagrahas to short a”' in text
    assert 'not applied' in text
    remove.uncheck()
    assert warning.is_hidden()

    # applied with both ticked: both stay ticked (and saved), but only "remove avagrahas" is used
    remove.check()
    with page.expect_navigation():   # applying settings reloads the editor
        page.get_by_role('button', name='Apply').click()
    page.wait_for_function('window.__editor && window.__editor.S.current && window.__editor.S.collator')
    saved = json.loads((sushruta / SECTION / 'editor.config.json').read_text(encoding='utf-8'))['collation']['filters']
    assert 'avagrahas to short a' in saved and 'remove avagrahas' in saved
    used = page.evaluate(NAMES)
    assert 'remove avagrahas' in used and 'avagrahas to short a' not in used and 'double avagrahas' not in used
    page.locator('#btn-info').click()
    assert box(page, 'avagrahas to short a').is_checked() and box(page, 'remove avagrahas').is_checked()
    assert page.locator('#set-filter-conflicts').is_visible()
