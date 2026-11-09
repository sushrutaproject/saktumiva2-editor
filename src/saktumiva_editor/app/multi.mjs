// Choosing several passages in the passage list, and remembering the choice for the session.
// Pure functions (no DOM), so that they can be tested in Node.

// `order` is the list of passage ids in document order (or the order of the rows shown).
export function sortByDoc(ids, order) {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...new Set(ids)].filter(id => pos.has(id)).sort((a, b) => pos.get(a) - pos.get(b));
}

// The passages from `anchor` to `target`, both included, in document order.
export function rangeBetween(order, anchor, target) {
  let a = order.indexOf(anchor), b = order.indexOf(target);
  if (b < 0) return [];
  if (a < 0) a = b;
  if (a > b) [a, b] = [b, a];
  return order.slice(a, b + 1);
}

// One click in the passage list.
//   plain click: that passage alone
//   Shift-click: the range from the anchor (the passage clicked last without Shift) to this one
//   Ctrl/Cmd-click (or the tick box): add this passage to the selection, or take it out
// `order` is the order of the rows that can be clicked (the filtered list), `all` the whole document order.
// Returns {selection, anchor, focus}: `focus` is the passage that a single-passage view would show.
export function clickSelect({selection = [], anchor = null, order, all = order, id, shift = false, toggle = false}) {
  if (shift) {
    const sel = rangeBetween(order, anchor ?? id, id);
    return {selection: sortByDoc(toggle ? [...selection, ...sel] : sel, all), anchor: anchor ?? id, focus: id};
  }
  if (toggle) {
    const has = selection.includes(id);
    const sel = has ? selection.filter(x => x !== id) : [...selection, id];
    if (!sel.length) return {selection: [id], anchor: id, focus: id};      // never nothing
    return {selection: sortByDoc(sel, all), anchor: id, focus: has ? sel[sel.length - 1] : id};
  }
  return {selection: [id], anchor: id, focus: id};
}

// "SS.3.1.1–SS.3.1.5" for a continuous run, "SS.3.1.1, SS.3.1.4, SS.3.2.7" (shortened after a few) otherwise.
export function selectionLabel(ids, order) {
  if (!ids.length) return '';
  if (ids.length === 1) return ids[0];
  const i0 = order.indexOf(ids[0]);
  const continuous = i0 >= 0 && ids.every((id, k) => order[i0 + k] === id);
  if (continuous) return `${ids[0]} – ${ids[ids.length - 1]}`;
  return ids.length <= 4 ? ids.join(', ') : `${ids.slice(0, 3).join(', ')} … ${ids[ids.length - 1]}`;
}

// What is kept in sessionStorage: whether "Show several" was on, and which passages were shown.
export function encodeSession({several, selection}) {
  return JSON.stringify({several: !!several, selection: selection || []});
}
export function decodeSession(text, order) {
  try {
    const v = JSON.parse(text || '');
    if (!v || typeof v !== 'object') throw new Error();
    return {several: !!v.several, selection: sortByDoc(Array.isArray(v.selection) ? v.selection : [], order)};
  } catch { return {several: false, selection: []}; }
}
