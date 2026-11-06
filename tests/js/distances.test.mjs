// Data export → distances between whole witnesses (app/distances.mjs, Collator.wholeTexts).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FIXTURES, loadSection } from './harness.mjs';
import { computeDistances, distancesNexus } from '../../src/saktumiva_editor/app/distances.mjs';

const tok = s => [...s.replace(/\s/g, '')];
const A = 'athāto vedotpattim adhyāyaṃ vyākhyāsyāmaḥ yathovāca bhagavān dhanvantariḥ';
const texts = [['A', tok(A)], ['B', tok(A.replace('vedotpattim', 'vedotpattiṃ nāma'))], ['C', tok(A)],
               ['D', tok('atha khalu bhagavantam amaravaram ṛṣigaṇaparivṛtam āśramastham')]];

test('each measure gives a distance matrix: symmetric, 0 on the diagonal, the copies closest', () => {
  for (const measure of ['ngrams', 'ncd', 'bpe']) {
    const d = computeDistances(texts, {measure, ngramSize: 2, bpeIterations: 30});
    assert.equal(d.length, 4, measure);
    for (let i = 0; i < 4; i++) {
      assert.equal(d[i][i], 0, measure);
      for (let j = 0; j < 4; j++) { assert.equal(d[i][j], d[j][i], measure); assert.ok(d[i][j] >= 0 && Number.isFinite(d[i][j]), measure); }
    }
    const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].sort((p, q) => d[p[0]][p[1]] - d[q[0]][q[1]]);
    assert.deepEqual(pairs[0], [0, 2], `${measure}: A and C are the same text`);
    assert.ok(d[0][3] > d[0][1], `${measure}: D, a different sentence, is further than B`);
  }
});

test('the NEXUS distances block', () => {
  const text = distancesNexus(["A", "B'x", 'C'], [[0, 0.25, 1 / 3], [0.25, 0, 0.5], [1 / 3, 0.5, 0]], {title: 'test [1]'});
  assert.match(text, /^#NEXUS\n\[test 1\]\n/);
  assert.match(text, /DIMENSIONS NTAX=3;\n {2}TAXLABELS 'A' 'B''x' 'C';/);
  assert.match(text, /BEGIN DISTANCES;\n {2}FORMAT TRIANGLE=BOTH;\n {2}MATRIX\n/);
  const rows = text.split('MATRIX\n')[1].split('\n  ;')[0].split('\n').map(l => l.trim());
  assert.deepEqual(rows, ["'A'    0 0.25 0.333333", "'B''x' 0.25 0 0.5", "'C'    0.333333 0.5 0"]);
});

test('whole texts of a section, passage by passage, ante or post correctionem', () => {
  const {collator, edDoc} = loadSection(path.join(FIXTURES, 'rasendramangala-ch1/section'));
  const blocks = [...edDoc.getElementsByTagNameNS('*', '*')].filter(e => ['p', 'lg', 'l'].includes(e.localName))
    .map(e => e.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')).filter(Boolean);
  assert.ok(blocks.length > 10);
  const corrected = [...collator.state.alltexts].filter(([, v]) => v.type === 'ac').map(([, v]) => v.par);
  assert.ok(corrected.length, 'the fixture has a witness with corrections');
  const sig = corrected[0], plain = [...collator.state.alltexts].find(([, v]) => !['ac', 'pc'].includes(v.type))[0];
  const ac = collator.wholeTexts(blocks, [sig, plain], 'ac'), pc = collator.wholeTexts(blocks, [sig, plain], 'pc');
  assert.deepEqual([...ac.keys()], [sig, plain]);
  assert.ok(ac.get(plain).size > 10);
  assert.deepEqual([...ac.get(plain)], [...pc.get(plain)]);                 // no corrections: the same either way
  assert.deepEqual([...ac.get(sig).keys()], [...pc.get(sig).keys()]);       // the same passages …
  const differ = [...ac.get(sig).keys()].filter(b => ac.get(sig).get(b).join('') !== pc.get(sig).get(b).join(''));
  assert.ok(differ.length, '… but where there are corrections, different texts');
  for (const [b, t] of ac.get(sig)) { assert.ok(blocks.includes(b)); assert.ok(Array.isArray(t) && t.length); }
  // the witnesses' texts are not changed by reading them
  const again = collator.wholeTexts(blocks, [sig], 'ac').get(sig);
  assert.deepEqual([...again].map(([b, t]) => [b, t.join('')]), [...ac.get(sig)].map(([b, t]) => [b, t.join('')]));
});
