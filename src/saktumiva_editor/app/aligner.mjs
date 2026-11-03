// An editable model of a Saktumiva alignment file.
// Rows = witnesses (<TEI n="siglum">), columns = aligned cells (<w n="…">),
// groups = word groups (<cl>), which become the apparatus entries.
// Every operation only regroups or moves cells: no row's text ever changes.
import { parseXML, TEI_NS } from './teiutil.mjs';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const innerXML = el => [...el.childNodes].map(n => n.nodeType === 3 ? esc(n.data).replace(/&quot;/g, '"')
  : new XMLSerializer().serializeToString(n).replace(/ xmlns="http:\/\/www\.tei-c\.org\/ns\/1\.0"/g, '')).join('');

let colSeq = 0;
export class AlignMatrix {
  constructor(xml, base) {
    this.base = base;
    this.doc = parseXML(xml, 'alignment');
    const teis = [...this.doc.documentElement.children].filter(e => e.localName === 'TEI');
    this.rows = teis.map(t => t.getAttribute('n'));
    this.cols = [];            // {id, cells: {siglum: {inner, text, lemma}}}
    this.groups = [];          // [[col, col, …], …]
    const byN = new Map();
    const colFor = n => { if (!byN.has(n)) { const c = {id: ++colSeq, n: Number(n), cells: {}}; byN.set(n, c); this.cols.push(c); } return byN.get(n); };
    teis.forEach((tei, r) => {
      const text = tei.getElementsByTagNameNS(TEI_NS, 'text')[0];
      const units = [...text.children];
      const groupsHere = [];
      for (const u of units) {
        const ws = u.localName === 'cl' ? [...u.children].filter(c => c.localName === 'w') : u.localName === 'w' ? [u] : [];
        const g = [];
        for (const w of ws) {
          const c = colFor(w.getAttribute('n'));
          c.cells[this.rows[r]] = {inner: innerXML(w), text: w.textContent, lemma: w.getAttribute('lemma')};
          g.push(c);
        }
        if (g.length) groupsHere.push(g);
      }
      if (r === 0) this.groups = groupsHere;
    });
    this.cols.sort((a, b) => a.n - b.n);
    for (const c of this.cols) for (const s of this.rows) c.cells[s] ??= {inner: '', text: '', lemma: null};
    this.original = Object.fromEntries(this.rows.map(s => [s, this.rowText(s)]));
  }

  rowText(s) { return this.groups.flat().map(c => c.cells[s].text).join(''); }
  cellText(s, g) { return this.groups[g].map(c => c.cells[s].text).join(''); }
  cellNorm(s, g) { return this.groups[g].map(c => c.cells[s].lemma ?? c.cells[s].text).join('').replace(/\s+/g, ' ').trim(); }
  isEmptyCol(c) { return this.rows.every(s => c.cells[s].text === '' && !c.cells[s].inner); }
  differs(g) { const v = new Set(this.rows.map(s => this.cellNorm(s, g))); return v.size > 1; }

  snapshot() { return JSON.stringify({groups: this.groups.map(g => g.map(c => c.id)), cols: this.cols}); }
  restore(snap) {
    const {groups, cols} = JSON.parse(snap);
    this.cols = cols; const byId = new Map(cols.map(c => [c.id, c]));
    this.groups = groups.map(g => g.map(id => byId.get(id)));
  }

  hasBase(cols) { return cols.some(c => c.cells[this.base]?.text.trim()); }

  _tidy() {
    this.groups = this.groups.map(g => g.filter(c => !this.isEmptyCol(c))).filter(g => g.length);
    this.cols = this.groups.flat();
    for (const s of this.rows) if (this.rowText(s) !== this.original[s]) throw new Error(`internal check failed: the text of ${s} changed`);
    // Saktumiva needs some text of the edition in every column (except a leading or trailing remainder it made itself)
    const bad = this.groups.findIndex((g, i) => !this.hasBase(g) && i > 0 && i < this.groups.length - 1);
    if (bad >= 0) throw new Error('every column must keep some text of the edition; use “join” instead');
  }

