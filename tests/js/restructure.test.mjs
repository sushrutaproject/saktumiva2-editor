// Merging and splitting passages in the edition and the witness files (app/restructure.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, FIXTURES, teiutil } from './harness.mjs';

const R = await import(pathToFileURL(path.join(ROOT, 'src/saktumiva_editor/app/restructure.mjs')).href);
const { parseXML, scanRaw } = teiutil;
const file = raw => ({raw, doc: parseXML(raw, 'test'), span: scanRaw(raw)});
const tei = body => `<?xml version="1.0"?>\n<TEI xmlns="http://www.tei-c.org/ns/1.0">\n  <text><body><div>\n${body}\n  </div></body></text>\n</TEI>\n`;

const ED = tei(`    <lg xml:id="T.1">
      <l>aaa bbb<anchor xml:id="T.1-n1"/> ccc</l>
      <trailer>[one]</trailer>
    </lg>
    <!-- a comment -->
    <lg xml:id="T.2" n="2">
      <l>ddd <unclear>eee fff</unclear> ggg<anchor xml:id="T.2-n1"/></l>
      <l>hhh iii</l>
    </lg>
    <lg xml:id="T.3">
      <l>jjj</l>
    </lg>`).replace('</TEI>', `  <standOff corresp="#T.1" type="Note">
    <note target="#T.1-n1">first</note>
  </standOff>
  <standOff corresp="#T.2" type="Note">
    <note target="#T.2-n1">second</note>
  </standOff>
</TEI>`);

test('merge in the edition: tags removed, nothing else touched, notes follow', () => {
  const r = R.mergeInFile({...file(ED), ids: ['T.1', 'T.2'], edition: true});
  assert.equal(r.status, 'merged');
  const expected = ED.replace('\n    </lg>\n    <!-- a comment -->\n    <lg xml:id="T.2" n="2">', '\n    \n    <!-- a comment -->\n    ')
    .replace('<standOff corresp="#T.2"', '<standOff corresp="#T.1"');
  assert.equal(r.content, expected);
  assert.equal(R.findPassage(r.doc, 'T.2'), null);
  assert.equal(R.findPassage(r.doc, 'T.1').getElementsByTagNameNS('*', 'l').length, 3);
});

test('merge in witnesses: both, only the first, only the second, by corresp, none', () => {
  const both = tei('<p xml:id="T.1">aaa\n  bbb</p>\n<p xml:id="T.2">ccc</p><p xml:id="T.3">x</p>');
  let r = R.mergeInFile({...file(both), ids: ['T.1', 'T.2']});
  assert.equal(r.content, both.replace('</p>\n<p xml:id="T.2">', '\n'));
  r = R.mergeInFile({...file(tei('<p xml:id="T.1">aaa</p>')), ids: ['T.1', 'T.2']});
  assert.equal(r.status, 'unchanged');
  const second = tei('<p xml:id="T.2">ccc</p>');
  r = R.mergeInFile({...file(second), ids: ['T.1', 'T.2']});
  assert.equal(r.status, 'renamed');
  assert.equal(r.content, second.replace('T.2', 'T.1'));
  const corr = tei('<p corresp="#T.1">aaa</p> <p corresp="#T.2">ccc</p>');
  r = R.mergeInFile({...file(corr), ids: ['T.1', 'T.2']});
  assert.equal(r.content, corr.replace('</p> <p corresp="#T.2">', ' '));
  const one = tei('<p corresp="#T.1 #T.2">aaa</p>');
  r = R.mergeInFile({...file(one), ids: ['T.1', 'T.2']});
  assert.equal(r.content, one.replace(' #T.2', ''));
  assert.equal(R.mergeInFile({...file(tei('<p xml:id="T.9">z</p>')), ids: ['T.1', 'T.2']}).status, 'unchanged');
  r = R.mergeInFile({...file(tei('<p xml:id="T.1">a</p><p xml:id="T.2">b</p><p xml:id="T.3">c</p>')), ids: ['T.1', 'T.2', 'T.3']});
  assert.match(r.content, /<p xml:id="T.1">abc<\/p>/);
});

test('merge refuses what it cannot do safely', () => {
  const bad = (body, re, ids = ['T.1', 'T.2']) => assert.throws(() => R.mergeInFile({...file(tei(body)), ids}), re);
  bad('<p xml:id="T.2">b</p><p xml:id="T.1">a</p>', /another order/);
  bad('<p xml:id="T.1">a</p><p xml:id="T.3">c</p><p xml:id="T.2">b</p>', /between T.1 and T.2/);
  bad('<p xml:id="T.1">a</p><lg xml:id="T.2"><l>b</l></lg>', /same kind/);
  bad('<div><p xml:id="T.1">a</p></div><div><p xml:id="T.2">b</p></div>', /not side by side/);
  bad('<p xml:id="T.1">a</p><p xml:id="T.2"/>', /empty element/);
  assert.throws(() => R.mergeInFile({...file(ED), ids: ['T.1', 'T.9'], edition: true}), /not a passage/);
  // a page break between the two is allowed and kept
  const r = R.mergeInFile({...file(tei('<p xml:id="T.1">a</p><pb n="2"/><p xml:id="T.2">b</p>')), ids: ['T.1', 'T.2']});
  assert.match(r.content, /<p xml:id="T.1">a<pb n="2"\/>b<\/p>/);
});

