import { TEI_NS, KEY_ATTR, parseXML, xmlid, serializeEl, scanRaw, rangeFromCoords,
         collapseWithMap, mergeText, describeChange, patchElement, elementSpanAfter } from './teiutil.mjs';
import { Collator, readSettings, settingsFromConfig, settingsToConfig, filterCatalogue, scriptRule } from './collate.mjs';
import { AlignMatrix } from './aligner.mjs';
import saktumivaIgnoreTags from './saktumiva/lib/tagfilters.mjs';
import { setupMenu, checkForUpdates, showAbout } from './common.mjs';
import { findStemmata, layoutTree, renderSVG, sigla as stemmaSigla } from './stemma.mjs';
import { buildNexus } from './nexus.mjs';
import { clickSelect, sortByDoc, selectionLabel, encodeSession, decodeSession } from './multi.mjs';
import { mergeInFile, splitInFile, findPassage, textNodesOf, snapOffset, offsetPlace, offsetToCount,
         alignedParts, locateParts, validId } from './restructure.mjs';

// ================================================================ helpers
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
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
const teiEls = (root, name) => [...root.getElementsByTagNameNS(TEI_NS, name)];
const nfc = s => s.normalize('NFC');
const store = {
  get: k => { try { return localStorage.getItem('sktedit:' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('sktedit:' + k, v); } catch { /* ignore */ } }
};
let toastTimer;
const toast = (msg, bad = false, ms = 3500) => {
  const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
};
// Passage ids without the part every passage shares (e.g. "SS." or "ch1."), for the passage list
let idPrefix = '';
const commonPrefix = ids => {
  if (ids.length < 2) return '';
  let p = ids[0];
  for (const id of ids) while (p && !id.startsWith(p)) p = p.slice(0, -1);
  const cut = p.search(/[._-]/);   // only the first part: SS.3.1.1 -> 3.1.1, ch1.12 -> 12
  return cut >= 0 ? p.slice(0, cut + 1) : '';
};
const shortId = id => idPrefix && id.startsWith(idPrefix) ? id.slice(idPrefix.length) : id;

// ================================================================ state
const S = {
  cfg: null, editionFile: null, raw: '', mtime: null, gitOn: false,
  origDoc: null, doc: null, span: null, byId: new Map(), origById: new Map(), blocks: [], chapter: new Map(),
  witnesses: [], badFiles: [], collator: null, settingsSource: '',
  current: null, mode: 'read',
  selection: [], anchor: null, several: false,   // several passages shown at once (selection.length > 1)
  undo: [], redo: [], log: [],
  results: new Map(),    // passage id -> {hash, res}
  alignFile: new Map(), forceFresh: new Set(), inflight: new Map(), pendingAlign: new Set(),
  appRanges: [],         // for current passage: [{app, range(TEI)}]
  t2h: new Map(), h2t: new Map(),
  noteTypes: new Set(), keysOk: true
};

// ================================================================ loading
// Every request names the section this window is editing, so that a window left open after
// switching to another section (in another window) cannot write into the wrong files.
const apiFetch = (url, opts = {}) => fetch(url, {...opts,
  headers: {...(opts.headers || {}), 'X-Saktumiva-Folder': encodeURIComponent(S.folder || '')}}).then(r => {
  if (r.status === 409 && r.headers.get('Content-Type')?.startsWith('application/json')) r.clone().json().then(j => {
    if (j.stale) { toast(j.errors[0], true, 15000); $('#status').textContent = 'Switched elsewhere — reload'; }
  }).catch(() => {});
  return r;
});
const fetchText = async path => {
  const r = await apiFetch('/project/' + path.split('/').map(encodeURIComponent).join('/'), {cache: 'no-store'});
  if (!r.ok) throw new Error(`could not read ${path} (${r.status})`);
  return r.text();
};

async function load() {
  const resp = await apiFetch('/api/config', {cache: 'no-store'});
  if (resp.status === 409) { location.replace('/choose'); return; }
  const info = await resp.json();
  S.folder = info.folder; S.version = info.version;
  S.cfg = info.config; S.gitOn = info.git; S.editionFile = S.cfg.edition; S.publishTo = info.publishTo;
  try { S.prefs = (await (await apiFetch('/api/prefs', {cache: 'no-store'})).json()).prefs || {}; } catch { S.prefs = {}; }
  applyLayoutPrefs();
  $('#section').textContent = `— ${info.project && info.project !== info.section ? info.project + ' / ' : ''}${info.section} · ${S.editionFile}`;
  document.title = `${info.section} · Saktumiva editor`;
  S.mtime = info.mtimes[S.editionFile];
  S.mtimes = info.mtimes;
  S.raw = await fetchText(S.editionFile);
  S.origDoc = parseXML(S.raw, S.editionFile);
  S.doc = S.origDoc.cloneNode(true);
  S.span = scanRaw(S.raw);

  let settingsDoc = null;
  if (S.cfg.settingsFrom) {
    try { settingsDoc = parseXML(await fetchText(S.cfg.settingsFrom), S.cfg.settingsFrom); S.settingsSource = S.cfg.settingsFrom; }
    catch (e) { S.badFiles.push({file: S.cfg.settingsFrom, error: e.message}); }
  }
  if (!S.settingsSource) S.settingsSource = 'built-in defaults';
  let settings = readSettings(settingsDoc);
  if (S.cfg.collation) { settings = settingsFromConfig(S.cfg.collation, settings); S.settingsSource = 'editor.config.json (set in Settings)'; }
  const edSiglum = S.origDoc.querySelector('idno[type="siglum"]')?.textContent.trim() || 'Ed';
  S.edSiglum = edSiglum;
  S.stemmata = findStemmata(S.origDoc);
  $('#btn-stemma').hidden = !S.stemmata.stemmata.length && !S.stemmata.commented;
  S.collator = new Collator({settings, extraIgnore: S.cfg.collation?.ignoreTags ? [] : (S.cfg.extraIgnoreTags || []),
                             apparatusOpts: S.cfg.apparatus || {}, scriptNoteRules: S.cfg.scriptNoteRules || {},
                             editionFile: S.editionFile, editionSiglum: edSiglum});

  for (const f of S.cfg.witnesses || []) {
    try {
      const raw = await fetchText(f);
      const doc = parseXML(raw, f);
      S.collator.addFile(f, doc);
      S.witnesses.push({file: f, doc, raw, span: scanRaw(raw), mtime: S.mtimes[f], siglum: doc.querySelector('idno[type="siglum"]')?.textContent.trim() || f,
        title: doc.querySelector('titleStmt > title')?.textContent.trim().replace(/\s+/g, ' ') || f,
        manifest: doc.querySelector('facsimile graphic')?.getAttribute('url') || null});
    } catch (e) { S.badFiles.push({file: f, error: e.message}); }
  }
  S.collator.setEdition(S.doc);
  assignKeys(S.doc);
  S.baseProblems = new Set(noteProblems(S.origDoc));
  reindex();
  for (const so of teiEls(S.doc, 'standOff')) if (so.getAttribute('type') && so.getAttribute('type') !== 'apparatus') S.noteTypes.add(so.getAttribute('type'));
  ['Notes', 'Emendation', 'Testimonia', 'Parallels', 'Sources'].forEach(t => S.noteTypes.add(t));
  $('#note-types').replaceChildren(...[...S.noteTypes].sort().map(t => h('option', {value: t})));

  rememberOriginal();
  const last = store.get(S.editionFile + ':current');
  const sess = decodeSession(sessionGet(), S.blocks);
  S.several = sess.several;
  renderList();
  const first = S.byId.has(last) ? last : S.blocks[0];
  if (sess.several && sess.selection.length > 1) showSeveral(sess.selection, sess.selection.includes(first) ? first : sess.selection[0]);
  else openPassage(first);
  updateStatus();
  if (S.badFiles.length) toast(`Some files could not be read: ${S.badFiles.map(b => b.file).join(', ')}. See Settings.`, true, 9000);
}

function noteProblems(doc) {
  const ids = new Set();
  for (const el of doc.getElementsByTagNameNS(TEI_NS, '*')) { const i = xmlid(el); if (i) ids.add(i); }
  const out = [];
  for (const so of teiEls(doc, 'standOff')) {
    if (so.getAttribute('type') === 'apparatus') continue;
    for (const n of [...so.children].filter(c => c.localName === 'note'))
      for (const t of (n.getAttribute('target') || '').split(/\s+/).filter(Boolean))
        if (!ids.has(t.replace(/^#/, ''))) out.push(`note target ${t} matches no xml:id`);
  }
  return out;
}
function assignKeys(doc) {
  const sos = teiEls(doc, 'standOff');
  sos.forEach((so, i) => so.setAttribute(KEY_ATTR, String(i)));
  S.keysOk = sos.length === S.span.standOffs.length;
}

function reindex() {
  const index = doc => {
    const m = new Map();
    for (const el of doc.getElementsByTagNameNS(TEI_NS, '*')) { const id = xmlid(el); if (id) m.set(id, el); }
    return m;
  };
  S.byId = index(S.doc);
  S.origById = index(S.origDoc);
  const text = S.doc.getElementsByTagNameNS(TEI_NS, 'text')[0];
  const isBlock = el => ['lg', 'p', 'l'].includes(el.localName) && xmlid(el);
  S.blocks = [];
  for (const el of text.getElementsByTagNameNS(TEI_NS, '*')) {
    if (!isBlock(el)) continue;
    let p = el.parentNode, nested = false;
    while (p && p !== text) { if (p.nodeType === 1 && isBlock(p)) { nested = true; break; } p = p.parentNode; }
    if (nested) continue;
    S.blocks.push(xmlid(el));
    const div = el.closest ? el.closest('div') : null;
    const head = div ? [...div.children].find(c => c.localName === 'head') : null;
    S.chapter.set(xmlid(el), head ? head.textContent.trim().replace(/[\[\]]/g, '') : '');
  }
  idPrefix = S.cfg.idPrefix ?? commonPrefix(S.blocks);
}

// ================================================================ passage list
const firstWords = el => {
  const clone = el.cloneNode(true);
  for (const t of [...clone.getElementsByTagNameNS(TEI_NS, '*')].filter(e => ['trailer', 'label', 'note', 'head'].includes(e.localName))) t.remove();
  return clone.textContent.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
};
function renderList() {
  const box = $('#passage-list');
  const q = nfc($('#filter').value.trim().toLowerCase());
  const frag = document.createDocumentFragment();
  const dirty = computeDirty();
  let lastCh = null;
  for (const id of S.blocks) {
    const el = S.byId.get(id);
    const words = firstWords(el);
    if (q && !id.toLowerCase().includes(q) && !el.textContent.replace(/\s+/g, ' ').toLowerCase().includes(q)) continue;
    const ch = S.chapter.get(id);
    if (ch !== lastCh) { frag.append(h('div', {class: 'chapter'}, ch || '—')); lastCh = ch; }
    const sel = isMulti() && S.selection.includes(id);
    frag.append(h('div', {class: 'pitem' + (id === S.current ? ' current' : '') + (sel ? ' selected' : ''), 'data-id': id, role: 'option',
                          'aria-selected': String(sel || id === S.current), onclick: e => listClick(e, id)},
      h('input', {type: 'checkbox', class: 'pcheck', tabindex: '-1', 'aria-label': `Show ${id} with the others`, checked: sel || (S.several && id === S.current),
                  title: 'Show this passage together with the others (or Ctrl-click / Cmd-click the passage)'}),
      h('span', {class: 'pid'}, shortId(id)), h('span', {class: 'pwords'}, words),
      h('span', {class: 'mark' + (dirty.has(id) ? ' dirty' : ''), title: 'unsaved changes'})));
  }
  box.replaceChildren(frag);
  box.classList.toggle('several', S.several);
  box.querySelector('.current')?.scrollIntoView({block: 'nearest'});
  updateSeveralButton();
}
function markList() {
  const dirty = computeDirty();
  const multi = isMulti();
  for (const it of document.querySelectorAll('.pitem')) {
    const id = it.dataset.id;
    const sel = multi && S.selection.includes(id);
    it.classList.toggle('current', id === S.current);
    it.classList.toggle('selected', sel);
    it.setAttribute('aria-selected', String(sel || id === S.current));
    it.querySelector('.pcheck').checked = sel || (S.several && id === S.current);
    it.querySelector('.mark').classList.toggle('dirty', dirty.has(id));
  }
  $('#passage-list').classList.toggle('several', S.several);
  for (const m of document.querySelectorAll('#passage .mhead .mark, #apparatus .ghead .mark')) m.classList.toggle('dirty', dirty.has(m.dataset.id));
  updateSeveralButton();
}

// ================================================================ several passages at once
// A plain click shows one passage; Shift-click a range, Ctrl/Cmd-click (or the tick box, with "Show several" on)
// adds or removes one. Editing works on one passage at a time: click a passage's heading to open it alone.
const isMulti = () => S.selection.length > 1;
const sessionKey = () => 'sktedit:' + S.editionFile + ':several';
function sessionGet() { try { return sessionStorage.getItem(sessionKey()); } catch { return null; } }
function rememberSelection() {
  try { sessionStorage.setItem(sessionKey(), encodeSession({several: S.several, selection: isMulti() ? S.selection : []})); } catch { /* ignore */ }
}
function updateSeveralButton() {
  const b = $('#btn-several');
  b.setAttribute('aria-pressed', String(S.several));
  b.textContent = S.several ? 'Show several ✓' : 'Show several';
  $('#sel-count').textContent = isMulti() ? `${S.selection.length} shown` : S.several ? 'tick passages, or Shift-click' : '';
}
function listClick(e, id) {
  if (S.mode !== 'read') { e.preventDefault(); toast('Finish or cancel the current edit first.', true); markList(); return; }
  const onBox = e.target.classList?.contains('pcheck');
  const toggle = e.ctrlKey || e.metaKey || onBox;
  const shift = e.shiftKey;
  if (!toggle && !shift) { openPassage(id); return; }
  if (shift) window.getSelection()?.removeAllRanges();   // Shift-click selects text in the list otherwise
  const order = [...document.querySelectorAll('#passage-list .pitem')].map(x => x.dataset.id);
  const r = clickSelect({selection: S.selection.length ? S.selection : [S.current], anchor: S.anchor ?? S.current,
                         order, all: S.blocks, id, shift, toggle});
  if (!S.several) { S.several = true; }
  S.anchor = r.anchor;
  if (r.selection.length < 2) openPassage(r.selection[0], {keepAnchor: true});
  else showSeveral(r.selection, r.focus, {keepScroll: true, keepAnchor: true});
}
function setSeveral(on) {
  if (S.mode !== 'read') { toast('Finish or cancel the current edit first.', true); return; }
  S.several = on;
  if (!on && isMulti()) openPassage(S.current);
  else { rememberSelection(); markList(); }
}
// the controls above the text: the editing tools for one passage, or the way back to one passage
function setMultiUI(multi) {
  $('#centre').classList.toggle('multi', multi);
  $('#reading-tools').hidden = multi;
  $('#multi-tools').hidden = !multi;
  $('#wit-scope').textContent = multi ? 'these passages' : 'this passage';
  $('#btn-prev').hidden = multi; $('#btn-next').hidden = multi;
  $('#btn-align').hidden = multi;
}
function showSeveral(ids, focus, opts = {}) {
  if (S.mode !== 'read') { toast('Finish or cancel the current edit first.', true); return; }
  ids = sortByDoc(ids.filter(id => S.byId.has(id)), S.blocks);
  if (ids.length < 2) { openPassage(ids[0] || focus); return; }
  dropBatch();
  S.selection = ids;
  S.current = ids.includes(focus) ? focus : ids[0];
  if (!opts.keepAnchor) S.anchor = S.current;
  store.set(S.editionFile + ':current', S.current);
  rememberSelection();
  setMultiUI(true);
  $('#passage-id').textContent = selectionLabel(ids, S.blocks);
  $('#passage-chapter').textContent = `${ids.length} passages`;
  focused = null;
  S.appRanges = [];
  renderPassage(); renderNotes(); renderWitnesses();
  renderApparatusGroups();
  collateMulti();
  markList(); updateStatus();
  if (!opts.keepScroll) document.querySelector(`.pitem[data-id="${CSS.escape(S.current)}"]`)?.scrollIntoView({block: 'nearest'});
}
// re-show whatever is shown now (after a save, undo …)
function refreshView() {
  if (isMulti() && S.selection.every(id => S.byId.has(id))) showSeveral(S.selection, S.current, {keepScroll: true, keepAnchor: true});
  else openPassage(S.byId.has(S.current) ? S.current : S.blocks[0], {keepScroll: true});
}
const needOne = () => { toast('This works on one passage at a time: click a passage’s heading (its id) to open it alone.', false, 5000); };

// ================================================================ dirty tracking
let origSer = new Map(), origNotes = new Map();
const notesByPassage = doc => {
  const m = new Map();
  for (const so of teiEls(doc, 'standOff')) {
    const c = (so.getAttribute('corresp') || '').replace(/^#/, '');
    m.set(c, (m.get(c) || '') + serializeEl(so));
  }
  return m;
};
function rememberOriginal() {
  origSer = new Map(S.blocks.map(id => [id, S.origById.get(id) ? serializeEl(S.origById.get(id)) : null]));
  origNotes = notesByPassage(S.origDoc);
}
function computeDirty() {
  const set = new Set();
  if (!S.log.length) return set;
  for (const id of S.blocks) { const el = S.byId.get(id); if (el && serializeEl(el) !== origSer.get(id)) set.add(id); }
  const cur = notesByPassage(S.doc);
  for (const k of new Set([...cur.keys(), ...origNotes.keys()])) if (cur.get(k) !== origNotes.get(k)) set.add(k);
  return set;
}

function updateStatus() {
  const n = S.log.length;
  const st = $('#status');
  if (n) { st.textContent = `${n} unsaved change${n > 1 ? 's' : ''}`; st.className = 'status dirty'; }
  else { st.textContent = S.gitOn ? 'All saved' : 'All saved (no git)'; st.className = 'status saved'; }
  $('#btn-save').disabled = n === 0 || S.mode !== 'read';
  $('#btn-publish').disabled = S.mode !== 'read' && S.mode !== 'publish';
  $('#btn-align').disabled = S.mode !== 'read' || isMulti() || !S.results.get(S.current)?.res.alignXML;
  $('#btn-undo').disabled = !S.undo.length || S.mode !== 'read';
  $('#btn-redo').disabled = !S.redo.length || S.mode !== 'read';
}

// ================================================================ undo
function snapshot(label) {
  S.undo.push({doc: S.doc.cloneNode(true), current: S.current, selection: [...S.selection], log: [...S.log]});
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
  S.log.push(label);
}
function swapDoc(entry, toStack) {
  toStack.push({doc: S.doc.cloneNode(true), current: S.current, selection: [...S.selection], log: [...S.log]});
  S.doc = entry.doc; S.log = entry.log;
  S.collator.setEdition(S.doc);
  reindex();
  // back to the view in which the change was made: one passage, or the same several
  const sel = (entry.selection || []).filter(id => S.byId.has(id));
  if (sel.length > 1) showSeveral(sel, entry.current, {keepScroll: true});
  else openPassage(S.byId.has(entry.current) ? entry.current : S.current, {keepScroll: true});
  markList(); updateStatus();
}
const doUndo = () => { if (S.undo.length && S.mode === 'read') { swapDoc(S.undo.pop(), S.redo); toast('Undone.'); } };
const doRedo = () => { if (S.redo.length && S.mode === 'read') { swapDoc(S.redo.pop(), S.undo); toast('Redone.'); } };

function changed(id) {
  S.collator.setEdition(S.doc); // the edition element objects are live, but refresh the text map
  if (isMulti()) {
    S.appRanges = S.appRanges.filter(a => a.pid !== id);   // its apparatus is out of date until collated again
    renderPassage(); renderNotes(); collateMulti(); markList(); updateStatus();
    return;
  }
  $('#collate-status').textContent = 'collating…';
  renderPassage(); collateCurrent(); renderNotes(); markList(); updateStatus();
}

// ================================================================ rendering the passage (read mode)
const CHIP = {
  caesura: () => '', anchor: el => '', gap: el => '‡'.repeat(parseInt(el.getAttribute('quantity')) || 1),
  metamark: el => '※', pb: el => `[${el.getAttribute('n') || 'pb'}]`, lb: () => '', cb: () => ''
};
const MUTED = new Set(['trailer', 'label', 'head', 'note']);
const SPANCLASS = {pc: 'pc', unclear: 'unclear', sic: 'sic', damage: 'damage', supplied: 'supplied', surplus: 'surplus', foreign: 'foreign'};

function renderTEI(node, anchorLabels) {
  if (node.nodeType === 3) {
    const t = document.createTextNode(node.data);
    S.t2h.set(node, t); S.h2t.set(t, node);
    return t;
  }
  if (node.nodeType !== 1) return null;
  const n = node.localName;
  let el;
  if (n in CHIP) {
    el = h('span', {class: `chip ${n}`, 'data-label': CHIP[n](node), title: n === 'metamark' ? `metamark ${node.getAttribute('function') || ''}` : n === 'pb' ? 'page break' : null});
    if (n === 'anchor') {
      const id = xmlid(node);
      el.dataset.label = anchorLabels.get(id) || '•';
      el.dataset.anchor = id || '';
      el.title = id ? `note ${id}` : 'anchor';
    }
    return el;
  }
  if (n === 'lg') el = h('div', {class: 'lg'});
  else if (n === 'l') el = h('div', {class: 'l'});
  else if (n === 'p') el = h('div', {class: 'p'});
  else if (MUTED.has(n)) el = h('div', {class: n});
  else el = h('span', {class: SPANCLASS[n] || `tei-${n}`, title: ['unclear', 'sic', 'damage', 'supplied', 'surplus'].includes(n) ? n : null});
  for (const c of node.childNodes) { const r = renderTEI(c, anchorLabels); if (r) el.append(r); }
  return el;
}

const anchorLabelsFor = el => {
  const m = new Map();
  teiEls(el, 'anchor').forEach((a, i) => { const id = xmlid(a); if (id) m.set(id, String(i + 1)); });
  return m;
};

// a passage's heading in the several-passages view: its id (click: open it alone), status and unsaved mark
function passageHeading(id, cls) {
  return h('div', {class: cls, 'data-id': id},
    h('button', {class: 'mopen', title: `Open ${id} alone, to edit it, its notes or its alignment`, onclick: () => openPassage(id)}, id),
    h('span', {class: 'mstatus muted', 'data-id': id}, multiStatus.get(id) || ''),
    h('span', {class: 'mark', 'data-id': id, title: 'unsaved changes'}));
}
function renderPassage() {
  const box = $('#passage');
  box.classList.remove('editing');
  S.t2h = new Map(); S.h2t = new Map();
  if (isMulti()) {
    box.replaceChildren(...S.selection.map(id => {
      const el = S.byId.get(id);
      return h('section', {class: 'mpass', 'data-id': id}, passageHeading(id, 'mhead'),
        !el ? h('p', {class: 'muted'}, 'Passage not found.')
          : el.textContent.trim() ? renderTEI(el, anchorLabelsFor(el)) : h('p', {class: 'muted empty'}, '(no text)'));
    }));
    paintHighlights();
    return;
  }
  const el = S.byId.get(S.current);
  if (!el) { box.replaceChildren(h('p', {class: 'muted'}, 'Passage not found.')); return; }
  box.replaceChildren(renderTEI(el, anchorLabelsFor(el)));
  paintHighlights();
}

function openPassage(id, opts = {}) {
  if (!id) return;
  if (S.mode !== 'read') { toast('Finish or cancel the current edit first.', true); return; }
  if (isMulti()) dropBatch();
  S.current = id;
  S.selection = [id];
  if (!opts.keepAnchor) S.anchor = id;
  rememberSelection();
  setMultiUI(false);
  store.set(S.editionFile + ':current', id);
  $('#passage-id').textContent = id;
  $('#passage-chapter').textContent = S.chapter.get(id) || '';
  const i = S.blocks.indexOf(id);
  $('#btn-prev').disabled = i <= 0; $('#btn-next').disabled = i >= S.blocks.length - 1;
  renderPassage(); renderNotes(); renderWitnesses();
  $('#apparatus').replaceChildren(); S.appRanges = []; focused = null;
  $('#collate-status').textContent = '';
  collateCurrent();
  markList();
  if (!opts.keepScroll) document.querySelector(`.pitem[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: 'nearest'});
}
const go = d => { if (isMulti()) return; const i = S.blocks.indexOf(S.current) + d; if (i >= 0 && i < S.blocks.length) openPassage(S.blocks[i]); };

// ================================================================ collation + apparatus
// Order of preference: this session's results, the editor's own cache, an existing
// Saktumiva alignment file that still matches the text, and finally a fresh alignment.
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function cacheKey(ser, id) {
  const wits = S.witnesses.map(w => { const el = witPassage(w.doc, id); return el ? serializeEl(el) : ''; });
  const data = [ser, S.collator.signature(), ...wits].join('\u0000');
  return hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data)));
}
async function getResult(id, {priority = 'high', onProgress} = {}) {
  const el = S.byId.get(id); if (!el) return null;
  const ser = serializeEl(el);
  const mem = S.results.get(id);
  if (mem && mem.hash === ser) return mem.res;
  const key = await cacheKey(ser, id);
  // share one computation between simultaneous requests for the same passage text
  const inflight = S.inflight.get(key);
  const RANK = {low: 0, batch: 1, high: 1};   // a batch job still running when its passage is opened alone is reused
  if (inflight && RANK[inflight.priority] >= RANK[priority]) return inflight.promise;
  const promise = computeResult(id, ser, key, {priority, onProgress});
  S.inflight.set(key, {priority, promise});
  try { return await promise; } finally { if (S.inflight.get(key)?.promise === promise) S.inflight.delete(key); }
}
async function computeResult(id, ser, key, {priority, onProgress}) {
  const t0 = performance.now();
  let res = null;
  const finish = (r, source, alignXML) => { r.source = source; r.alignXML = alignXML; r.ms = Math.round(performance.now() - t0); return r; };
  let staleCorrected = false;
  if (S.cfg.alignmentsDir && !S.forceFresh.has(id)) {
    let x = await alignFileText(id);
    if (x) {
      try {
        let r = S.collator.apparatus(id, x);
        // witnesses that now have this passage but are not in the alignment (e.g. ids added since)
        const missing = r.rows ? S.witnesses.filter(w => witPassage(w.doc, id) && !r.rows.includes(w.siglum)) : [];
        // a corrected alignment containing text of an element now ignored (e.g. <trailer>): remove that text, keep the corrections
        if (r.corrected && !r.compat.ok && !missing.length) {
          let y = null, r2 = null;
          try { y = S.collator.adaptIgnored(id, x); r2 = y && S.collator.apparatus(id, y); } catch (e) { console.warn('could not adapt', id, e); }
          if (r2 && !r2.error && !r2.mismatch && !r2.witMismatch && r2.compat.ok) {
            const resp = await (await apiFetch('/api/alignments', {method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({alignments: {[id]: y}, message: `Alignment for ${id}: text of newly ignored XML elements removed (hand corrections kept)`})})).json().catch(() => ({ok: false}));
            if (resp.ok) { S.alignFile.set(id, y); x = y; r = r2; }
          }
        }
        const current = !r.error && !r.mismatch && !r.witMismatch && !missing.length;
        if (current && (r.compat.ok || r.corrected)) res = finish(r, 'file', x);
        else if (r.corrected) staleCorrected = true;
      } catch { /* unreadable alignment file: collate afresh */ }
    }
  }
  if (!res) try {
    const c = await apiFetch(`/api/cache?block=${encodeURIComponent(id)}&key=${key}`, {cache: 'no-store'});
    if (c.ok) { const x = await c.text(); const r = S.collator.apparatus(id, x); if (!r.error && !r.mismatch && r.compat.ok) res = finish(r, 'cache', x); }
  } catch { /* no cache */ }
  if (!res) {
    const a = await S.collator.align(id, {priority, onProgress});
    if (!a) return null;              // a look-ahead that was interrupted
    if (a.none) res = finish(a, 'none', null);
    else {
      res = finish(S.collator.apparatus(id, a.alignXML), 'collated', a.alignXML);
      apiFetch('/api/cache', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({block: id, key, xml: a.alignXML})}).catch(() => {});
    }
  }
  res.staleCorrected = staleCorrected && res.source !== 'file';
  if (serializeEl(S.byId.get(id)) === ser) S.results.set(id, {hash: ser, res});
  return res;
}
// the passage's alignment file as it is on disk (null if there is none); fetched once per session
async function alignFileText(id) {
  if (S.alignFile.has(id)) return S.alignFile.get(id);
  let x = null;
  try { x = await fetchText(`${S.cfg.alignmentsDir}/${id}.xml`); } catch { x = null; }
  S.alignFile.set(id, x);
  return x;
}
const fileIsCorrected = id => /<change[^>]*type="hand-corrected"/.test(S.alignFile.get(id) || '');

let collateTimer;
function collateCurrent() {
  clearTimeout(collateTimer);
  collateTimer = setTimeout(async () => {
    const id = S.current, el = S.byId.get(id);
    if (!el) return;
    const ser = serializeEl(el);
    if (!(S.results.get(id)?.hash === ser)) $('#collate-status').textContent = 'collating…';
    try {
      const res = await getResult(id, {priority: 'high', onProgress: p => { if (S.current === id && !isMulti()) $('#collate-status').textContent = `collating… ${Math.round(p * 100)}%`; }});
      if (!res) return;
      if (S.current === id && !isMulti() && serializeEl(S.byId.get(id)) === ser) { showApparatus(id, res); lookAhead(); }
    } catch (e) {
      console.error(e);
      if (S.current === id && !isMulti()) { $('#collate-status').textContent = ''; $('#apparatus').replaceChildren(h('p', {class: 'error'}, 'Collation failed: ' + e.message)); }
    }
  }, 120);
}
// quietly prepare the next two passages
async function lookAhead() {
  await flushAlignments();
  const i = S.blocks.indexOf(S.current);
  for (const id of S.blocks.slice(i + 1, i + 3)) { try { await getResult(id, {priority: 'low'}); } catch { /* ignore */ } }
}

// alignment files for saved passages whose collation was not ready at save time
let flushing = false;
async function flushAlignments() {
  if (flushing || !S.pendingAlign.size || S.cfg.writeAlignments === false) return;
  flushing = true;
  try {
    for (const id of [...S.pendingAlign]) {
      if (serializeEl(S.byId.get(id)) !== origSer.get(id)) { S.pendingAlign.delete(id); continue; } // edited again: next save handles it
      let res = null;
      try { res = await getResult(id, {priority: 'low'}); } catch { S.pendingAlign.delete(id); continue; }
      if (!res) continue;                     // interrupted; try again later
      S.pendingAlign.delete(id);
      if (!res.alignXML || serializeEl(S.byId.get(id)) !== origSer.get(id)) continue;
      S.alignFile.set(id, res.alignXML);
      const r = await (await apiFetch('/api/alignments', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({alignments: {[id]: res.alignXML}, message: `Alignment for ${id} (generated)`})})).json().catch(() => ({ok: false}));
      if (!r.ok) console.warn('alignment not written', id, r);
    }
  } finally { flushing = false; }
}

const sigla = str => (str || '').split(/\s+/).filter(Boolean).map(s => s.replace(/^#/, '')).join(' ');
const readingText = el => el.textContent.replace(/\s+/g, ' ').trim();

// The apparatus of one passage: its entries, and the TEI ranges of their lemmata (for highlighting and "use")
function apparatusContent(id, res) {
  if (res.none) return {nodes: [h('p', {class: 'muted'}, res.reason)], status: '', ranges: [], legend: []};
  if (res.error) return {nodes: [h('p', {class: 'error'}, res.error)], status: '', ranges: [], legend: []};
  const status = S.mode === 'align' ? 'following your corrections'
    : res.source === 'collated' ? `collated in ${(res.ms / 1000).toFixed(1)} s`
    : res.source === 'file' ? (res.corrected ? 'from your corrected alignment' : 'from the existing alignment file') : 'collated (cached)';
  const passageEl = S.byId.get(id);
  const ignore = new Set(S.collator.ignore);
  const nodes = [], ranges = [];
  const apps = [...res.listApp.children].filter(a => a.localName === 'app');
  const omissions = [...res.listApp.children].filter(a => a.localName === 'listApp');
  if (!apps.length) nodes.push(h('p', {class: 'muted'}, 'No variants: all witnesses agree with the text.'));
  apps.forEach((app, i) => {
    const loc = (app.getAttribute('loc') || '0,0').split(',').map(Number);
    const r = rangeFromCoords(loc, passageEl, ignore);
    let range = null;
    if (r) { range = S.doc.createRange(); range.setStart(r.sNode, r.sOff); range.setEnd(r.eNode, r.eOff); }
    ranges.push({app, range, i, pid: id, key: appKey(id, i)});
    nodes.push(renderApp(app, i, id));
  });
  for (const om of omissions) for (const app of [...om.children]) nodes.push(h('div', {class: 'app'}, h('span', {class: 'muted'}, 'Long omission: '),
     h('span', {class: 'lem'}, readingText(app.querySelector('lem'))), h('span', {class: 'bracket'}, ' ] om. '), h('span', {class: 'sig'}, sigla(app.querySelector('rdg')?.getAttribute('wit')))));
  const legend = res.listWit ? [...res.listWit.querySelectorAll(':scope > witness')].map(w => `${w.getAttribute('xml:id') || xmlid(w)} = ${w.querySelector('expan')?.textContent.trim() || ''}`) : [];
  if (res.warnings?.length) nodes.push(h('p', {class: 'muted'}, 'Collation warnings: ' + res.warnings.join('; ')));
  if (res.source === 'file' && res.corrected && res.compat && !res.compat.ok) nodes.unshift(h('p', {class: 'muted'}, 'Your corrected alignment was made with other collation settings (' + res.compat.why.join('; ') + '). It is used as it is.'));
  if (res.staleCorrected) nodes.unshift(h('p', {class: 'error'}, 'Your corrected alignment for this passage no longer fits its text (the text or a witness has changed). This is a fresh collation; use “Correct alignment” to redo the corrections.'));
  return {nodes, status, ranges, legend};
}

function showApparatus(id, res) {
  const box = $('#apparatus');
  const c = apparatusContent(id, res);
  S.appRanges = c.ranges;
  $('#collate-status').textContent = c.status;
  $('#btn-align').disabled = !res.alignXML || S.mode !== 'read';
  if (c.legend.length) c.nodes.push(h('div', {class: 'legend'}, c.legend.join(' · ')));
  box.replaceChildren(...c.nodes);
  paintHighlights();
}

// ---------------------------------------------------------------- the apparatus of several passages
// One group per passage, in document order. Each group fills in when its passage is ready, so a
// passage that has to be collated afresh does not hold up the others.
const multiStatus = new Map();    // passage id -> what its heading says (waiting, collating 40%, collated …)
const multiLegend = new Map();    // siglum -> "K = Kathmandu …", for all the passages shown
let multiRun = 0;
function setMultiStatus(id, text, cls = '') {
  multiStatus.set(id, text);
  for (const el of document.querySelectorAll(`.mstatus[data-id="${CSS.escape(id)}"]`)) { el.textContent = text; el.className = 'mstatus muted ' + cls; }
}
function renderApparatusGroups() {
  multiLegend.clear();
  $('#apparatus').replaceChildren(...S.selection.map(id => h('section', {class: 'appgroup', 'data-id': id},
    passageHeading(id, 'ghead'), h('div', {class: 'gbody'}, h('p', {class: 'muted'}, '…')))), h('div', {class: 'legend', id: 'multi-legend'}));
}
function showApparatusGroup(id, res) {
  const g = document.querySelector(`#apparatus .appgroup[data-id="${CSS.escape(id)}"] .gbody`);
  if (!g) return;
  const c = apparatusContent(id, res);
  S.appRanges = [...S.appRanges.filter(a => a.pid !== id), ...c.ranges];
  g.replaceChildren(...c.nodes);
  setMultiStatus(id, c.status || (res.none ? 'not collated' : ''), 'ok');
  for (const l of c.legend) multiLegend.set(l.split(' = ')[0], l);
  const lg = $('#multi-legend');
  if (lg) lg.textContent = [...multiLegend.values()].join(' · ');
  paintHighlights();
}
function multiProgress() {
  const n = S.selection.length, ready = S.selection.filter(id => S.results.get(id)?.hash === serializeEl(S.byId.get(id))).length;
  $('#collate-status').textContent = ready === n ? `all ${n} passages ready` : `${ready} of ${n} passages ready`;
}
// collate the passages shown (those not ready yet), all at once: ready ones appear at once, the others as they finish
function collateMulti() {
  const run = ++multiRun;
  const ids = [...S.selection];
  for (const id of ids) {
    const el = S.byId.get(id);
    if (!el) continue;
    const ser = serializeEl(el);
    const mem = S.results.get(id);
    if (mem && mem.hash === ser) { showApparatusGroup(id, mem.res); continue; }
    setMultiStatus(id, 'waiting…', 'busy');
    document.querySelector(`#apparatus .appgroup[data-id="${CSS.escape(id)}"] .gbody`)?.replaceChildren(h('p', {class: 'muted'}, 'Waiting for the collation of this passage…'));
    getResult(id, {priority: 'batch', onProgress: p => { if (run === multiRun) setMultiStatus(id, `collating… ${Math.round(p * 100)}%`, 'busy'); }})
      .then(res => {
        if (run !== multiRun || !isMulti() || !S.selection.includes(id) || serializeEl(S.byId.get(id)) !== ser) return;
        if (!res) { setMultiStatus(id, 'not collated', 'bad'); return; }
        showApparatusGroup(id, res); multiProgress(); updateStatus();
      })
      .catch(e => {
        console.error(e);
        if (run !== multiRun) return;
        setMultiStatus(id, 'collation failed', 'bad');
        document.querySelector(`#apparatus .appgroup[data-id="${CSS.escape(id)}"] .gbody`)?.replaceChildren(h('p', {class: 'error'}, 'Collation failed: ' + e.message));
      });
  }
  multiProgress();
}
// leaving the several-passages view: passages still waiting to be collated for it are dropped
function dropBatch() { multiRun++; multiStatus.clear(); S.collator?.dropQueued('batch'); }

const appKey = (pid, i) => `${pid}|${i}`;
function renderApp(app, i, pid) {
  const key = appKey(pid, i);
  const div = h('div', {class: 'app', 'data-key': key,
    onmouseenter: () => focusApp(key, false), onmouseleave: () => focusApp(null, false), onclick: () => focusApp(key, true)});
  const kids = [...app.children];
  const lemGrp = kids.find(k => k.localName === 'rdgGrp' && k.getAttribute('type') === 'lemma');
  const lem = lemGrp ? lemGrp.querySelector('lem') : kids.find(k => k.localName === 'lem');
  const lemWits = lemGrp ? lemGrp.getAttribute('select') : lem?.getAttribute('wit');
  div.append(h('span', {class: 'lem'}, readingText(lem || app)), ' ', h('span', {class: 'sig'}, sigla(lemWits)), h('span', {class: 'bracket'}, ' ]'));
  const minor = [];
  if (lemGrp) for (const r of lemGrp.querySelectorAll('rdg')) minor.push(r);
  let first = true;
  for (const k of kids) {
    if (k === lemGrp || k.localName === 'lem') continue;
    if (k.localName === 'rdg') { if (!first) div.append(h('span', {class: 'semi'}, ';')); div.append(renderRdg(k, k.getAttribute('wit'), i, false, pid)); first = false; }
    else if (k.localName === 'rdgGrp') {
      const main = k.querySelector('rdg[type="main"]') || k.querySelector('rdg');
      if (!first) div.append(h('span', {class: 'semi'}, ';'));
      div.append(renderRdg(main, k.getAttribute('select'), i, false, pid)); first = false;
      for (const r of k.querySelectorAll('rdg')) if (r !== main) minor.push(r);
    }
  }
  if (minor.length && S.cfg.apparatus?.showMinor !== false) div.append(h('div', {class: 'minor'}, 'minor: ', ...minor.map(r => renderRdg(r, r.getAttribute('wit'), i, true, pid))));
  return div;
}

function renderRdg(rdg, wits, appIndex, small = false, pid = S.current) {
  const txt = readingText(rdg);
  const span = h('span', {class: 'rdg', title: 'Witnesses: ' + sigla(wits)},
    txt ? txt : h('span', {class: 'om'}, 'om.'), ' ', h('span', {class: 'sig'}, sigla(wits)));
  if (S.mode === 'read') span.append(h('button', {class: 'use', title: txt ? 'Put this reading in the text' : 'Remove the lemma from the text (follow the omission)',
    onclick: e => { e.stopPropagation(); acceptReading(pid, appIndex, rdg, sigla(wits)); }}, txt ? 'use' : 'omit'));
  span.addEventListener('mouseenter', () => highlightWits(sigla(wits)));
  span.addEventListener('mouseleave', () => highlightWits(''));
  return span;
}

let focused = null;
function focusApp(key, sticky) {
  if (sticky) focused = (focused === key ? null : key);
  const show = key ?? focused;
  for (const d of document.querySelectorAll('.app')) d.classList.toggle('focus', d.dataset.key === focused);
  paintHighlights(show);
}

function toHtmlRange(r) {
  if (!r) return null;
  const s = S.t2h.get(r.startContainer), e = S.t2h.get(r.endContainer);
  if (!s || !e) return null;
  const hr = new Range();
  try { hr.setStart(s, r.startOffset); hr.setEnd(e, r.endOffset); } catch { return null; }
  return hr;
}
function paintHighlights(focusIndex = focused) {
  if (!window.CSS || !CSS.highlights || !['read', 'align'].includes(S.mode)) return;
  const all = [], foc = [];
  for (const {range, key} of S.appRanges) {
    const hr = toHtmlRange(range); if (!hr) continue;
    all.push(hr); if (key === focusIndex) foc.push(hr);
  }
  CSS.highlights.set('lemma', new Highlight(...all));
  CSS.highlights.set('lemma-focus', new Highlight(...foc));
}

function highlightWits(sig) {
  const set = new Set(sig.split(/\s+/).filter(Boolean).map(s => s.replace(/(ac|pc)$/, '')));
  for (const w of document.querySelectorAll('.wit')) w.classList.toggle('hl', set.has(w.dataset.siglum));
}

// clicking on a word in the text focuses its apparatus entry
$('#passage').addEventListener('click', e => {
  if (S.mode !== 'read') return;
  if (e.target.closest('.mhead')) return;
  const a = e.target.closest('.chip.anchor');
  if (a) { focusNote(a.dataset.anchor); return; }
  if (!window.getSelection().isCollapsed) return;
  const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
  const rng = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
  const node = pos ? pos.offsetNode : rng?.startContainer, off = pos ? pos.offset : rng?.startOffset;
  const tn = S.h2t.get(node);
  if (!tn) return;
  const hit = S.appRanges.find(({range}) => range && range.isPointInRange(tn, Math.min(off, tn.data.length)));
  if (hit) {
    focusApp(hit.key, true);
    document.querySelector(`.app[data-key="${CSS.escape(hit.key)}"]`)?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }
});

// ================================================================ accept a reading
function readingFragment(rdg) {
  const frag = S.doc.createDocumentFragment();
  for (const c of rdg.childNodes) frag.append(S.doc.importNode(c, true));
  // witness-physical markup does not belong in the edition
  for (const x of [...frag.querySelectorAll('*')]) {
    if (['lb', 'pb', 'cb', 'milestone'].includes(x.localName)) x.remove();
  }
  // trim outer whitespace
  const first = frag.firstChild, last = frag.lastChild;
  if (first?.nodeType === 3) first.data = first.data.replace(/^\s+/, '');
  if (last?.nodeType === 3) last.data = last.data.replace(/\s+$/, '');
  return frag;
}

const KEEP_IN_LEMMA = new Set(['anchor', 'caesura', 'pb', 'lb', 'cb', 'metamark']);
function acceptReading(pid, appIndex, rdg, wits) {
  const entry = S.appRanges.find(a => a.pid === pid && a.i === appIndex);
  if (!entry || !entry.range) { toast('Could not locate this lemma in the text.', true); return; }
  const range = entry.range;
  const oldText = range.toString().replace(/\s+/g, ' ').trim();
  const newText = readingText(rdg);
  if (!newText && !confirm(`Remove “${oldText}” from the text (following ${wits})?`)) return;
  snapshot(`${pid}: ${newText ? `read “${newText}” (${wits}) for “${oldText}”` : `omitted “${oldText}” (${wits})`}`);
  const kept = [...range.cloneContents().querySelectorAll('*')].filter(e => KEEP_IN_LEMMA.has(e.localName))
    .map(e => xmlid(e) ? S.byId.get(xmlid(e)) || e : e);
  range.deleteContents();
  const frag = readingFragment(rdg);
  const tail = S.doc.createDocumentFragment();
  for (const k of kept) tail.append(k.ownerDocument === S.doc ? k : S.doc.importNode(k, true));
  frag.append(tail);
  range.insertNode(frag);
  range.commonAncestorContainer.normalize?.();
  S.byId.get(pid).normalize();
  reindex();
  focused = null;
  changed(pid);
  toast(newText ? `Text now reads “${newText}”. Undo with Ctrl+Z.` : `“${oldText}” removed. Undo with Ctrl+Z.`);
}

// ================================================================ notes
function notesFor(id) {
  const passage = S.byId.get(id);
  if (!passage) return [];
  const labels = anchorLabelsFor(passage);
  const res = [];
  for (const so of teiEls(S.doc, 'standOff')) {
    const type = so.getAttribute('type') || '';
    if (type === 'apparatus') continue;
    const corr = (so.getAttribute('corresp') || '').replace(/^#/, '');
    for (const n of [...so.children].filter(c => c.localName === 'note')) {
      const tgt = (n.getAttribute('target') || '').replace(/^#/, '').split(/\s+/)[0];
      if (corr === id || labels.has(tgt)) res.push({note: n, standOff: so, type, target: tgt, label: labels.get(tgt) || ''});
    }
  }
  res.sort((a, b) => (Number(a.label) || 999) - (Number(b.label) || 999));
  return res;
}

const noteHTML = note => {
  const out = h('div', {class: 'nbody'});
  const walk = (n, into) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) into.append(c.data);
      else if (c.nodeType === 1) {
        const cls = c.localName === 'foreign' ? 'foreign' : (c.localName === 'emph' || c.localName === 'title' || c.localName === 'hi') ? 'emph' : '';
        const s = h('span', {class: cls}); walk(c, s); into.append(s);
      }
    }
  };
  walk(note, out);
  return out;
};

const noteCard = (n, pid) => h('div', {class: 'note', 'data-target': n.target},
  h('div', {class: 'nhead'}, h('span', {class: 'nlabel'}, n.label || '—'), h('span', {class: 'ntype'}, n.type),
    h('span', {class: 'muted'}, n.target ? n.target : 'no anchor'), h('span', {class: 'spacer'}),
    h('button', {onclick: () => openNoteDialog({existing: n, pid})}, 'Edit')),
  noteHTML(n.note));
function renderNotes() {
  const box = $('#notes');
  if (isMulti()) {
    const groups = S.selection.map(id => ({id, list: notesFor(id)})).filter(g => g.list.length);
    const n = groups.reduce((a, g) => a + g.list.length, 0);
    $('#notes-count').textContent = n ? `${n}` : '';
    if (!n) { box.replaceChildren(h('p', {class: 'muted'}, 'No notes in these passages. To add one, open a passage alone (click its heading).')); return; }
    box.replaceChildren(...groups.map(g => h('section', {class: 'notegroup', 'data-id': g.id},
      h('div', {class: 'ghead'}, h('button', {class: 'mopen', title: `Open ${g.id} alone`, onclick: () => openPassage(g.id)}, g.id)),
      ...g.list.map(x => noteCard(x, g.id)))));
    return;
  }
  const list = notesFor(S.current);
  $('#notes-count').textContent = list.length ? `${list.length}` : '';
  if (!list.length) { box.replaceChildren(h('p', {class: 'muted'}, 'No notes. Select a word in the text and choose “Add note”.')); return; }
  box.replaceChildren(...list.map(n => noteCard(n, S.current)));
}

function focusNote(target) {
  for (const n of document.querySelectorAll('.note')) n.classList.toggle('focus', n.dataset.target === target);
  document.querySelector(`.note[data-target="${CSS.escape(target)}"]`)?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
}

const nextAnchorId = id => {
  let k = 1;
  while (S.byId.has(`${id}-n${k}`)) k++;
  return `${id}-n${k}`;
};

// where a new standOff for passage `id` goes: after the last standOff of this or an earlier passage
function placeStandOff(so, id, outer = '\n') {
  const order = new Map(S.blocks.map((b, i) => [b, i]));
  const mine = order.get(id) ?? 0;
  const all = teiEls(S.doc, 'standOff').filter(s => s.getAttribute('type') !== 'apparatus');
  let after = null;
  for (const s of all) {
    const c = (s.getAttribute('corresp') || '').replace(/^#/, '');
    if ((order.get(c) ?? -1) <= mine) after = s;
  }
  const root = S.doc.documentElement;
  if (after) after.after(S.doc.createTextNode(outer), so);
  else if (all.length) all[0].before(S.doc.createTextNode(outer), so);
  else root.append(S.doc.createTextNode(outer), so, S.doc.createTextNode('\n'));
}

function noteElement(target, bodyXML) {
  const frag = parseXML(`<note xmlns="${TEI_NS}" xml:lang="en"${target ? ` target="#${target}"` : ''}>${bodyXML}</note>`, 'note').documentElement;
  const el = S.doc.importNode(frag, true);
  el.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns');
  return el;
}

// the file's own indentation, read from an existing standOff
function standOffStyle() {
  const so = teiEls(S.doc, 'standOff').find(s => s.getAttribute('type') !== 'apparatus' && [...s.children].some(c => c.localName === 'note'));
  const ws = n => (n && n.nodeType === 3 && /^\s*$/.test(n.data)) ? n.data : null;
  if (!so) return {outer: '\n', inner: '\n', close: '\n'};
  const first = [...so.children].find(c => c.localName === 'note');
  return {outer: ws(so.previousSibling) ?? '\n', inner: ws(first.previousSibling) ?? '\n', close: ws(so.lastChild) ?? '\n'};
}
function addNoteTo(id, type, note) {
  const st = standOffStyle();
  const sos = teiEls(S.doc, 'standOff');
  let so = sos.find(s => s.getAttribute('corresp') === '#' + id && s.getAttribute('type') === type);
  if (so) {
    const last = so.lastChild;
    if (last && last.nodeType === 3 && /^\s*$/.test(last.data)) last.before(S.doc.createTextNode(st.inner), note);
    else so.append(S.doc.createTextNode(st.inner), note, S.doc.createTextNode(st.close));
    return;
  }
  so = S.doc.createElementNS(TEI_NS, 'standOff');
  so.setAttribute('corresp', '#' + id);
  so.setAttribute('type', type);
  so.append(S.doc.createTextNode(st.inner), note, S.doc.createTextNode(st.close));
  placeStandOff(so, id, st.outer);
}

function removeNote(n) {
  const so = n.parentNode;
  const prev = n.previousSibling;
  n.remove();
  if (prev && prev.nodeType === 3 && /^\s*$/.test(prev.data) && prev.previousSibling) prev.remove();
  if (![...so.children].some(c => c.localName === 'note')) {
    const ws = so.nextSibling;
    so.remove();
    if (ws && ws.nodeType === 3 && /^\s*$/.test(ws.data)) ws.remove();
  }
}

// selection in the reading view -> a point in the TEI
function teiPointFromSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!$('#passage').contains(r.endContainer)) return null;
  let node = r.endContainer, off = r.endOffset;
  if (node.nodeType !== 3) { // find the last text node before the point
    const walker = document.createTreeWalker($('#passage'), NodeFilter.SHOW_TEXT);
    let last = null;
    while (walker.nextNode()) { const t = walker.currentNode; const cmp = r.comparePoint(t, 0); if (cmp <= 0 || t === node) last = t; }
    if (!last) return null; node = last; off = last.data.length;
  }
  const tn = S.h2t.get(node);
  if (!tn) return null;
  // snap to the end of the word
  while (off < tn.data.length && /\S/.test(tn.data[off]) && !/[|।॥]/.test(tn.data[off])) off++;
  return {node: tn, offset: off, text: r.toString().replace(/\s+/g, ' ').trim()};
}

let noteCtx = null;
function openNoteDialog(ctx) {
  if (!ctx.existing && isMulti()) { needOne(); return; }
  ctx.pid = ctx.pid || S.current;
  noteCtx = ctx;
  const d = $('#note-dialog');
  $('#note-error').hidden = true;
  if (ctx.existing) {
    const e = ctx.existing;
    $('#note-dialog-title').textContent = `Edit note ${e.label || ''}`;
    $('#note-where').textContent = `${ctx.pid}${e.target ? ' · anchor ' + e.target : ''}`;
    $('#note-type').value = e.type;
    $('#note-text').value = [...e.note.childNodes].map(c => c.nodeType === 1 ? serializeEl(c) : c.nodeValue).join('').replace(/\s+/g, ' ').trim();
    $('#btn-note-ok').textContent = 'Save note';
    $('#btn-note-delete').hidden = false;
  } else {
    $('#note-dialog-title').textContent = ctx.title || 'Add note';
    $('#note-where').textContent = ctx.point ? `${S.current} · after “${ctx.point.node.data.slice(0, ctx.point.offset).trim().split(/\s+/).slice(-2).join(' ')}”` : `${S.current} · at the end of the passage`;
    $('#note-type').value = ctx.type || store.get('lastNoteType') || 'Notes';
    $('#note-text').value = ctx.text || (ctx.point?.text ? `<foreign>${ctx.point.text}</foreign>: ` : '');
    $('#btn-note-ok').textContent = 'Add note';
    $('#btn-note-delete').hidden = true;
  }
  d.showModal();
  const ta = $('#note-text'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

$('#btn-note-cancel').addEventListener('click', () => { noteCtx = null; $('#note-dialog').close(); });
$('#btn-foreign').addEventListener('click', () => {
  const ta = $('#note-text'), a = ta.selectionStart, b = ta.selectionEnd;
  ta.setRangeText(`<foreign>${ta.value.slice(a, b)}</foreign>`, a, b, 'end'); ta.focus();
});

$('#note-form').addEventListener('submit', e => {
  const btn = e.submitter;
  if (!btn || btn.value !== 'ok') { noteCtx = null; return; }
  const type = $('#note-type').value.trim();
  const body = nfc($('#note-text').value.trim());
  let note;
  try { note = noteElement('x', body); }
  catch (err) { e.preventDefault(); $('#note-error').textContent = 'The note is not valid TEI: check that every <tag> is closed.'; $('#note-error').hidden = false; return; }
  store.set('lastNoteType', type);
  const ctx = noteCtx; noteCtx = null;
  if (ctx.existing) {
    const ex = ctx.existing;
    const oldBody = [...ex.note.childNodes].map(c => c.nodeType === 1 ? serializeEl(c) : c.nodeValue).join('').replace(/\s+/g, ' ').trim();
    if (oldBody === body.replace(/\s+/g, ' ') && type === ex.type) return;
    snapshot(`${ctx.pid}: edited note ${ex.target || ''}`);
    const fresh = noteElement(ex.target, body);
    for (const a of ex.note.attributes) if (!fresh.hasAttribute(a.name)) fresh.setAttribute(a.name, a.value);
    if (type === ex.type) ex.note.replaceWith(fresh);
    else { removeNote(ex.note); addNoteTo(ctx.pid, type, fresh); }
  } else {
    const id = S.current;
    const anchorId = nextAnchorId(id);
    snapshot(`${id}: added ${type} note ${anchorId}`);
    ctx.before?.();
    const anchor = S.doc.createElementNS(TEI_NS, 'anchor');
    anchor.setAttribute('xml:id', anchorId);
    if (ctx.point) {
      const {node, offset} = ctx.point;
      const rest = node.splitText(offset);
      rest.before(anchor);
    } else {
      const el = S.byId.get(id);
      const lines = teiEls(el, 'l'); const last = lines.length ? lines[lines.length - 1] : el;
      last.append(anchor);
    }
    addNoteTo(id, type, noteElement(anchorId, body));
    S.byId.get(id).normalize();
  }
  S.noteTypes.add(type);
  reindex();
  changed(ctx.pid);
  if (!ctx.existing) toast('Note added. Undo with Ctrl+Z.');
});

$('#btn-note-delete').addEventListener('click', () => {
  const ex = noteCtx?.existing; if (!ex) return;
  if (!confirm('Delete this note' + (ex.target ? ' and its anchor in the text' : '') + '?')) return;
  const pid = noteCtx.pid || S.current;
  $('#note-dialog').close(); noteCtx = null;
  snapshot(`${pid}: deleted note ${ex.target || ''}`);
  removeNote(ex.note);
  if (ex.target) {
    const stillUsed = teiEls(S.doc, 'note').some(n => (n.getAttribute('target') || '').split(/\s+/).includes('#' + ex.target));
    if (!stillUsed) S.byId.get(ex.target)?.remove();
  }
  S.byId.get(pid)?.normalize();
  reindex();
  changed(pid);
  toast('Note deleted. Undo with Ctrl+Z.');
});

// floating "Add note here" button
document.addEventListener('selectionchange', () => {
  const pop = $('#selection-pop');
  const sel = window.getSelection();
  if (S.mode !== 'read' || isMulti() || !sel.rangeCount || sel.isCollapsed || !$('#passage').contains(sel.anchorNode)) { pop.hidden = true; return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  pop.style.left = `${Math.max(8, rect.right - 40)}px`; pop.style.top = `${rect.bottom + 6}px`;
  pop.hidden = false;
});
$('#btn-pop-note').addEventListener('mousedown', e => e.preventDefault());
$('#btn-pop-note').addEventListener('click', () => { const p = teiPointFromSelection(); $('#selection-pop').hidden = true; openNoteDialog({point: p}); });
$('#btn-note').addEventListener('click', () => openNoteDialog({point: teiPointFromSelection()}));

// ================================================================ witnesses
const witPassage = (doc, id) => {
  const text = doc.getElementsByTagNameNS(TEI_NS, 'text')[0];
  if (!text) return null;
  for (const el of text.getElementsByTagNameNS(TEI_NS, '*')) {
    if (xmlid(el) === id || (el.getAttribute('corresp') || '').split(/\s+/).includes('#' + id)) return el;
  }
  return null;
};
const precedingPb = el => {
  const first = el.getElementsByTagNameNS(TEI_NS, 'pb')[0];
  const doc = el.ownerDocument;
  const pbs = teiEls(doc, 'pb');
  let last = null;
  for (const pb of pbs) { if (el.compareDocumentPosition(pb) & Node.DOCUMENT_POSITION_PRECEDING) last = pb; else break; }
  return {before: last, inside: first};
};
function witHTML(node, into) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { into.append(c.data); continue; }
    if (c.nodeType !== 1) continue;
    const n = c.localName;
    if (['trailer', 'label', 'note', 'head'].includes(n)) continue;
    if (n === 'del') { const d = h('del'); witHTML(c, d); into.append(d); }
    else if (n === 'add') { const d = h('ins', {title: 'added'}); witHTML(c, d); into.append(d); }
    else if (n === 'pb') into.append(h('span', {class: 'chip pb', 'data-label': `[${c.getAttribute('n') || ''}]`}));
    else if (n === 'gap') into.append(h('span', {class: 'chip gap', 'data-label': '‡'.repeat(parseInt(c.getAttribute('quantity')) || 1)}));
    else if (n === 'caesura') into.append(h('span', {class: 'chip caesura'}));
    else if (n === 'lb' || n === 'cb') { /* line/column breaks: whitespace, if any, is already in the text */ }
    else if (n === 'l') { const d = h('div'); witHTML(c, d); into.append(d); }
    else { const s = h('span', {class: SPANCLASS[n] || ''}); witHTML(c, s); into.append(s); }
  }
}
// ---------------------------------------------------------------- layout: side panels and text size
const TEXT_SIZE = {min: 14, max: 40, step: 2, normal: 21};
function savePrefs(changes) {
  S.prefs = {...(S.prefs || {}), ...changes};
  apiFetch('/api/prefs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(changes)}).catch(() => {});
}
function applyLayoutPrefs() {
  const p = S.prefs || {};
  const L = $('#layout');
  L.classList.toggle('no-left', !!p.hideLeft);
  L.classList.toggle('no-right', !!p.hideRight);
  const tl = $('#btn-toggle-left'), tr = $('#btn-toggle-right');
  tl.setAttribute('aria-pressed', String(!p.hideLeft)); tl.title = (p.hideLeft ? 'Show' : 'Hide') + ' the passage list ([)';
  tr.setAttribute('aria-pressed', String(!p.hideRight)); tr.title = (p.hideRight ? 'Show' : 'Hide') + ' the witnesses (])';
  const size = Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, Number(p.textSize) || TEXT_SIZE.normal));
  document.documentElement.style.setProperty('--text-size', size + 'px');
  $('#btn-text-reset').title = `Normal text size (now ${size}px)`;
}
function setTextSize(delta) {
  const now = Number(S.prefs?.textSize) || TEXT_SIZE.normal;
  const size = delta === 0 ? TEXT_SIZE.normal : Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, now + delta));
  savePrefs({textSize: size}); applyLayoutPrefs();
}
const togglePanel = side => { savePrefs({[side]: !S.prefs?.[side]}); applyLayoutPrefs(); };
$('#btn-toggle-left').addEventListener('click', () => togglePanel('hideLeft'));
$('#btn-toggle-right').addEventListener('click', () => togglePanel('hideRight'));
$('#btn-text-smaller').addEventListener('click', () => setTextSize(-TEXT_SIZE.step));
$('#btn-text-larger').addEventListener('click', () => setTextSize(TEXT_SIZE.step));
$('#btn-text-reset').addEventListener('click', () => setTextSize(0));
document.addEventListener('keydown', e => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"], dialog');
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === '[') { e.preventDefault(); togglePanel('hideLeft'); }
    else if (e.key === ']') { e.preventDefault(); togglePanel('hideRight'); }
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing) {
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setTextSize(TEXT_SIZE.step); }
    else if (e.key === '-') { e.preventDefault(); setTextSize(-TEXT_SIZE.step); }
    else if (e.key === '0') { e.preventDefault(); setTextSize(0); }
  }
});

