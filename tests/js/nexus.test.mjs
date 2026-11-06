// Data export → NEXUS for SplitsTree (app/nexus.mjs): alignment files to a character matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIR = path.join(ROOT, 'tests/fixtures/nexus');
globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { alignmentCharacters, buildNexus } = await import(pathToFileURL(path.join(ROOT, 'src/saktumiva_editor/app/nexus.mjs')).href);

const small = fs.readFileSync(path.join(DIR, 'small.xml'), 'utf8');
const real = fs.readFileSync(path.join(DIR, 'SS.1.1.3.xml'), 'utf8');
// the MATRIX rows and the declared dimensions of a NEXUS text
const parse = text => {
  const rows = Object.fromEntries(text.split(/\n\s*MATRIX\n/)[1].split(/\n\s*;/)[0].trim().split('\n')
    .map(l => l.match(/^'((?:[^']|'')*)'\s+(\S*)$/)).map(m => [m[1], m[2]]));
  return {rows, ntax: +text.match(/NTAX=(\d+)/)[1], nchar: +text.match(/NCHAR=(\d+)/)[1],
          labels: [...text.matchAll(/^\s+(\d+) '([^']*)' \/ (.*?),?$/gm)].map(m => [m[2], m[3]])};
};

test('characters: one per aligned cell or one per word group, as written or normalized', () => {
  const cells = alignmentCharacters(small, {mergeGroups: false, normalize: false});
  assert.deepEqual(cells.sigla, ['X', 'Y', 'Z']);
  assert.equal(cells.chars.length, 12);
  assert.deepEqual(cells.chars[0], {X: 'atha', Y: 'athā', Z: 'atha'});
  assert.deepEqual(cells.chars[1], {X: 'vā', Y: 'vā', Z: ''});
  const norm = alignmentCharacters(small, {mergeGroups: false, normalize: true});
  assert.deepEqual(norm.chars[0], {X: 'atha', Y: 'atha', Z: 'atha'});     // the lemma attribute
  const groups = alignmentCharacters(small);                               // defaults: merged, normalized
  assert.equal(groups.chars.length, 4);
  assert.deepEqual(groups.chars[0], {X: 'athavā', Y: 'athavā', Z: 'atha'});
  assert.deepEqual(groups.chars[2], {X: 'abcdefgh', Y: '', Z: 'abcdefgh'});
  assert.deepEqual(alignmentCharacters(small, {gapsSignificant: true}).chars[2].Y, '[]');
  assert.throws(() => alignmentCharacters('<teiCorpus'), /not well-formed/);
});

test('the NEXUS matrix (merged groups, normalized)', () => {
  const r = buildNexus([{id: 'P.1', xml: small}], ['X', 'Y', 'Z', 'W']);
  assert.deepEqual([r.ntax, r.nchar, r.passages, r.skipped, r.tooMany], [4, 4, 1, [], 0]);
  const n = parse(r.text);
  assert.equal(n.ntax, 4); assert.equal(n.nchar, 4);
  // states from 2 on, in order of first appearance; '-' gap, '?' lost text (‡) or a witness without the passage
  assert.deepEqual(n.rows, {X: '222?', Y: '23-2', Z: '342?', W: '????'});
  assert.deepEqual(n.labels, [
    ['P.1.1', "'[]' '‡' 'athavA' 'atha'"],
    ['P.1.2', "'[]' '‡' 'rAma()s' 'rAmaH' 'rAma'"],              // Harvard-Kyoto, lower case, ' as ()
    ['P.1.3', "'[]' '‡' 'abcdefgh'"],
    ['P.1.4', "'[]' '‡' 'x'"]]);
  for (const row of Object.values(n.rows)) assert.equal(row.length, n.nchar);
  assert.match(r.text, /^#NEXUS\n/);
  assert.match(r.text, /FORMAT DATATYPE=STANDARD RESPECTCASE GAP=- MISSING=\? SYMBOLS="0123456789ABCDEFGHKLMNPQRSTUVWXYZabcdefghklmnpqrstuvwxyz";/);
});

test('gaps significant: a short omission is state 0, a run of eight or more cells is still a gap', () => {
  const merged = parse(buildNexus([{id: 'P', xml: small}], ['X', 'Y', 'Z'], {gapsSignificant: true}).text);
  assert.equal(merged.rows.Y, '2302');
  const cells = parse(buildNexus([{id: 'P', xml: small}], ['X', 'Y', 'Z'], {gapsSignificant: true, mergeGroups: false}).text);
  assert.equal(cells.rows.Y.slice(3, 11), '--------');
  assert.equal(cells.rows.Z[1], '0');
});

test('passages one after another; corrected witnesses as ante or post correctionem', () => {
  const taxa = ['K', 'N', 'H', 'A'];
  const r = buildNexus([{id: 'SS.1.1.3', xml: real}, {id: 'P', xml: small}, {id: 'bad', xml: '<x'}], taxa);
  assert.deepEqual(r.skipped, [['bad', 'not well-formed XML']]);
  assert.equal(r.passages, 2);
  const n = parse(r.text);
  const realChars = alignmentCharacters(real).chars.length;
  assert.equal(n.nchar, realChars + 4);
  assert.deepEqual(Object.keys(n.rows), taxa);
  assert.equal(n.rows.K.slice(realChars), '????');                         // K is not in the second passage
  assert.ok(/[2-9]/.test(n.rows.K.slice(0, realChars)));                    // but has Kac/Kpc in the first
  assert.equal(n.labels[0][0], 'SS.1.1.3.1');
  assert.equal(n.labels[realChars][0], 'P.1');
  const ac = alignmentCharacters(real).chars.map(c => c.Kac), pc = alignmentCharacters(real).chars.map(c => c.Kpc);
  const k = ac.findIndex((x, i) => x !== pc[i]);
  assert.ok(k >= 0, 'Kac and Kpc differ somewhere');
  // the reading K has at that character, by its state label
  const said = (nx, i) => [...nx.labels[i][1].matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1])['0123456789ABCDEFGHKLMNPQRSTUVWXYZabcdefghklmnpqrstuvwxyz'.indexOf(nx.rows.K[i])];
  const withPc = parse(buildNexus([{id: 'SS.1.1.3', xml: real}], taxa, {corrections: 'pc'}).text);
  const hk = x => x.replace(/\s+/g, '').replace(/ā/g, 'A').replace(/ṃ/g, 'M').replace(/ḥ/g, 'H');
  assert.equal(said(n, k), hk(ac[k]));
  assert.equal(said(withPc, k), hk(pc[k]));
  assert.notEqual(said(n, k), said(withPc, k));
});

test('more readings than symbols: the extra ones are written as ?', () => {
  const tei = (n, x) => `<TEI n="${n}"><text><cl><w n="0">${x}</w></cl></text></TEI>`;
  const taxa = Array.from({length: 60}, (_, i) => `W${i}`);
  const xml = `<teiCorpus xmlns="http://www.tei-c.org/ns/1.0">${taxa.map((s, i) => tei(s, 'r' + i)).join('')}</teiCorpus>`;
  const r = buildNexus([{id: 'P', xml}], taxa);
  assert.equal(r.tooMany, 1);
  const n = parse(r.text);
  assert.equal(n.rows.W0, '2'); assert.equal(n.rows.W53, 'z'); assert.equal(n.rows.W54, '?');
});
