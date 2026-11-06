// NEXUS for SplitsTree: a character matrix from the section's alignment files (one per passage).
// After Saktumiva's matrix editor (matrix-editor/lib/export.mjs: options + nexus), which does the same for
// one alignment open in that editor. Here the passages are put one after another, and a witness that lacks
// a passage has "?" (missing) for all of its characters.
//
// Each aligned cell (<w>) is a character, or each word group (<cl>) with "Merge groups"; its states are the
// different readings, written in Harvard-Kyoto in the CHARSTATELABELS. As in Saktumiva: an empty cell is a
// gap (-); with "Gaps are significant" it is a state of its own (0), but runs of eight or more such cells
// are written as gaps. Unlike Saktumiva, which writes lost text (‡) as state 1, so that witnesses with a
// lacuna at the same place seem to agree, a reading with ‡ in it is written as missing (?).
import Sanscript from './saktumiva/lib/sanscript.mjs';

const TEI = 'http://www.tei-c.org/ns/1.0';
// 0 = an empty cell when gaps are significant; 1 is kept free, as in Saktumiva (it was its "‡")
const SYMBOLS = '0123456789ABCDEFGHKLMNPQRSTUVWXYZabcdefghklmnpqrstuvwxyz';
const [SIGGAP, , ...STATES] = SYMBOLS;
const GAP = '-';

const kids = (el, name) => [...el.children].filter(c => c.localName === name && c.namespaceURI === TEI);

// One alignment file -> {sigla, chars: [{siglum: reading}]}; reading '' = empty cell.
export function alignmentCharacters(xml, {normalize = true, mergeGroups = true, gapsSignificant = false} = {}) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not well-formed XML');
  const teis = kids(doc.documentElement, 'TEI');
  const sigla = teis.map(t => t.getAttribute('n'));
  const read = w => (normalize && w.hasAttribute('lemma') ? w.getAttribute('lemma') : w.textContent);
  const rows = teis.map(t => {
    const text = t.getElementsByTagNameNS(TEI, 'text')[0];
    const units = [];
    for (const u of text ? text.children : []) {
      const ws = u.localName === 'cl' ? kids(u, 'w') : u.localName === 'w' ? [u] : [];
      if (!ws.length) continue;
      if (mergeGroups) units.push(ws.map(read).join(''));
      else units.push(...ws.map(read));
    }
    return units;
  });
  const n = Math.max(0, ...rows.map(r => r.length));
  const chars = [];
  for (let i = 0; i < n; i++) {
    const c = {};
    sigla.forEach((s, r) => {
      let x = (rows[r][i] ?? '').trim();
      if (x === '' && gapsSignificant) x = '[]';
      c[s] = x;
    });
    chars.push(c);
  }
  return {sigla, chars};
}

const reading = x => x === '' || x === '[]' ? x : x.includes('‡') ? '‡' : Sanscript.t(x.toLowerCase(), 'iast', 'hk').replace(/'/g, '()');
const quote = s => `'${String(s).replace(/'/g, "''")}'`;

// passages: [{id, xml}] in order; taxa: the sigla to put in the matrix, in order. A witness with corrections
// has two rows in an alignment (Hac, Hpc: without <add>, without <del>); opts.corrections says which is used.
// -> {text, ntax, nchar, passages: n, skipped: [[id, why]], tooMany: n}
export function buildNexus(passages, taxa, opts = {}) {
  const matrix = new Map(taxa.map(s => [s, []]));
  const labels = [], skipped = [];
  let tooMany = 0, used = 0;
  const corr = opts.corrections === 'pc' ? 'pc' : 'ac';
  for (const {id, xml} of passages) {
    let a;
    try { a = alignmentCharacters(xml, opts); } catch (e) { skipped.push([id, e.message]); continue; }
    if (!a.chars.length) { skipped.push([id, 'empty alignment']); continue; }
    used++;
    a.chars.forEach((c, i) => {
      const states = [];
      const rs = taxa.map(s => (s in c ? reading(c[s]) : s + corr in c ? reading(c[s + corr]) : null));
      for (const r of rs) if (r !== null && r !== '' && r !== '[]' && r !== '‡' && !states.includes(r)) states.push(r);
      if (states.length > STATES.length) tooMany++;
      labels.push({id, i, states});
      taxa.forEach((s, t) => {
        const r = rs[t];
        matrix.get(s).push(r === null || r === '‡' ? '?' : r === '' ? GAP : r === '[]' ? SIGGAP
          : (STATES[states.indexOf(r)] ?? '?'));
      });
    });
  }
  const nchar = labels.length;
  const width = Math.max(...taxa.map(s => quote(s).length));
  // as Saktumiva: long gaps are not counted, even if "gaps are significant"
  const rows = taxa.map(s => quote(s).padEnd(width + 1) + matrix.get(s).join('').replace(/0{8,}/g, m => '-'.repeat(m.length)));
  // each character is named after its passage and place (SS.1.1.3.2 = 2nd character of SS.1.1.3)
  const charlabels = labels.map(({id, i, states}, k) =>
    `    ${k + 1} ${quote(`${id}.${i + 1}`)} / ${["'[]'", "'‡'", ...states.slice(0, STATES.length).map(quote)].join(' ')}`).join(',\n');
  const title = opts.title ? `[${opts.title.replace(/[[\]]/g, '')}]\n` : '';
  const text = `#NEXUS
${title}
BEGIN TAXA;
  DIMENSIONS NTAX=${taxa.length};
  TAXLABELS ${taxa.map(quote).join(' ')};
END;

BEGIN CHARACTERS;
  DIMENSIONS NCHAR=${nchar};
  FORMAT DATATYPE=STANDARD RESPECTCASE GAP=${GAP} MISSING=? SYMBOLS="${SYMBOLS}";
  CHARSTATELABELS
${charlabels}
  ;
  MATRIX
${rows.join('\n')}
  ;
END;
`;
  return {text, ntax: taxa.length, nchar, passages: used, skipped, tooMany};
}
