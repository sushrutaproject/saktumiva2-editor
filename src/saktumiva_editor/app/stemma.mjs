// Stemmata in the TEI header: <xenoData><stemma format="nexml"><nex:nexml>…</nex:nexml></stemma></xenoData>,
// as written by SplitsTree6 or by Saktumiva itself (lib/collate.mjs, matrix-editor). Reads every tree in every
// stemma and draws it top-down, as a stemma codicum: the root at the top, the witnesses' sigla at the leaves.
// No DOM is needed for the drawing (renderSVG returns a string), so the same code can serve a web page too.

export const NEXML_NS = 'http://www.nexml.org/2009';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const byName = (root, name) => [...root.getElementsByTagNameNS('*', name)];
const kids = (el, name) => [...el.children].filter(c => c.localName === name);
const idOf = el => el.getAttributeNS(XML_NS, 'id') || el.getAttribute('xml:id') || el.getAttribute('id') || el.getAttribute('n') || '';

// ---------------------------------------------------------------- reading
// -> {stemmata: [{key, title, stemmaId, treeId, tree} | {key, title, error}], commented: n}
// `commented` counts <stemma> elements that are inside an XML comment (<!-- … -->) and so are not read.
export function findStemmata(doc) {
  const root = doc.documentElement;
  const header = (root && kids(root, 'teiHeader')[0]) || byName(doc, 'teiHeader')[0];
  const out = {stemmata: [], commented: 0};
  if (!header) return out;
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 8) out.commented += (c.data.match(/<stemma[\s>]/g) || []).length;
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(header);
  byName(header, 'stemma').forEach((st, si) => {
    const sid = idOf(st);
    const base = sid || `Stemma ${si + 1}`;
    const format = (st.getAttribute('format') || '').trim().toLowerCase();
    if (format !== 'nexml') {
      out.stemmata.push({key: `${si}`, title: base, error: `format="${st.getAttribute('format') || ''}" cannot be drawn (only format="nexml")`});
      return;
    }
    const nexml = byName(st, 'nexml')[0];
    if (!nexml) { out.stemmata.push({key: `${si}`, title: base, error: 'no <nexml> inside the <stemma>'}); return; }
    const otuLabel = new Map(byName(nexml, 'otu').map(o => [o.getAttribute('id'), (o.getAttribute('label') || '').trim()]));
    const trees = byName(nexml, 'trees').flatMap(t => [...t.children].filter(c => c.localName === 'tree' || c.localName === 'network'));
    if (!trees.length) { out.stemmata.push({key: `${si}`, title: base, error: 'the NeXML contains no tree'}); return; }
    trees.forEach((t, ti) => {
      const tid = t.getAttribute('label') || t.getAttribute('id') || '';
      const title = trees.length > 1 || (tid && !/^tree\d*$/i.test(tid)) ? `${base} · ${tid || 'tree ' + (ti + 1)}` : base;
      const entry = {key: `${si}.${ti}`, title, stemmaId: sid, treeId: t.getAttribute('id') || ''};
      if (t.localName === 'network') entry.error = 'this is a network, not a tree; only trees can be drawn';
      else {
        try { entry.tree = parseTree(t, otuLabel); }
        catch (e) { entry.error = e.message; }
      }
      out.stemmata.push(entry);
    });
  });
  return out;
}

