// Pure helpers for TEI documents: parsing, serializing, locating elements in the
// raw file text, mapping Saktumiva apparatus coordinates to DOM ranges, and
// merging edited text back into whitespace-preserving TEI text.

export const TEI_NS = 'http://www.tei-c.org/ns/1.0';
export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const KEY_ATTR = 'ed-k'; // private in-memory key; never written to disk

export const parseXML = (str, name = '') => {
  const doc = new DOMParser().parseFromString(str, 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`${name} is not well-formed XML: ${err.textContent.split('\n').slice(0, 2).join(' ')}`);
  return doc;
};

export const xmlid = el => el.getAttributeNS(XML_NS, 'id') || el.getAttribute('xml:id');

// Serialize one element as it would appear in the file (no xmlns, no private key).
export const serializeEl = el => {
  const clone = el.cloneNode(true);
  if (clone.nodeType === 1) {
    clone.removeAttribute(KEY_ATTR);
    for (const k of clone.querySelectorAll(`[${KEY_ATTR}]`)) k.removeAttribute(KEY_ATTR);
  }
  let s = new XMLSerializer().serializeToString(clone);
  s = s.replace(/^(<[^\s>]+)\s+xmlns="http:\/\/www\.tei-c\.org\/ns\/1\.0"/, '$1');
  return s;
};

export const escapeXML = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- raw scanning
// One pass over the file text: spans of every element with an xml:id, and of
// every <standOff>, in document order. Comments, PIs and CDATA are skipped.
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.\-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

export const scanRaw = raw => {
  const ids = new Map();
  const corresps = new Map();
  const standOffs = [];
  const stack = [];
  let teiEnd = -1;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(raw))) {
    if (m[2] === undefined) continue;
    const [all, close, name, attrs, selfc] = m;
    if (close) {
      // pop to the matching name (tolerant)
      while (stack.length) {
        const top = stack.pop();
        if (top.name === name) {
          const span = [top.start, m.index + all.length];
          if (top.id) ids.set(top.id, span);
          if (top.corr) for (const c of top.corr.split(/\s+/)) if (c && !corresps.has(c)) corresps.set(c, span);
          if (name === 'standOff') standOffs.push(span);
          if (name === 'TEI') teiEnd = m.index;
          break;
        }
      }
      continue;
    }
    const idm = /\sxml:id\s*=\s*(["'])(.*?)\1/.exec(attrs);
    const id = idm ? idm[2] : null;
    if (selfc) {
      if (id) ids.set(id, [m.index, m.index + all.length]);
      continue;
    }
    const cm = /\scorresp\s*=\s*(["'])(.*?)\1/.exec(attrs);
    stack.push({name, start: m.index, id, corr: cm ? cm[2] : null});
  }
  standOffs.sort((a, b) => a[0] - b[0]);
  return {ids, corresps, standOffs, teiEnd};
};

// ---------------------------------------------------------------- Saktumiva coordinates
// A faithful port of Saktumiva's rangeFromCoords (lib/export.mjs): apparatus
// "loc" values count non-whitespace characters, skipping ignored tags.
const countpos = (str, pos) => {
  if (pos === 0) return /[­\s]/.test(str[0]) ? 1 : 0;
  let realn = 0;
  for (let n = 0; n < str.length; n++) {
    if (realn === pos) return /[­\s]/.test(str[n]) ? n + 1 : n;
    if (!/[­\s]/.test(str[n])) realn++;
  }
  return str.length;
};
const nextOut = node => { while (node) { if (node.nextSibling) return node.nextSibling; node = node.parentNode; } return null; };

export const rangeFromCoords = ([p0, p1], target, ignore = new Set()) => {
  const doc = target.ownerDocument;
  let start = 0, sNode = null, sOff = 0, eNode = null, eOff = 0, started = false;
  const walker = doc.createTreeWalker(target, 0xFFFFFFFF);
  const skip = () => { let c = walker.currentNode; while (c) { const s = walker.nextSibling(); if (s) return s; c = walker.parentNode(); if (c === target) return null; } return null; };
  let cur = walker.nextNode();
  while (cur) {
    if (cur.nodeType === 8) { cur = skip(); continue; }
    if (cur.nodeType === 1) {
      const n = cur.localName;
      if (n === 'choice' && cur !== cur.parentNode.firstChild) { cur = skip(); continue; }
      if (ignore.has(n) || (n === 'gap' && cur.getAttribute('reason') === 'ellipsis')) { cur = skip(); continue; }
      if (n === 'gap') { start += parseInt(cur.getAttribute('quantity')) || 1; cur = skip(); continue; }
    } else if (cur.nodeType === 3) {
      const t = cur.data.trim();
      if (t === '') { cur = walker.nextNode(); continue; }
      const end = start + t.replace(/[\s­]/g, '').length;
      if (!started && p0 <= end) {
        let pos = countpos(cur.data, p0 - start), node = cur;
        if (pos === node.data.length || node.data.slice(pos).trim() === '') {
          // move to next non-empty text node
          node = nextOut(node); pos = 0;
          while (node) {
            if (node.nodeType === 1) { node = (ignore.has(node.localName) ? nextOut(node) : (node.firstChild || nextOut(node))); continue; }
            if (node.nodeType !== 3 || node.data.trim() === '') { node = nextOut(node); continue; }
            break;
          }
        }
        if (node) {
          const sp = node.data.slice(pos).search(/\S/);
          sNode = node; sOff = sp > 0 ? pos + sp : pos;
          started = true;
        }
      }
      if (started && p1 <= end) {
        const pos = countpos(cur.data, p1 - start);
        const es = cur.data.slice(0, pos).search(/\s+$/);
        eNode = cur; eOff = (es > -1 && es < pos) ? es : pos;
        break;
      }
      start = end;
    }
    cur = walker.nextNode();
  }
  if (!sNode || !eNode) return null;
  return {sNode, sOff, eNode, eOff};
};

// Text of a block as Saktumiva counts it (for diagnostics)
export const countedText = (el, ignore) => {
  let s = '';
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.data;
      else if (c.nodeType === 1) {
        if (ignore.has(c.localName)) continue;
        if (c.localName === 'gap') { s += '‡'.repeat(parseInt(c.getAttribute('quantity')) || 1); continue; }
        walk(c);
      }
    }
  };
  walk(el);
  return s;
};

// ---------------------------------------------------------------- whitespace-preserving merge
// raw: original text (may contain newlines + indentation)
// edited: the new text as typed (whitespace collapsed)
// Returns raw with only the changed middle replaced.
export const collapseWithMap = raw => {
  let out = '', map = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (out.endsWith(' ')) continue;
      out += ' '; map.push(i);
    } else { out += ch; map.push(i); }
  }
  map.push(raw.length);
  return {out, map};
};