// Witness order: the user's own (dragged) order of sigla, kept in the editor's preferences for all projects;
// witnesses without the passage always go to the bottom.
function witnessRank(w) {
  const order = S.prefs?.witnessOrder || [];
  const i = order.indexOf(w.siglum);
  return i < 0 ? order.length + S.witnesses.indexOf(w) : i;
}
function orderedWitnesses(id) {
  return S.witnesses.map(w => ({w, el: witPassage(w.doc, id)}))
    .sort((a, b) => (!a.el - !b.el) || (witnessRank(a.w) - witnessRank(b.w)));
}
async function saveWitnessOrder(sigla) {
  // keep sigla of other projects that are not in this one, after those reordered here
  const others = (S.prefs?.witnessOrder || []).filter(s => !sigla.includes(s));
  S.prefs = {...(S.prefs || {}), witnessOrder: [...sigla, ...others]};
  try { await apiFetch('/api/prefs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({witnessOrder: S.prefs.witnessOrder})}); }
  catch { /* the order still applies in this window */ }
}
let dragSig = null;
function witnessDrag(box, siglum) {
  // only the grip starts a drag, so the witness text can still be selected
  const grip = box.querySelector('.wgrip');
  grip.addEventListener('mousedown', () => { box.draggable = true; });
  grip.addEventListener('mouseup', () => { box.draggable = false; });
  box.addEventListener('dragstart', e => { dragSig = siglum; box.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', siglum); });
  box.addEventListener('dragend', () => { dragSig = null; box.draggable = false; box.classList.remove('dragging'); document.querySelectorAll('.wit.drop-before, .wit.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
  box.addEventListener('dragover', e => {
    if (!dragSig || dragSig === siglum) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const r = box.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    box.classList.toggle('drop-after', after); box.classList.toggle('drop-before', !after);
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop-before', 'drop-after'));
  box.addEventListener('drop', e => {
    e.preventDefault();
    const after = box.classList.contains('drop-after');
    box.classList.remove('drop-before', 'drop-after');
    if (!dragSig || dragSig === siglum) return;
    // the user's order of all this project's witnesses (also those not in this passage)
    const all = [...S.witnesses].sort((a, b) => witnessRank(a) - witnessRank(b)).map(w => w.siglum).filter(s => s !== dragSig);
    all.splice(all.indexOf(siglum) + (after ? 1 : 0), 0, dragSig);
    saveWitnessOrder(all);
    renderWitnesses();
  });
}

// several passages: each witness's text of every passage shown, under the passage's id
function renderWitnessesMulti() {
  const box = $('#witnesses');
  const ids = S.selection;
  const rows = S.witnesses.map(w => ({w, els: ids.map(id => witPassage(w.doc, id))}))
    .sort((a, b) => (!a.els.some(Boolean) - !b.els.some(Boolean)) || (witnessRank(a.w) - witnessRank(b.w)));
  box.replaceChildren(...rows.map(({w, els}) => {
    const grip = h('span', {class: 'wgrip', title: 'Drag to change the order of the witnesses', 'aria-hidden': 'true'}, '⠿');
    const head = h('div', {class: 'whead'}, grip, h('span', {class: 'wsig'}, w.siglum), h('span', {class: 'wtitle', title: w.title}, w.title));
    const present = els.filter(Boolean).length;
    if (!present) { const b = h('div', {class: 'wit absent', 'data-siglum': w.siglum}, head, h('div', {class: 'muted'}, 'none of these passages is in this witness')); witnessDrag(b, w.siglum); return b; }
    const firstEl = els.find(Boolean);
    const {before, inside} = precedingPb(firstEl);
    const pb = before || inside;
    if (pb && w.manifest && pb.getAttribute('facs')) head.append(h('button', {title: 'Show the manuscript page of the first of these passages', onclick: () => showImage(w, pb)}, `image ${pb.getAttribute('n') || ''}`));
    else if (pb) head.append(h('span', {class: 'muted'}, pb.getAttribute('n') || ''));
    if (present < ids.length) head.append(h('span', {class: 'muted wcount'}, `${present} of ${ids.length}`));
    const segs = ids.map((id, k) => {
      const t = h('div', {class: 'wtext'});
      if (els[k]) witHTML(els[k], t); else t.append(h('span', {class: 'muted'}, 'not in this witness'));
      return h('div', {class: 'wseg', 'data-id': id},
        h('button', {class: 'wid mopen', title: `Open ${id} alone (to correct ${w.siglum}’s transcription of it: “edit”)`, onclick: () => openPassage(id)}, id), t);
    });
    const b = h('div', {class: 'wit', 'data-siglum': w.siglum}, head, ...segs);
    witnessDrag(b, w.siglum);
    return b;
  }));
  if (S.badFiles.length) box.append(h('p', {class: 'error'}, 'Not loaded: ' + S.badFiles.map(b => b.file).join(', ') + ' (see Settings).'));
}
function renderWitnesses() {
  if (isMulti()) { renderWitnessesMulti(); return; }
  const box = $('#witnesses');
  const id = S.current;
  box.replaceChildren(...orderedWitnesses(id).map(({w, el}) => {
    const grip = h('span', {class: 'wgrip', title: 'Drag to change the order of the witnesses', 'aria-hidden': 'true'}, '⠿');
    const head = h('div', {class: 'whead'}, grip, h('span', {class: 'wsig'}, w.siglum), h('span', {class: 'wtitle', title: w.title}, w.title));
    if (!el) { const b = h('div', {class: 'wit absent', 'data-siglum': w.siglum}, head, h('div', {class: 'muted'}, 'not in this witness')); witnessDrag(b, w.siglum); return b; }
    const {before, inside} = precedingPb(el);
    const pb = before || inside;
    if (pb && w.manifest && pb.getAttribute('facs')) {
      head.append(h('button', {title: 'Show the manuscript page', onclick: () => showImage(w, pb)}, `image ${pb.getAttribute('n') || ''}`));
    } else if (pb) head.append(h('span', {class: 'muted'}, pb.getAttribute('n') || ''));
    const t = h('div', {class: 'wtext'}); witHTML(el, t);
    const box = h('div', {class: 'wit', 'data-siglum': w.siglum}, head, t);
    head.append(h('button', {title: `Correct ${w.siglum}'s transcription of this passage`, onclick: () => editWitness(w, el, box)}, 'edit'));
    witnessDrag(box, w.siglum);
    return box;
  }));
  if (S.badFiles.length) box.append(h('p', {class: 'error'}, 'Not loaded: ' + S.badFiles.map(b => b.file).join(', ') + ' (see Settings).'));
}

// IIIF image viewer (OpenSeadragon, as used by Saktumiva)
let OSD = null, viewer = null, viewerManifest = null;
const processManifest = data => {
  if (data.items) return data.items.map(c => { const m = c.items[0].items[0].body.service[0]; m['@context'] = 'http://iiif.io/api/image/3/context.json'; m.protocol = 'http://iiif.io/api/image'; m.height = c.height; m.width = c.width; return m; });
  if (data.sequences) return data.sequences[0].canvases.map(c => {
    if (c.images[0].resource.service) {
      const m = c.images[0].resource.service;
      if (m.profile === 'http://iiif.io/api/image/2/level0.json') return {type: 'image', url: c.images[0].resource['@id']};
      m['@context'] = 'http://iiif.io/api/image/2/context.json'; m.protocol = 'http://iiif.io/api/image'; m.width = c.width; m.height = c.height; return m;
    }
    const m = c.images[0].resource; m['@context'] = 'http://iiif.io/api/image/1/context.json'; m.protocol = 'http://iiif.io/api/image'; return m;
  });
  return [];
};
async function showImage(w, pb) {
  const page = (parseInt(pb.getAttribute('facs')) || 1) - 1;
  $('#image-panel').hidden = false;
  if (S.prefs?.hideRight) { savePrefs({hideRight: false}); applyLayoutPrefs(); }   // the image lives in the right-hand panel
  $('#image-title').textContent = `${w.siglum} · ${pb.getAttribute('n') || ''}`;
  try {
    if (!OSD) OSD = (await import('./saktumiva/editmode/openseadragon/openseadragon.min.mjs')).default;
    if (viewerManifest !== w.manifest) {
      viewer?.destroy(); viewer = null;
      $('#viewer').replaceChildren();
      const tiles = processManifest(await (await fetch(w.manifest)).json());
      viewer = OSD({element: $('#viewer'), prefixUrl: './saktumiva/editmode/openseadragon/images/', preserveViewport: true,
        visibilityRatio: 1, maxZoomLevel: 3, sequenceMode: true, tileSources: tiles, initialPage: page});
      viewerManifest = w.manifest;
    } else viewer.goToPage(page);
    $('#image-panel').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  } catch (e) {
    $('#viewer').replaceChildren(h('p', {class: 'error', style: 'padding:12px'}, `Could not load the images (${e.message}). They come from ${w.manifest}; check your internet connection.`));
  }
}
$('#btn-image-close').addEventListener('click', () => { $('#image-panel').hidden = true; });

// ================================================================ correcting the alignment
let AL = null;   // {id, m: AlignMatrix, hist: [], base}
function startAligner() {
  if (S.mode !== 'read') return;
  if (isMulti()) { needOne(); return; }
  const id = S.current;
  const r = S.results.get(id);
  if (!r || r.hash !== serializeEl(S.byId.get(id)) || !r.res.alignXML) { toast('Wait for the collation to finish first.', true); return; }
  let m;
  try { m = new AlignMatrix(r.res.alignXML, S.collator.siglum); } catch (e) { toast('Cannot read this alignment: ' + e.message, true); return; }
  S.mode = 'align';
  AL = {id, m, hist: [], base: S.collator.siglum};
  $('#aligner').hidden = false;
  $('#reading-tools').style.visibility = 'hidden';
  $('#btn-align').disabled = true;
  renderAligner();
  updateStatus();
  $('#aligner').scrollIntoView({behavior: 'smooth', block: 'start'});
}

function alApply(fn) {
  const snap = AL.m.snapshot();
  let ok = false;
  try { ok = fn(); } catch (e) { AL.m.restore(snap); toast('Not done: ' + e.message, true); return; }
  if (!ok) { AL.m.restore(snap); return; }
  AL.hist.push(snap);
  renderAligner();
}

function renderAligner() {
  const m = AL.m, base = AL.base;
  const rows = [base, ...m.rows.filter(s => s !== base)].filter(s => m.rows.includes(s));
  // break the columns into lines of about 60 characters of the first row
  const lines = []; let cur = [], len = 0;
  m.groups.forEach((g, i) => {
    const w = Math.max(...rows.map(s => m.cellText(s, i).length), 4);
    if (cur.length && len + w > 62) { lines.push(cur); cur = []; len = 0; }
    cur.push(i); len += w + 3;
  });
  if (cur.length) lines.push(cur);
  const last = m.groups.length - 1;
  const tables = lines.map(idx => h('table', {class: 'al-line'},
    h('thead', {}, h('tr', {}, h('th'), ...idx.map(g => h('td', {}, String(g + 1),
      g < last ? h('button', {'data-op': 'merge', 'data-g': g, title: 'Join this column with the next one (one apparatus entry)'}, 'join →') : null)))),
    h('tbody', {}, ...rows.map(s => h('tr', {class: s === base ? 'base' : ''}, h('th', {class: 'sig'}, s),
      ...idx.map(g => {
        const text = m.cellText(s, g);
        const td = h('td', {class: text.trim() ? '' : 'empty'});
        if (s === base) {
          // syllables, with cut points where the column may be split
          const cuts = new Set(m.cutPoints(g));
          m.baseCells(base, g).forEach((t, k) => {
            if (cuts.has(k)) td.append(h('span', {class: 'cut', 'data-op': 'split', 'data-g': g, 'data-k': k, title: 'Split the column here'}));
            if (t) td.append(h('span', {class: 'tokb'}, t));
          });
          if (!text.trim()) td.append('–');
        } else td.append(text.trim() ? text : '–');
        if (text.trim()) {
          if (g > 0) td.append(h('button', {class: 'sh l', 'data-op': 'shift', 'data-s': s, 'data-g': g, 'data-dir': -1, title: `Move ${s}'s first syllable here into the previous column`}, '‹'));
          if (g < last) td.append(h('button', {class: 'sh r', 'data-op': 'shift', 'data-s': s, 'data-g': g, 'data-dir': 1, title: `Move ${s}'s last syllable here into the next column`}, '›'));
        }
        return td;
      }))))));
  $('#al-table').replaceChildren(...tables);
  $('#btn-al-undo').disabled = !AL.hist.length;
  $('#btn-al-save').disabled = !AL.hist.length;
  $('#al-status').textContent = AL.hist.length ? `${AL.hist.length} change${AL.hist.length > 1 ? 's' : ''}` : '';
  // the apparatus follows the corrections
  try {
    const xml = m.toXML();
    const r = S.collator.apparatus(AL.id, xml);
    showApparatus(AL.id, {...r, alignXML: xml, source: 'editing'});
  } catch (e) { $('#apparatus').replaceChildren(h('p', {class: 'error'}, 'Apparatus could not be built: ' + e.message)); }
}

$('#al-table').addEventListener('click', e => {
  const b = e.target.closest('[data-op]'); if (!b || !AL) return;
  const g = Number(b.dataset.g);
  if (b.dataset.op === 'merge') alApply(() => AL.m.merge(g));
  else if (b.dataset.op === 'split') alApply(() => AL.m.split(g, Number(b.dataset.k)));
  else if (b.dataset.op === 'shift') alApply(() => AL.m.shift(b.dataset.s, g, Number(b.dataset.dir)));
});
$('#btn-al-undo').addEventListener('click', () => { if (AL?.hist.length) { AL.m.restore(AL.hist.pop()); renderAligner(); } });
$('#btn-al-cancel').addEventListener('click', () => endAligner());
$('#btn-al-save').addEventListener('click', saveAlignment);
$('#btn-align').addEventListener('click', startAligner);

function endAligner() {
  S.mode = 'read'; AL = null;
  $('#aligner').hidden = true;
  $('#reading-tools').style.visibility = '';
  updateStatus();
  const r = S.results.get(S.current);
  if (r) showApparatus(S.current, r.res); else collateCurrent();
}

async function saveAlignment() {
  if (!AL) return;
  const id = AL.id;
  const xml = AL.m.toXML({corrected: true});
  const resp = await (await apiFetch('/api/alignments', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({alignments: {[id]: xml}, message: `Alignment for ${id} corrected by hand`})})).json().catch(e => ({ok: false, errors: [e.message]}));
  if (!resp.ok) { toast('Not saved: ' + (resp.errors || []).join(' '), true, 9000); return; }
  S.alignFile.set(id, xml);
  S.forceFresh.delete(id);
  const r = S.collator.apparatus(id, xml);
  S.results.set(id, {hash: serializeEl(S.byId.get(id)), res: {...r, alignXML: xml, source: 'file'}});
  endAligner();
  toast(`Corrected alignment saved to ${S.cfg.alignmentsDir}/${id}.xml${resp.commit ? ` — git commit ${resp.commit}` : ''}. The editor will use it from now on.`, false, 7000);
}

// ================================================================ correcting a witness transcription
function editWitness(w, el, box) {
  if (S.mode !== 'read') { toast('Finish or cancel the current edit first.', true); return; }
  if (isMulti()) { needOne(); return; }
  S.mode = 'witness';
  updateStatus();
  const ta = h('textarea', {class: 'wit-src', spellcheck: 'false'});
  ta.value = serializeEl(el);
  const apply = h('button', {class: 'primary'}, `Save to ${w.file}`);
  const cancel = h('button', {}, 'Cancel');
  const note = h('p', {class: 'muted'}, `This corrects the transcription of ${w.siglum} itself and is saved straight away to its file (with a git commit). The passage is then collated again.`);
  box.replaceChildren(note, ta, h('div', {class: 'edit-bar'}, h('span', {class: 'spacer'}), cancel, apply));
  ta.focus();
  cancel.addEventListener('click', () => { S.mode = 'read'; updateStatus(); renderWitnesses(); });
  apply.addEventListener('click', () => saveWitness(w, el, nfc(ta.value)));
}

async function saveWitness(w, el, txt) {
  const id = S.current;
  let node;
  try {
    const wrap = parseXML(`<wrap xmlns="${TEI_NS}">${txt}</wrap>`, 'passage').documentElement;
    const els = [...wrap.children];
    if (els.length !== 1) throw new Error('the box must contain exactly one element');
    node = els[0];
    if (node.localName !== el.localName || (xmlid(node) || '') !== (xmlid(el) || '') || (node.getAttribute('corresp') || '') !== (el.getAttribute('corresp') || ''))
      throw new Error('the outer element, its xml:id and corresp must stay the same');
  } catch (e) { toast('Not saved: ' + e.message, true, 7000); return; }
  const before = serializeEl(el);
  const imported = w.doc.importNode(node, true);
  imported.removeAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns');
  if (serializeEl(imported) === before) { S.mode = 'read'; updateStatus(); renderWitnesses(); return; }
  const xid = xmlid(el);
  const span = xid ? w.span.ids.get(xid) : null;
  const corr = (el.getAttribute('corresp') || '').split(/\s+/)[0];
  const sp = span || (corr ? w.span.corresps.get(corr) : null);
  if (!sp) { toast(`Cannot find this passage in ${w.file}.`, true); return; }
  if (fileIsCorrected(id) && !confirm(`The alignment of ${id} was corrected by hand. After changing ${w.siglum}'s transcription it will be replaced by a fresh collation (the corrected one stays in git history). Go on?`)) return;
  const content = w.raw.slice(0, sp[0]) + patchElement(w.raw.slice(sp[0], sp[1]), before, serializeEl(imported)) + w.raw.slice(sp[1]);
  let check;
  try { check = parseXML(content, w.file); } catch (e) { toast('Not saved: ' + e.message, true, 8000); return; }
  const resp = await (await apiFetch('/api/save', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({file: w.file, baseMtime: w.mtime, content, message: `${w.siglum} (${w.file}): corrected transcription of ${id}`})})).json().catch(e => ({ok: false, errors: [e.message]}));
  if (!resp.ok) { toast('Not saved: ' + (resp.errors || []).join(' '), true, 10000); return; }
  w.raw = content; w.mtime = resp.mtime; w.span = scanRaw(content); w.doc = check;
  S.collator.setFile(w.file, check);
  S.results.delete(id);
  S.forceFresh.add(id);
  if (S.cfg.alignmentsDir) S.pendingAlign.add(id);
  S.mode = 'read'; updateStatus();
  renderWitnesses();
  collateCurrent();
  toast(`Saved ${w.file}${resp.commit ? ` — git commit ${resp.commit}` : ''}. Collating the passage again.`, false, 6000);
}

// ================================================================ edit text (visual)
const TOKEN_LABEL = {
  caesura: () => '|', anchor: el => '◆' + (xmlid(el) || '').replace(/^.*-n/, 'n'), gap: el => '‡', metamark: () => '※',
  pb: el => `[${el.getAttribute('n') || 'pb'}]`, lb: () => '⏎', cb: () => '¦'
};
let editCtx = null;

function editableLines(el) {
  if (['l', 'p'].includes(el.localName)) return [el];
  const ls = [...el.children].filter(c => ['l', 'p'].includes(c.localName));
  return ls.length ? ls : [el];
}

function startEdit() {
  if (S.mode !== 'read') return;
  if (isMulti()) { needOne(); return; }
  const el = S.byId.get(S.current);
  if (!el) return;
  S.mode = 'edit';
  CSS.highlights?.clear();
  const box = $('#passage');
  box.classList.add('editing');
  const lines = editableLines(el);
  const rows = [];
  const model = lines.map(L => {
    const items = []; // {type:'text', node} | {type:'chip', node}
    for (const c of L.childNodes) {
      if (c.nodeType === 3) items.push({type: 'text', node: c});
      else if (c.nodeType === 1 && !MUTED.has(c.localName)) items.push({type: 'chip', node: c});
      else if (c.nodeType === 1) items.push({type: 'fixed', node: c});
    }
    return {L, items};
  });
  for (const m of model) {
    const row = h('div', {class: 'erow', contenteditable: 'true', spellcheck: 'false'});
    m.items.forEach((it, k) => {
      if (it.type === 'text') row.append(collapseWithMap(it.node.data).out);
      else if (it.type === 'chip') {
        const n = it.node.localName;
        const label = TOKEN_LABEL[n] ? TOKEN_LABEL[n](it.node) : it.node.textContent.replace(/\s+/g, ' ') || n;
        row.append(h('span', {class: 'tok' + (TOKEN_LABEL[n] ? '' : ' texty') + (n === 'anchor' ? ' anchor' : ''), contenteditable: 'false',
          'data-k': k, title: TOKEN_LABEL[n] ? `<${n}>` : `<${n}> — use TEI source to change the words inside`}, label));
      }
    });
    rows.push(row);
  }
  const trailers = [...el.children].filter(c => MUTED.has(c.localName)).map(c => h('div', {class: 'trailer'}, c.textContent.trim()));
  box.replaceChildren(...rows, ...trailers);
  editCtx = {el, model, rows, before: serializeEl(el)};
  $('#edit-bar').hidden = false; $('#chk-emend').checked = false;
  $('#reading-tools').style.visibility = 'hidden';
  updateStatus();
  rows[0]?.focus();
}

function readRow(row) {
  // -> [{type:'text', s}, {type:'chip', k}] with consecutive text merged
  const out = [];
  const push = s => { if (out.length && out[out.length - 1].type === 'text') out[out.length - 1].s += s; else out.push({type: 'text', s}); };
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) push(c.data);
      else if (c.nodeType === 1 && c.classList.contains('tok')) out.push({type: 'chip', k: Number(c.dataset.k)});
      else if (c.nodeType === 1 && c.tagName === 'BR') push(' ');
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(row);
  return out;
}

function finishEdit(commit) {
  if (S.mode !== 'edit' || !editCtx) return;
  const {el, model, rows, before} = editCtx;
  if (!commit) { endEdit(); return; }
  // plan the new children of each line, checking that markup tokens kept their order
  const plans = [];
  for (let r = 0; r < rows.length; r++) {
    const items = model[r].items;
    const edited = readRow(rows[r]);
    const chipsNew = edited.filter(x => x.type === 'chip').map(x => x.k);
    const ok = chipsNew.every((k, i) => i === 0 || k > chipsNew[i - 1]);
    if (!ok) { toast('Markup tokens (grey boxes) cannot be moved or duplicated here. Use “TEI source” for that.', true, 6000); return; }
    // region j = original items strictly between surviving chip j-1 and chip j
    const bounds = [-1, ...chipsNew, items.length];
    const segs = []; let cur = '';
    for (const x of edited) { if (x.type === 'text') cur += x.s; else { segs.push(cur); cur = ''; } }
    segs.push(cur);
    const newKids = [];
    for (let j = 0; j < bounds.length - 1; j++) {
      const lo = bounds[j], hi = bounds[j + 1];
      const raw = items.slice(lo + 1, hi).filter(it => it.type === 'text').map(it => it.node.data).join('');
      const fixed = items.slice(lo + 1, hi).filter(it => it.type === 'fixed').map(it => it.node);
      const merged = nfc(mergeText(raw, nfc(segs[j])));
      if (merged) newKids.push(merged);
      newKids.push(...fixed);
      if (hi < items.length) newKids.push(items[hi].node);
    }
    plans.push({L: model[r].L, newKids});
  }
  const oldPlain = el.textContent;
  // apply
  const undoDoc = S.doc.cloneNode(true);
  for (const {L, newKids} of plans) {
    L.replaceChildren(...newKids.map(k => typeof k === 'string' ? S.doc.createTextNode(k) : k));
  }
  const after = serializeEl(el);
  if (after === before) { endEdit(); return; }
  S.undo.push({doc: undoDoc, current: S.current, log: [...S.log]}); S.redo = [];
  const {from, to} = describeChange(oldPlain.replace(/\s+/g, ' '), el.textContent.replace(/\s+/g, ' '));
  S.log.push(`${S.current}: changed “${from}” to “${to}”`);
  const emend = $('#chk-emend').checked;
  endEdit();
  reindex();
  changed(S.current);
  if (emend) {
    // anchor goes after the last changed word
    const point = findWordEnd(el, to);
    openNoteDialog({title: 'Record the emendation', type: 'Emendation', point,
      text: `We emend <foreign>${from || '…'}</foreign> to <foreign>${to || '…'}</foreign> .`.replace(' .', '.')});
  } else toast('Text changed. Undo with Ctrl+Z.');
}

function findWordEnd(el, words) {
  const last = (words || '').trim().split(/\s+/).pop();
  if (!last) return null;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let found = null;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (t.parentNode && MUTED.has(t.parentNode.localName)) continue;
    const i = t.data.lastIndexOf(last);
    if (i >= 0) found = {node: t, offset: i + last.length, text: last};
  }
  return found;
}

function endEdit() {
  S.mode = 'read'; editCtx = null;
  $('#edit-bar').hidden = true; $('#source-box').hidden = true;
  $('#reading-tools').style.visibility = '';
  renderPassage(); updateStatus();
}

// ================================================================ edit TEI source
function startSource() {
  if (S.mode !== 'read') return;
  if (isMulti()) { needOne(); return; }
  const el = S.byId.get(S.current);
  S.mode = 'source';
  $('#source-text').value = serializeEl(el);
  $('#source-box').hidden = false;
  $('#reading-tools').style.visibility = 'hidden';
  updateStatus();
  $('#source-text').focus();
}
function applySource() {
  const el = S.byId.get(S.current);
  const txt = nfc($('#source-text').value);
  let node;
  try {
    const wrap = parseXML(`<wrap xmlns="${TEI_NS}">${txt}</wrap>`, 'passage').documentElement;
    const els = [...wrap.children];
    if (els.length !== 1) throw new Error('the box must contain exactly one element');
    node = els[0];
    if (xmlid(node) !== S.current) throw new Error(`the xml:id must stay "${S.current}"`);
    const ids = [...node.getElementsByTagNameNS(TEI_NS, '*')].map(xmlid).filter(Boolean);
    const clash = ids.find(i => S.byId.has(i) && !el.contains(S.byId.get(i)));
    if (clash) throw new Error(`xml:id "${clash}" is already used elsewhere`);
  } catch (e) { toast('Not applied: ' + e.message, true, 7000); return; }
  if (serializeEl(node) === serializeEl(el)) { endEdit(); return; }
  snapshot(`${S.current}: edited TEI source`);
  el.replaceWith(S.doc.importNode(node, true));
  endEdit(); reindex(); changed(S.current);
  toast('Passage updated. Undo with Ctrl+Z.');
}

// ================================================================ merging and splitting passages
// Both change the edition and every witness file together and are saved straight away, as one git commit
// (like a correction to a witness). There is nothing left to undo in the page, so they wait until all is saved.
function restructureReady() {
  if (S.mode !== 'read') { toast('Finish or cancel the current edit first.', true); return false; }
  if (S.log.length) { toast('Save your changes first: merging and splitting rewrite the edition and the witness files straight away.', true, 7000); return false; }
  if (S.badFiles.some(b => (S.cfg.witnesses || []).includes(b.file))) {
    toast(`Not possible while a witness file cannot be read (${S.badFiles.map(b => b.file).join(', ')}): its passages would be left behind.`, true, 9000); return false; }
  return true;
}
const sectionFiles = () => [
  {file: S.editionFile, raw: S.raw, doc: S.origDoc, span: S.span, mtime: S.mtime, edition: true, siglum: S.collator.siglum, title: 'the edition'},
  ...S.witnesses.map(w => ({file: w.file, raw: w.raw, doc: w.doc, span: w.span, mtime: w.mtime, siglum: w.siglum, title: w.title, w}))];
const onFiles = fn => sectionFiles().map(f => { try { return {f, res: fn(f)}; } catch (e) { return {f, error: e.message}; } });
const filesReport = rows => h('table', {}, ...rows.map(r => h('tr', {'data-file': r.f.file, 'data-status': r.error ? 'error' : r.res.status},
  h('td', {class: 'sig'}, r.f.siglum), h('td', {class: 'muted'}, r.f.file),
  h('td', {class: r.error ? 'error' : r.res.status === 'unchanged' ? 'muted' : ''}, r.error ? `Cannot be done: ${r.error}.` : r.res.why))));
const wayBack = () => h('p', {class: 'muted'}, 'This is written to the files straight away',
  S.gitOn ? ', as one git commit. Ctrl+Z does not undo it: to go back, revert that commit in git.'
          : '. This folder is not under git, so there is no way back: make a copy of the folder first.',
  S.cfg.alignmentsDir && S.cfg.writeAlignments !== false ? ' The alignment files of these passages are replaced by fresh collations.' : '');
let rsGo = null;
function restructureDialog(action, ...content) {
  $('#rs-body').replaceChildren(...content.filter(Boolean));
  $('#rs-error').hidden = true;
  $('#btn-rs-go').textContent = action; $('#btn-rs-go').disabled = false;
  if (!$('#restructure-dialog').open) $('#restructure-dialog').showModal();
}
const rsError = msg => { const e = $('#rs-error'); e.textContent = msg; e.hidden = !msg; };
async function correctedAlignments(ids) {
  if (!S.cfg.alignmentsDir) return [];
  await Promise.all(ids.map(alignFileText));
  return ids.filter(fileIsCorrected);
}
// Write the new files, then take them as what is on disk (as after Save and after a witness correction).
// `gone`: passages that no longer exist; `fresh`: passages whose text is new and must be collated again.
async function commitRestructure(rows, {gone, fresh, message}) {
  const changed = rows.filter(r => r.res.content !== r.f.raw);
  const writeAl = !!S.cfg.alignmentsDir && S.cfg.writeAlignments !== false;
  $('#btn-rs-go').disabled = true;
  let resp;
  try {
    resp = await (await apiFetch('/api/restructure', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({files: changed.map(r => ({file: r.f.file, baseMtime: r.f.mtime, content: r.res.content})),
                            removeAlignments: writeAl ? [...new Set([...gone, ...fresh])] : [], message})})).json();
  } catch (e) { resp = {ok: false, errors: ['the local server did not answer. Is it still running?']}; }
  $('#btn-rs-go').disabled = false;
  if (!resp.ok) { rsError('Nothing was changed: ' + (resp.errors || []).join(' ')); return null; }
  for (const r of changed) {
    const mtime = resp.mtimes[r.f.file];
    S.mtimes[r.f.file] = mtime;
    if (r.f.edition) {
      S.raw = r.res.content; S.mtime = mtime; S.origDoc = r.res.doc; S.span = scanRaw(S.raw);
      S.doc = S.origDoc.cloneNode(true);
      assignKeys(S.doc);
      S.collator.setEdition(S.doc);
      S.undo = []; S.redo = []; S.log = [];
      S.baseProblems = new Set(noteProblems(S.origDoc));
    } else {
      const w = r.f.w;
      w.raw = r.res.content; w.mtime = mtime; w.span = scanRaw(w.raw); w.doc = r.res.doc;
      S.collator.setFile(w.file, w.doc);
    }
  }
  S.chapter = new Map();
  reindex();
  rememberOriginal();
  for (const id of [...gone, ...fresh]) {
    S.results.delete(id); S.forceFresh.delete(id); S.pendingAlign.delete(id);
    if (writeAl) S.alignFile.set(id, null); else S.alignFile.delete(id);
  }
  if (writeAl) for (const id of fresh) S.pendingAlign.add(id);
  $('#restructure-dialog').close();
  return resp;
}

// ---------------------------------------------------------------- merge the passages shown
async function openMerge() {
  if (!restructureReady()) return;
  const ids = [...S.selection];
  if (ids.length < 2) { toast('Show the passages to merge first (Shift-click in the passage list).'); return; }
  const i0 = S.blocks.indexOf(ids[0]);
  if (!ids.every((id, k) => S.blocks[i0 + k] === id)) { toast('Only passages that follow one another can be merged. Shift-click selects such a run.', true, 7000); return; }
  const keep = ids[0];
  const rows = onFiles(f => mergeInFile({...f, ids, name: f.file}));
  const corrected = await correctedAlignments(ids);
  const warnings = [...new Set(rows.flatMap(r => r.res?.warnings || []))];
  const bad = rows.some(r => r.error);
  restructureDialog('Merge',
    h('h3', {}, `Merge ${ids.length} passages into ${keep}`),
    h('p', {}, `The text of ${selectionLabel(ids, S.blocks)} becomes one passage with the xml:id `, h('b', {}, keep),
      ', in the edition and in every witness that has these passages. Their notes go with them. No text is changed: only the tags between the passages are removed.'),
    filesReport(rows),
    bad ? h('p', {class: 'error'}, 'Nothing can be merged until the files marked above are put right (for instance with a witness’s “edit”, or in your XML editor); then reload this page.') : null,
    warnings.length ? h('ul', {}, ...warnings.map(w => h('li', {}, w))) : null,
    corrected.length ? h('p', {class: 'error'}, `The alignment of ${corrected.join(', ')} was corrected by hand. It will be replaced by a fresh collation of the merged passage (the corrected one stays in git history).`) : null,
    wayBack());
  $('#btn-rs-go').disabled = bad;
  rsGo = async () => {
    const resp = await commitRestructure(rows, {gone: ids.slice(1), fresh: [keep], message: `Passages ${ids.join(', ')} merged into ${keep}`});
    if (!resp) return;
    S.selection = [keep]; S.current = keep;
    renderList(); openPassage(keep); updateStatus();
    toast(`Merged into ${keep}: ${resp.written.length} file(s) changed${resp.commit ? ` — git commit ${resp.commit}` : ''}.`, false, 7000);
    flushAlignments();
  };
}

// ---------------------------------------------------------------- split the passage shown
// The place is chosen in the edition's text; the alignment then says where that falls in each witness.
// Every witness is shown so that its place can be checked and moved.
let SP = null;   // {id, rows: [{f, el, text, offset, manual, guess}]}
function openSplit() {
  if (!restructureReady()) return;
  if (isMulti()) { needOne(); return; }
  const id = S.current;
  const rows = sectionFiles().map(f => ({f, el: findPassage(f.doc, id)})).filter(r => r.el)
    .map(r => ({...r, text: textNodesOf(r.el).map(t => t.data).join(''), offset: null, manual: false, guess: ''}));
  if (!rows.length || !rows[0].f.edition) return;
  if (!rows[0].text.trim()) { toast('This passage has no text to split.', true); return; }
  // start from the word last clicked or selected in the text, if any
  let start = null;
  const pt = teiPointFromSelection(), nodes = textNodesOf(S.byId.get(id));
  if (pt && nodes.includes(pt.node)) start = nodes.slice(0, nodes.indexOf(pt.node)).reduce((a, t) => a + t.data.length, 0) + pt.offset;
  SP = {id, rows, list: h('div', {id: 'sp-rows'})};
  const first = h('input', {id: 'sp-first', value: id, spellcheck: 'false'}), second = h('input', {id: 'sp-second', value: id + 'b', spellcheck: 'false'});
  restructureDialog('Split',
    h('h3', {}, `Split ${id} in two`),
    h('p', {}, 'Click in the text of the edition where the second passage is to begin. Each witness is then marked at the matching place, going by the alignment: ',
      'check them, and click in a witness (or use ‹ ›, « » for a word) to move its mark. The shaded text becomes the second passage. ',
      'A witness marked at its very beginning or end keeps its text whole, in the second or the first passage.'),
    h('div', {class: 'ids'}, h('label', {}, 'xml:id of the first part', first), h('label', {}, 'xml:id of the second part', second)),
    SP.list, wayBack());
  if (start !== null && offsetPlace(rows[0].el, snapOffset(rows[0].el, start)) === 'inside') setSplitOffset(rows[0], start);
  else renderSplit();
  correctedAlignments([id]).then(c => { if (c.length && SP?.id === id) SP.list.after(h('p', {class: 'error'},
    `The alignment of ${id} was corrected by hand. It will be replaced by fresh collations of the two parts (the corrected one stays in git history).`)); });
  rsGo = runSplit;
}
function setSplitOffset(row, offset, manual = false) {
  row.offset = snapOffset(row.el, offset);
  if (row.f.edition) suggestSplit(); else { row.manual = manual; row.guess = ''; }
  renderSplit();
}
function suggestSplit() {
  const ed = SP.rows[0], ignore = new Set(S.collator.ignore);
  let parts = new Map();
  const r = S.results.get(SP.id);
  if (r?.res.alignXML && r.hash === serializeEl(S.byId.get(SP.id))) {
    try { parts = alignedParts(r.res.alignXML, S.collator.siglum, offsetToCount(ed.el, ed.offset, ignore)); } catch (e) { console.warn('no suggestion from the alignment', e); }
  }
  for (const row of SP.rows.slice(1)) {
    if (row.manual) continue;
    // a witness with corrections has two rows in the alignment (Kac, Kpc): its corrected text is followed
    const part = [row.f.siglum, row.f.siglum + 'pc', row.f.siglum + 'ac'].map(k => parts.get(k)).find(Boolean);
    const at = part ? locateParts(row.el, part, ignore) : null;
    if (at) { row.offset = at.offset; row.guess = at.sure ? 'by the alignment' : 'by the alignment — please check'; }
    else {   // no alignment to go by: the same proportion of the text, at the next word
      let o = Math.round(row.text.length * ed.offset / Math.max(1, ed.text.length));
      while (o < row.text.length && /\S/.test(row.text[o])) o++;
      row.offset = snapOffset(row.el, o); row.guess = 'a rough guess (no alignment): please check';
    }
  }
}
function splitNudge(row, kind) {
  const s = row.text; let o = row.offset ?? 0;
  if (kind === 'char-') { o--; while (o > 0 && /\s/.test(s[o])) o--; }
  if (kind === 'char+') o++;
  if (kind === 'word-') { o--; while (o > 0 && /\s/.test(s[o])) o--; while (o > 0 && /\S/.test(s[o - 1])) o--; }
  if (kind === 'word+') { while (o < s.length && /\S/.test(s[o])) o++; }
  setSplitOffset(row, Math.max(0, o), true);
}
function splitText(row) {
  const box = h('div', {class: 'sptext'}), starts = new Map();
  let flat = 0, placed = row.offset === null;
  const mark = () => h('span', {class: 'split-mark', title: 'the second passage begins here'});
  const put = (into, text, start) => {
    if (!text) return;
    const t = document.createTextNode(text); starts.set(t, start);
    into.append(row.offset !== null && start >= row.offset ? h('span', {class: 'part2'}, t) : t);
  };
  const walk = (n, into) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const a = flat; flat += c.data.length;
        if (!placed && row.offset >= a && row.offset < flat) {
          put(into, c.data.slice(0, row.offset - a), a); into.append(mark()); placed = true; put(into, c.data.slice(row.offset - a), row.offset);
        } else put(into, c.data, a);
      } else if (c.nodeType === 1) {
        const name = c.localName;
        if (name in CHIP) { into.append(h('span', {class: `chip ${name}`, 'data-label': CHIP[name](c) || (name === 'anchor' ? '•' : '')})); continue; }
        const el = ['lg', 'l', 'p'].includes(name) || MUTED.has(name) ? h('div', {class: name}) : h('span', {class: SPANCLASS[name] || `tei-${name}`});
        walk(c, el); into.append(el);
      }
    }
  };
  walk(row.el, box);
  if (!placed) box.append(mark());
  box.addEventListener('click', e => {
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
    const rng = !pos && document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    const node = pos ? pos.offsetNode : rng?.startContainer, off = pos ? pos.offset : rng?.startOffset;
    if (node && starts.has(node)) setSplitOffset(row, starts.get(node) + off, true);
  });
  return box;
}
function renderSplit() {
  const ed = SP.rows[0];
  SP.list.replaceChildren(...SP.rows.map((row, i) => {
    if (i && ed.offset === null) return null;
    const place = row.offset === null ? null : offsetPlace(row.el, row.offset);
    const where = row.offset === null ? 'click where the second passage begins'
      : place === 'start' ? 'all of this goes to the second passage' : place === 'end' ? 'all of this stays in the first passage' : row.guess;
    const nudge = (label, kind, title) => h('button', {title, disabled: row.offset === null, onclick: () => splitNudge(row, kind)}, label);
    return h('div', {class: 'sprow' + (i ? '' : ' edition'), 'data-siglum': row.f.siglum},
      h('div', {class: 'sphead'}, h('span', {class: 'wsig sig'}, row.f.siglum), h('span', {class: 'wtitle', title: row.f.title}, i ? row.f.title : 'the edition'),
        h('span', {class: 'spacer'}), h('span', {class: 'spwhere'}, where),
        nudge('«', 'word-', 'A word earlier'), nudge('‹', 'char-', 'A letter earlier'), nudge('›', 'char+', 'A letter later'), nudge('»', 'word+', 'A word later')),
      splitText(row));
  }));
  const missing = S.witnesses.filter(w => !SP.rows.some(r => r.f.w === w)).map(w => w.siglum);
  if (missing.length) SP.list.append(h('p', {class: 'muted'}, `Not in ${missing.join(', ')}.`));
  rsError('');
}
async function runSplit() {
  const {id} = SP, ed = SP.rows[0];
  const firstId = nfc($('#sp-first').value.trim()), secondId = nfc($('#sp-second').value.trim());
  if (ed.offset === null) { rsError('Click in the text of the edition where the second passage is to begin.'); return; }
  for (const n of [firstId, secondId]) if (!validId(n)) { rsError(`“${n}” cannot be an xml:id: use letters, digits, full stops, hyphens and underscores, beginning with a letter.`); return; }
  const offsets = new Map(SP.rows.map(r => [r.f.file, r.offset]));
  const rows = onFiles(f => splitInFile({...f, id, firstId, secondId, offset: offsets.get(f.file), name: f.file}));
  const bad = rows.filter(r => r.error);
  if (bad.length) { rsError('Nothing was changed. ' + bad.map(r => `${r.f.siglum} (${r.f.file}): ${r.error}.`).join(' ')); return; }
  const warnings = [...new Set(rows.flatMap(r => r.res.warnings))];
  const resp = await commitRestructure(rows, {gone: firstId === id ? [] : [id], fresh: [firstId, secondId],
    message: `Passage ${id} split into ${firstId} and ${secondId}`});
  if (!resp) return;
  SP = null;
  S.selection = [firstId]; S.current = firstId;
  renderList(); showSeveral([firstId, secondId], firstId); updateStatus();
  toast(`${id} is now ${firstId} and ${secondId}: ${resp.written.length} file(s) changed${resp.commit ? ` — git commit ${resp.commit}` : ''}.`
    + (warnings.length ? ' Note: ' + warnings.join('; ') : ''), false, warnings.length ? 12000 : 7000);
  flushAlignments();
}

// ================================================================ saving
function buildRaw() {
  const edits = [];
  const raw = S.raw;
  // passages
  for (const id of S.blocks) {
    const cur = S.byId.get(id), old = S.origById.get(id);
    if (!old) continue;
    const a = serializeEl(cur), b = serializeEl(old);
    if (a !== b) {
      const span = S.span.ids.get(id);
      if (!span) throw new Error(`cannot find ${id} in the file`);
      edits.push({start: span[0], end: span[1], text: patchElement(raw.slice(span[0], span[1]), b, a), order: 0});
    }
  }
  // standOffs (notes)
  const origSO = teiEls(S.origDoc, 'standOff');
  const curSO = teiEls(S.doc, 'standOff');
  const byKey = new Map(curSO.filter(s => s.hasAttribute(KEY_ATTR)).map(s => [s.getAttribute(KEY_ATTR), s]));
  const touchedNotes = curSO.some(s => !s.hasAttribute(KEY_ATTR)) || origSO.some((o, k) => !byKey.has(String(k)) || serializeEl(byKey.get(String(k))) !== serializeEl(o));
  if (touchedNotes && !S.keysOk) throw new Error('the notes in this file could not be matched to the file text, so notes cannot be saved');
  origSO.forEach((o, k) => {
    const [s, e] = S.span.standOffs[k];
    const c = byKey.get(String(k));
    if (!c) { // deleted: also remove the line break before it
      let s2 = s; while (s2 > 0 && /[ \t]/.test(raw[s2 - 1])) s2--; if (raw[s2 - 1] === '\n') s2--;
      edits.push({start: s2, end: e, text: '', order: 0});
    } else if (serializeEl(c) !== serializeEl(o)) edits.push({start: s, end: e, text: patchElement(raw.slice(s, e), serializeEl(o), serializeEl(c)), order: 0});
  });
  curSO.forEach((so, i) => {
    if (so.hasAttribute(KEY_ATTR)) return;
    let pos = null, text = null;
    const ws = so.previousSibling && so.previousSibling.nodeType === 3 && /^\s+$/.test(so.previousSibling.data) ? so.previousSibling.data : '\n';
    for (let j = i - 1; j >= 0; j--) if (curSO[j].hasAttribute(KEY_ATTR)) { pos = S.span.standOffs[Number(curSO[j].getAttribute(KEY_ATTR))][1]; text = ws + serializeEl(so); break; }
    if (pos === null) for (let j = i + 1; j < curSO.length; j++) if (curSO[j].hasAttribute(KEY_ATTR)) { pos = S.span.standOffs[Number(curSO[j].getAttribute(KEY_ATTR))][0]; text = serializeEl(so) + ws; break; }
    if (pos === null) { pos = S.span.teiEnd; text = serializeEl(so) + '\n'; }
    edits.push({start: pos, end: pos, text, order: i + 1});
  });
  edits.sort((x, y) => (y.start - x.start) || (y.order - x.order));
  let out = raw;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return {content: out, nEdits: edits.length};
}

async function save() {
  if (S.mode !== 'read' || !S.log.length) return;
  let built;
  try { built = buildRaw(); } catch (e) { toast('Not saved: ' + e.message, true, 8000); return; }
  // check our own result before sending
  let check;
  try { check = parseXML(built.content, S.editionFile); } catch (e) { toast('Not saved: ' + e.message, true, 8000); return; }
  const changedIds = S.blocks.filter(id => S.origById.get(id) && serializeEl(S.byId.get(id)) !== serializeEl(S.origById.get(id)));
  // alignment files that are ready go with this save; the others follow when collated
  const alignments = {};
  // a hand-corrected alignment that no longer fits the changed text is only replaced with permission
  const corrected = changedIds.filter(id => fileIsCorrected(id) && !(S.results.get(id)?.res.source === 'file' && S.results.get(id)?.hash === serializeEl(S.byId.get(id))));
  let keepOld = new Set();
  if (corrected.length && !confirm(`You have corrected the alignment of ${corrected.join(', ')} by hand, and your text changes mean it no longer fits.\n\nOK: replace it with a fresh collation (the corrected one stays in git history).\nCancel: keep the corrected file as it is (it will be flagged until you redo it).`)) keepOld = new Set(corrected);
  if (S.cfg.writeAlignments !== false) for (const id of changedIds) {
    if (keepOld.has(id)) continue;
    const r = S.results.get(id);
    if (r && r.hash === serializeEl(S.byId.get(id)) && r.res.alignXML) alignments[id] = r.res.alignXML;
    else S.pendingAlign.add(id);
  }
  const newProblems = noteProblems(check).filter(p => !S.baseProblems.has(p));
  if (newProblems.length && !confirm(`This save would leave notes that point nowhere:\n${newProblems.join('\n')}\n\nSave anyway?`)) { updateStatus(); return; }
  const lines = [...new Set(S.log)];
  const message = (lines.length === 1 ? lines[0] : `${lines.length} edits in ${S.editionFile}`) + (lines.length > 1 ? '\n\n' + lines.map(l => '- ' + l).join('\n') : '');
  $('#btn-save').disabled = true; $('#status').textContent = 'Saving…';
  let resp;
  try {
    resp = await (await apiFetch('/api/save', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({file: S.editionFile, baseMtime: S.mtime, content: built.content, alignments, message})})).json();
  } catch (e) { toast('Not saved: the local server did not answer. Is it still running?', true, 9000); updateStatus(); return; }
  if (!resp.ok) { toast('Not saved: ' + resp.errors.join(' '), true, 12000); updateStatus(); return; }
  // adopt the saved file as the new baseline
  S.raw = built.content; S.mtime = resp.mtime;
  S.origDoc = check; S.span = scanRaw(S.raw);
  S.doc = S.origDoc.cloneNode(true);
  assignKeys(S.doc);
  S.collator.setEdition(S.doc);
  S.undo = []; S.redo = []; S.log = [];
  S.baseProblems = new Set(noteProblems(S.origDoc));
  reindex();
  rememberOriginal();
  refreshView();
  renderList();
  updateStatus();
  const extra = Object.keys(alignments).length ? ` and ${Object.keys(alignments).length} alignment file(s)` : '';
  for (const [id, xml] of Object.entries(alignments)) { S.pendingAlign.delete(id); S.alignFile.set(id, xml); }
  toast(`Saved ${S.editionFile}${extra}${resp.commit ? ` — git commit ${resp.commit}` : ''}.`, false, 6000);
  flushAlignments();
}