// One <tree>: -> {root, lengths: 'all'|'some'|'none', negative: n}. Nodes are {id, label, length, children}.
// The edges are followed from the root whichever way they point (SplitsTree's trees are unrooted at heart).
// A witness that is the root and has a single branch (SplitsTree roots its output at the first taxon) is
// moved down to a leaf, and the root put at the node it hangs from: `leafRoot` is the tree as drawn then,
// `root` the tree as rooted in the file.
export function parseTree(treeEl, otuLabel = new Map()) {
  const nodes = new Map();
  for (const n of kids(treeEl, 'node')) {
    const id = n.getAttribute('id'), otu = n.getAttribute('otu');
    if (!id) continue;
    let label = (n.getAttribute('label') || '').trim();
    if (label === id && !otu) label = '';       // Bio::Phylo labels the inner nodes with their ids (n7, n8 …)
    nodes.set(id, {id, label: label || otuLabel.get(otu) || '', marked: n.getAttribute('root') === 'true', length: null, children: []});
  }
  if (!nodes.size) throw new Error('the tree has no nodes');
  const num = s => { const x = parseFloat(s); return Number.isFinite(x) ? x : null; };
  const adj = new Map([...nodes.keys()].map(k => [k, []]));
  const incoming = new Set();
  let nEdges = 0;
  for (const e of kids(treeEl, 'edge')) {
    const s = e.getAttribute('source'), t = e.getAttribute('target');
    if (!nodes.has(s) || !nodes.has(t)) throw new Error(`an edge points to a node that does not exist (${nodes.has(s) ? t : s})`);
    const length = num(e.getAttribute('length'));
    adj.get(s).push({to: t, length}); adj.get(t).push({to: s, length});
    incoming.add(t); nEdges++;
  }
  const rootedge = kids(treeEl, 'rootedge')[0];
  if (nEdges !== nodes.size - 1) throw new Error(`${nodes.size} nodes and ${nEdges} edges do not make a tree (a network?)`);
  const start = [...nodes.values()].find(n => n.marked)
    || (rootedge && nodes.get(rootedge.getAttribute('target')))
    || [...nodes.values()].find(n => !incoming.has(n.id))
    || nodes.values().next().value;
  // orient from the root
  const seen = new Set([start.id]), queue = [start];
  let lengths = 0, negative = 0;
  while (queue.length) {
    const p = queue.shift();
    for (const {to, length} of adj.get(p.id)) {
      if (seen.has(to)) continue;
      seen.add(to);
      const c = nodes.get(to);
      c.length = length;
      if (length !== null) lengths++;
      if (length !== null && length < 0) negative++;
      p.children.push(c); queue.push(c);
    }
  }
  if (seen.size !== nodes.size) throw new Error('not all nodes are connected to the root');
  const info = {root: start, lengths: lengths === nEdges ? 'all' : lengths ? 'some' : 'none', negative, leafRoot: null};
  if (start.label && start.children.length === 1) {
    const copy = n => ({...n, children: n.children.map(copy)});
    const old = copy(start), top = old.children[0];
    old.children = [];
    const lr = {...top, length: null, children: [{...old, length: top.length}, ...top.children]};
    info.leafRoot = lr;
  }
  return info;
}

// ---------------------------------------------------------------- layout
// -> {nodes: [{node, parent, x, depth, leaf}], leaves, maxDepth, proportional}
// x counts leaves from the left; depth is the sum of branch lengths from the root (proportional), or the
// number of generations from the root. Negative or missing lengths count as 0.
export function layoutTree(root, {proportional = true} = {}) {
  const out = [];
  let leaves = 0;
  const go = (n, parent, depth) => {
    const rec = {node: n, parent, depth, leaf: !n.children.length, x: 0};
    out.push(rec);
    if (rec.leaf) rec.x = leaves++;
    else {
      const ch = n.children.map(c => go(c, rec, depth + (proportional ? Math.max(0, c.length ?? 0) : 1)));
      rec.x = (ch[0].x + ch[ch.length - 1].x) / 2;
    }
    return rec;
  };
  go(root, null, 0);
  const maxDepth = Math.max(...out.map(r => r.depth));
  if (proportional && !(maxDepth > 0)) return {...layoutTree(root, {proportional: false}), proportional: false};
  return {nodes: out, leaves, maxDepth, proportional};
}

// ---------------------------------------------------------------- drawing
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fmtLength = x => x === null || x === undefined ? 'no length' : String(Number(x.toPrecision(3)));
// a round length (1, 2 or 5 × 10ⁿ) near a quarter of the whole depth, for the scale bar
export function niceStep(max) {
  const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return Number(((m >= 5 ? 5 : m >= 2 ? 2 : 1) * p).toPrecision(1));
}

