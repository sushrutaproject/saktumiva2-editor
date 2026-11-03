// Shared by the editor and the project chooser: the Help menu and "Check for updates".

export const $ = (s, r = document) => r.querySelector(s);
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
};

// A button that opens a small menu of buttons below it.
export function setupMenu(menu) {
  const btn = menu.querySelector('[aria-haspopup]'), items = menu.querySelector('[role="menu"]');
  const close = () => { items.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    items.hidden = !items.hidden; btn.setAttribute('aria-expanded', String(!items.hidden));
    if (!items.hidden) items.querySelector('button')?.focus();
  });
  items.addEventListener('click', close);
  document.addEventListener('click', e => { if (!menu.contains(e.target)) close(); });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const all = [...items.querySelectorAll('button')], i = all.indexOf(document.activeElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); e.preventDefault();
    }
  });
}

export function dialog(title, ...content) {
  let d = $('#common-dialog');
  if (!d) {
    d = h('dialog', {id: 'common-dialog'}, h('div', {class: 'body'}),
      h('div', {class: 'dialog-buttons'}, h('span', {class: 'spacer'}), h('button', {class: 'primary', onclick: () => d.close()}, 'Close')));
    document.body.append(d);
  }
  d.querySelector('.body').replaceChildren(h('h3', {}, title), ...content);
  if (!d.open) d.showModal();
  return d;
}

const copyable = cmd => h('div', {class: 'cmd'}, h('code', {}, cmd),
  h('button', {onclick: e => { navigator.clipboard?.writeText(cmd); e.target.textContent = 'Copied'; }}, 'Copy'));

export async function checkForUpdates() {
  dialog('Check for updates', h('p', {class: 'muted'}, 'Asking GitHub for the latest release…'));
  let r;
  try { r = await (await fetch('/api/update-check', {cache: 'no-store'})).json(); }
  catch (e) { r = {error: e.message}; }
  if (r.error) return dialog('Check for updates', h('p', {class: 'error'}, r.error),
    h('p', {}, 'You have version ', h('b', {}, r.current || '?'), '. Releases are listed at ', h('a', {href: r.page, target: '_blank', rel: 'noopener'}, r.page || 'GitHub'), '.'));
  if (!r.newer) return dialog('Check for updates', h('p', {}, `You have the latest version (${r.current}).`),
    r.note ? h('p', {class: 'muted'}, r.note) : null);
  const how = r.how || {};
  dialog(`Version ${r.latest} is available`,
    h('p', {}, `You have ${r.current}. Version ${r.latest}${r.published ? ` was released on ${r.published}` : ''}.`),
    r.notes ? h('details', {}, h('summary', {}, 'What’s new'), h('pre', {class: 'notes'}, r.notes)) : null,
    h('p', {}, how.text || ''),
    how.command ? copyable(how.command) : null,
    how.url ? h('p', {}, h('a', {href: how.url, target: '_blank', rel: 'noopener'}, how.url.split('/').pop() || how.url)) : null,
    h('p', {class: 'muted'}, 'Save your work and stop the editor (Ctrl+C in its terminal) before updating. ',
      h('a', {href: r.page, target: '_blank', rel: 'noopener'}, 'Release page')));
}

export async function showAbout() {
  let st = {};
  try { st = await (await fetch('/api/state', {cache: 'no-store'})).json(); } catch { /* offline */ }
  dialog('Saktumiva editor',
    h('p', {}, `Version ${st.version || '?'} (${({executable: 'ready-made program', pipx: 'installed with pipx', source: 'running from a git checkout', pip: 'installed with pip'})[st.install] || st.install || ''}).`),
    h('p', {}, 'A local editing screen for critical editions collated with ',
      h('a', {href: 'https://github.com/chchch/saktumiva', target: '_blank', rel: 'noopener'}, 'Saktumiva'), ' by Charles Li, whose code does the collation and makes the apparatus.'),
    st.patchProblems?.length ? h('p', {class: 'error'}, 'This copy of Saktumiva does not fit the editor’s changes: ', st.patchProblems.join('; ')) : null,
    h('p', {}, h('a', {href: 'https://github.com/sushrutaproject/saktumiva2-editor', target: '_blank', rel: 'noopener'}, 'github.com/sushrutaproject/saktumiva2-editor')));
}
