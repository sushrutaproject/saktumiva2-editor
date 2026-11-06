// Runs Saktumiva's own collation and apparatus code on one passage at a time.
import { processFile, preProcess, postProcess, findSplitfunc } from './saktumiva/lib/collate.mjs';
import { filters as allFilters, filterAll } from './saktumiva/lib/normalize.mjs';
import { makeApp, getWits, addWitnesses, addApparatus } from './saktumiva/lib/apparatus.mjs';
import xmlFormat from './saktumiva/lib/xml-formatter.mjs';
import { parseXML, TEI_NS } from './teiutil.mjs';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const DEFAULTS = {
  tokenization: 'grapheme', target: null,
  scoring: {match: 1, mismatch: -1, gap_open: -2, gap_extend: -0.25, gap_skip_initial: true,
            scalegap: false, recursive: true, realigndepth: 20, distancefunc: 'ngrams', ngramsize: 2},
  filternames: ['ignore punctuation'],
  tagfilters: ['pc', 'abbr', 'corr', 'ex', 'head', 'label', 'note', 'num', 'rt', 'locus', 'metamark', 'supplied', 'surplus']
};

// Read collation settings from an existing Saktumiva alignment file.
export const readSettings = doc => {
  if (!doc) return {...DEFAULTS};
  const g = sel => doc.querySelector(sel)?.textContent.trim();
  const num = (sel, d) => { const v = parseFloat(g(sel)); return isNaN(v) ? d : v; };
  const d = DEFAULTS.scoring;
  return {
    tokenization: g('ab[type="tokenization"]') || DEFAULTS.tokenization,
    target: g('ab[type="targetedition"]') || null,
    scoring: {
      match: num('ab[type="match"]', d.match), mismatch: num('ab[type="mismatch"]', d.mismatch),
      gap_open: num('ab[type="gapopen"]', d.gap_open), gap_extend: num('ab[type="gapextend"]', d.gap_extend),
      gap_skip_initial: true, scalegap: false,
      recursive: (g('ab[type="recursive"]') ?? 'true') === 'true',
      realigndepth: num('ab[type="realigndepth"]', d.realigndepth),
      distancefunc: g('ab[type="distancefunction"]') || 'ngrams', ngramsize: 2
    },
    filternames: [...doc.querySelectorAll('normalization > ab')].map(a => a.textContent.trim()),
    tagfilters: [...doc.querySelectorAll('ab[type="tagfilters"] tag[subtype="ignore"]')].map(t => t.textContent.trim())
  };
};

// Collation settings stored in editor.config.json ("collation"), in the same shape as readSettings.
export const settingsFromConfig = (c, fallback) => {
  const d = fallback || DEFAULTS, ds = d.scoring;
  const n = (v, def) => (typeof v === 'number' && !isNaN(v)) ? v : def;
  return {
    tokenization: c.tokenization || d.tokenization, target: c.target ?? d.target,
    scoring: {match: n(c.match, ds.match), mismatch: n(c.mismatch, ds.mismatch), gap_open: n(c.gapOpen, ds.gap_open),
      gap_extend: n(c.gapExtend, ds.gap_extend), gap_skip_initial: true, scalegap: false,
      recursive: c.recursive ?? ds.recursive, realigndepth: n(c.realignDepth, ds.realigndepth),
      distancefunc: c.distance || ds.distancefunc, ngramsize: 2},
    filternames: Array.isArray(c.filters) ? c.filters : d.filternames,
    tagfilters: Array.isArray(c.ignoreTags) ? c.ignoreTags : d.tagfilters
  };
};
export const settingsToConfig = s => ({tokenization: s.tokenization, ...(s.target ? {target: s.target} : {}),
  match: s.scoring.match, mismatch: s.scoring.mismatch, gapOpen: s.scoring.gap_open, gapExtend: s.scoring.gap_extend,
  recursive: s.scoring.recursive, realignDepth: s.scoring.realigndepth, distance: s.scoring.distancefunc,
  filters: s.filternames, ignoreTags: s.tagfilters});

// All of Saktumiva's normalizations, for the settings screen
export const filterCatalogue = allFilters.map((f, i) => ({i, name: f.name, group: f.group || 'general', off: f.checked === false}));

