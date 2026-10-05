import { solve } from './solver.js';

self.onmessage = (e) => {
  const { id, game, maxNodes } = e.data;
  let result;
  try { result = solve(game, maxNodes); } catch (err) { result = { solved: false, complete: false, error: String(err) }; }
  self.postMessage({ id, result });
};
