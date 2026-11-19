// The rows of an alignment are not always named after their witnesses: a witness with scribal corrections
// in the passage (<add>, <del>) is collated as two rows, e.g. "Hac" and "Hpc". The editor asks, before it
// uses a stored alignment, whether every witness that has the passage is in it; a witness present only
// under such names was taken to be missing, so the stored (even the hand-corrected) alignment was set
// aside and the passage collated afresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSection, FIXTURES, collate } from './harness.mjs';

const dir = path.join(FIXTURES, 'sushruta-sarira/section');
const FILES = {A: '03-za-vulgate-1938.xml', K: 'kl_699_sarirasthana.xml', N: 'nak_1-1079_sarirasthana.xml',
  H: 'nak_5-333_sarirasthana.xml', L: 'pul_7082_sarirasthana.xml'};

test('a witness collated as "ac" and "pc" rows is found in the alignment', async () => {
  const sec = loadSection(dir);
  const {alignXML} = await sec.collator.align('SS.3.4.90cd');
  const res = sec.collator.apparatus('SS.3.4.90cd', alignXML);
  // H has a correction in this passage: two rows, and none called "H"
  assert.deepEqual([...res.rows].sort(), ['A', 'Hac', 'Hpc', 'NE']);
  assert.deepEqual(res.rowWits.filter(r => r.name.startsWith('H')), [
    {name: 'Hac', siglum: 'H', file: FILES.H}, {name: 'Hpc', siglum: 'H', file: FILES.H}]);
  const has = (siglum, file = FILES[siglum]) => collate.alignmentHasWitness(res, {siglum, file});
  assert.ok(has('H'), 'H is in the alignment, as Hac and Hpc');
  assert.ok(has('H', null), 'found by its siglum alone');
  assert.ok(has('otherwise named', FILES.H), 'found by its file alone');
  assert.ok(has('A'));
  // witnesses that are really not in it
  assert.ok(!has('K') && !has('N') && !has('L'));
});

test('witnesses named as usual are found as before', () => {
  const sec = loadSection(dir);
  const res = sec.collator.apparatus('SS.3.1.1', sec.alignment('SS.3.1.1'));
  assert.deepEqual([...res.rows].sort(), ['A', 'H', 'K', 'N', 'NE']);
  for (const s of ['A', 'H', 'K', 'N']) assert.ok(collate.alignmentHasWitness(res, {siglum: s, file: FILES[s]}), s);
  assert.ok(!collate.alignmentHasWitness(res, {siglum: 'L', file: FILES.L}));
});
