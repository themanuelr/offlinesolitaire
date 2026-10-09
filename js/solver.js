// Klondike solver with full knowledge of every card (the standard definition of "solvable").
// Used offline to build the bank of solvable deals, and in a worker for Hint and rewind.
// Unlimited passes through the stock, drawing 1 or 3 cards at a time.

import { suitOf, rankOf, isRed, mulberry32 } from './engine.js';
let rnd = null; // set while a restart probe shuffles the move order

// Solver state:
//   piles[i]: cards bottom..top, down[i]: how many of them are face down
//   found[s]: number of cards on foundation of suit s
//   seq: the talon as one sequence (waste bottom..top, then stock in draw order), w = waste size
function fromGame(g) {
  const seq = g.waste.slice().concat(g.stock.slice().reverse());
  return {
    piles: g.tableau.map((p) => p.map((x) => x.c)),
    down: g.tableau.map((p) => p.filter((x) => !x.up).length),
    found: g.foundations.map((f) => f.length),
    seq, w: g.waste.length, d: g.drawCount,
  };
}

function copy(s) {
  return { piles: s.piles.map((p) => p.slice()), down: s.down.slice(), found: s.found.slice(), seq: s.seq.slice(), w: s.w, d: s.d };
}

// 64-bit position hash as two 32-bit words. Piles are combined with a sum so their
// order does not matter (same symmetry as sorting them).
let H1 = 0, H2 = 0;
function hashKey(s) {
  let a1 = 0, a2 = 0;
  for (let i = 0; i < 7; i++) {
    const p = s.piles[i];
    let x = 0x9e3779b9 ^ s.down[i], y = 0x85ebca6b + s.down[i];
    for (let j = 0; j < p.length; j++) {
      x = Math.imul(x ^ (p[j] + 1), 0x01000193);
      y = Math.imul(y + p[j] + 7, 0x5bd1e995); y ^= y >>> 15;
    }
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
    a1 = (a1 + x) | 0; a2 = (a2 + Math.imul(y, 0x27d4eb2d)) | 0;
  }
  const n = s.seq.length;
  const w = s.w === n || s.w % s.d === 0 ? 99 : s.w;
  let x = Math.imul(a1 ^ w, 0x01000193), y = a2 + w * 0x3c6ef372;
  for (let j = 0; j < n; j++) {
    x = Math.imul(x ^ (s.seq[j] + 1), 0x01000193);
    y = Math.imul(y + s.seq[j] + 3, 0x5bd1e995); y ^= y >>> 15;
  }
  const f = s.found[0] | (s.found[1] << 4) | (s.found[2] << 8) | (s.found[3] << 12) | (s.d << 16);
  x = Math.imul(x ^ f, 0x85ebca6b); x ^= x >>> 16;
  y = Math.imul(y ^ (f * 31), 0xcc9e2d51); y ^= y >>> 13;
  H1 = x | 1; H2 = y; // H1 is never 0, so 0 marks an empty slot
}

// Open-addressing set of 64-bit hashes.
class HashSet {
  constructor(bits = 16) { this.bits = bits; this.t = new Int32Array(2 << bits); this.size = 0; }
  clear() { this.t.fill(0); this.size = 0; }
  // Adds (H1, H2); returns false if it was already there.
  add(h1, h2) {
    if (this.size * 2 > (1 << this.bits)) this.grow();
    const mask = (1 << this.bits) - 1, t = this.t;
    let i = (h2 ^ (h1 >>> 7)) & mask;
    while (t[2 * i] !== 0) {
      if (t[2 * i] === h1 && t[2 * i + 1] === h2) return false;
      i = (i + 1) & mask;
    }
    t[2 * i] = h1; t[2 * i + 1] = h2; this.size++;
    return true;
  }
  has(h1, h2) {
    const mask = (1 << this.bits) - 1, t = this.t;
    let i = (h2 ^ (h1 >>> 7)) & mask;
    while (t[2 * i] !== 0) {
      if (t[2 * i] === h1 && t[2 * i + 1] === h2) return true;
      i = (i + 1) & mask;
    }
    return false;
  }
  grow() {
    const old = this.t; this.bits++; this.t = new Int32Array(2 << this.bits); this.size = 0;
    for (let i = 0; i < old.length; i += 2) if (old[i] !== 0) this.add(old[i], old[i + 1]);
  }
  forEach(fn) { const t = this.t; for (let i = 0; i < t.length; i += 2) if (t[i] !== 0) fn(t[i], t[i + 1]); }
}