// Names (as written in alignment files) -> filter indices. Saktumiva writes one name per ticked filter,
// so a name listed twice means both filters of that name (e.g. the Sanskrit and the Pali one).
export const namesToIndices = names => {
  const used = new Set(), out = [], unknown = [];
  for (const nm of names) {
    const i = allFilters.findIndex((f, k) => f.name === nm && !used.has(k));
    if (i >= 0) { used.add(i); out.push(i); } else if (!allFilters.some(f => f.name === nm)) unknown.push(nm);
  }
  return {indices: out.sort((a, b) => a - b), unknown};
};

// "ś=s, ṇ=n, b=v" -> [['ś','s'], ['ṇ','n'], ['b','v']]
export const parsePairs = str => String(str || '').split(/[,;\n]+/).map(p => p.split('=').map(x => x.trim().normalize('NFC')))
  .filter(p => p.length === 2 && p[0] && p[1] && p[0] !== p[1]);
const applyPairs = (s, pairs) => { for (const [a, b] of pairs) s = s.split(a).join(b); return s; };

// Anusvāra written for the nasal of the same class (and final m for ṃ)
const nasalRule = s => s.replace(/[ṅñṇnm](?=\s*[kgcjṭḍtdpb])|m(?!\S)/g, 'ṃ');

// What a <scriptNote xml:id="…"> in a witness means for collation.
// `rules` (from editor.config.json "scriptNoteRules") can add or override: {"id": "b=v, ś=s"} or {"id": ""} to ignore.
export const scriptRule = (id, rules = {}) => {
  if (Object.hasOwn(rules, id)) {
    const pairs = parsePairs(rules[id]);
    return pairs.length ? {label: pairs.map(p => p.join(' = ')).join(', '), fn: s => applyPairs(s, pairs)} : {label: 'ignored (editor.config.json)', fn: null};
  }
  if (/^s(a)?varn(a|ṇa)-nasals$/i.test(id)) return {label: 'anusvāra = nasal of the same class; final m = ṃ', fn: nasalRule};
  const m = id.normalize('NFC').match(/^script-(.+)-(.+)$/);
  if (m) {
    let [a, b] = [m[1], m[2]];
    if (a.length > 1 && b.length > 1 && a.endsWith('a') && b.endsWith('a')) { a = a.slice(0, -1); b = b.slice(0, -1); }
    return {label: `${a} = ${b}`, fn: s => s.split(a).join(b)};
  }
  return null;
};
export const scriptNotesOf = doc => [...doc.getElementsByTagNameNS(TEI_NS, 'scriptNote')]
  .map(n => n.getAttributeNS(XML_NS, 'id')).filter(Boolean);

// Readings are copied from the transcriptions with their markup. A note anchor caught inside a reading
// (e.g. from a reading of the edition's own <app>) would repeat the anchor's xml:id in the apparatus:
// drop anchors, and any xml:id, from the copied readings.
export const cleanReadings = listapp => (listapp || '')
  .replace(/<anchor\b[^>]*\/>/g, '').replace(/<anchor\b[^>]*>\s*<\/anchor>/g, '')
  .replace(/\sxml:id="[^"]*"/g, '');

export class Collator {
  constructor({settings, extraIgnore = [], apparatusOpts = {}, scriptNoteRules = {}, editionFile, editionSiglum}) {
    this.settings = settings;
    this.ignore = [...new Set([...settings.tagfilters, ...extraIgnore])];
    const {indices, unknown} = namesToIndices(settings.filternames);
    this.filtersindices = indices;
    this.filtersnames = indices.map(i => allFilters[i].name);
    this.unknownFilters = unknown;
    this.apparatusOpts = apparatusOpts;
    this.samePairs = parsePairs(apparatusOpts.sameLetters);
    this.scriptNoteRules = scriptNoteRules;
    this.useScriptNotes = apparatusOpts.scriptNotes !== false;
    this.witRules = new Map();   // witness file -> [{id, label, fn}]
    this.editionFile = editionFile;
    this.siglum = settings.target || editionSiglum;
    this.state = {alltexts: new Map(), allblocks: new Set()};
    this.docs = new Map();
    this.queue = [];          // waiting jobs: {block, priority, resolve, reject, onProgress}
    this.running = null;
    this.worker = null;
  }