export const mergeText = (raw, edited) => {
  edited = edited.replace(/ /g, ' ').replace(/\s+/g, ' ');
  // keep the file's own whitespace at the edges (line breaks, indentation)
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.slice(lead.length).match(/\s*$/)[0];
  if (lead || trail) {
    const core = raw.slice(lead.length, raw.length - trail.length);
    const e = edited.trim();
    if (!e) return core ? ((lead || trail) ? ' ' : '') : raw;
    const newLead = lead || (edited.startsWith(' ') ? ' ' : '');
    const newTrail = trail || (edited.endsWith(' ') ? ' ' : '');
    return newLead + mergeText(core, e) + newTrail;
  }
  const {out: orig, map} = collapseWithMap(raw);
  if (orig === edited) return raw;
  let p = 0;
  while (p < orig.length && p < edited.length && orig[p] === edited[p]) p++;
  let s = 0;
  while (s < orig.length - p && s < edited.length - p &&
         orig[orig.length - 1 - s] === edited[edited.length - 1 - s]) s++;
  const a = map[p];
  const b = map[orig.length - s];
  return raw.slice(0, a) + edited.slice(p, edited.length - s) + raw.slice(b);
};

// Simple word-level description of a change, for commit messages and emendation notes
export const describeChange = (before, after) => {
  const A = before.trim().split(/\s+/), B = after.trim().split(/\s+/);
  let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  return {from: A.slice(p, A.length - s).join(' '), to: B.slice(p, B.length - s).join(' ')};
};

// ---------------------------------------------------------------- minimal element patch
// rawEl: the element exactly as it stands in the file; origSer / curSer: XMLSerializer
// output before and after the edit. Returns new raw text for the element that keeps
// the file's own formatting everywhere outside the changed stretch.
const tokenize = s => s.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || [];
const normTag = t => t.replace(/\s+xmlns="[^"]*"/, '').replace(/\s+/g, ' ').replace(/'/g, '"').replace(/\s*(\/?)>$/, '$1>');
export const patchElement = (rawEl, origSer, curSer) => {
  if (origSer === curSer) return rawEl;
  const R = tokenize(rawEl), O = tokenize(origSer), C = tokenize(curSer);
  const same = (r, o) => r === o || (r.startsWith('<') && o.startsWith('<') && normTag(r) === normTag(o));
  if (R.length !== O.length || !R.every((r, i) => same(r, O[i]))) return curSer; // cannot align: replace whole element
  let i = 0;
  while (i < O.length && i < C.length && O[i] === C[i]) i++;
  let j = 0;
  while (j < O.length - i && j < C.length - i && O[O.length - 1 - j] === C[C.length - 1 - j]) j++;
  let head = R.slice(0, i).join(''), tail = R.slice(R.length - j).join('');
  let mid = C.slice(i, C.length - j);
  const oMid = O.slice(i, O.length - j), rMid = R.slice(i, R.length - j);
  // refine at character level inside text tokens at the edges
  if (mid.length && oMid.length && !mid[0].startsWith('<') && !oMid[0].startsWith('<') && rMid[0] === oMid[0]) {
    let a = 0; const x = oMid[0], y = mid[0];
    while (a < x.length && a < y.length && x[a] === y[a]) a++;
    head += x.slice(0, a); mid = [y.slice(a), ...mid.slice(1)]; oMid[0] = x.slice(a); rMid[0] = x.slice(a);
  }
  const L = mid.length - 1, Lo = oMid.length - 1;
  if (L >= 0 && Lo >= 0 && !mid[L].startsWith('<') && !oMid[Lo].startsWith('<') && rMid[Lo] === oMid[Lo]) {
    let b = 0; const x = oMid[Lo], y = mid[L];
    while (b < x.length && b < y.length && x[x.length - 1 - b] === y[y.length - 1 - b]) b++;
    tail = x.slice(x.length - b) + tail; mid[L] = y.slice(0, y.length - b);
  }
  return head + mid.join('') + tail;
};

// Span [start, end] of the first <name …> element that starts at or after `from`
// (nesting of the same element name and comments are respected).
export const elementSpanAfter = (raw, from, name) => {
  const re = new RegExp(`<!--[\\s\\S]*?-->|<(/?)${name}\\b[^>]*?(/?)>`, 'g');
  re.lastIndex = from;
  let m, depth = 0, start = -1;
  while ((m = re.exec(raw))) {
    if (m[0].startsWith('<!--')) continue;
    if (!m[1]) {
      if (start < 0) start = m.index;
      if (m[2]) { if (depth === 0) return [start, m.index + m[0].length]; continue; }
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) return [start, m.index + m[0].length];
    }
  }
  return null;
};