const fits = (c, top) => rankOf(top) === rankOf(c) + 1 && isRed(top) !== isRed(c);
const toFound = (s, c) => s.found[suitOf(c)] === rankOf(c) - 1;

function safeToFound(s, c) {
  const r = rankOf(c);
  if (r <= 2) return true;
  const red = isRed(c);
  for (let t = 0; t < 4; t++) {
    const tRed = t === 1 || t === 2;
    if (tRed !== red && s.found[t] < r - 1) return false;
  }
  return true;
}

// Waste sizes reachable by drawing (and recycling), including the current one.
function talonPositions(s) {
  const n = s.seq.length, out = [];
  const seen = new Set();
  let w = s.w;
  while (!seen.has(w)) {
    seen.add(w);
    out.push(w);
    if (n === 0) break;
    w = w === n ? 0 : Math.min(w + s.d, n);
  }
  return out;
}

function flip(s, i) {
  if (s.down[i] > 0 && s.down[i] === s.piles[i].length) s.down[i]--;
}

function apply(s, m) {
  const n = copy(s);
  switch (m.t) {
    case 'tf': { const c = n.piles[m.from].pop(); n.found[suitOf(c)]++; flip(n, m.from); break; }
    case 'wf': { const c = n.seq.splice(m.w - 1, 1)[0]; n.w = m.w - 1; n.found[suitOf(c)]++; break; }
    case 'wt': { const c = n.seq.splice(m.w - 1, 1)[0]; n.w = m.w - 1; n.piles[m.to].push(c); break; }
    case 'tt': { const run = n.piles[m.from].splice(m.idx); n.piles[m.to].push(...run); flip(n, m.from); break; }
    case 'ft': { const c = m.suit * 13 + n.found[m.suit] - 1; n.found[m.suit]--; n.piles[m.to].push(c); break; }
  }
  return n;
}

// Play every "safe" foundation move; returns the new state and the moves made.
function autoPlay(s, path) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < 7; i++) {
      const p = s.piles[i];
      if (p.length && toFound(s, p[p.length - 1]) && safeToFound(s, p[p.length - 1])) {
        const m = { t: 'tf', from: i }; s = apply(s, m); path.push(m); changed = true;
      }
    }
    // Only in Draw 1. In Draw 3, taking a card off the waste shifts every card behind it,
    // which changes the cards later draws land on, so sending it home is a real choice:
    // forcing it made the solver call winnable positions lost (game 2953).
    if (s.d === 1 && s.w > 0) {
      const c = s.seq[s.w - 1];
      if (toFound(s, c) && safeToFound(s, c)) {
        const m = { t: 'wf', w: s.w }; s = apply(s, m); path.push(m); changed = true;
      }
    }
  }
  return s;
}

function moves(s) {
  const first = [], reveal = [], talon = [], other = [], last = [];
  // Tableau to foundation.
  for (let i = 0; i < 7; i++) {
    const p = s.piles[i];
    if (p.length && toFound(s, p[p.length - 1])) first.push({ t: 'tf', from: i });
  }
  // Tableau to tableau.
  for (let i = 0; i < 7; i++) {
    const p = s.piles[i];
    for (let idx = s.down[i]; idx < p.length; idx++) {
      const c = p[idx];
      const whole = idx === s.down[i];
      if (!whole && !toFound(s, p[idx - 1])) continue;
      let emptyTried = false;
      for (let j = 0; j < 7; j++) {
        if (j === i) continue;
        const q = s.piles[j];
        if (q.length === 0) {
          if (rankOf(c) !== 13 || emptyTried || (whole && idx === 0)) continue;
          emptyTried = true;
        } else if (!fits(c, q[q.length - 1])) continue;
        const m = { t: 'tt', from: i, idx, to: j };
        (whole && idx > 0 ? reveal : other).push(m);
      }
    }
  }
  // Talon to foundation / tableau.
  for (const w of talonPositions(s)) {
    if (w === 0) continue;
    const c = s.seq[w - 1];
    if (toFound(s, c)) first.push({ t: 'wf', w });
    let emptyTried = false;
    for (let j = 0; j < 7; j++) {
      const q = s.piles[j];
      if (q.length === 0) {
        if (rankOf(c) !== 13 || emptyTried) continue;
        emptyTried = true;
      } else if (!fits(c, q[q.length - 1])) continue;
      talon.push({ t: 'wt', w, to: j });
    }
  }
  // Foundation back to tableau.
  for (let suit = 0; suit < 4; suit++) {
    if (s.found[suit] < 2) continue;
    const c = suit * 13 + s.found[suit] - 1;
    for (let j = 0; j < 7; j++) {
      const q = s.piles[j];
      if (q.length && fits(c, q[q.length - 1])) last.push({ t: 'ft', suit, to: j });
    }
  }
  reveal.sort((a, b) => s.down[b.from] - s.down[a.from]);
  if (rnd) { const sh = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    return first.concat(sh(reveal.concat(talon)), sh(other), last); }
  return first.concat(reveal, talon, other, last);
}

