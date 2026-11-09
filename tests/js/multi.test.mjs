// Choosing several passages in the passage list (app/multi.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const { clickSelect, rangeBetween, sortByDoc, selectionLabel, encodeSession, decodeSession } =
  await import(pathToFileURL(path.join(ROOT, 'src/saktumiva_editor/app/multi.mjs')).href);

const ORDER = ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.3', 'SS.3.1.4', 'SS.3.1.5', 'SS.3.2.1'];

test('a plain click shows one passage', () => {
  const r = clickSelect({selection: ['SS.3.1.1', 'SS.3.1.2'], anchor: 'SS.3.1.1', order: ORDER, id: 'SS.3.1.4'});
  assert.deepEqual(r, {selection: ['SS.3.1.4'], anchor: 'SS.3.1.4', focus: 'SS.3.1.4'});
});

test('Shift-click selects the range from the anchor, in either direction', () => {
  let r = clickSelect({selection: ['SS.3.1.2'], anchor: 'SS.3.1.2', order: ORDER, id: 'SS.3.1.5', shift: true});
  assert.deepEqual(r.selection, ['SS.3.1.2', 'SS.3.1.3', 'SS.3.1.4', 'SS.3.1.5']);
  assert.equal(r.anchor, 'SS.3.1.2');
  // a second Shift-click replaces the range, from the same anchor
  r = clickSelect({...r, order: ORDER, id: 'SS.3.1.1', shift: true});
  assert.deepEqual(r.selection, ['SS.3.1.1', 'SS.3.1.2']);
  assert.deepEqual(rangeBetween(ORDER, 'SS.3.2.1', 'SS.3.1.4'), ['SS.3.1.4', 'SS.3.1.5', 'SS.3.2.1']);
});

test('Ctrl/Cmd-click adds and removes single passages, kept in document order', () => {
  let r = clickSelect({selection: ['SS.3.1.4'], anchor: 'SS.3.1.4', order: ORDER, id: 'SS.3.1.1', toggle: true});
  assert.deepEqual(r.selection, ['SS.3.1.1', 'SS.3.1.4']);
  r = clickSelect({...r, order: ORDER, id: 'SS.3.2.1', toggle: true});
  assert.deepEqual(r.selection, ['SS.3.1.1', 'SS.3.1.4', 'SS.3.2.1']);
  r = clickSelect({...r, order: ORDER, id: 'SS.3.1.4', toggle: true});
  assert.deepEqual(r.selection, ['SS.3.1.1', 'SS.3.2.1']);
  // taking out the last one leaves that passage shown alone, never nothing
  r = clickSelect({selection: ['SS.3.1.1'], anchor: 'SS.3.1.1', order: ORDER, id: 'SS.3.1.1', toggle: true});
  assert.deepEqual(r.selection, ['SS.3.1.1']);
});

test('Ctrl+Shift-click adds a range to the selection', () => {
  const r = clickSelect({selection: ['SS.3.1.1', 'SS.3.1.2'], anchor: 'SS.3.1.4', order: ORDER, id: 'SS.3.1.5', shift: true, toggle: true});
  assert.deepEqual(r.selection, ['SS.3.1.1', 'SS.3.1.2', 'SS.3.1.4', 'SS.3.1.5']);
});

test('a range in a filtered list takes only the rows shown', () => {
  const shown = ['SS.3.1.1', 'SS.3.1.3', 'SS.3.1.5'];
  const r = clickSelect({selection: ['SS.3.1.1'], anchor: 'SS.3.1.1', order: shown, all: ORDER, id: 'SS.3.1.5', shift: true});
  assert.deepEqual(r.selection, shown);
});

test('labels and session memory', () => {
  assert.equal(selectionLabel(['SS.3.1.2', 'SS.3.1.3', 'SS.3.1.4'], ORDER), 'SS.3.1.2 – SS.3.1.4');
  assert.equal(selectionLabel(['SS.3.1.1', 'SS.3.1.4'], ORDER), 'SS.3.1.1, SS.3.1.4');
  assert.equal(selectionLabel(['SS.3.1.1', 'SS.3.1.3', 'SS.3.1.4', 'SS.3.1.5', 'SS.3.2.1'], ORDER), 'SS.3.1.1, SS.3.1.3, SS.3.1.4 … SS.3.2.1');
  assert.deepEqual(sortByDoc(['SS.3.2.1', 'x', 'SS.3.1.1', 'SS.3.1.1'], ORDER), ['SS.3.1.1', 'SS.3.2.1']);
  const saved = encodeSession({several: true, selection: ['SS.3.1.3', 'SS.3.1.2', 'gone']});
  assert.deepEqual(decodeSession(saved, ORDER), {several: true, selection: ['SS.3.1.2', 'SS.3.1.3']});
  assert.deepEqual(decodeSession(null, ORDER), {several: false, selection: []});
  assert.deepEqual(decodeSession('{bad', ORDER), {several: false, selection: []});
});
