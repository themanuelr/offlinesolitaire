import { solve, reset, lostCount } from './solver.js';

// The solver remembers positions it has proven lost; that memory belongs to one game.
let current = null;

self.onmessage = (e) => {
  const { id, game, maxNodes, gameKey } = e.data;
  if (gameKey !== current || lostCount() > 1500000) { reset(); current = gameKey; }
  let result;
  try { result = solve(game, maxNodes); } catch (err) { result = { solved: false, complete: false, error: String(err) }; }
  self.postMessage({ id, result });
};