// The search sometimes takes a card down from a foundation and puts it straight back
// later without using it (e.g. 5♥ onto 6♠, then 5♥ home again). Shown as a hint, that first
// move looks pointless, so drop such pairs: a 'ft' and the 'tf' that undoes it, when nothing
// in between touches that pile or that suit's foundation.
function simplify(start, path) {
  for (let changed = true; changed;) {
    changed = false;
    const states = [start];
    for (const m of path) states.push(apply(states[states.length - 1], m));
    const suitMoved = (k) => {
      const m = path[k], s = states[k];
      if (m.t === 'tf') return suitOf(s.piles[m.from][s.piles[m.from].length - 1]);
      if (m.t === 'wf') return suitOf(s.seq[m.w - 1]);
      if (m.t === 'ft') return m.suit;
      return -1;
    };
    for (let k = 0; k < path.length && !changed; k++) {
      const m = path[k];
      if (m.t !== 'ft') continue;
      const j = m.to;
      for (let l = k + 1; l < path.length; l++) {
        const n = path[l];
        if (n.t === 'tf' && n.from === j) { path = path.filter((_, i) => i !== k && i !== l); changed = true; break; }
        if (n.from === j || n.to === j || suitMoved(l) === m.suit) break;
      }
    }
  }
  return path;
}

const done = (s) => s.found.every((f) => f === 13);

// Returns { solved: true, path } | { solved: false, complete } where complete means
// the search space was exhausted (definitely unsolvable under the solver's move set).
// Positions proven lost by an exhaustive search. Kept between calls so the rewind does not
// re-prove what Hint (or the previous step back) already showed; reset() when the game changes.
const lost = new HashSet(12);
const seen = new HashSet(16);
export function reset() { lost.clear(); }
export const lostCount = () => lost.size;
// Restarts: short searches with shuffled move order catch wins that one fixed order
// misses for a long time; a probe that finishes inside its budget is a full proof.
export function solve(game, maxNodes = 200000) {
  let spent = 0, budget = 2000, i = 0;
  while (spent + budget < maxNodes / 4) {
    rnd = i ? mulberry32(i) : null; i++;
    const r = solveOnce(game, budget);
    spent += r.nodes;
    if (r.solved || r.complete) { r.nodes = spent; rnd = null; return r; }
    budget = Math.floor(budget * 1.5);
  }
  rnd = null;
  const r = solveOnce(game, maxNodes - spent);
  r.nodes += spent;
  return r;
}
function solveOnce(game, maxNodes) {
  let nodes = 0;
  seen.clear();
  const path = [];
  let aborted = false;

  function dfs(s) {
    const mark = path.length;
    s = autoPlay(s, path);
    if (done(s)) return true;
    hashKey(s);
    if (lost.has(H1, H2) || !seen.add(H1, H2)) { path.length = mark; return false; }
    if (++nodes > maxNodes) { aborted = true; path.length = mark; return false; }
    for (const m of moves(s)) {
      path.push(m);
      if (dfs(apply(s, m))) return true;
      path.pop();
      if (aborted) break;
    }
    path.length = mark;
    return false;
  }

  const start = fromGame(game);
  const ok = dfs(start);
  if (!ok && !aborted) seen.forEach((a, b) => lost.add(a, b));
  return ok ? { solved: true, path: simplify(start, path), nodes } : { solved: false, complete: !aborted, nodes: Math.min(nodes, maxNodes) };
}