  // what a fresh alignment depends on (normalizations are checked separately: see compatible())
  signature() {
    const {tokenization, scoring} = this.settings;
    return JSON.stringify(['v2', tokenization, scoring, this.ignore, this.siglum]);
  }

  // Can an existing alignment (file or cache) be used with the current settings?
  // Normalizations the alignment lacks are applied when the apparatus is made; ones it has
  // that are now switched off cannot be undone, nor can different tokenization or scoring.
  compatible(alignDoc, block = null) {
    const f = readSettings(alignDoc), s = this.settings, why = [];
    // XML elements ignored differently (e.g. <trailer>): matters only if the passage contains one
    if (block) {
      const fileTags = new Set(f.tagfilters), now = new Set(this.ignore);
      const differ = [...new Set([...fileTags, ...now])].filter(t => fileTags.has(t) !== now.has(t));
      const present = differ.filter(t => this._blockHas(block, t));
      if (present.length) why.push(`ignored XML elements differ: ${present.map(t => `<${t}>`).join(', ')}`);
    }
    if (f.tokenization !== s.tokenization) why.push(`tokenization ${f.tokenization}`);
    for (const k of ['match', 'mismatch', 'gap_open', 'gap_extend', 'realigndepth', 'recursive', 'distancefunc'])
      if (f.scoring[k] !== s.scoring[k]) why.push(`${k.replace('_', ' ')} ${f.scoring[k]}`);
    const have = namesToIndices(f.filternames).indices;
    const off = have.filter(i => !this.filtersindices.includes(i)).map(i => allFilters[i].name);
    if (off.length) why.push(`normalizations now switched off: ${off.join(', ')}`);
    return {ok: !why.length, why, extra: this.filtersindices.filter(i => !have.includes(i))};
  }

