// "remove avagrahas" and "avagrahas to short a" (or "double avagrahas") cannot both apply. Saktumiva runs
// the ticked normalizations in list order, so "avagrahas to short a" used to win silently: anye 'tra / anye tra
// became anye atra / anye tra, a variant, although "remove avagrahas" was ticked. Now "remove avagrahas" wins,
// and the settings screen says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSection, FIXTURES, collate, teiutil } from './harness.mjs';

const dir = path.join(FIXTURES, 'sushruta-sarira', 'section');
const BASE = ['ignore punctuation', 'superfluous avagrahas'];
const section = extra => loadSection(dir, {collation: {filters: [...BASE, ...extra]}});
const eqOf = sec => sec.collator._appOpts('SS.3.1.1', teiutil.parseXML(sec.alignment('SS.3.1.1'), 'alignment')).equivalent;
const names = c => c.filtersnames;

test("only 'avagrahas to short a': 'tra and tra differ (atra / tra)", () => {
  const sec = section(['double avagrahas', 'avagrahas to short a']);
  assert.ok(!eqOf(sec)('H', "'tra", 'tra', "'tra", 'tra'));
  assert.deepEqual(collate.conflictMessages(sec.collator.selectedIndices), []);
});

test("only 'remove avagrahas': 'tra and tra agree", () => {
  const sec = section(['remove avagrahas']);
  assert.ok(eqOf(sec)('H', "'tra", 'tra', "'tra", 'tra'));
  assert.deepEqual(collate.conflictMessages(sec.collator.selectedIndices), []);
});

test("both ticked: 'remove avagrahas' wins", () => {
  const sec = section(['avagrahas to short a', 'remove avagrahas']), c = sec.collator;
  assert.ok(eqOf(sec)('H', "'tra", 'tra', "'tra", 'tra'));
  assert.ok(names(c).includes('remove avagrahas') && !names(c).includes('avagrahas to short a'));
  // what is ticked is remembered for the settings screen
  const ticked = c.selectedIndices.map(i => collate.filterCatalogue[i].name);
  assert.ok(ticked.includes('avagrahas to short a') && ticked.includes('remove avagrahas'));
  // a real variant stays one
  assert.ok(!eqOf(sec)('H', "'tra", 'tatra', "'tra", 'tatra'));
});

test("'double avagrahas' gives way too: ''tmā and tmā agree", () => {
  const sec = section(['double avagrahas', 'avagrahas to short a', 'remove avagrahas']);
  assert.ok(eqOf(sec)('H', "''tmā", 'tmā', "''tmā", 'tmā'));
  assert.deepEqual(names(sec.collator).filter(n => /avagraha/.test(n)), ['superfluous avagrahas', 'remove avagrahas']);
});

test('the settings screen is told about the conflict', () => {
  const one = collate.conflictMessages(section(['avagrahas to short a', 'remove avagrahas']).collator.selectedIndices);
  assert.equal(one.length, 1);
  assert.match(one[0], /“remove avagrahas” is ticked together with “avagrahas to short a”/);
  assert.match(one[0], /“avagrahas to short a” is not applied/);
  const two = collate.conflictMessages(section(['double avagrahas', 'avagrahas to short a', 'remove avagrahas']).collator.selectedIndices);
  assert.match(two[0], /“double avagrahas” and “avagrahas to short a” are not applied/);
});

test('an alignment made with "avagrahas to short a" is collated again once "remove avagrahas" overrides it', () => {
  // the stored alignment of the fixture was made with "double avagrahas" and "avagrahas to short a"
  const doc = teiutil.parseXML(section([]).alignment('SS.3.1.1'), 'alignment');
  const both = ['double avagrahas', 'avagrahas to short a'];
  assert.doesNotMatch(section(both).collator.compatible(doc).why.join(), /avagraha/);
  const now = section([...both, 'remove avagrahas']).collator.compatible(doc);
  assert.equal(now.ok, false);
  assert.match(now.why.join(), /double avagrahas, avagrahas to short a/);
});
