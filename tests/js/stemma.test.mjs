// The Stemma view (app/stemma.mjs): reading the NeXML stemmata of a teiHeader, laying them out and drawing them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIR = path.join(ROOT, 'tests/fixtures/stemma');
const { DOMParser } = new JSDOM('').window;
const { findStemmata, parseTree, layoutTree, renderSVG, niceStep, sigla } =
  await import(pathToFileURL(path.join(ROOT, 'src/saktumiva_editor/app/stemma.mjs')).href);

const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const load = name => parse(fs.readFileSync(path.join(name.includes('/') ? ROOT : DIR, name), 'utf8'));
const shape = n => n.children.length ? {[n.label || '·']: n.children.map(shape)} : n.label;
const byLabel = lay => Object.fromEntries(lay.nodes.filter(r => r.node.label).map(r => [r.node.label, r]));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

test('SplitsTree6 stemma: the witness at the root is drawn as a leaf', () => {
  const {stemmata, commented} = findStemmata(load('splitstree6.xml'));
  assert.equal(commented, 0);
  assert.equal(stemmata.length, 1);
  const [st] = stemmata;
  assert.equal(st.title, 'Stemma 1');          // no id on the <stemma>, and the tree is only called "tree1"
  assert.equal(st.error, undefined);
  assert.equal(st.tree.lengths, 'all');
  assert.deepEqual(shape(st.tree.root), {H: [{'·': ['K', 'N']}]});
  assert.deepEqual(shape(st.tree.leafRoot), {'·': ['H', 'K', 'N']});
  assert.deepEqual(sigla(st.tree.leafRoot), ['H', 'K', 'N']);

  const lay = layoutTree(st.tree.leafRoot);
  assert.ok(lay.proportional);
  const L = byLabel(lay);
  close(L.H.depth, 0.0057309819385409355);
  close(L.K.depth, 0.0046311914920806885);
  close(L.N.depth, 0.015896709635853767);
  assert.equal(lay.maxDepth, L.N.depth);
  assert.deepEqual([L.H.x, L.K.x, L.N.x], [0, 1, 2]);
  assert.equal(lay.nodes[0].x, 1);              // the unnamed node above them, in the middle

  const gen = layoutTree(st.tree.leafRoot, {proportional: false});
  assert.ok(!gen.proportional);
  assert.deepEqual(Object.values(byLabel(gen)).map(r => r.depth), [1, 1, 1]);
  // as rooted in the file: H at the top, a generation above the others
  assert.deepEqual(Object.values(byLabel(layoutTree(st.tree.root, {proportional: false}))).map(r => [r.node.label, r.depth]),
    [['H', 0], ['K', 2], ['N', 2]]);
});

test('a stemma inside a comment is noticed but not read (the Sūtrasthāna file as it is now)', () => {
  assert.deepEqual(findStemmata(load('commented.xml')), {stemmata: [], commented: 1});
});

test('Bio::Phylo stemma (Rasendramaṅgala): inner nodes labelled with their ids are unnamed', () => {
  const {stemmata} = findStemmata(load('tests/fixtures/rasendramangala-ch1/section/provisional_edition_ch1.txt'));
  assert.equal(stemmata.length, 1);
  const t = stemmata[0].tree;
  assert.equal(t.lengths, 'all');
  assert.equal(t.leafRoot, null);
  assert.deepEqual(shape(t.root), {'·': ['A2', 'Pa', {'·': ['A1', {'·': ['L', {'·': ['P', 'Ko1']}]}]}]});
  const L = byLabel(layoutTree(t.root));
  close(L.P.depth, 0.00945917827124318 + 0.010748281735322968 + 8.284803049613595E-4 + 0.008652807717852384);
  assert.deepEqual(Object.keys(L), ['A2', 'Pa', 'A1', 'L', 'P', 'Ko1']);
});

test('an edition without a stemma', () => {
  const doc = load('tests/fixtures/sushruta-sarira/section/provisional-edition_sarirasthana_new.xml');
  assert.deepEqual(findStemmata(doc), {stemmata: [], commented: 0});
  assert.deepEqual(findStemmata(parse('<TEI xmlns="http://www.tei-c.org/ns/1.0"><text/></TEI>')), {stemmata: [], commented: 0});
});

test('several stemmata, several trees, and those that cannot be drawn', () => {
  const {stemmata} = findStemmata(load('several.xml'));
  assert.deepEqual(stemmata.map(s => [s.key, s.title, s.error || 'ok']), [
    ['0.0', 'stemma0 · guidetree', 'ok'],
    ['1.0', 'stemma1 · without lengths', 'ok'],
    ['1.1', 'stemma1 · A copied from C', 'ok'],
    ['1.2', 'stemma1 · net', 'this is a network, not a tree; only trees can be drawn'],
    ['2', 'stemma2', 'format="newick" cannot be drawn (only format="nexml")']]);

  // Saktumiva's guide tree: its node labels are right even though their otu references are not
  const guide = stemmata[0].tree;
  assert.deepEqual(shape(guide.root), {'·': [{'·': ['A1938', 'N']}, {'·': ['H', 'NE']}]});
  assert.equal(guide.leafRoot, null);
  const G = byLabel(layoutTree(guide.root));
  close(G.H.depth, 0.22724410704895176);         // zero-length branches: H and NE sit at their parent
  close(G.NE.depth, G.H.depth);

  // no lengths at all: one step per generation, whatever is asked; labels from the otus
  const clad = stemmata[1].tree;
  assert.equal(clad.lengths, 'none');
  assert.deepEqual(shape(clad.root), {'·': [{'·': ['A', 'B<1>']}, 'C']});
  const lay = layoutTree(clad.root, {proportional: true});
  assert.ok(!lay.proportional);
  assert.deepEqual(Object.values(byLabel(lay)).map(r => [r.node.label, r.depth]), [['A', 2], ['B<1>', 2], ['C', 1]]);

  // a witness as an inner node (an exemplar), and a negative length drawn as 0
  const ex = stemmata[2].tree;
  assert.equal(ex.negative, 1);
  assert.equal(ex.leafRoot, null);
  const E = byLabel(layoutTree(ex.root));
  assert.equal(E.C.leaf, false);
  close(E.A.depth, 0.3); close(E.C.depth, 0.2); assert.equal(E.B.depth, 0);
});

