// The project chooser: recent projects, a folder browser, a project's sections, and setting up a section.
import { $, h, dialog, setupMenu, checkForUpdates, showAbout } from './common.mjs';

const main = $('#chooser');
const get = async url => (await fetch(url, {cache: 'no-store'})).json();
const post = async (url, body) => (await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(body)})).json().catch(e => ({ok: false, errors: [e.message]}));
let toastTimer;
const toast = (msg, bad = false, ms = 5000) => {
  const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
};
const go = (params, replace = false) => {
  const url = '/choose' + (params ? '?' + new URLSearchParams(params) : '');
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  route();
};
const card = (...kids) => h('section', {class: 'card'}, ...kids);

async function openSection(folder) {
  const r = await post('/api/open', {folder});
  if (r.ok) { location.href = '/'; return; }
  if (r.needsSetup) return go({setup: folder});
  toast((r.errors || ['Could not open the section']).join(' '), true);
}

// ---------------------------------------------------------------- start: recent projects and a folder
async function home() {
  const {recent} = await get('/api/recent');
  const list = recent.length ? h('ul', {class: 'choices'}, ...recent.map(it => h('li', {class: it.exists ? '' : 'gone'},
    h('button', {class: 'choice', disabled: !it.exists, title: `Edit ${it.sectionName} again`, onclick: () => openSection(it.section)},
      h('span', {}, h('b', {}, it.sectionName), h('span', {class: 'muted'}, ` — ${it.name}`)),
      h('span', {class: 'small muted'}, it.exists ? `${it.section} · last opened ${it.opened}` : `${it.section} · folder not found`)),
    it.exists ? h('button', {title: `All sections of ${it.name}`, onclick: () => go({project: it.root})}, 'Project…') : null,
    h('button', {class: 'ghost', title: 'Remove from this list (nothing is deleted)', onclick: async () => {
      await post('/api/recent/forget', {section: it.section || it.root}); home(); }}, '×'))))
    : h('p', {class: 'muted'}, 'No projects yet. Choose a folder below.');
  main.replaceChildren(
    card(h('h2', {}, 'Recently opened'), list),
    card(h('h2', {}, 'Open a folder'),
      h('p', {class: 'muted'}, 'A project folder (for example a git repository with one folder per chapter), or one section folder with an edition and its witnesses.'),
      h('form', {class: 'pathform', onsubmit: e => { e.preventDefault(); const p = $('#path').value.trim(); if (p) go({project: p}); }},
        h('input', {id: 'path', placeholder: 'Folder path, e.g. ~/Documents/Rasendramangala', autocomplete: 'off', spellcheck: 'false'}),
        h('button', {class: 'primary'}, 'Open'),
        h('button', {type: 'button', onclick: () => go({browse: $('#path').value.trim() || ''})}, 'Browse…'))));
  $('#path').focus();
}

// ---------------------------------------------------------------- browsing folders on this computer
async function browse(path) {
  const r = await get('/api/browse?' + new URLSearchParams({path}));
  if (!r.ok) { toast(r.errors.join(' '), true); return go({browse: ''}, true); }
  main.replaceChildren(card(
    h('h2', {}, 'Choose a folder'),
    h('div', {class: 'crumbs'},
      r.parent ? h('button', {onclick: () => go({browse: r.parent})}, '↑ Up') : null,
      h('button', {onclick: () => go({browse: r.home})}, 'Home'),
      ...r.roots.map(d => h('button', {onclick: () => go({browse: d})}, d)),
      h('code', {class: 'here'}, r.path)),
    h('div', {class: 'pathform'}, h('span', {class: 'spacer'}),
      h('button', {onclick: () => go({})}, 'Cancel'),
      h('button', {class: 'primary', onclick: () => go({project: r.path})}, 'Use this folder')),
    r.dirs.length ? h('ul', {class: 'dirs'}, ...r.dirs.map(d => h('li', {},
      h('button', {class: 'choice', onclick: () => go({browse: d.path})}, '📁 ', d.name, d.section ? h('span', {class: 'tag'}, 'TEI files') : null))))
      : h('p', {class: 'muted'}, 'No folders here.')));
}