const cut = (raw, at) => {   // at: the text just before the split point
  const f = file(raw);
  const el = R.findPassage(f.doc, 'T.2');
  const all = R.textNodesOf(el).map(t => t.data).join('');
  return {f, offset: all.indexOf(at) + at.length};
};

test('split inside a line, inside inline markup, and between lines', () => {
  let {f, offset} = cut(ED, 'eee');
  let r = R.splitInFile({...f, id: 'T.2', secondId: 'T.2b', offset, edition: true});
  assert.equal(r.status, 'split');
  assert.ok(r.content.includes(`    <lg xml:id="T.2" n="2">
      <l>ddd <unclear>eee </unclear></l>
    </lg>
    <lg xml:id="T.2b" n="2">
      <l><unclear>fff</unclear> ggg<anchor xml:id="T.2-n1"/></l>
      <l>hhh iii</l>
    </lg>`), r.content);
  // the note anchored in the second part now belongs to it; the other one is untouched
  assert.ok(r.content.includes('<standOff corresp="#T.2b" type="Note">\n    <note target="#T.2-n1">second</note>'));
  assert.ok(r.content.includes('<standOff corresp="#T.1" type="Note">'));
  ({f, offset} = cut(ED, 'ggg'));
  r = R.splitInFile({...f, id: 'T.2', firstId: 'T.2ab', secondId: 'T.2cd', offset, edition: true});
  assert.ok(r.content.includes(`    <lg xml:id="T.2ab" n="2">
      <l>ddd <unclear>eee fff</unclear> ggg<anchor xml:id="T.2-n1"/></l>
    </lg>
    <lg xml:id="T.2cd" n="2">
      <l>hhh iii</l>
    </lg>`), r.content);
  assert.ok(r.content.includes('<standOff corresp="#T.2ab" type="Note">'));   // the old id is gone everywhere
  assert.ok(!r.content.includes('"#T.2"') && !r.content.includes('"T.2"'));
  // everything outside the passage and its notes is byte for byte the same
  assert.equal(r.content.slice(0, r.content.indexOf('<lg xml:id="T.2ab"')), ED.slice(0, ED.indexOf('<lg xml:id="T.2"')));
});

test('split: notes of one standOff divided between the parts', () => {
  const ed = ED.replace('ccc</l>', 'ccc<anchor xml:id="T.1-n2"/></l>').replace('<note target="#T.1-n1">first</note>',
    '<note target="#T.1-n1">first</note>\n    <note target="#T.1-n2">other</note>\n    <note>general</note>');
  const f = file(ed);
  const el = R.findPassage(f.doc, 'T.1');
  const offset = R.textNodesOf(el).map(t => t.data).join('').indexOf('ccc');
  const r = R.splitInFile({...f, id: 'T.1', secondId: 'T.1b', offset, edition: true});
  assert.ok(r.content.includes(`  <standOff corresp="#T.1" type="Note">
    <note target="#T.1-n1">first</note>
    <note>general</note>
  </standOff>
  <standOff corresp="#T.1b" type="Note">
    <note target="#T.1-n2">other</note>
  </standOff>`), r.content);
});

test('split in witnesses: a paragraph, all in one part, absent', () => {
  const w = tei('<p xml:id="T.1">aaa <del>bbb</del>\n   ccc ddd</p>');
  let f = file(w);
  let r = R.splitInFile({...f, id: 'T.1', secondId: 'T.1b', offset: R.snapOffset(R.findPassage(f.doc, 'T.1'), 7)});
  assert.equal(r.content, w.replace('\n   ccc', '\n   </p>\n<p xml:id="T.1b">ccc'));
  r = R.splitInFile({...f, id: 'T.1', secondId: 'T.1b', offset: 0});
  assert.equal(r.status, 'renamed');
  assert.equal(r.content, w.replace('T.1', 'T.1b'));
  r = R.splitInFile({...f, id: 'T.1', secondId: 'T.1b', offset: 999});
  assert.equal(r.status, 'unchanged');
  r = R.splitInFile({...f, id: 'T.1', firstId: 'T.1a', secondId: 'T.1b', offset: 999});
  assert.equal(r.content, w.replace('T.1', 'T.1a'));
  const c = tei('<p corresp="#T.1">aaa bbb</p>');
  f = file(c);
  r = R.splitInFile({...f, id: 'T.1', secondId: 'T.1b', offset: 4});
  assert.equal(r.content, c.replace('aaa bbb</p>', 'aaa </p>\n<p corresp="#T.1b">bbb</p>'));
  assert.equal(R.splitInFile({...file(tei('<p xml:id="T.9">z</p>')), id: 'T.1', secondId: 'T.1b', offset: 1}).status, 'unchanged');
});

