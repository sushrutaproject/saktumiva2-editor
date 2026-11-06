// Computes the distances of distances.mjs away from the page, which would otherwise freeze on long texts.
import { computeDistances } from './distances.mjs';

onmessage = e => {
  try { postMessage({matrix: computeDistances(e.data.texts, e.data.opts)}); }
  catch (err) { postMessage({error: err.message || String(err)}); }
};
