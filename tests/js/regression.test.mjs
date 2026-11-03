// Regression tests: the editor's collation and apparatus, with the pinned Saktumiva, on real sections.
// The results are compared with tests/golden/. After an intended change (e.g. a Saktumiva update
// that improves the apparatus) run  npm run update-golden  and review the diff of tests/golden/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSection, FIXTURES, serialize, stable, compareGolden, patchProblems, teiutil } from './harness.mjs';

const summary = res => ({
  error: res.error || null,
  listApp: serialize(res.listApp),
  listWit: serialize(res.listWit),
  warnings: res.warnings || [],
  mismatch: !!res.mismatch, witMismatch: !!res.witMismatch,
  rows: res.rows || []
});

test("the editor's patches fit this Saktumiva", () => {
  assert.deepEqual(patchProblems, [], 'Saktumiva has changed where the editor patches it: update saktumiva-patches.json');
});

for (const name of fs.readdirSync(FIXTURES).filter(n => fs.existsSync(path.join(FIXTURES, n, 'fixture.json')))) {
  const spec = JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'fixture.json'), 'utf8'));
  const dir = path.join(FIXTURES, name, 'section');

  test(name, async t => {
    const sec = loadSection(dir);

    for (const block of spec.stored || [])
      await t.test(`${block}: apparatus from the stored alignment`, t => {
        const xml = sec.alignment(block);
        assert.ok(xml, `alignments/${block}.xml is missing`);
        compareGolden(t, `${name}/${block}.stored`, summary(sec.collator.apparatus(block, xml)), assert);
      });

    if (spec.scriptNotes?.length) {
      const off = loadSection(dir, {apparatus: {...sec.cfg.apparatus, scriptNotes: false}});
      for (const block of spec.scriptNotes)
        await t.test(`${block}: the witnesses' script notes change the apparatus`, () => {
          const xml = sec.alignment(block);
          assert.notEqual(serialize(sec.collator.apparatus(block, xml).listApp), serialize(off.collator.apparatus(block, xml).listApp),
            'switching script notes off made no difference: is the opts.equivalent patch still applied?');
        });
    }

    for (const block of spec.fresh || [])
      await t.test(`${block}: fresh collation and apparatus`, async t => {
        const res = await sec.collator.align(block);
        assert.ok(res?.alignXML, `no alignment for ${block}: ${res?.reason || ''}`);
        compareGolden(t, `${name}/${block}.fresh`,
          {alignment: stable(res.alignXML), apparatus: summary(sec.collator.apparatus(block, res.alignXML))}, assert);
      });

    if (spec.publish?.length)
      await t.test('apparatus written by Publish', async t => {
        const doc = sec.edDoc.cloneNode(true);
        const warnings = {};
        for (const block of spec.publish) {
          const xml = sec.alignment(block) || (await sec.collator.align(block)).alignXML;
          warnings[block] = sec.collator.publishInto(doc, block, xml, `alignments/${block}.xml`);
        }
        const standOffs = [...doc.getElementsByTagNameNS(teiutil.TEI_NS, 'standOff')]
          .filter(so => so.getAttribute('type') === 'apparatus').map(so => stable(serialize(so)));
        const listWit = serialize(doc.getElementsByTagNameNS(teiutil.TEI_NS, 'listWit')[0]);
        compareGolden(t, `${name}/publish`, {standOffs, listWit, warnings}, assert);
      });
  });
}