  // places where group g can be split: before each edition syllable that has edition text before it
  cutPoints(g) {
    const grp = this.groups[g], out = [];
    let seen = false;
    grp.forEach((c, k) => { const t = c.cells[this.base]?.text.trim(); if (t) { if (seen) out.push(k); seen = true; } });
    return out;
  }

  // join group g with the next one
  merge(g) { if (g < 0 || g >= this.groups.length - 1) return false; this.groups.splice(g, 2, [...this.groups[g], ...this.groups[g + 1]]); this._tidy(); return true; }

  // split group g before its k-th column
  split(g, k) {
    const grp = this.groups[g];
    if (!grp || k <= 0 || k >= grp.length || !this.hasBase(grp.slice(0, k)) || !this.hasBase(grp.slice(k))) return false;
    this.groups.splice(g, 1, grp.slice(0, k), grp.slice(k)); this._tidy(); return true;
  }

  // move one witness's last syllable of group g into group g+1 (dir = +1), or its first syllable into g-1 (dir = -1)
  shift(s, g, dir) {
    const grp = this.groups[g], other = this.groups[g + dir];
    if (!grp || !other) return false;
    const filled = grp.filter(c => c.cells[s].text !== '' || c.cells[s].inner);
    if (!filled.length) return false;
    const src = dir > 0 ? filled[filled.length - 1] : filled[0];
    const blank = () => { const c = {id: ++colSeq, n: -1, cells: {}}; for (const r of this.rows) c.cells[r] = {inner: '', text: '', lemma: null}; return c; };
    // the cell lands in a new column at the near edge of the neighbouring group
    const dst = blank();
    if (dir > 0) other.unshift(dst); else other.push(dst);
    dst.cells[s] = src.cells[s];
    src.cells[s] = {inner: '', text: '', lemma: null};
    this._tidy();
    return true;
  }

  // the base (edition) row's cells of group g, for choosing a split point
  baseCells(base, g) { return this.groups[g].map(c => c.cells[base].text); }

  toXML({corrected = false, who = 'Saktumiva editor'} = {}) {
    const doc = this.doc.cloneNode(true);
    const ns = doc.documentElement.namespaceURI || TEI_NS;
    const teis = [...doc.documentElement.children].filter(e => e.localName === 'TEI');
    teis.forEach(tei => {
      const s = tei.getAttribute('n');
      let n = 0;
      const body = this.groups.map(g => '<cl>' + g.map(c => {
        const cell = c.cells[s];
        const lem = cell.lemma !== null && cell.lemma !== undefined ? ` lemma="${esc(cell.lemma)}"` : '';
        return cell.inner ? `<w n="${n++}"${lem}>${cell.inner}</w>` : `<w n="${n++}"${lem}/>`;
      }).join('') + '</cl>').join('');
      const fresh = parseXML(`<text xmlns="${ns}">${body}</text>`, 'alignment row').documentElement;
      const old = tei.getElementsByTagNameNS(TEI_NS, 'text')[0];
      old.replaceChildren(...[...fresh.childNodes].map(n => doc.importNode(n, true)));
    });
    if (corrected) {
      const header = [...doc.documentElement.children].find(e => e.localName === 'teiHeader');
      if (header) {
        let rd = [...header.children].find(e => e.localName === 'revisionDesc');
        if (!rd) { rd = doc.createElementNS(ns, 'revisionDesc'); header.append(rd, doc.createTextNode('\n')); }
        const ch = doc.createElementNS(ns, 'change');
        ch.setAttribute('type', 'hand-corrected');
        ch.setAttribute('when', new Date().toISOString().slice(0, 10));
        ch.textContent = `Alignment corrected by hand (${who})`;
        rd.append(ch);
      }
    }
    let out = new XMLSerializer().serializeToString(doc);
    if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
    return out;
  }
}

export const isHandCorrected = doc => !!doc.querySelector('revisionDesc change[type="hand-corrected"]');