  // does the passage, in the edition or any witness, contain an element <tag>?
  _blockHas(block, tag) {
    if (!this._passIndex) {
      this._passIndex = new Map();
      for (const doc of this.docs.values())
        for (const el of doc.getElementsByTagNameNS('*', '*')) {
          if (!['p', 'lg', 'l', 'div'].includes(el.localName)) continue;
          const ids = [el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id'),
            ...(el.getAttribute('corresp') || '').split(/\s+/).map(c => c.replace(/^#/, ''))].filter(Boolean);
          for (const id of ids) { if (!this._passIndex.has(id)) this._passIndex.set(id, []); this._passIndex.get(id).push(el); }
        }
    }
    return (this._passIndex.get(block) || []).some(el => el.getElementsByTagNameNS('*', tag).length > 0);
  }

  _blockIn(doc, block) {
    const out = [];
    for (const el of doc.getElementsByTagNameNS('*', '*')) {
      if (!['p', 'lg', 'l', 'div'].includes(el.localName)) continue;
      if (el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') === block ||
          (el.getAttribute('corresp') || '').split(/\s+/).includes('#' + block)) out.push(el);
    }
    return out;
  }

  // An alignment made when an element (e.g. <trailer>) was not yet ignored contains that element's text.
  // Remove that text from it, keeping its word groups (so corrections made by hand survive), and record
  // the element as ignored. Returns the new alignment XML, or null if this cannot be done safely.
  adaptIgnored(block, alignXML) {
    const doc = parseXML(alignXML, `alignment ${block}`);
    const f = readSettings(doc), fileTags = new Set(f.tagfilters);
    const add = this.ignore.filter(t => !fileTags.has(t) && this._blockHas(block, t));
    if (!add.length || f.tagfilters.some(t => !this.ignore.includes(t) && this._blockHas(block, t))) return null;
    const files = new Map(getWits(doc).map(w => [w.name, w.filename]));
    const teis = [...doc.documentElement.children].filter(e => e.localName === 'TEI');
    for (const tei of teis) {
      const sig = tei.getAttribute('n');
      const src = this.docs.get(sig === this.siglum ? this.editionFile : files.get(sig));
      if (!src) return null;
      const strings = this._blockIn(src, block).flatMap(el => add.flatMap(t => [...el.getElementsByTagNameNS('*', t)]))
        .map(e => e.textContent.replace(/\s+/g, '')).filter(Boolean);
      if (!strings.length) continue;
      const ws = [...tei.getElementsByTagNameNS('*', 'w')];
      // every character of the row, and the non-whitespace ones (where the element's text is looked for)
      const all = [], pos = []; let flat = '';
      ws.forEach((w, wi) => { const t = w.textContent; for (let ci = 0; ci < t.length; ci++) {
        if (!/\s/.test(t[ci])) { pos.push(all.length); flat += t[ci]; }
        all.push([wi, ci, t[ci]]); } });
      const kill = ws.map(() => new Set());
      let end = flat.length;
      for (const str of [...strings].reverse()) {
        const at = flat.lastIndexOf(str, end - str.length);
        if (at < 0) return null;
        const a = pos[at], b = pos[at + str.length - 1];
        for (let k = a; k <= b; k++) kill[all[k][0]].add(all[k][1]);
        // the element sat between two stretches of whitespace: keep only the one before it
        let k = b + 1; const after = [];
        while (k < all.length && /\s/.test(all[k][2])) after.push(all[k++]);
        if (after.length && a > 0 && /\s/.test(all[a - 1][2])) for (const [wi, ci] of after) kill[wi].add(ci);
        end = at;
      }
      for (const [wi, w] of ws.entries()) {
        if (!kill[wi].size) continue;
        if (w.children.length) return null;          // markup inside the cell: leave it to a fresh collation
        w.textContent = w.textContent.split('').filter((_, ci) => !kill[wi].has(ci)).join('');
        w.removeAttribute('lemma');
      }
    }
    // drop columns that are now empty in every row, and groups left empty
    const rows = teis.map(t => [...t.getElementsByTagNameNS('*', 'w')]);
    const ncol = Math.max(...rows.map(r => r.length));
    for (let c = 0; c < ncol; c++)
      if (rows.every(r => !r[c] || (r[c].textContent === '' && !r[c].children.length))) rows.forEach(r => r[c]?.remove());
    const baseTei = teis.find(t => t.getAttribute('n') === this.siglum);
    for (const tei of teis) for (const cl of [...tei.getElementsByTagNameNS('*', 'cl')]) if (!cl.children.length) cl.remove();
    // every group except the first and last must keep some text of the edition: otherwise give up
    const baseCls = baseTei ? [...baseTei.getElementsByTagNameNS('*', 'cl')] : [];
    if (baseCls.some((cl, i) => i > 0 && i < baseCls.length - 1 && !cl.textContent.trim())) return null;
    for (const tei of teis) [...tei.getElementsByTagNameNS('*', 'w')].forEach((w, i) => w.setAttribute('n', String(i)));
    // record the newly ignored elements
    const tf = doc.querySelector('ab[type="tagfilters"]');
    if (tf) for (const t of add) { const el = doc.createElementNS(tf.namespaceURI, 'tag'); el.setAttribute('subtype', 'ignore'); el.textContent = t; tf.append(el, doc.createTextNode('\n')); }
    const rd = doc.querySelector('revisionDesc');
    if (rd) { const ch = doc.createElementNS(rd.namespaceURI, 'change'); ch.setAttribute('when', new Date().toISOString().slice(0, 10));
      ch.textContent = `Text of ${add.map(t => `<${t}>`).join(', ')} removed (now ignored in collation); hand corrections kept`; rd.append(ch); }
    let out = new XMLSerializer().serializeToString(doc);
    if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
    return out;
  }

  _witnessRules(name, doc) {
    if (name === this.editionFile) return;
    const list = [];
    for (const id of scriptNotesOf(doc)) { const r = scriptRule(id, this.scriptNoteRules); list.push({id, label: r?.label || null, fn: r?.fn || null}); }
    this.witRules.set(name, list);
  }

  // makeApp's test of whether a witness agrees with the lemma, widened by the settings
  _equivalence(alignDoc, witmap) {
    const extra = this.compatible(alignDoc).extra, pairs = this.samePairs;
    const common = s => applyPairs(extra.length ? filterAll(s, extra)[0] : s, pairs);
    const perWit = new Map();
    if (this.useScriptNotes) for (const [name, w] of witmap) {
      const file = [...this.docs].find(([, d]) => d === w.xml)?.[0];
      const fns = (this.witRules.get(file) || []).map(r => r.fn).filter(Boolean);
      if (fns.length) perWit.set(name, s => fns.reduce((t, fn) => fn(t), s));
    }
    if (!extra.length && !pairs.length && !perWit.size) return undefined;
    return (id, a, b) => {
      const x = common(a), y = common(b);
      if (x === y) return true;
      const f = perWit.get(id);
      return !!f && f(x) === f(y);
    };
  }

  _appOpts(block, alignDoc) {
    const witmap = new Map();
    for (const w of getWits(alignDoc)) {
      if (!w.filename) continue;
      const d = this.docs.get(w.filename);
      if (d) witmap.set(w.name, {name: w.name, type: w.type, select: w.select, xml: d});
    }
    const o = this.apparatusOpts;
    const maxom = Number(o.maxomlength);
    return {base: this.siglum, normlem: o.normlem ?? true, mergerdgs: o.mergerdgs ?? true,
      maxomlength: o.maxomlength != null && maxom > 0 ? maxom : null,
      blockid: block, witnesses: witmap, equivalent: this._equivalence(alignDoc, witmap)};
  }

  addFile(name, doc) {
    this.docs.set(name, doc); this._passIndex = null;
    this._witnessRules(name, doc);
    return processFile(doc, name, this.state);
  }

  setFile(name, doc) {
    for (const [k, v] of [...this.state.alltexts]) if (v.filename === name) this.state.alltexts.delete(k);
    this.docs.set(name, doc); this._passIndex = null;
    this._witnessRules(name, doc);
    processFile(doc, name, this.state);
  }
  setEdition(doc) { this.setFile(this.editionFile, doc); }

  // ---------------------------------------------------------- alignment (slow, in a worker)
  // priority 'high' jobs go first and interrupt a running 'low' (look-ahead) job.
  align(block, {priority = 'high', onProgress} = {}) {
    return new Promise((resolve, reject) => {
      const job = {block, priority, resolve, reject, onProgress};
      if (priority === 'high') {
        this.queue = this.queue.filter(j => !(j.block === block && j.priority === 'low' && (j.resolve(null), true)));
        this.queue.unshift(job);
        if (this.running && this.running.priority === 'low') this._interrupt();
      } else {
        if (this.queue.some(j => j.block === block) || this.running?.block === block) return resolve(null);
        this.queue.push(job);
      }
      this._next();
    });
  }

  _interrupt() {
    const r = this.running;
    this.worker?.terminate(); this.worker = null; this.running = null;
    r.resolve(null); // look-ahead jobs simply give up
  }

  _next() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job;
    let texts;
    try {
      const sigla = [...this.state.alltexts.keys()];
      texts = preProcess(job.block, sigla.map(s => ({siglum: s, text: this.state.alltexts.get(s)})),
        {splitfunc: findSplitfunc(this.settings.tokenization), selectedfilters: this.filtersindices, ignoretags: this.ignore});
    } catch (e) { this.running = null; job.reject(e); return this._next(); }
    if (texts.length < 2 || !texts.some(t => t.siglum === this.siglum)) {
      this.running = null;
      job.resolve({none: true, reason: texts.length < 2 ? 'No witness has this passage.' : 'Passage not found in the edition.'});
      return this._next();
    }
    const configfunc = this.settings.tokenization === 'character' ? 'character' : this.settings.scoring.recursive ? 'arr' : 'arr_simple';
    if (!this.worker) this.worker = new Worker('./saktumiva/lib/multialignworker.mjs', {type: 'module'});
    const done = (fn, val) => { this.running = null; fn(val); this._next(); };
    this.worker.onmessage = e => {
      if (e.data && Object.hasOwn(e.data, 'progress')) { job.onProgress?.(e.data.progress); return; }
      try {
        const filtersmap = new Map(texts.map(t => [t.siglum, t.filters]));
        const meta = {block: job.block, alltexts: this.state.alltexts, filtersnames: this.filtersnames, filtersindices: this.filtersindices,
          tagfilters: this.ignore, lang: texts[0].lang, tokenization: this.settings.tokenization,
          scoring: this.settings.scoring, targetedition: this.siglum};
        const pp = postProcess(e.data, filtersmap, meta);
        done(job.resolve, {alignXML: pp.startsWith('<?xml') ? pp : '<?xml version="1.0" encoding="UTF-8"?>\n' + pp});
      } catch (err) { done(job.reject, err); }
    };
    this.worker.onerror = e => { this.worker?.terminate(); this.worker = null; done(job.reject, new Error(e.message || 'alignment failed')); };
    this.worker.postMessage([texts, configfunc, this.settings.scoring]);
  }

  // ---------------------------------------------------------- whole texts (for distances)
  // The text of each witness in `sigla` for the passages `blocks`, cleaned, normalized and tokenized as for
  // collation, the passages one after another: what Saktumiva's tree page compares. A witness with <add>/<del>
  // is taken ante or post correctionem (`corr`: Kac, Kpc). -> Map(siglum -> Map(block -> tokens)), in passage order
  wholeTexts(blocks, sigla, corr = 'ac') {
    const splitfunc = findSplitfunc(this.settings.tokenization);
    const want = new Set(sigla.flatMap(s => [s, s + 'ac', s + 'pc']));
    const entries = [...this.state.alltexts].filter(([k]) => want.has(k)).map(([k, text]) => ({siglum: k, text}));
    const out = new Map(sigla.map(s => [s, new Map()]));
    for (const b of blocks) {
      let res;
      try { res = preProcess(b, entries, {splitfunc, selectedfilters: this.filtersindices, ignoretags: this.ignore}); }
      catch { continue; }
      const got = new Map(res.map(r => [r.siglum, r.text]));
      for (const s of sigla) {
        const t = got.get(s) ?? got.get(s + corr);   // without corrections in this passage, Saktumiva gives the plain siglum
        if (t && t.length) out.get(s).set(b, t);
      }
    }
    return out;
  }

  // ---------------------------------------------------------- publishing
  // Adds <standOff type="apparatus"> for one passage (and any missing witnesses) to `doc`,
  // using Saktumiva's own makeApp / addWitnesses / addApparatus, as its command-line tool does.
  publishInto(doc, block, alignXML, alignPath) {
    const alignDoc = parseXML(alignXML, `alignment ${block}`);
    const opts = this._appOpts(block, alignDoc);
    const quiet = console.log, alrt = window.alert; console.log = () => {}; window.alert = null;
    try {
      const app = makeApp(alignDoc, doc, opts);
      if (app.error) throw new Error(app.error);
      addWitnesses(doc, app.listwit);
      addApparatus(doc, cleanReadings(app.listapp), app.warnings, alignDoc, block, alignPath);
      return app.warnings || [];
    } finally { console.log = quiet; window.alert = alrt; }
  }

  // ---------------------------------------------------------- apparatus (fast)
  // Returns {listApp, listWit, warnings, mismatch}
  apparatus(block, alignXML) {
    const alignDoc = parseXML(alignXML, `alignment ${block}`);
    const ed = this.docs.get(this.editionFile);
    const opts = this._appOpts(block, alignDoc);
    // Saktumiva reports problems with alert() and console.log; keep them out of sight
    const quiet = console.log, alrt = window.alert; console.log = () => {}; window.alert = null;
    let app;
    try { app = makeApp(alignDoc, ed, opts); }
    finally { console.log = quiet; window.alert = alrt; }
    const corrected = !!alignDoc.querySelector('revisionDesc change[type="hand-corrected"]');
    const compat = this.compatible(alignDoc, block);
    if (app.error) return {error: app.error, corrected, compat};
    const mine = `: ${this.siglum} doesn't match alignment`;
    const mismatch = (app.warnings || []).some(w => w.includes(mine));
    const formatted = app.listapp ? xmlFormat(`<listApp xmlns="${TEI_NS}">${app.listapp}</listApp>`,
      {indentation: '  ', collapseContent: true, lineSeparator: '\n'}) : `<listApp xmlns="${TEI_NS}"/>`;
    return {listApp: parseXML(formatted, 'apparatus').documentElement, listWit: alignDoc.querySelector('listWit'),
            warnings: (app.warnings || []).filter(w => !w.includes(mine)), mismatch, corrected, compat,
            // a witness's text no longer matches this alignment (its transcription has changed)
            witMismatch: (app.warnings || []).some(w => !w.includes(mine) && w.includes("doesn't match alignment")),
            rows: [...alignDoc.documentElement.children].filter(e => e.localName === 'TEI').map(e => e.getAttribute('n'))};
  }
}