// ---------------------------------------------------------------- a project's sections
async function showProject(path) {
  main.replaceChildren(card(h('p', {class: 'muted'}, 'Looking for sections…')));
  const r = await get('/api/project?' + new URLSearchParams({path}));
  if (!r.ok) { toast(r.errors.join(' '), true); return go({}, true); }
  const rows = r.sections.map(s => h('li', {},
    h('button', {class: 'choice', onclick: () => s.configured && !s.problem ? openSection(s.path) : go({setup: s.path})},
      h('b', {}, s.rel === '.' ? s.name : s.rel),
      s.configured
        ? h('span', {class: 'small muted'}, s.problem ? '' : `${s.edition} · ${s.witnesses} witness${s.witnesses === 1 ? '' : 'es'}`)
        : h('span', {class: 'small muted'}, `${s.teiFiles} TEI files, not set up yet`),
      s.problem ? h('span', {class: 'small error'}, s.problem) : null),
    s.configured ? h('button', {title: 'Change which files are the edition and the witnesses', onclick: () => go({setup: s.path})}, 'Files…')
      : h('button', {class: 'primary', onclick: () => go({setup: s.path})}, 'Set up')));
  main.replaceChildren(card(
    h('div', {class: 'cardhead'}, h('h2', {}, r.name), h('span', {class: 'spacer'}), h('button', {onclick: () => go({})}, 'Other projects')),
    h('p', {class: 'muted'}, h('code', {}, r.root), r.hasProjectFile ? ' · saktumiva-project.json' : ''),
    rows.length ? h('ul', {class: 'choices'}, ...rows)
      : h('p', {}, 'No sections found: no folder here has an editor.config.json or two or more TEI files. ',
        h('button', {onclick: () => go({browse: r.root})}, 'Browse inside'))));
}

// ---------------------------------------------------------------- setting up a section (editor.config.json)
async function setup(path) {
  const r = await get('/api/setup?' + new URLSearchParams({path}));
  if (!r.ok) { toast(r.errors.join(' '), true); return go({}, true); }
  const cfg = r.config, files = r.files.map(f => f.name);
  const edSel = h('select', {id: 'ed'}, h('option', {value: ''}, '— choose the edition file —'),
    ...files.map(f => h('option', {value: f, selected: f === cfg.edition}, f)));
  const wits = h('div', {class: 'wits'});
  const pub = h('input', {id: 'pub', value: cfg.publishTo || '', placeholder: '(default) <edition>_with-apparatus.xml', spellcheck: 'false'});
  const err = h('p', {class: 'error', hidden: true});
  const drawWits = () => {
    const ed = edSel.value, chosen = new Set([...wits.querySelectorAll('input:checked')].map(i => i.value));
    const initial = !wits.childElementCount;
    wits.replaceChildren(...r.files.filter(f => f.name !== ed).map(f => h('label', {class: 'check'},
      h('input', {type: 'checkbox', value: f.name, checked: initial ? (cfg.witnesses || []).includes(f.name) : chosen.has(f.name)}),
      ` ${f.name}`, f.apparatus ? h('span', {class: 'tag'}, 'has an apparatus: published file?') : null)));
  };
  edSel.addEventListener('change', drawWits);
  drawWits();
  const save = async () => {
    const config = {edition: edSel.value, witnesses: [...wits.querySelectorAll('input:checked')].map(i => i.value), publishTo: pub.value.trim() || null};
    const s = await post('/api/setup', {folder: r.folder, config});
    if (!s.ok) { err.textContent = s.errors.join('; '); err.hidden = false; return; }
    openSection(r.folder);
  };
  main.replaceChildren(card(
    h('h2', {}, `Set up ${r.name}`),
    h('p', {class: 'muted'}, h('code', {}, r.folder)),
    h('p', {}, r.exists ? 'Change which files the editor works on. Other settings stay as they are.'
      : 'The editor will save these choices in editor.config.json in this folder. The guesses below come from the file names; please check them.'),
    h('label', {}, 'Edition — the text you edit (the base text of the collation)'), edSel,
    h('label', {}, 'Witnesses — the transcriptions collated with it'), wits,
    h('label', {}, 'Publish to — the file Publish writes: the edition with the full apparatus'), pub,
    err,
    h('div', {class: 'dialog-buttons'}, h('span', {class: 'spacer'}),
      h('button', {onclick: () => history.back()}, 'Cancel'),
      h('button', {class: 'primary', onclick: save}, r.exists ? 'Save and open' : 'Create editor.config.json and open'))));
}

function help() {
  dialog('Projects and sections',
    h('p', {}, 'A section is one folder with an edition file and the witness transcriptions collated with it (TEI XML; the files may end in .xml, .txt or .tei). A project is a folder of sections, for example a git repository with one folder per chapter.'),
    h('p', {}, 'The first time you open a section, the editor proposes which file is the edition and which are witnesses, and saves your choice in editor.config.json in that folder. Settings (collation, apparatus) are kept there too.'),
    h('p', {}, 'A project can have a saktumiva-project.json in its top folder, listing its sections and giving settings shared by all of them. See the README.'),
    h('p', {}, 'If the folder is in a git repository, every save is a commit. Nothing is sent anywhere unless you push.'));
}

async function route() {
  const q = new URLSearchParams(location.search);
  if (q.has('setup')) return setup(q.get('setup'));
  if (q.has('project')) return showProject(q.get('project'));
  if (q.has('browse')) return browse(q.get('browse'));
  return home();
}

setupMenu($('#help-menu'));
$('#btn-updates').addEventListener('click', checkForUpdates);
$('#btn-about').addEventListener('click', showAbout);
$('#btn-help').addEventListener('click', help);
window.addEventListener('popstate', route);
get('/api/state').then(st => {
  if (st.folder) { const b = $('#back'); b.textContent = `Back to ${st.section}`; b.hidden = false; }
});
route();