// ================================================================ publishing
// The edition file plus a Saktumiva apparatus (<standOff type="apparatus">) for every passage,
// written to a separate file so that the working file holds only what you wrote.
let pub = null;
function openPublish() {
  if (S.mode !== 'read') { toast('Finish or cancel the current edit first.', true); return; }
  if (S.log.length) { toast('Save your changes first; publishing uses the saved edition.', true, 6000); return; }
  pub = null;
  $('#pub-intro').textContent = `This writes ${S.publishTo}: your edition (${S.editionFile}) with its notes, followed by Saktumiva's apparatus for each of its ${S.blocks.length} passages. ` +
    `Corrected alignments are used as they are; other passages are collated if needed (the first time this can take a while for long prose passages). ` +
    `Alignment files in ${S.cfg.alignmentsDir || 'alignments'}/ are brought up to date. Your edition file itself is not changed.`;
  $('#pub-progress').value = 0; $('#pub-status').textContent = ''; $('#pub-result').replaceChildren();
  $('#btn-pub-start').hidden = false; $('#btn-pub-close').hidden = true; $('#btn-pub-cancel').hidden = false; $('#btn-pub-cancel').textContent = 'Cancel';
  $('#publish-dialog').showModal();
}

async function runPublish() {
  pub = {cancel: false};
  S.mode = 'publish'; updateStatus();
  $('#btn-pub-start').hidden = true;
  const only = new URLSearchParams(location.search).get('publishOnly'); // for testing a part
  const ids = S.blocks.filter(id => !only || id.startsWith(only));
  const doc = S.origDoc.cloneNode(true);
  for (const so of [...teiEls(doc, 'standOff')].filter(s => s.getAttribute('type') === 'apparatus')) so.remove();
  const alignments = {}, skipped = [], warned = [];
  const t0 = performance.now();
  let done = 0;
  for (const id of ids) {
    if (pub.cancel) break;
    const left = done ? Math.round((performance.now() - t0) / done * (ids.length - done) / 60000) : null;
    $('#pub-status').textContent = `${id} — ${done + 1} of ${ids.length}${left !== null && left > 0 ? ` (about ${left} min left)` : ''}`;
    $('#pub-progress').value = done / ids.length;
    let res = null;
    try { res = await getResult(id, {priority: 'high'}); } catch (e) { skipped.push([id, e.message]); done++; continue; }
    if (!res || res.none || !res.alignXML) { skipped.push([id, res?.reason || 'no alignment']); done++; continue; }
    try {
      const w = S.collator.publishInto(doc, id, res.alignXML, `${S.cfg.alignmentsDir || 'alignments'}/${id}.xml`);
      if (w.length) warned.push([id, w.join('; ')]);
      if (S.cfg.writeAlignments !== false && (await alignFileText(id)) !== res.alignXML) alignments[id] = res.alignXML;
    } catch (e) { skipped.push([id, e.message]); }
    done++;
  }
  if (pub.cancel) { S.mode = 'read'; updateStatus(); $('#publish-dialog').close(); toast('Publishing cancelled; nothing was written.'); return; }
  $('#pub-progress').value = 1;
  $('#pub-status').textContent = 'Writing…';
  let out;
  try { out = splicePublished(doc); } catch (e) { S.mode = 'read'; updateStatus(); $('#pub-status').textContent = 'Not written: ' + e.message; $('#btn-pub-cancel').hidden = true; $('#btn-pub-close').hidden = false; return; }
  const n = ids.length - skipped.length;
  const resp = await (await apiFetch('/api/publish', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content: out, alignments, message: `Published ${S.publishTo}: apparatus for ${n} passages` + (only ? ` (only ${only}…)` : '')})}))
    .json().catch(e => ({ok: false, errors: [e.message]}));
  S.mode = 'read'; updateStatus();
  $('#btn-pub-cancel').hidden = true; $('#btn-pub-close').hidden = false;
  if (!resp.ok) { $('#pub-status').textContent = 'Not written: ' + (resp.errors || []).join(' '); return; }
  for (const [id, xml] of Object.entries(alignments)) S.alignFile.set(id, xml);
  $('#pub-status').textContent = `Written: ${resp.target} with the apparatus of ${n} passages` +
    (Object.keys(alignments).length ? `, and ${Object.keys(alignments).length} alignment files brought up to date` : '') +
    (resp.commit ? ` — git commit ${resp.commit}.` : '.');
  const parts = [];
  if (skipped.length) parts.push(h('p', {}, `${skipped.length} passage(s) have no apparatus:`), h('ul', {}, ...skipped.map(([id, why]) => h('li', {}, `${id}: ${why}`))));
  if (warned.length) parts.push(h('p', {}, `Saktumiva reported problems in ${warned.length} passage(s) (also recorded as comments in the file):`), h('ul', {}, ...warned.map(([id, w]) => h('li', {}, `${id}: ${w}`))));
  $('#pub-result').replaceChildren(...parts);
}
// The published file is the edition file exactly as written, plus: the header lines Saktumiva's
// pages need, any witnesses added to <listWit>, and the apparatus blocks before </TEI>.
function splicePublished(doc) {
  let raw = S.raw;
  if (/<standOff[^>]*type="apparatus"/.test(raw)) throw new Error(`${S.editionFile} already contains apparatus blocks; publishing from it would duplicate them. Publish from the file without apparatus.`);
  const edits = [];
  // witnesses added by Saktumiva to sourceDesc/listWit
  const oldSD = S.origDoc.querySelector('sourceDesc'), newSD = doc.querySelector('sourceDesc');
  if (oldSD && newSD && serializeEl(oldSD) !== serializeEl(newSD)) {
    const at = raw.search(/<sourceDesc\b/);
    const span = at >= 0 ? elementSpanAfter(raw, at, 'sourceDesc') : null;
    if (!span) throw new Error('cannot find <sourceDesc> in the edition file');
    edits.push([span[0], span[1], patchElement(raw.slice(span[0], span[1]), serializeEl(oldSD), serializeEl(newSD))]);
  }
  // Saktumiva's display shows only note blocks of type notes1-notes4: map the edition's note types onto
  // those in the published file (the original type is kept as @subtype). Configurable as "publishNoteTypes".
  const NOTE_SLOTS = S.cfg.publishNoteTypes || {Notes: 'notes1', Note: 'notes1', notes: 'notes1',
    Emendation: 'notes2', Emendations: 'notes2', Testimonia: 'notes3', Parallels: 'notes3', Sources: 'notes3'};
  const slotFor = t => /^notes[1-4]$/.test(t) ? null : (NOTE_SLOTS[t] || 'notes4');
  for (const m of raw.matchAll(/<standOff\b[^>]*>/g)) {
    const tag = m[0], t = tag.match(/\stype="([^"]*)"/)?.[1];
    if (!t || t === 'apparatus' || !slotFor(t)) continue;
    let nt = tag.replace(/\stype="[^"]*"/, ` type="${slotFor(t)}"`);
    if (!/\ssubtype="/.test(nt)) nt = nt.replace(/\s*\/?>$/, e => ` subtype="${t}"` + e.trimStart());
    edits.push([m.index, m.index + tag.length, nt]);
  }
  // apparatus blocks, in the format Saktumiva writes
  const apps = [...teiEls(doc, 'standOff')].filter(so => so.getAttribute('type') === 'apparatus').map(serializeEl).join('');
  const end = scanRaw(raw).teiEnd;
  if (end < 0) throw new Error('cannot find </TEI> in the edition file');
  if (apps) edits.push([end, end, (/\n\s*$/.test(raw.slice(0, end)) ? '' : '\n') + apps]);
  edits.sort((a, b) => b[0] - a[0]);
  for (const [a, b, t] of edits) raw = raw.slice(0, a) + t + raw.slice(b);
  // header: XML declaration, stylesheet and the polyfill Saktumiva's pages use
  raw = raw.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>\s*/, '').replace(/<\?xml-stylesheet[^>]*\?>\s*/g, '');
  if (S.cfg.publishPolyfill !== false && !raw.includes('xslt-polyfill'))
    raw = raw.replace(/<TEI\b[^>]*>/, m => m + '\n<script src="./lib/js/xslt-polyfill.min.js" xmlns="http://www.w3.org/1999/xhtml"></script>');
  const sheet = S.cfg.publishStylesheet ?? 'edition.xsl';
  raw = '<?xml version="1.0" encoding="UTF-8"?>\n' + (sheet ? `<?xml-stylesheet type="text/xsl" href="${sheet}"?>\n` : '') + raw;
  parseXML(raw, S.publishTo);   // must be well-formed
  return raw;
}
$('#btn-publish').addEventListener('click', openPublish);
$('#btn-pub-start').addEventListener('click', runPublish);
$('#btn-pub-cancel').addEventListener('click', () => { if (pub && S.mode === 'publish') { pub.cancel = true; $('#btn-pub-cancel').textContent = 'Stopping…'; } else $('#publish-dialog').close(); });
$('#btn-pub-close').addEventListener('click', () => $('#publish-dialog').close());
$('#publish-dialog').addEventListener('cancel', e => { if (S.mode === 'publish') e.preventDefault(); });

