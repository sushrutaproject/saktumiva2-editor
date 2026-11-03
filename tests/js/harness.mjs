// Loads the editor's own collation code (app/collate.mjs) with the Saktumiva submodule in Node,
// with Saktumiva patched exactly as the server patches it, and a DOM from jsdom.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
const PKG = path.join(ROOT, 'src/saktumiva_editor');
const BUILD = path.join(HERE, '.build/app');
export const FIXTURES = path.join(ROOT, 'tests/fixtures');
export const GOLDEN = path.join(ROOT, 'tests/golden');

// ---------------------------------------------------------------- a patched copy of the app
export const PATCHES = JSON.parse(fs.readFileSync(path.join(PKG, 'saktumiva-patches.json'), 'utf8')).patches;

export function applyPatches(rel, text) {
  const problems = [];
  for (const p of PATCHES.filter(p => p.file === rel)) {
    const re = new RegExp(p.find, 'g'), n = [...text.matchAll(re)].length;
    if (n !== 1) { problems.push(`${rel}: patch matches ${n} times, expected once`); continue; }
    text = text.replace(new RegExp(p.find), () => p.replace);
  }
  return {text, problems};
}

function buildApp() {
  fs.rmSync(BUILD, {recursive: true, force: true});
  fs.mkdirSync(BUILD, {recursive: true});
  for (const f of fs.readdirSync(path.join(PKG, 'app'))) if (f.endsWith('.mjs')) fs.copyFileSync(path.join(PKG, 'app', f), path.join(BUILD, f));
  const lib = path.join(PKG, 'app/saktumiva/lib');
  if (!fs.existsSync(path.join(lib, 'collate.mjs'))) throw new Error('The Saktumiva submodule is not checked out: run  git submodule update --init');
  fs.cpSync(lib, path.join(BUILD, 'saktumiva/lib'), {recursive: true});
  const problems = [];
  for (const rel of new Set(PATCHES.map(p => p.file))) {
    const f = path.join(BUILD, 'saktumiva', rel);
    const r = applyPatches(rel, fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, r.text);
    problems.push(...r.problems);
  }
  return problems;
}

// ---------------------------------------------------------------- browser globals
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['DOMParser', 'XMLSerializer', 'Node', 'Element', 'Document', 'NodeFilter', 'document'])
  globalThis[k] = dom.window[k];
globalThis.window = dom.window;
const appURL = pathToFileURL(BUILD + '/').href;
// Alignment runs in a Web Worker in the browser; here it runs in this process.
globalThis.Worker = class {
  constructor() { this.onmessage = null; this.onerror = null; }
  postMessage(data) {
    import(new URL('saktumiva/lib/multialign.mjs', appURL)).then(({default: MultiAligner}) => {
      try { this.onmessage?.({data: new MultiAligner(data[1], data[2]).align(data[0])}); }
      catch (e) { this.onerror?.(e); }
    });
  }
  terminate() {}
};

export const patchProblems = buildApp();
export const collate = await import(new URL('collate.mjs', appURL));
export const teiutil = await import(new URL('teiutil.mjs', appURL));

// ---------------------------------------------------------------- a section, loaded as main.mjs loads it
export function loadSection(dir, overrides = {}) {
  const cfg = {...JSON.parse(fs.readFileSync(path.join(dir, 'editor.config.json'), 'utf8')), ...overrides};
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const {parseXML} = teiutil;
  const edDoc = parseXML(read(cfg.edition), cfg.edition);
  let settingsDoc = null;
  if (cfg.settingsFrom && fs.existsSync(path.join(dir, cfg.settingsFrom))) settingsDoc = parseXML(read(cfg.settingsFrom), cfg.settingsFrom);
  let settings = collate.readSettings(settingsDoc);
  if (cfg.collation) settings = collate.settingsFromConfig(cfg.collation, settings);
  const siglum = edDoc.querySelector('idno[type="siglum"]')?.textContent.trim() || 'Ed';
  const collator = new collate.Collator({settings, extraIgnore: cfg.collation?.ignoreTags ? [] : (cfg.extraIgnoreTags || []),
    apparatusOpts: cfg.apparatus || {}, scriptNoteRules: cfg.scriptNoteRules || {}, editionFile: cfg.edition, editionSiglum: siglum});
  for (const w of cfg.witnesses) collator.addFile(w, parseXML(read(w), w));
  collator.setEdition(edDoc);
  const alignment = block => {
    const f = path.join(dir, cfg.alignmentsDir || 'alignments', `${block}.xml`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  return {cfg, collator, edDoc, alignment, raw: read(cfg.edition)};
}

// Things that change from run to run (dates, the random ids of the guide tree's nodes) are blanked out.
export const stable = xml => { const ids = new Map(); return xml
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, u => { if (!ids.has(u)) ids.set(u, `uuid${ids.size}`); return ids.get(u); })
  .replace(/\bwhen="[^"]*"/g, 'when="…"')
  .replace(/<date>[^<]*<\/date>/g, '<date>…</date>')
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '…'); };

export const serialize = node => node ? new XMLSerializer().serializeToString(node) : null;

export function compareGolden(t, name, actual, assert) {
  const f = path.join(GOLDEN, `${name}.json`);
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, JSON.stringify(actual, null, 1) + '\n');
    if (!process.env.UPDATE_GOLDEN) t.diagnostic(`wrote new golden file ${path.relative(ROOT, f)}`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepStrictEqual(actual, expected,
    `${name}: the result differs from tests/golden/${name}.json. If Saktumiva was updated and the change is intended, ` +
    'run  npm run update-golden  in tests/js and commit the new golden files.');
}
