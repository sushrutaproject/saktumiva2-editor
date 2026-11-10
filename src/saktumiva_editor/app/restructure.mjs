// Merging several passages into one, and splitting one passage in two, in one TEI file
// (the edition or a witness). The file's own text is changed only where it must be:
// tags are removed, added or relabelled, and nothing else is reformatted.
// Every result is parsed again and checked: the text of the passages must be exactly
// what it was, letter for letter. No DOM of the page is used, so this runs in Node too.
import { TEI_NS, XML_NS, parseXML, xmlid, serializeEl, patchElement } from './teiutil.mjs';
import { AlignMatrix } from './aligner.mjs';

const START_TAG = /^<[A-Za-z_][\w:.\-]*(?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>/;
const END_TAG = /<\/[A-Za-z_][\w:.\-]*\s*>$/;
const ID_OK = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;
const BETWEEN_OK = new Set(['pb', 'lb', 'cb', 'milestone', 'anchor', 'gb']);   // may stand between two passages that are merged

export const validId = id => ID_OK.test(id || '');
const isWs = n => n.nodeType === 3 && n.data.trim() === '';
const textKey = el => el.textContent.replace(/\s+/g, '');
const teiEls = (root, name) => [...root.getElementsByTagNameNS(TEI_NS, name)];
const correspTokens = el => (el.getAttribute('corresp') || '').split(/\s+/).filter(Boolean);

// The element that holds passage `id` in this file: by its xml:id, or by corresp="#id" (as witnesses may have it).
export function findPassage(doc, id) {
  const text = doc.getElementsByTagNameNS(TEI_NS, 'text')[0];
  if (!text) return null;
  for (const el of text.getElementsByTagNameNS(TEI_NS, '*'))
    if (xmlid(el) === id || correspTokens(el).includes('#' + id)) return el;
  return null;
}
function rawSpan(el, id, raw, span) {
  const xid = xmlid(el);
  const sp = xid ? span.ids.get(xid) : span.corresps.get('#' + id);
  const m = sp && START_TAG.exec(raw.slice(sp[0], sp[1]));
  if (!m || !raw.slice(sp[0]).startsWith('<' + el.nodeName)) throw new Error(`cannot find ${id} in the text of the file`);
  return {start: sp[0], end: sp[1], tag: m[0], selfClosing: !!m[1]};
}
const setAttr = (tag, name, value) => {
  const re = new RegExp(`(\\s${name.replace(':', '\\:')}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  if (value === null) return tag.replace(new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '');
  if (!re.test(tag)) throw new Error(`cannot find the ${name} attribute`);
  return tag.replace(re, (_, pre) => `${pre}"${value}"`);
};
// A start tag relabelled: ids in `from` (a Set) become `to`, in xml:id or in corresp.
function relabelTag(tag, el, from, to) {
  const xid = xmlid(el);
  if (xid && from.has(xid) && xid !== to) tag = setAttr(tag, 'xml:id', to);
  const toks = correspTokens(el);
  if (toks.some(t => from.has(t.slice(1)))) {
    let out = [...new Set(toks.map(t => from.has(t.slice(1)) ? '#' + to : t))];
    if (xid && (xid === to || from.has(xid))) out = out.filter(t => t !== '#' + to);
    tag = setAttr(tag, 'corresp', out.length ? out.join(' ') : null);
  }
  return tag;
}
function relabelEl(el, from, to) {
  const xid = xmlid(el);
  if (xid && from.has(xid)) { if (el.hasAttributeNS(XML_NS, 'id')) el.setAttributeNS(XML_NS, 'xml:id', to); else el.setAttribute('xml:id', to); }
  const toks = correspTokens(el);
  if (toks.some(t => from.has(t.slice(1)))) {
    let out = [...new Set(toks.map(t => from.has(t.slice(1)) ? '#' + to : t))];
    if (xid && from.has(xid)) out = out.filter(t => t !== '#' + to);
    if (out.length) el.setAttribute('corresp', out.join(' ')); else el.removeAttribute('corresp');
  }
}
const applyEdits = (raw, edits) => {
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) raw = raw.slice(0, e.start) + e.text + raw.slice(e.end);
  return raw;
};
// <standOff corresp="#old"> of the edition (its notes) relabelled, in the file text
function standOffEdits(doc, raw, span, from, to, skip = new Set()) {
  const sos = teiEls(doc, 'standOff'), edits = [];
  sos.forEach((so, k) => {
    const c = (so.getAttribute('corresp') || '').replace(/^#/, '');
    if (!from.has(c) || c === to || skip.has(so)) return;
    if (sos.length !== span.standOffs.length) throw new Error('the notes (<standOff>) could not be matched to the text of the file');
    const [s] = span.standOffs[k];
    const m = START_TAG.exec(raw.slice(s));
    if (!m) throw new Error('cannot read a <standOff> tag');
    edits.push({start: s, end: s + m[0].length, text: setAttr(m[0], 'corresp', '#' + to)});
  });
  return edits;
}
// other places that point at a passage whose id disappears (they are left alone, and reported)
function otherRefs(doc, gone, except) {
  const out = [];
  for (const el of doc.getElementsByTagNameNS('*', '*')) {
    if (except.has(el) || (el.localName === 'standOff' && el.namespaceURI === TEI_NS)) continue;
    for (const a of el.attributes) {
      if (!a.value.includes('#')) continue;
      for (const t of a.value.split(/\s+/)) if (t[0] === '#' && gone.has(t.slice(1))) out.push(`<${el.nodeName} ${a.name}="${a.value}">`);
    }
  }
  return out;
}
function duplicateIds(doc) {
  const seen = new Set(), dup = new Set();
  for (const el of doc.getElementsByTagNameNS('*', '*')) { const i = xmlid(el); if (i) { if (seen.has(i)) dup.add(i); seen.add(i); } }
  return [...dup];
}

// ---------------------------------------------------------------- merge
// `ids`: the passages, in the order of the edition; the first id is kept.
// Returns {status, content, doc}: status is 'merged' (several elements became one), 'renamed' (only a later
// passage is in this file: it now carries the first id), 'unchanged' (only the first, or none of them).
// Throws an Error that says why this file cannot be merged.
export function mergeInFile({raw, doc, span, ids, edition = false, name = 'the file'}) {
  const keep = ids[0], from = new Set(ids);
  const present = [];
  for (const id of ids) {
    const el = findPassage(doc, id);
    if (!el) { if (edition) throw new Error(`${id} is not a passage of the edition`); continue; }
    if (!present.some(p => p.el === el)) present.push({el, id});
  }
  if (!present.length) return {status: 'unchanged', content: raw, doc, warnings: [], why: 'has none of these passages'};
  const edits = [], warnings = [];
  const first = present[0];
  const sp0 = rawSpan(first.el, first.id, raw, span);
  const tag0 = relabelTag(sp0.tag, first.el, from, keep);
  if (tag0 !== sp0.tag) edits.push({start: sp0.start, end: sp0.start + sp0.tag.length, text: tag0});
  if (present.length > 1) {
    const spans = [sp0];
    for (let i = 1; i < present.length; i++) {
      const a = present[i - 1], b = present[i];
      if (!(a.el.compareDocumentPosition(b.el) & 4) || a.el.contains(b.el))
        throw new Error(`${b.id} does not come after ${a.id} here (the passages are in another order)`);
      if (a.el.parentNode !== b.el.parentNode) throw new Error(`${a.id} and ${b.id} are not side by side (they are in different <${b.el.parentNode.nodeName}> elements)`);
      if (a.el.nodeName !== b.el.nodeName) throw new Error(`${a.id} is a <${a.el.nodeName}> and ${b.id} a <${b.el.nodeName}>: only elements of the same kind can be merged`);
      for (let n = a.el.nextSibling; n !== b.el; n = n.nextSibling) {
        if (n.nodeType === 3 ? n.data.trim() : n.nodeType === 1 && !(BETWEEN_OK.has(n.localName) && !n.textContent.trim())) {
          const what = n.nodeType === 1 ? `<${n.nodeName}${xmlid(n) ? ` xml:id="${xmlid(n)}"` : ''}>` : `text (“${n.data.trim().slice(0, 30)}”)`;
          throw new Error(`there is ${what} between ${a.id} and ${b.id}`);
        }
      }
      spans.push(rawSpan(b.el, b.id, raw, span));
    }
    spans.forEach((s, i) => {
      if (s.selfClosing) throw new Error(`${present[i].id} is an empty element (<${present[i].el.nodeName} …/>): give it a start and an end tag, or remove it, in the file`);
      if (i > 0) edits.push({start: s.start, end: s.start + s.tag.length, text: ''});
      if (i < spans.length - 1) {
        const m = END_TAG.exec(raw.slice(s.start, s.end));
        if (!m) throw new Error(`cannot find the end tag of ${present[i].id}`);
        edits.push({start: s.start + m.index, end: s.end, text: ''});
      }
    });
  }
  const gone = new Set(ids.slice(1));
  if (edition) {
    edits.push(...standOffEdits(doc, raw, span, gone, keep));
    warnings.push(...otherRefs(doc, gone, new Set(present.map(p => p.el))).map(r => `${r} still points at a passage that will no longer exist`));
  }
  if (!edits.length) return {status: 'unchanged', content: raw, doc, warnings, why: `has only ${keep}`};
  const content = applyEdits(raw, edits);
  const newDoc = parseXML(content, name);
  const merged = findPassage(newDoc, keep);
  const sound = merged && textKey(merged) === present.map(p => textKey(p.el)).join('')
    && ids.slice(1).every(id => !findPassage(newDoc, id))
    && newDoc.getElementsByTagNameNS('*', '*').length === doc.getElementsByTagNameNS('*', '*').length - (present.length - 1)
    && !duplicateIds(newDoc).length;
  if (!sound) throw new Error('the result did not pass the check of its text (nothing was changed)');
  return {status: present.length > 1 ? 'merged' : 'renamed', content, doc: newDoc, warnings, n: present.length,
          why: present.length > 1 ? `${present.map(p => p.id).join(' + ')} → ${keep}` : `has only ${first.id}: relabelled ${keep}`};
}

// ---------------------------------------------------------------- positions in a passage
// A split point is an offset into all the text of the passage element (its text nodes, one after the other).
export function textNodesOf(el) {
  const out = [];
  const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) out.push(c); else if (c.nodeType === 1) walk(c); } };
  walk(el);
  return out;
}
export const textLength = el => textNodesOf(el).reduce((a, t) => a + t.data.length, 0);
// the offset moved past white space, so that the second part begins with a letter
export function snapOffset(el, offset) {
  const s = textNodesOf(el).map(t => t.data).join('');
  offset = Math.max(0, Math.min(offset, s.length));
  while (offset < s.length && /\s/.test(s[offset])) offset++;
  return offset;
}
// 'start': nothing but white space before the point; 'end': nothing after it; else 'inside'
export function offsetPlace(el, offset) {
  const s = textNodesOf(el).map(t => t.data).join('');
  if (!s.slice(0, offset).trim()) return 'start';
  if (!s.slice(offset).trim()) return 'end';
  return 'inside';
}
// Saktumiva counts the letters of a passage without white space and without the text of ignored elements;
// a <gap> counts for its quantity. These two convert between that count and an offset.
function countWalk(el, ignore, visit) {
  let flat = 0, counted = 0, stop = false;
  const walk = (n, ignored) => {
    for (const c of n.childNodes) {
      if (stop) return;
      if (c.nodeType === 3) {
        for (let i = 0; i < c.data.length && !stop; i++) {
          if (visit(flat, counted)) { stop = true; return; }
          flat++;
          if (!ignored && !/[\s­]/.test(c.data[i])) counted++;
        }
      } else if (c.nodeType === 1) {
        const ig = ignored || ignore.has(c.localName) || (c.localName === 'gap' && c.getAttribute('reason') === 'ellipsis');
        if (!ig && c.localName === 'gap') counted += parseInt(c.getAttribute('quantity')) || 1;
        walk(c, ig);
      }
    }
  };
  walk(el, false);
  return {flat, counted};
}
export function offsetToCount(el, offset, ignore = new Set()) {
  let res = null;
  const end = countWalk(el, ignore, (flat, counted) => { if (flat === offset) { res = counted; return true; } return false; });
  return res ?? end.counted;
}
export function countToOffset(el, count, ignore = new Set()) {
  if (count <= 0) return 0;
  let res = null;
  const end = countWalk(el, ignore, (flat, counted) => { if (counted >= count) { res = flat; return true; } return false; });
  return res ?? end.flat;
}
// Where the witnesses should be cut, going by the alignment: the column of the alignment in which the
// edition reaches `count` letters, and for each row its letters up to that column and after it.
// Returns a Map siglum -> {before, after} (rows of the alignment only).
export function alignedParts(alignXML, base, count) {
  const m = new AlignMatrix(alignXML, base);
  if (!m.rows.includes(base)) return new Map();
  const letters = s => s.replace(/[\s­‡]/g, '');
  const cols = m.groups.flat();
  let k = -1, cum = 0;
  for (let i = 0; i < cols.length && cum < count; i++) { cum += cols[i].cells[base].text.replace(/[\s­]/g, '').length; k = i; }
  const out = new Map();
  for (const s of m.rows) out.set(s, {before: letters(cols.slice(0, k + 1).map(c => c.cells[s].text).join('')),
                                      after: letters(cols.slice(k + 1).map(c => c.cells[s].text).join(''))});
  return out;
}
// The offset in passage element `el` at which the letters `before` end and the letters `after` begin.
// The alignment leaves out some of a witness's text (deleted letters, ignored elements), so the letters are
// looked for in order, from the front and from the back; `sure` says whether both arrive at the same place.
export function locateParts(el, {before, after}, ignore = new Set()) {
  let text = '';
  const usable = [];
  const walk = (n, ignored) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { for (const ch of c.data) usable.push(!ignored); text += c.data; }
      else if (c.nodeType === 1) walk(c, ignored || ignore.has(c.localName));
    }
  };
  walk(el, false);
  if (text.length !== usable.length) { usable.length = 0; for (let i = 0; i < text.length; i++) usable.push(true); }   // (astral characters)
  let f = 0, okF = true;
  for (const ch of before) {
    let i = f; while (i < text.length && !(usable[i] && text[i] === ch)) i++;
    if (i >= text.length) { okF = false; break; }
    f = i + 1;
  }
  let b = text.length, okB = true;
  for (let k = after.length - 1; k >= 0; k--) {
    let i = b - 1; while (i >= 0 && !(usable[i] && text[i] === after[k])) i--;
    if (i < 0) { okB = false; break; }
    b = i;
  }
  if (!okF && !okB) return null;
  if (!okF) return {offset: b, sure: false};
  if (!okB || f > b) return {offset: snapOffset(el, f), sure: false};
  // in between there may be white space, and text the alignment does not have: that stays with the first part
  const between = [...text.slice(f, b)].some((ch, i) => usable[f + i] && /\S/.test(ch));
  return {offset: between ? snapOffset(el, f) : b, sure: !between};
}

// ---------------------------------------------------------------- split
// Cut `block` (a copy, not in the document) after node `ref` of `container`; returns the second half.
function cutTree(block, container, ref) {
  const atStart = () => ref === null || (isWs(ref) && !ref.previousSibling);
  const atEnd = () => { for (let n = ref ? ref.nextSibling : container.firstChild; n; n = n.nextSibling) if (!isWs(n)) return false; return true; };
  while (container !== block && atStart()) { ref = container.previousSibling; container = container.parentNode; }
  while (container !== block && atEnd()) { ref = container; container = container.parentNode; }
  let carry = null;
  for (;;) {
    const shell = container.cloneNode(false);
    if (carry) shell.append(carry);
    let n = ref ? ref.nextSibling : container.firstChild;
    while (n) { const next = n.nextSibling; shell.append(n); n = next; }
    if (container === block) return shell;
    if (shell.hasAttributeNS(XML_NS, 'id')) shell.removeAttributeNS(XML_NS, 'id');   // an inner element cut in two: the id stays with its first half
    shell.removeAttribute('xml:id');
    carry = shell.childNodes.length ? shell : null;
    ref = container; container = container.parentNode;
  }
}
// The two halves of passage element `el` cut at `offset` (see textNodesOf), as new elements.
export function splitElement(el, offset) {
  const block = el.cloneNode(true);
  const lead = block.firstChild && isWs(block.firstChild) ? block.firstChild.data : null;
  const trail = block.lastChild && isWs(block.lastChild) ? block.lastChild.data : null;
  let start = 0, node = null, local = 0;
  for (const t of textNodesOf(block)) {
    if (offset > start && offset <= start + t.data.length) { node = t; local = offset - start; break; }
    start += t.data.length;
  }
  if (!node) throw new Error('the split point is not inside the text');
  if (local < node.data.length) node.splitText(local);
  const second = cutTree(block, node.parentNode, node);
  // keep the file's line breaks and indentation at the new edges
  if (lead !== null && second.firstChild && !isWs(second.firstChild)) second.prepend(block.ownerDocument.createTextNode(lead));
  if (trail !== null && block.lastChild) {
    if (isWs(block.lastChild)) block.lastChild.data = trail;
    else if (block.lastChild.nodeType === 1) block.append(block.ownerDocument.createTextNode(trail));
  }
  return [block, second];
}

// `offset`: where to cut this file's text of passage `id`. `firstId`, `secondId`: the ids of the two parts
// (firstId may be the old id). Returns {status, content, doc}: 'split'; 'renamed' (all of the text belongs
// to one part, which has a new id); 'unchanged' (the passage is not here, or all of it stays under the old id).
export function splitInFile({raw, doc, span, id, firstId = id, secondId, offset, edition = false, name = 'the file'}) {
  for (const n of [firstId, secondId]) if (!validId(n)) throw new Error(`“${n}” cannot be an xml:id (letters, digits, . - _ only, not beginning with a digit)`);
  if (firstId === secondId) throw new Error('the two parts need different ids');
  const taken = n => n !== id && [...doc.getElementsByTagNameNS('*', '*')].some(e => xmlid(e) === n || (e.localName !== 'standOff' && correspTokens(e).includes('#' + n)));
  for (const n of [firstId, secondId]) if (taken(n)) throw new Error(`the id ${n} is already used`);
  if (secondId === id) throw new Error('the second part needs a new id');
  const el = findPassage(doc, id);
  if (!el) {
    if (edition) throw new Error(`${id} is not a passage of the edition`);
    return {status: 'unchanged', content: raw, doc, warnings: [], why: 'does not have this passage'};
  }
  const from = new Set([id]);
  const sp = rawSpan(el, id, raw, span);
  offset = snapOffset(el, offset ?? textLength(el));
  const place = offsetPlace(el, offset);
  if (edition && place !== 'inside') throw new Error('choose a place inside the text of the edition: both parts need some text');
  const edits = [], warnings = [];
  let status, why, moved = new Set();
  if (place !== 'inside') {
    const to = place === 'start' ? secondId : firstId;
    const tag = relabelTag(sp.tag, el, from, to);
    if (tag === sp.tag) return {status: 'unchanged', content: raw, doc, warnings, why: `all of its text stays in ${firstId}`};
    edits.push({start: sp.start, end: sp.start + sp.tag.length, text: tag});
    status = 'renamed'; why = `all of its text belongs to ${to}`;
  } else {
    const [a, b] = splitElement(el, offset);
    relabelEl(a, from, firstId); relabelEl(b, from, secondId);
    const before = raw.slice(raw.lastIndexOf('\n', sp.start - 1) + 1, sp.start);
    const sep = '\n' + (/^\s*$/.test(before) ? before : '');
    edits.push({start: sp.start, end: sp.end, text: patchElement(raw.slice(sp.start, sp.end), serializeEl(el), serializeEl(a) + sep + serializeEl(b))});
    moved = new Set([...b.getElementsByTagNameNS('*', '*')].map(xmlid).filter(Boolean));
    status = 'split'; why = `${id} → ${firstId} + ${secondId}`;
  }
  if (edition) {
    // notes anchored in the second part go with it
    const sos = teiEls(doc, 'standOff'), handled = new Set();
    sos.forEach((so, k) => {
      if ((so.getAttribute('corresp') || '') !== '#' + id || so.getAttribute('type') === 'apparatus') return;
      const notes = [...so.children].filter(c => c.localName === 'note');
      const going = notes.filter(n => moved.has((n.getAttribute('target') || '').replace(/^#/, '').split(/\s+/)[0]));
      if (!going.length) return;
      if (sos.length !== span.standOffs.length) throw new Error('the notes (<standOff>) could not be matched to the text of the file');
      const [s, e] = span.standOffs[k];
      handled.add(so);
      if (going.length === notes.length) {
        const m = START_TAG.exec(raw.slice(s));
        edits.push({start: s, end: s + m[0].length, text: setAttr(m[0], 'corresp', '#' + secondId)});
        return;
      }
      const left = so.cloneNode(true), right = so.cloneNode(false);
      right.setAttribute('corresp', '#' + secondId);
      left.setAttribute('corresp', '#' + firstId);
      const ws = n => n && isWs(n) ? n.data : '\n';
      const inner = ws(notes[0].previousSibling), close = ws(so.lastChild);
      const leftNotes = [...left.children].filter(c => c.localName === 'note');
      notes.forEach((n, i) => {
        if (!going.includes(n)) return;
        const ln = leftNotes[i];
        if (ln.previousSibling && isWs(ln.previousSibling)) ln.previousSibling.remove();
        right.append(so.ownerDocument.createTextNode(inner), ln);
      });
      right.append(so.ownerDocument.createTextNode(close));
      const before = raw.slice(raw.lastIndexOf('\n', s - 1) + 1, s);
      const sep = '\n' + (/^\s*$/.test(before) ? before : '');
      edits.push({start: s, end: e, text: patchElement(raw.slice(s, e), serializeEl(so), serializeEl(left) + sep + serializeEl(right))});
    });
    if (firstId !== id) {
      edits.push(...standOffEdits(doc, raw, span, from, firstId, handled));
      warnings.push(...otherRefs(doc, from, new Set([el])).map(r => `${r} still points at ${id}, which will no longer exist`));
    }
  }
  const content = applyEdits(raw, edits);
  const newDoc = parseXML(content, name);
  const a = findPassage(newDoc, firstId), b = findPassage(newDoc, secondId);
  const text = status === 'split' ? (a && b && a !== b ? textKey(a) + textKey(b) : null) : textKey(findPassage(newDoc, place === 'start' ? secondId : firstId) || newDoc.createElement('x'));
  const sound = text === textKey(el) && (firstId === id || !findPassage(newDoc, id)) && !duplicateIds(newDoc).length
    && (status !== 'renamed' || newDoc.getElementsByTagNameNS('*', '*').length === doc.getElementsByTagNameNS('*', '*').length);
  if (!sound) throw new Error('the result did not pass the check of its text (nothing was changed)');
  return {status, content, doc: newDoc, warnings, why};
}
