// Core Klondike rules shared by the game, the solver and the deal generator.
// A card is an integer 0..51: suit = floor(c / 13), rank = (c % 13) + 1.
// Suits: 0 spades, 1 hearts, 2 diamonds, 3 clubs.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const suitOf = (c) => Math.floor(c / 13);
export const rankOf = (c) => (c % 13) + 1;
export const isRed = (c) => { const s = suitOf(c); return s === 1 || s === 2; };
export const cardName = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

// Small deterministic PRNG so a seed always produces the same deal everywhere.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledDeck(seed) {
  const rnd = mulberry32(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Deal a game. tableau[i] is an array of {c, up}; stock/waste keep their top card last.
// foundations[s] holds the cards of suit s in order.
export function deal(seed, drawCount = 3) {
  const deck = shuffledDeck(seed);
  let k = 0;
  const tableau = [];
  for (let i = 0; i < 7; i++) {
    const pile = [];
    for (let j = 0; j <= i; j++) pile.push({ c: deck[k++], up: j === i });
    tableau.push(pile);
  }
  const stock = deck.slice(k).reverse();
  return {
    seed, drawCount, tableau, stock, waste: [],
    foundations: [[], [], [], []],
  };
}

export function cloneState(s) {
  return {
    ...s,
    tableau: s.tableau.map((p) => p.map((x) => ({ ...x }))),
    stock: s.stock.slice(),
    waste: s.waste.slice(),
    foundations: s.foundations.map((f) => f.slice()),
  };
}

export function canGoToFoundation(state, c) {
  return state.foundations[suitOf(c)].length === rankOf(c) - 1;
}

// Can card c be placed on top of tableau pile `pile`?
export function canGoToTableau(pile, c) {
  if (pile.length === 0) return rankOf(c) === 13;
  const top = pile[pile.length - 1];
  return top.up && rankOf(top.c) === rankOf(c) + 1 && isRed(top.c) !== isRed(c);
}

// Index of the first card of a movable face-up run starting at idx (valid alternating sequence).
export function isMovableRun(pile, idx) {
  if (idx < 0 || idx >= pile.length || !pile[idx].up) return false;
  for (let i = idx; i < pile.length - 1; i++) {
    const a = pile[i].c, b = pile[i + 1].c;
    if (!pile[i + 1].up || rankOf(a) !== rankOf(b) + 1 || isRed(a) === isRed(b)) return false;
  }
  return true;
}

export function isWon(state) {
  return state.foundations.every((f) => f.length === 13);
}

// Draw from stock (or recycle the waste when the stock is empty). Returns false if nothing happened.
export function drawStock(state) {
  if (state.stock.length === 0) {
    if (state.waste.length === 0) return false;
    state.stock = state.waste.reverse();
    state.waste = [];
    return true;
  }
  const n = Math.min(state.drawCount, state.stock.length);
  for (let i = 0; i < n; i++) state.waste.push(state.stock.pop());
  return true;
}