// The class names (st-edge, st-node, st-label …) are styled by the page; with {standalone: true} the SVG
// carries its own style, for saving as a file.
export function renderSVG(lay, {lines = 'straight', describe = () => '', standalone = false, height} = {}) {
  const labels = lay.nodes.filter(r => r.node.label);
  const longest = Math.max(1, ...labels.map(r => [...r.node.label].length));
  const gap = Math.max(56, Math.round(longest * 8.5) + 18);
  const H = height ?? (lay.proportional ? Math.min(460, Math.max(240, lay.leaves * 34)) : Math.max(1, lay.maxDepth) * 72);
  const left = lay.proportional ? 84 : 36, right = 36 + (labels.some(r => !r.leaf) ? longest * 9 : 0), top = 22, bottom = 40;
  const W = Math.max(260, left + right + (lay.leaves - 1) * gap);
  const span = (lay.leaves - 1) * gap, x0 = left + (W - left - right - span) / 2;
  const X = r => x0 + r.x * gap, Y = r => top + (lay.maxDepth ? r.depth / lay.maxDepth : 0) * H;
  const f = v => Math.round(v * 10) / 10;
  const parts = [];
  // branches
  for (const r of lay.nodes) {
    if (!r.parent) continue;
    const [px, py, cx, cy] = [X(r.parent), Y(r.parent), X(r), Y(r)].map(f);
    const d = lines === 'square' ? `M${px},${py}H${cx}V${cy}` : `M${px},${py}L${cx},${cy}`;
    const who = r.node.label || (r.leaf ? 'leaf' : 'node');
    const len = r.node.length;
    // a wide invisible copy of each branch makes it easy to point at for its length
    parts.push(`<g class="st-branch"><title>${esc(`branch to ${who}: ${fmtLength(len)}${len < 0 ? ' (drawn as 0)' : ''}`)}</title>` +
               `<path class="st-hit" d="${d}"/><path class="st-edge" d="${d}"/></g>`);
  }
  // nodes and sigla
  for (const r of lay.nodes) {
    const x = f(X(r)), y = f(Y(r));
    if (!r.node.label) { parts.push(`<circle class="st-node" cx="${x}" cy="${y}" r="2.6"/>`); continue; }
    const tip = describe(r.node.label);
    const t = tip ? `<title>${esc(tip)}</title>` : '';
    if (r.leaf) parts.push(`<text class="st-label" x="${x}" y="${f(y + 18)}" text-anchor="middle">${esc(r.node.label)}${t}</text>`);
    else parts.push(`<circle class="st-node st-wit" cx="${x}" cy="${y}" r="3.2"/>`,
                    `<text class="st-label st-inner" x="${f(x + 7)}" y="${f(y + 5)}">${esc(r.node.label)}${t}</text>`);
  }
  // scale bar, at the left, for the vertical (length) axis
  if (lay.proportional) {
    const step = niceStep(lay.maxDepth), px = step / lay.maxDepth * H;
    const y1 = f(top + H), y0 = f(top + H - px), x = left - 46;
    parts.push(`<g class="st-scale"><path d="M${x - 4},${y0}H${x + 4}M${x},${y0}V${y1}M${x - 4},${y1}H${x + 4}"/>` +
               `<text x="${x + 8}" y="${f((y0 + y1) / 2 + 4)}">${esc(String(step))}</text></g>`);
  }
  const style = standalone ? `<style>.st-edge,.st-scale path{fill:none;stroke:#555;stroke-width:1.4}.st-hit{fill:none;stroke:transparent;stroke-width:10}.st-node{fill:#555}` +
    `.st-label{font:600 14px system-ui,'Noto Sans','DejaVu Sans',sans-serif;fill:#1d1c1a}.st-inner{paint-order:stroke;stroke:#fff;stroke-width:4px}` +
    `.st-scale text{font:11px system-ui,sans-serif;fill:#6b675f}</style>` : '';
  const ns = standalone ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  return `<svg${ns} class="stemma" viewBox="0 0 ${f(W)} ${f(top + H + bottom)}" width="${f(W)}" height="${f(top + H + bottom)}" role="img">${style}${parts.join('')}</svg>`;
}

// leaves and labelled nodes, in drawing order
export const sigla = root => {
  const out = [];
  const go = n => { if (n.label) out.push(n.label); n.children.forEach(go); };
  go(root);
  return out;
};