// ================================================================ dialogs: settings, history, help
function showInfo(title, ...content) {
  $('#info-body').replaceChildren(h('h3', {}, title), ...content);
  $('#info-dialog').showModal();
}
// ---------------------------------------------------------------- settings
const GROUP_LABEL = {general: 'General', sanskrit: 'Sanskrit', pali: 'Pali', tamil: 'Tamil', sinhalese: 'Sinhalese'};
const DIST = {ngrams: 'n-grams', ncd: 'compression distance (NCD)'};
const TOK = {grapheme: 'Eḻuttu (without conjuncts)', aksara: 'Akṣara (conjuncts and vowels together)', character: 'Consonants and vowels separate', whitespace: 'Whitespace-delimited (words)'};
function filesTable() {
  const rows = [
    ['Section folder', document.title.split(' · ')[0]],
    ['Edition (saved to)', S.editionFile],
    ['Witnesses', S.witnesses.map(w => `${w.siglum}: ${w.file}`).join('\n')],
    ['Not loaded', S.badFiles.length ? S.badFiles.map(b => `${b.file}: ${b.error}`).join('\n') : 'none'],
    ['Existing problems in the edition', S.baseProblems.size ? [...S.baseProblems].join('\n') : 'none found'],
    ['Collation settings from', S.settingsSource],
    ['Alignment files', S.cfg.writeAlignments === false ? 'not written' : `written to ${S.cfg.alignmentsDir || 'alignments'}/ for passages you change`],
    ['Publish writes', S.publishTo + ' (set "publishTo" in editor.config.json to change)'],
    ['Versioning', S.gitOn ? 'every save is a git commit' : 'folder is not a git repository: saves are not versioned']
  ];
  return h('table', {}, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {style: 'white-space:pre-wrap'}, v || ''))));
}
// elements occurring inside <text> in the edition and witnesses: name -> {n, files}
let tagStatsCache = null;
const STRUCTURAL = new Set(['text', 'body', 'front', 'back', 'group', 'div', 'p', 'lg', 'l', 'ab', 'app', 'lem', 'rdg', 'rdgGrp']);
function tagStats() {
  if (tagStatsCache) return tagStatsCache;
  const m = new Map();
  const add = (doc, label) => {
    for (const t of doc.getElementsByTagNameNS(TEI_NS, 'text'))
      for (const el of t.getElementsByTagNameNS('*', '*')) {
        if (STRUCTURAL.has(el.localName)) continue;
        const e = m.get(el.localName) || {n: 0, files: new Set()};
        e.n++; e.files.add(label); m.set(el.localName, e);
      }
  };
  add(S.origDoc, 'edition');
  for (const w of S.witnesses) add(w.doc, w.siglum);
  return (tagStatsCache = m);
}
function tagChecklist(ignored) {
  const stats = tagStats(), on = new Set(ignored);
  const names = [...saktumivaIgnoreTags, ...[...stats.keys()].filter(t => !saktumivaIgnoreTags.includes(t)).sort((a, b) => stats.get(b).n - stats.get(a).n)];
  return h('div', {class: 'cols tags'}, ...names.map(t => {
    const st = stats.get(t);
    return h('label', {class: 'chk', title: st ? 'in: ' + [...st.files].join(', ') : 'not found in your files'},
      h('input', {type: 'checkbox', 'data-tag': t, checked: on.has(t)}), ' ', h('code', {}, `<${t}>`), ' ',
      h('span', {class: 'muted'}, st ? `${st.n}×` : '—'), saktumivaIgnoreTags.includes(t) ? h('span', {class: 'muted'}, ' · Saktumiva default') : '');
  }));
}
function openSettings() {
  tagStatsCache = null;
  const C = S.collator, st = C.settings, ap = S.cfg.apparatus || {};
  const on = new Set(C.filtersindices);
  const box = (attrs, label, title) => h('label', {class: 'chk', title}, h('input', {type: 'checkbox', ...attrs}), ' ', label);
  // normalizations, grouped as in Saktumiva
  const groups = {};
  for (const f of filterCatalogue) (groups[f.group] ??= []).push(f);
  const filterSet = (g, open) => h('details', {open: open || groups[g].some(f => on.has(f.i)) || null},
    h('summary', {}, GROUP_LABEL[g] || g, ' ', h('span', {class: 'muted'}, `(${groups[g].filter(f => on.has(f.i)).length} of ${groups[g].length} on)`)),
    h('div', {class: 'cols'}, ...groups[g].map(f => box({'data-filter': f.i, checked: on.has(f.i)}, f.name))));
  // witnesses' script notes
  const witRows = S.witnesses.map(w => {
    const rules = C.witRules.get(w.file) || [];
    return h('tr', {}, h('th', {}, w.siglum), h('td', {}, rules.length ? h('div', {}, ...rules.map(r => h('div', {}, h('code', {}, r.id), ' → ',
      r.label ? r.label : h('span', {class: 'error'}, 'not understood (see Help below)')))) : h('span', {class: 'muted'}, 'none')));
  });
  const num = (id, v, step = 'any') => h('input', {type: 'number', id, value: v, step, class: 'num'});
  const body = h('div', {id: 'settings-form', onkeydown: e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }},
    h('h3', {}, 'Settings'),
    h('h4', {}, 'Variants to leave out of the apparatus'),
    h('p', {class: 'muted'}, 'Readings that differ from the text only in these ways are not given as variants; Saktumiva keeps them as “minor” readings under the lemma. Turning one on takes effect at once. Turning one off that was used for an existing alignment means that passage is collated again.'),
    ...Object.keys(groups).sort((a, b) => (a === 'general' ? -1 : b === 'general' ? 1 : a === 'sanskrit' ? -1 : b === 'sanskrit' ? 1 : 0)).map(g => filterSet(g, g === 'sanskrit')),
    h('label', {}, 'Letters treated as the same in all witnesses',
      h('input', {id: 'set-same', value: ap.sameLetters || '', placeholder: 'e.g.  ś=s, ṇ=n'})),
    h('h4', {}, 'Witnesses’ own script notes'),
    box({id: 'set-script', checked: ap.scriptNotes !== false}, 'Obey the <scriptNote>s in each witness’s <scriptDesc>', 'Only for that witness: e.g. script-ba-va makes b and v the same in that manuscript'),
    h('table', {class: 'small'}, ...witRows),
    h('h4', {}, 'Apparatus'),
    box({id: 'set-normlem', checked: ap.normlem ?? true}, 'Use normalized readings (needed for the normalizations above)'),
    box({id: 'set-merge', checked: ap.mergerdgs ?? true}, 'Merge groups (one entry per word group, as in the alignment)'),
    h('label', {class: 'chk'}, h('input', {type: 'checkbox', id: 'set-maxom', checked: ap.maxomlength > 0}), ' Separate note for omissions over ',
      h('input', {type: 'number', id: 'set-maxomlen', value: ap.maxomlength > 0 ? ap.maxomlength : 20, min: 1, class: 'num'}), ' characters'),
    box({id: 'set-minor', checked: ap.showMinor !== false}, 'Show minor readings in the editor’s apparatus panel (display only)'),
    h('details', {}, h('summary', {}, h('b', {}, 'Alignment'), ' ', h('span', {class: 'muted'}, '(changing these means every passage is collated again, unless you corrected its alignment by hand)')),
      h('label', {}, 'Tokenization', h('select', {id: 'set-tok'}, ...Object.entries(TOK).map(([k, v]) => h('option', {value: k, selected: st.tokenization === k}, v)))),
      h('div', {class: 'row'},
        h('label', {}, 'Match', num('set-match', st.scoring.match)), h('label', {}, 'Mismatch', num('set-mismatch', st.scoring.mismatch)),
        h('label', {}, 'Gap opening', num('set-gapo', st.scoring.gap_open)), h('label', {}, 'Gap extension', num('set-gape', st.scoring.gap_extend))),
      h('div', {class: 'row'},
        h('label', {}, 'Realign depth', num('set-depth', st.scoring.realigndepth, 1)),
        h('label', {}, 'Distance function', h('select', {id: 'set-dist'}, ...Object.entries(DIST).map(([k, v]) => h('option', {value: k, selected: st.scoring.distancefunc === k}, v))))),
      box({id: 'set-rec', checked: st.scoring.recursive}, 'Recursive scoring (score the consonants and vowels within each unit)')),
    h('h4', {}, 'XML elements'),
    h('p', {class: 'muted'}, 'A ticked element is left out of the collation together with everything inside it (as Saktumiva’s “Ignore <…>” options). Saktumiva’s defaults come first, then the other elements found inside <text> in your files, with how often they occur. Changing this means passages are collated again.'),
    tagChecklist(C.ignore),
    h('label', {}, 'Other elements to ignore', h('input', {id: 'set-tags-other', placeholder: 'element names, separated by commas',
      value: C.ignore.filter(t => !tagStats().has(t) && !saktumivaIgnoreTags.includes(t)).join(', ')})),
    h('details', {}, h('summary', {class: 'muted'}, 'What Saktumiva always does with XML'),
      h('ul', {class: 'muted'},
        h('li', {}, '<add> and <del>: the witness is collated twice, ante correctionem (without <add>) and post correctionem (without <del>), e.g. Hac and Hpc.'),
        h('li', {}, '<app> with <rdg wit="…">: each reading counts as the text of the witness(es) named.'),
        h('li', {}, '<gap>: replaced by a placeholder (one per unit of @quantity), except reason="ellipsis".'),
        h('li', {}, '<lb break="no">, <pb break="no">: the word continues across the break.'),
        h('li', {}, 'Comments are ignored; other markup (<unclear>, <sic>, <g> …) keeps its text in the collation unless ticked above.'))),
    h('details', {}, h('summary', {}, h('b', {}, 'Files')), filesTable(), h('p', {class: 'muted'}, 'These come from editor.config.json in the section folder.')),
    h('details', {}, h('summary', {}, h('b', {}, 'Help: script notes')),
      h('p', {}, 'A note whose xml:id has the form ', h('code', {}, 'script-X-Y'), ' (e.g. script-ba-va, script-śa-sa, script-na-ṇa) makes X and Y the same letter for that witness. ',
        h('code', {}, 'svarna-nasals'), ' (or savarna-nasals) treats anusvāra and the nasal of the same class, and final m and ṃ, as the same.'),
      h('p', {}, 'For any other note, add a rule to editor.config.json, e.g. ', h('code', {}, '"scriptNoteRules": {"script-ya-ja": "y=j", "my-note": ""}'), ' (an empty rule ignores the note).')),
    h('p', {id: 'set-error', class: 'error', hidden: true}),
    h('div', {class: 'dialog-buttons'}, h('span', {class: 'spacer'}),
      h('button', {type: 'button', onclick: () => $('#info-dialog').close()}, 'Cancel'),
      h('button', {type: 'button', class: 'primary', onclick: applySettings}, 'Apply')));
  $('#info-body').replaceChildren(body);
  $('#info-dialog').classList.add('wide');
  $('#info-dialog').querySelector('.dialog-buttons.outer').hidden = true;
  $('#info-dialog').showModal();
}
async function applySettings() {
  const v = id => $('#' + id);
  const err = msg => { const e = v('set-error'); e.textContent = msg; e.hidden = false; };
  if (S.log.length) return err('Please save (or undo) your changes first: applying settings reloads the editor.');
  if (S.mode !== 'read') return err('Please finish the current editing first.');
  const filters = [...document.querySelectorAll('#settings-form [data-filter]')].filter(b => b.checked)
    .map(b => filterCatalogue[Number(b.dataset.filter)].name);
  const st = S.collator.settings;
  const n = id => { const x = parseFloat(v(id).value); return isNaN(x) ? null : x; };
  const scoring = {match: n('set-match'), mismatch: n('set-mismatch'), gap_open: n('set-gapo'), gap_extend: n('set-gape'),
    realigndepth: n('set-depth'), recursive: v('set-rec').checked, distancefunc: v('set-dist').value};
  if (Object.values(scoring).some(x => x === null)) return err('Please give a number in each scoring field.');
  const collation = settingsToConfig({...st, tokenization: v('set-tok').value, scoring: {...st.scoring, ...scoring}, filternames: filters,
    tagfilters: [...new Set([...[...document.querySelectorAll('#settings-form [data-tag]')].filter(b => b.checked).map(b => b.dataset.tag),
      ...v('set-tags-other').value.split(/[\s,]+/).filter(Boolean)])]});
  const apparatus = {...(S.cfg.apparatus || {}), normlem: v('set-normlem').checked, mergerdgs: v('set-merge').checked,
    maxomlength: v('set-maxom').checked ? Math.max(1, parseInt(v('set-maxomlen').value) || 20) : null,
    scriptNotes: v('set-script').checked, sameLetters: v('set-same').value.trim(), showMinor: v('set-minor').checked};
  const r = await (await apiFetch('/api/config', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({collation, apparatus})})).json().catch(e => ({ok: false, errors: [e.message]}));
  if (!r.ok) return err('Not saved: ' + (r.errors || []).join(' '));
  store.set(S.editionFile + ':current', S.current);
  location.reload();
}
$('#btn-info').addEventListener('click', openSettings);
$('#info-dialog').addEventListener('close', () => { $('#info-dialog').classList.remove('wide'); $('#info-dialog').querySelector('.dialog-buttons.outer').hidden = false; });
$('#btn-history').addEventListener('click', async () => {
  const r = await (await apiFetch('/api/history', {cache: 'no-store'})).json();
  showInfo(`Saved versions of ${S.editionFile}`, r.commits.length
    ? h('table', {}, ...r.commits.map(([hsh, d, m]) => h('tr', {}, h('td', {}, h('code', {}, hsh)), h('td', {}, d), h('td', {}, m))))
    : h('p', {}, S.gitOn ? 'No commits yet.' : 'This folder is not a git repository.'),
    h('p', {class: 'muted'}, 'To go back to a version, use git (e.g. git checkout <id> -- <file>) or ask Claude.'));
});
// ---------------------------------------------------------------- stemma (teiHeader > xenoData > stemma[format=nexml])
// What a siglum stands for: the section's witnesses, the edition itself, and the <listWit> of the edition's header.
function siglumNames() {
  const m = new Map(S.witnesses.map(w => [w.siglum, w.title]));
  if (S.edSiglum && !m.has(S.edSiglum)) m.set(S.edSiglum, `the edition (${S.editionFile})`);
  for (const wit of teiEls(S.origDoc, 'witness')) {
    const sig = wit.querySelector('abbr[type="siglum"]')?.textContent.trim() || xmlid(wit);
    if (sig && !m.has(sig)) m.set(sig, wit.textContent.replace(/\s+/g, ' ').trim());
  }
  return m;
}
const stemmaOpts = () => ({proportional: S.prefs?.stemma?.proportional ?? true, lines: S.prefs?.stemma?.lines || 'straight'});
let stemmaSVG = null;
function drawStemma() {
  const all = S.stemmata.stemmata, sel = $('#stemma-which');
  const st = all.find(x => x.key === sel.value) || all[0];
  const fig = $('#stemma-figure'), notes = [];
  const lengthsBox = $('#stemma-lengths');
  stemmaSVG = null;
  $('#btn-stemma-svg').disabled = true;
  $('#stemma-asfile-box').hidden = true;
  lengthsBox.disabled = false;
  if (S.stemmata.commented) notes.push(`${S.stemmata.commented === 1 ? 'A <stemma>' : S.stemmata.commented + ' <stemma> elements'} in the teiHeader ${S.stemmata.commented === 1 ? 'is' : 'are'} inside a comment (<!-- … -->) and so not read. Remove the comment marks around it to show it here.`);
  if (!st) {
    fig.replaceChildren(h('p', {}, 'The edition’s teiHeader has no stemma that can be read.'));
  } else if (st.error) {
    fig.replaceChildren(h('p', {class: 'error'}, `${st.title}: ${st.error}.`));
  } else {
    const t = st.tree, o = stemmaOpts();
    const asFile = $('#stemma-asfile').checked;
    if (t.leafRoot) {
      $('#stemma-asfile-box').hidden = false;
      if (!asFile) notes.push(`In the file the tree is rooted at ${t.root.label}, which has a single branch (SplitsTree roots its trees at the first witness); it is drawn here as a leaf. Tick “Root as in the file” to draw it as the root.`);
    }
    const root = t.leafRoot && !asFile ? t.leafRoot : t.root;
    lengthsBox.disabled = t.lengths === 'none';
    const lay = layoutTree(root, {proportional: o.proportional && t.lengths !== 'none'});
    if (t.lengths === 'none') notes.push('The tree has no branch lengths: one step per generation.');
    else if (lay.proportional) notes.push('The vertical distance shows the length of each branch (scale at the left). Point at a branch for its length.');
    if (t.lengths === 'some') notes.push('Some branches have no length; they are drawn with length 0.');
    if (t.negative) notes.push(`${t.negative} branch${t.negative > 1 ? 'es have' : ' has'} a negative length, drawn as 0.`);
    const names = siglumNames();
    const describe = sig => names.get(sig) || '';
    const inTree = stemmaSigla(root);
    const unknown = inTree.filter(x => !names.has(x));
    const missing = S.witnesses.map(w => w.siglum).filter(x => !inTree.includes(x));
    if (unknown.length) notes.push(`Not a witness of this section: ${unknown.join(', ')}.`);
    if (missing.length) notes.push(`Witnesses of this section not in the stemma: ${missing.join(', ')}.`);
    fig.innerHTML = renderSVG(lay, {lines: o.lines, describe});
    stemmaSVG = {svg: renderSVG(lay, {lines: o.lines, describe, standalone: true}), title: st.title};
    $('#btn-stemma-svg').disabled = false;
  }
  $('#stemma-notes').replaceChildren(...notes.map(n => h('p', {}, n)));
}
function openStemma() {
  const all = S.stemmata.stemmata, sel = $('#stemma-which');
  sel.replaceChildren(...all.map(x => h('option', {value: x.key}, x.title)));
  sel.hidden = all.length < 2;
  // nothing to draw (only a commented-out stemma, or ones that cannot be read): no drawing options
  const drawable = all.some(x => x.tree);
  for (const el of $('#stemma-dialog .stemma-bar').children) if (el !== sel && el.id !== 'stemma-asfile-box') el.hidden = !drawable;
  $('#stemma-title').textContent = all.length > 1 ? `Stemmata (${all.length})`
    : all.length && !/^Stemma \d+$/.test(all[0].title) ? `Stemma: ${all[0].title}` : 'Stemma';   // no name of its own
  const o = stemmaOpts();
  $('#stemma-lengths').checked = o.proportional;
  $('#stemma-lines').value = o.lines;
  drawStemma();
  $('#stemma-dialog').showModal();
}
const setStemmaOpt = changes => { savePrefs({stemma: {...stemmaOpts(), ...changes}}); drawStemma(); };
$('#btn-stemma').addEventListener('click', openStemma);
$('#btn-stemma-close').addEventListener('click', () => $('#stemma-dialog').close());
$('#stemma-which').addEventListener('change', () => { $('#stemma-asfile').checked = false; drawStemma(); });
$('#stemma-lengths').addEventListener('change', e => setStemmaOpt({proportional: e.target.checked}));
$('#stemma-lines').addEventListener('change', e => setStemmaOpt({lines: e.target.value}));
$('#stemma-asfile').addEventListener('change', drawStemma);
$('#btn-stemma-svg').addEventListener('click', () => {
  if (!stemmaSVG) return;
  const name = `${S.editionFile.replace(/\.[^.]+$/, '')}_${stemmaSVG.title.replace(/[^\p{L}\p{N}]+/gu, '-')}.svg`;
  const a = h('a', {href: URL.createObjectURL(new Blob([stemmaSVG.svg], {type: 'image/svg+xml'})), download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------- data export: NEXUS for SplitsTree
// The alignments of the passages (collating those not yet collated, as Publish does) -> one character matrix.
const download = (name, text, type = 'text/plain') => {
  const a = h('a', {href: URL.createObjectURL(new Blob([text], {type: `${type};charset=utf-8`})), download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const nexusOpts = () => ({normalize: true, mergeGroups: true, gapsSignificant: false, ...(S.prefs?.nexus || {})});
let nexusRun = null;
function openNexus() {
  const o = nexusOpts();
  $('#nexus-normalize').checked = o.normalize;
  $('#nexus-merge').checked = o.mergeGroups;
  $('#nexus-gaps').checked = o.gapsSignificant;
  $(`#nexus-dialog input[name="nexus-corr"][value="${o.corrections === 'pc' ? 'pc' : 'ac'}"]`).checked = true;
  $('#nexus-all-label').textContent = `All ${S.blocks.length} passages of ${S.editionFile}`;
  $('#nexus-current-label').textContent = isMulti() ? `The ${S.selection.length} passages shown (${selectionLabel(S.selection, S.blocks)})` : `This passage only (${S.current})`;
  $('#nexus-files-label').textContent = `The saved alignment files (${S.cfg.alignmentsDir || 'alignments'}/) as they are`;
  // the witnesses, and the edition itself (off: it is the editor's reconstruction, not a witness)
  const wits = [...S.witnesses.map(w => [w.siglum, w.title, true]), [S.edSiglum, `the edition (${S.editionFile})`, false]];
  $('#nexus-wits').replaceChildren(...wits.map(([sig, title, on]) =>
    h('label', {class: 'chk', title}, h('input', {type: 'checkbox', value: sig, ...(on ? {checked: ''} : {})}), ' ', sig)));
  $('#nexus-progress').hidden = true;
  $('#nexus-status').textContent = '';
  $('#nexus-form').inert = false;
  $('#btn-nexus-go').disabled = false;
  $('#nexus-dialog').showModal();
}
async function runNexus() {
  const taxa = [...$('#nexus-wits').querySelectorAll('input:checked')].map(i => i.value);
  if (taxa.length < 2) { $('#nexus-status').textContent = 'Choose at least two witnesses.'; return; }
  const opts = {normalize: $('#nexus-normalize').checked, mergeGroups: $('#nexus-merge').checked, gapsSignificant: $('#nexus-gaps').checked,
                corrections: $('#nexus-dialog input[name="nexus-corr"]:checked').value};
  savePrefs({nexus: opts});
  const all = $('#nexus-dialog input[name="nexus-scope"]:checked').value === 'all';
  const ids = all ? S.blocks : isMulti() ? [...S.selection] : [S.current];
  const part = all ? '' : ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const asSaved = $('#nexus-dialog input[name="nexus-source"]:checked').value === 'files';
  const run = nexusRun = {cancel: false};
  $('#nexus-form').inert = true;
  $('#btn-nexus-go').disabled = true;
  const bar = $('#nexus-progress'), status = $('#nexus-status');
  bar.hidden = false; bar.value = 0;
  const passages = [], none = [];
  const t0 = performance.now();
  for (const [k, id] of ids.entries()) {
    if (run.cancel) return;
    const left = k ? Math.round((performance.now() - t0) / k * (ids.length - k) / 60000) : 0;
    status.textContent = `${id} — ${k + 1} of ${ids.length}${left > 0 ? ` (about ${left} min left)` : ''}`;
    bar.value = k / ids.length;
    if (asSaved) {
      const x = S.cfg.alignmentsDir ? await alignFileText(id) : null;
      if (x) passages.push({id, xml: x}); else none.push([id, 'no alignment file']);
      continue;
    }
    let res = null;
    try { res = await getResult(id, {priority: 'high'}); } catch (e) { none.push([id, e.message]); continue; }
    if (!res || res.none || !res.alignXML) { none.push([id, res?.reason || 'no alignment']); continue; }
    passages.push({id, xml: res.alignXML});
  }
  if (run.cancel) return;
  bar.value = 1;
  const how = [opts.normalize ? 'normalized spellings' : 'spellings as written', opts.mergeGroups ? 'one character per word group' : 'one character per aligned cell',
    opts.gapsSignificant ? 'gaps significant' : 'gaps not significant', opts.corrections === 'pc' ? 'post correctionem' : 'ante correctionem',
    asSaved ? 'saved alignment files' : 'alignments up to date with the texts'];
  const r = buildNexus(passages, taxa, {...opts, title: `${S.editionFile}${all ? '' : ', ' + (ids.length > 1 ? ids.join(' ') : part)}: ${taxa.join(', ')}; ${how.join(', ')}. Saktumiva editor ${S.version || ''}`.trim()});
  none.push(...r.skipped);
  const base = S.editionFile.replace(/\.[^.]+$/, '');
  if (r.nchar) download(`${base}${all ? '' : '_' + part}.nex`, r.text);
  status.replaceChildren(
    r.nchar ? `Saved ${base}${all ? '' : '_' + part}.nex (in your downloads): ${r.ntax} witnesses, ${r.nchar} characters from ${r.passages} passage${r.passages === 1 ? '' : 's'}.`
            : 'Nothing to export: no passage has an alignment.',
    ...(r.tooMany ? [h('br'), `${r.tooMany} character(s) have more readings than NEXUS symbols (54); the extra readings are written as ?.`] : []),
    ...(none.length ? [h('br'), `Left out (${none.length}): ${none.slice(0, 8).map(([id, why]) => `${id} (${why})`).join('; ')}${none.length > 8 ? ' …' : ''}`] : []));
  $('#btn-nexus-cancel').textContent = 'Close';
  nexusRun = null;
}
$('#btn-export-nexus').addEventListener('click', () => { $('#btn-nexus-cancel').textContent = 'Cancel'; openNexus(); });
$('#btn-nexus-go').addEventListener('click', runNexus);
$('#btn-nexus-cancel').addEventListener('click', () => { if (nexusRun) nexusRun.cancel = true; nexusRun = null; $('#nexus-dialog').close(); });
$('#nexus-dialog').addEventListener('close', () => { if (nexusRun) nexusRun.cancel = true; nexusRun = null; });

$('#btn-help').addEventListener('click', () => showInfo('Using the editor',
  h('p', {}, 'The text you see is the edition file itself. Changes stay in this window until you press Save; then they are written to the TEI file (only the passages and notes you changed) and committed to git.'),
  h('h3', {}, 'Choosing readings'), h('p', {}, 'Click a word in the text, or point at an apparatus entry, to see its lemma. Press “use” beside a reading to put it in the text. The passage is collated again at once, so the old lemma becomes a variant.'),
  h('h3', {}, 'Editing the text'), h('p', {}, '“Edit text” lets you type in the verse lines. Grey boxes are markup (caesura, anchors, page breaks…): they are protected, but you can delete them. Tick “Record as emendation” to add an Emendation note. “TEI source” edits the passage as XML for anything else.'),
  h('h3', {}, 'Correcting the collation'), h('p', {}, '“Correct alignment” shows how the witnesses are lined up, one column per apparatus entry. Join or split columns, or move a witness’s syllable into the neighbouring column; the apparatus follows. Saving writes the passage’s alignment file, marked as corrected by hand, and the editor uses it from then on. If a witness transcription itself is wrong, press “edit” beside it in the Witnesses panel.'),
  h('h3', {}, 'Trivial variants'), h('p', {}, 'Settings lists Saktumiva’s normalizations (final nasals, visarga sandhi, b/v …): readings that differ only in these ways are kept as “minor” readings, not variants. Each witness’s <scriptNote>s (e.g. script-ba-va) are obeyed for that witness alone.'),
  h('h3', {}, 'Publishing'), h('p', {}, '“Publish” writes a separate file (named in Settings) containing your edition and notes followed by Saktumiva’s apparatus for every passage (<standOff type="apparatus">), using your corrected alignments where you made them. The alignment files are brought up to date in the same step, and the whole is one git commit. Your edition file itself is not changed.'),
  h('h3', {}, 'Notes'), h('p', {}, 'Select a word and press “Add note here”. The anchor and the <standOff> note are created with matching ids. Edit or delete notes in the Notes panel.'),
  h('h3', {}, 'Data export'), h('p', {}, 'NEXUS for SplitsTree: a character matrix of the aligned readings of the whole section (or this passage), as Saktumiva’s matrix editor exports it. Choose the witnesses (the edition itself is left out unless you tick it) and whether to normalize spellings, merge word groups and count gaps. Passages not yet collated are collated first.'),
  h('h3', {}, 'Stemma'), h('p', {}, 'If the edition’s teiHeader has a <stemma format="nexml"> (in <xenoData>, as SplitsTree6 or Saktumiva write it), the Stemma button draws it: the sigla at the leaves, branch lengths in proportion or one step per generation. Download SVG saves the drawing.'),
  h('h3', {}, 'Keys'), h('p', {}, h('kbd', {}, 'Alt ↑/↓'), ' previous/next passage · ', h('kbd', {}, 'E'), ' edit text · ', h('kbd', {}, 'A'), ' correct alignment · ', h('kbd', {}, 'N'), ' add note · ', h('kbd', {}, 'Ctrl Z'), ' undo · ', h('kbd', {}, 'Ctrl S'), ' save · ', h('kbd', {}, 'Esc'), ' cancel editing'),
  h('p', {class: 'muted'}, 'Undo works until you save. After that, every saved version is in git (History).')));

// ================================================================ wiring
setupMenu($('#help-menu'));
setupMenu($('#export-menu'));
$('#btn-updates').addEventListener('click', checkForUpdates);
$('#btn-about').addEventListener('click', showAbout);
$('#btn-projects').addEventListener('click', () => { location.href = '/choose'; });  // beforeunload warns about unsaved changes
$('#btn-prev').addEventListener('click', () => go(-1));
$('#btn-next').addEventListener('click', () => go(1));
$('#btn-edit').addEventListener('click', startEdit);
$('#btn-edit-cancel').addEventListener('click', () => finishEdit(false));
$('#btn-edit-done').addEventListener('click', () => finishEdit(true));
$('#btn-source').addEventListener('click', startSource);
$('#btn-source-cancel').addEventListener('click', () => endEdit());
$('#btn-source-apply').addEventListener('click', applySource);
$('#btn-save').addEventListener('click', save);
$('#btn-undo').addEventListener('click', doUndo);
$('#btn-redo').addEventListener('click', doRedo);
$('#filter').addEventListener('input', () => renderList());
$('#btn-several').addEventListener('click', () => setSeveral(!S.several));
$('#btn-single').addEventListener('click', () => openPassage(S.current));
$('#btn-merge').addEventListener('click', openMerge);
$('#btn-split').addEventListener('click', openSplit);
$('#btn-rs-cancel').addEventListener('click', () => $('#restructure-dialog').close());
$('#btn-rs-go').addEventListener('click', () => rsGo?.());
$('#restructure-dialog').addEventListener('close', () => { SP = null; rsGo = null; });
$('#passage').addEventListener('dblclick', e => { if (S.mode === 'read' && !e.target.closest('.chip')) { window.getSelection().removeAllRanges(); startEdit(); } });

document.addEventListener('keydown', e => {
  const inField = e.target.closest('input, textarea, [contenteditable="true"], dialog');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (S.mode === 'edit') finishEdit(true); else if (S.mode === 'source') applySource(); else save(); return; }
  if (e.key === 'Escape' && S.mode === 'edit') { finishEdit(false); return; }
  if (e.key === 'Escape' && S.mode === 'source') { endEdit(); return; }
  if (e.key === 'Escape' && S.mode === 'align') { endAligner(); return; }
  if (e.key === 'Escape' && S.mode === 'read' && isMulti() && !inField) { openPassage(S.current); return; }
  if (S.mode === 'edit' && e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) finishEdit(true); return; }
  if (inField) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); go(1); return; }
  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); go(-1); return; }
  if (e.key === 'e' && !e.ctrlKey && !e.altKey) { e.preventDefault(); startEdit(); return; }
  if (e.key === 'a' && !e.ctrlKey && !e.altKey) { e.preventDefault(); startAligner(); return; }
  if (e.key === 'n' && !e.ctrlKey && !e.altKey) { e.preventDefault(); openNoteDialog({point: teiPointFromSelection()}); }
});
window.addEventListener('beforeunload', e => { if (S.log.length || (S.mode === 'align' && AL?.hist.length)) { e.preventDefault(); e.returnValue = ''; } });

load().catch(e => {
  console.error(e);
  $('#status').textContent = 'Could not load';
  $('#passage').replaceChildren(h('p', {class: 'error'}, e.message));
});

// expose for testing in the browser console
window.__editor = {S, save, buildRaw, showSeveral, openPassage, get AL() { return AL; },
  get SP() { return SP; }, setSplitOffset};
