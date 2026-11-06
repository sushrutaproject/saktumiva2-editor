// Distances between whole witness texts, as on Saktumiva's tree page (tree/index.mjs, lib/tree.mjs), written
// as a NEXUS DISTANCES block for SplitsTree. The measures are Saktumiva's own:
//   ngrams  cosine distance of tf-idf weighted n-grams of tokens (lib/ngrams.mjs)
//   ncd     normalized compression distance (lib/ncd.mjs)
//   bpe     byte-pair encoding, then cosine distance of the resulting units (lib/bpe.mjs)
// Unlike the tree page, which exports the distances read off the neighbour-joining tree it has built from
// them (so a network made from them can only show that tree again), the measured distances themselves are
// written. NCD is not quite symmetric and is not 0 from a text to itself: the two directions are averaged
// and the diagonal set to 0, as a distance matrix needs.
import { distanceMatrix as ngramMatrix } from './saktumiva/lib/ngrams.mjs';
import { distanceMatrix as NCDMatrix } from './saktumiva/lib/ncd.mjs';
import bpe from './saktumiva/lib/bpe.mjs';

export const MEASURES = {
  ngrams: 'n-grams (cosine distance, tf-idf weighted)',
  ncd: 'normalized compression distance',
  bpe: 'byte-pair encoding (cosine distance)'};

// texts: [[siglum, tokens]] -> square matrix, symmetric, 0 on the diagonal, no negative values
export function computeDistances(texts, {measure = 'ngrams', ngramSize = 3, bpeIterations = 600} = {}) {
  let m;
  if (measure === 'ncd') m = NCDMatrix(texts);
  else if (measure === 'bpe') {
    const units = bpe(texts.map(t => t[1]), Number(bpeIterations));
    m = ngramMatrix(units.map((u, i) => [texts[i][0], u]), 1);
  } else m = ngramMatrix(texts, Number(ngramSize));
  const n = texts.length;
  return Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) =>
    i === j ? 0 : Math.max(0, ((m[i][j] ?? 0) + (m[j][i] ?? 0)) / 2)));
}

const quote = s => `'${String(s).replace(/'/g, "''")}'`;
const num = x => (Number.isFinite(x) ? Number(x.toPrecision(6)).toString() : '?');

export function distancesNexus(sigla, matrix, {title = ''} = {}) {
  const w = Math.max(...sigla.map(s => quote(s).length));
  const rows = sigla.map((s, i) => `  ${quote(s).padEnd(w)} ${matrix[i].map(num).join(' ')}`);
  return `#NEXUS
${title ? `[${title.replace(/[[\]]/g, '')}]\n` : ''}
BEGIN TAXA;
  DIMENSIONS NTAX=${sigla.length};
  TAXLABELS ${sigla.map(quote).join(' ')};
END;

BEGIN DISTANCES;
  FORMAT TRIANGLE=BOTH;
  MATRIX
${rows.join('\n')}
  ;
END;
`;
}
