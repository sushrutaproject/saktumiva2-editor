// "Variants to leave out of the apparatus": readings that differ only by the selected normalizations
// must count as agreeing with the lemma, even where the normalized forms stored in the alignment
// (its lemma attributes) came out wrong, as with garbbha/garbha (b|bha normalized to v|bha).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSection, FIXTURES, teiutil } from './harness.mjs';

const dir = path.join(FIXTURES, 'sushruta-sarira', 'section');
const sec = loadSection(dir, {collation: {filters: ['ignore punctuation', 'b to v', 'geminated aspirated consonants',
  'geminated consonants after r', 'final nasal variants', 'internal nasal variants', 'final anusvāra variants',
  'internal visarga variants', 'remove spaces']}});
const alignDoc = teiutil.parseXML(sec.alignment('SS.3.1.1'), 'alignment');
const eq = sec.collator._appOpts('SS.3.1.1', alignDoc).equivalent;

test('the comparison hook is installed', () => assert.equal(typeof eq, 'function'));

for (const [wit, base, why] of [
  ['garbhagṛhāṇi', 'garbbhagṛhāṇi', 'geminate after r'],
  ['prādurbhāvaḥ', 'prādurbbhāvaḥ', 'geminate after r'],
  ['sarpistailam', 'sarppistailam', 'geminate after r'],
  ['śiraḥśuddhyarthaṃ', 'śiraḥśuddhyartham', 'final m / ṃ'],
  ['śoṇitārśassu', 'śoṇitārśaḥsu', 'internal visarga'],
])
  test(`${base} = ${wit} (${why})`, () =>
    // normalized forms as a faulty alignment stores them (garvbha…) differ; the readings' own text decides
    assert.ok(eq('A', wit + 'x', base + 'y', wit, base)));

test('a real variant stays a variant', () => {
  assert.ok(!eq('A', 'majjabhiḥ', 'majjābhiḥ', 'sarpistailavasāmajjabhiḥ', 'sarppistailavasāmajjābhiḥ'));
  assert.ok(!eq('A', 'garbha', 'gandha', 'garbha', 'gandha'));
});