test('NeXML that is not a tree is refused with a reason', () => {
  const tree = body => parse(`<tree xmlns="${'http://www.nexml.org/2009'}">${body}</tree>`).documentElement;
  assert.throws(() => parseTree(tree('')), /no nodes/);
  assert.throws(() => parseTree(tree('<node id="a"/><edge source="a" target="z" length="1"/>')), /node that does not exist \(z\)/);
  assert.throws(() => parseTree(tree('<node id="a"/><node id="b"/><node id="c"/><edge source="a" target="b"/><edge source="b" target="c"/><edge source="c" target="a"/>')), /do not make a tree/);
  assert.throws(() => parseTree(tree('<node id="a"/><node id="b"/><node id="c"/><edge source="a" target="b"/><edge source="b" target="a"/>')), /not all nodes are connected/);
  // edges pointing away from the root (an unrooted tree read from any node) are followed all the same
  const t = parseTree(tree('<node id="a" label="A"/><node id="m" root="true"/><node id="b" label="B"/><edge source="a" target="m" length="1"/><edge source="b" target="m" length="2"/>'));
  assert.deepEqual(shape(t.root), {'·': ['A', 'B']});
});

test('the drawing', () => {
  const {stemmata} = findStemmata(load('several.xml'));
  const svgDoc = text => {
    const d = parse(text);
    assert.equal(d.getElementsByTagName('parsererror').length, 0, 'well-formed');
    return d.documentElement;
  };
  // proportional, with a scale bar; standalone (for Download SVG): its own namespace and style
  const guide = layoutTree(stemmata[0].tree.root);
  const s1 = svgDoc(renderSVG(guide, {standalone: true, describe: sig => sig === 'N' ? 'MS Kathmandu NAK 1-1079' : ''}));
  assert.equal(s1.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(s1.getElementsByTagName('style').length, 1);
  assert.deepEqual([...s1.getElementsByTagName('text')].map(t => t.firstChild.data), ['A1938', 'N', 'H', 'NE', '0.1']);
  const label = sig => [...s1.getElementsByTagName('text')].find(t => t.firstChild.data === sig);
  assert.equal(label('N').getElementsByTagName('title')[0]?.textContent, 'MS Kathmandu NAK 1-1079');   // what the siglum stands for
  assert.equal(label('A1938').getElementsByTagName('title').length, 0);
  assert.equal(s1.getElementsByClassName('st-branch').length, 6);
  assert.match(s1.querySelector('.st-branch title').textContent, /^branch to node: 0\.227$/);
  assert.ok([...s1.getElementsByClassName('st-edge')].every(p => /^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/.test(p.getAttribute('d'))));
  const [, , w, hgt] = s1.getAttribute('viewBox').split(' ').map(Number);
  assert.ok(w >= 260 && hgt > 200 && Number.isFinite(w + hgt));
  // right angles, by generation: no scale bar; labels are escaped; inline (styled by the page) has no <style>
  const clad = renderSVG(layoutTree(stemmata[1].tree.root, {proportional: false}), {lines: 'square'});
  const s2 = svgDoc(clad);
  assert.equal(s2.getElementsByClassName('st-scale').length, 0);
  assert.equal(s2.getElementsByTagName('style').length, 0);
  assert.ok(clad.includes('>B&lt;1&gt;<'));
  assert.ok([...s2.getElementsByClassName('st-edge')].every(p => /^M[\d.]+,[\d.]+H[\d.]+V[\d.]+$/.test(p.getAttribute('d'))));
  // a witness that is an inner node: a dot with its siglum beside it
  const s3 = svgDoc(renderSVG(layoutTree(stemmata[2].tree.root)));
  assert.equal(s3.getElementsByClassName('st-wit').length, 1);
  assert.equal(s3.querySelector('.st-inner').textContent, 'C');
  assert.match([...s3.querySelectorAll('.st-branch title')].map(t => t.textContent).join('|'), /branch to B: -0\.05 \(drawn as 0\)/);
});

test('scale bar steps are round numbers', () => {
  assert.equal(niceStep(0.015896709635853767), 0.002);
  assert.equal(niceStep(0.7172850969166237), 0.1);
  assert.equal(niceStep(1), 0.2);
  assert.equal(niceStep(30), 5);
});