test('split refuses bad ids and a point at the edge of the edition text', () => {
  const f = file(ED);
  assert.throws(() => R.splitInFile({...f, id: 'T.2', secondId: 'T.3', offset: 5, edition: true}), /already used/);
  assert.throws(() => R.splitInFile({...f, id: 'T.2', secondId: 'T 2b', offset: 5, edition: true}), /cannot be an xml:id/);
  assert.throws(() => R.splitInFile({...f, id: 'T.2', secondId: 'T.2', offset: 5, edition: true}), /different ids|new id/);
  assert.throws(() => R.splitInFile({...f, id: 'T.2', secondId: 'T.2b', offset: 0, edition: true}), /inside the text/);
  assert.throws(() => R.splitInFile({...f, id: 'T.2', secondId: 'T.2b', offset: 9999, edition: true}), /inside the text/);
});

test('split then merge gives back the same text, in a real edition and its witnesses', () => {
  const dir = path.join(FIXTURES, 'sushruta-sarira/section');
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'editor.config.json'), 'utf8'));
  const key = el => el.textContent.replace(/\s+/g, '');
  for (const name of [cfg.edition, ...cfg.witnesses]) {
    const f = file(fs.readFileSync(path.join(dir, name), 'utf8'));
    const el = R.findPassage(f.doc, 'SS.3.1.4');
    if (!el) continue;
    const offset = Math.floor(R.textLength(el) / 2);
    const s = R.splitInFile({...f, id: 'SS.3.1.4', secondId: 'SS.3.1.4b', offset, edition: name === cfg.edition, name});
    assert.equal(s.status, 'split', name);
    assert.equal(s.content.length > f.raw.length, true);
    const m = R.mergeInFile({...file(s.content), ids: ['SS.3.1.4', 'SS.3.1.4b'], edition: name === cfg.edition, name});
    assert.equal(m.status, 'merged', name);
    assert.equal(key(R.findPassage(m.doc, 'SS.3.1.4')), key(el), name);
    // merging two real neighbours
    const mm = R.mergeInFile({...f, ids: ['SS.3.1.3', 'SS.3.1.4'], edition: name === cfg.edition, name});
    assert.equal(key(R.findPassage(mm.doc, 'SS.3.1.3')), key(R.findPassage(f.doc, 'SS.3.1.3')) + key(el), name);
  }
});

test('the alignment suggests where to cut each witness', () => {
  const dir = path.join(FIXTURES, 'sushruta-sarira/section');
  const xml = fs.readFileSync(path.join(dir, 'alignments/SS.3.1.1.xml'), 'utf8');
  const ed = file(fs.readFileSync(path.join(dir, 'provisional-edition_sarirasthana_new.xml'), 'utf8'));
  const el = R.findPassage(ed.doc, 'SS.3.1.1');
  const ignore = new Set(['trailer', 'note', 'anchor']);
  const all = R.textNodesOf(el).map(t => t.data).join('');
  const offset = all.indexOf('śārīraṃ');
  const count = R.offsetToCount(el, offset, ignore);
  assert.equal(count, 'athātaḥsarvvabhūtacintāṃ'.length);
  assert.equal(R.countToOffset(el, count, ignore) <= offset, true);
  assert.equal(R.snapOffset(el, R.countToOffset(el, count, ignore)), offset);
  const parts = R.alignedParts(xml, 'NE', count);
  assert.equal(parts.get('NE').before, 'athātaḥsarvvabhūtacintāṃ');
  for (const [siglum, name] of [['A', '03-za-vulgate-1938.xml'], ['H', 'nak_5-333_sarirasthana.xml'], ['N', 'nak_1-1079_sarirasthana.xml']]) {
    const w = file(fs.readFileSync(path.join(dir, name), 'utf8'));
    const wel = R.findPassage(w.doc, 'SS.3.1.1');
    const at = R.locateParts(wel, parts.get(siglum), ignore);
    assert.match(R.textNodesOf(wel).map(t => t.data).join('').slice(at.offset), /^[śs]ārīra/, siglum);
  }
  // text that the alignment does not have (deleted letters) does not throw the place off
  const d = file(tei('<p xml:id="T.1">aaa <del>xyz</del> bbb <del>ccc</del>ccc ddd</p>'));
  const del = R.findPassage(d.doc, 'T.1');
  let at = R.locateParts(del, {before: 'aaabbb', after: 'cccddd'});
  assert.deepEqual(at, {offset: 'aaa xyz bbb '.length, sure: false});      // the deleted ccc lies in between: said to be unsure
  at = R.locateParts(del, {before: 'aaa', after: 'bbbcccddd'}, new Set(['del']));
  assert.deepEqual(at, {offset: 'aaa xyz '.length, sure: true});        // an ignored deletion stays with the first part
  at = R.locateParts(del, {before: 'aaabbbccc', after: 'ddd'}, new Set(['del']));
  assert.deepEqual(at, {offset: 'aaa xyz bbb cccccc '.length, sure: true});
  assert.equal(R.locateParts(del, {before: 'qqq', after: 'zzz'}), null);
});
