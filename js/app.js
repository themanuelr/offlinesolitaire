import {
  deal, cloneState, drawStock, canGoToFoundation, canGoToTableau, isMovableRun, isWon,
  suitOf, rankOf, isRed, SUITS, RANKS, mulberry32,
} from './engine.js';
import { DEALS } from './deals.js';
import { findLastWinnable } from './rewind.js';

const $ = (id) => document.getElementById(id);
const board = $('board');
const STORE = 'klondike.v1';
const MAX_HISTORY = 300;

// ---------- persistence ----------

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
let store = loadStore();
store.settings ||= { drawCount: 3 };
store.stats ||= {};
store.order ||= { installSeed: Math.floor(Math.random() * 2 ** 31), pos: { 3: 0, 1: 0 } };

function save() {
  try {
    store.game = game;
    store.history = history.slice(-MAX_HISTORY);
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch { /* storage full or unavailable: the game still works */ }
}

function statsFor(d) {
  return (store.stats[d] ||= { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: null, bestMoves: null });
}

// ---------- game state ----------

let game = null;
let history = [];

// Deals are drawn from the solvable bank in an order unique to this install.
function nextDealIndex(d) {
  const list = DEALS[d];
  const rnd = mulberry32(store.order.installSeed + d);
  const perm = Array.from({ length: list.length }, (_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const pos = store.order.pos[d] || 0;
  store.order.pos[d] = (pos + 1) % list.length;
  return perm[pos % list.length];
}

function startGame(d, dealIndex) {
  const seed = DEALS[d][dealIndex];
  game = {
    ...deal(seed, d),
    dealIndex, moves: 0, score: 0, elapsed: 0, started: false, won: false,
    wasteFan: 0, fslots: [-1, -1, -1, -1],
  };
  history = [];
  clearHint();
  save();
  render(true);
  updateInfo();
}

function newGame(d = store.settings.drawCount) {
  if (game && game.started && !game.won) statsFor(game.drawCount).streak = 0;
  startGame(d, nextDealIndex(d));
}

function restartGame() {
  if (game.started && !game.won) statsFor(game.drawCount).streak = 0;
  startGame(game.drawCount, game.dealIndex);
}

function snapshot() {
  history.push(JSON.stringify(game));
  if (history.length > MAX_HISTORY) history.shift();
}

function markStarted() {
  if (!game.started) {
    game.started = true;
    statsFor(game.drawCount).played++;
  }
}

function undo() {
  if (busy || !history.length || game.won) return;
  restoreHistory(history.length - 1);
}

// Go back to history[k], dropping it and everything after it.
function restoreHistory(k) {
  const prev = JSON.parse(history[k]);
  history.length = k;
  prev.elapsed = game.elapsed;
  prev.moves = game.moves + 1;
  prev.started = game.started;
  game = prev;
  clearHint();
  save();
  render();
  updateInfo();
}

// ---------- moves ----------

function topOf(arr) { return arr[arr.length - 1]; }

function foundationSlotFor(suit, preferred = -1) {
  const at = game.fslots.indexOf(suit);
  if (at >= 0) return at;
  if (preferred >= 0 && game.fslots[preferred] === -1) return preferred;
  return game.fslots.indexOf(-1);
}

// src: {area:'tableau', pile, idx} | {area:'waste'} | {area:'foundation', suit}
function cardsAt(src) {
  if (src.area === 'tableau') {
    const p = game.tableau[src.pile];
    return isMovableRun(p, src.idx) ? p.slice(src.idx).map((x) => x.c) : null;
  }
  if (src.area === 'waste') return game.waste.length ? [topOf(game.waste)] : null;
  if (src.area === 'foundation') {
    const f = game.foundations[src.suit];
    return f.length ? [topOf(f)] : null;
  }
  return null;
}

function canMove(src, dst) {
  const cards = cardsAt(src);
  if (!cards) return false;
  if (dst.area === 'foundation') {
    if (cards.length !== 1 || src.area === 'foundation') return false;
    return canGoToFoundation(game, cards[0]);
  }
  if (dst.area === 'tableau') {
    if (src.area === 'tableau' && src.pile === dst.pile) return false;
    return canGoToTableau(game.tableau[dst.pile], cards[0]);
  }
  return false;
}

function doMove(src, dst, { record = true } = {}) {
  if (!canMove(src, dst)) return false;
  if (record) snapshot();
  markStarted();
  let cards;
  if (src.area === 'tableau') cards = game.tableau[src.pile].splice(src.idx).map((x) => x.c);
  else if (src.area === 'waste') { cards = [game.waste.pop()]; game.wasteFan = Math.max(game.waste.length ? 1 : 0, game.wasteFan - 1); }
  else { cards = [game.foundations[src.suit].pop()]; if (!game.foundations[src.suit].length) game.fslots[game.fslots.indexOf(src.suit)] = -1; }

  if (dst.area === 'foundation') {
    const s = suitOf(cards[0]);
    const slot = foundationSlotFor(s, dst.slot ?? -1);
    game.fslots[slot] = s;
    game.foundations[s].push(cards[0]);
    game.score += 10;
  } else {
    game.tableau[dst.pile].push(...cards.map((c) => ({ c, up: true })));
    if (src.area === 'waste') game.score += 5;
    if (src.area === 'foundation') game.score = Math.max(0, game.score - 15);
  }
  if (src.area === 'tableau') {
    const p = game.tableau[src.pile];
    if (p.length && !topOf(p).up) { topOf(p).up = true; game.score += 5; }
  }
  game.moves++;
  afterChange();
  return true;
}

function draw() {
  if (busy || game.won) return;
  if (!game.stock.length && !game.waste.length) return;
  snapshot();
  markStarted();
  const before = game.stock.length;
  drawStock(game);
  game.wasteFan = before ? Math.min(game.drawCount, before) : 0;
  game.moves++;
  afterChange();
}

function afterChange() {
  clearHint();
  save();
  render();
  updateInfo();
  if (isWon(game)) return onWin();
  maybeOfferFinish();
}

// Where should a tapped card go? Foundation first, then the best tableau pile.
function autoDestination(src) {
  const cards = cardsAt(src);
  if (!cards) return null;
  if (cards.length === 1 && src.area !== 'foundation' && canGoToFoundation(game, cards[0])) return { area: 'foundation' };
  let empty = null;
  for (let i = 0; i < 7; i++) {
    const dst = { area: 'tableau', pile: i };
    if (!canMove(src, dst)) continue;
    if (game.tableau[i].length) return dst;
    // A king already at the bottom of a pile gains nothing from moving to another empty pile.
    if (!(src.area === 'tableau' && src.idx === 0) && !empty) empty = dst;
  }
  return empty;
}

// ---------- win & finish ----------

function onWin() {
  game.won = true;
  stopTimer();
  const st = statsFor(game.drawCount);
  st.won++;
  st.streak++;
  st.bestStreak = Math.max(st.bestStreak, st.streak);
  const secs = Math.round(game.elapsed / 1000);
  if (secs > 30) game.score += Math.min(5000, Math.round(70000 / secs) * 10); // time bonus
  if (st.bestTime == null || secs < st.bestTime) st.bestTime = secs;
  if (st.bestMoves == null || game.moves < st.bestMoves) st.bestMoves = game.moves;
  save();
  updateInfo();
  $('win-text').textContent = `Time ${fmtTime(secs)} · ${game.moves} moves · score ${game.score}`;
  celebrate();
  setTimeout(() => $('win').showModal(), 1300);
}

function celebrate() {
  const w = board.clientWidth, h = board.clientHeight;
  for (const el of cardEls.values()) {
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * w * 1.4}px`);
    el.style.setProperty('--dy', `${h * (0.6 + Math.random() * 0.6)}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    el.style.animationDelay = `${Math.random() * 0.6}s`;
    el.classList.add('fly');
  }
}

let finishOffered = false;
function maybeOfferFinish() {
  if (finishOffered || game.won) return;
  if (game.tableau.some((p) => p.some((x) => !x.up))) return;
  finishOffered = true;
  askSolver(200000).then((r) => {
    if (r.solved && !game.won && !busy) {
      toast('All cards are face up. Finishing for you…');
      playPath(r.path);
    } else finishOffered = false;
  });
}

let busy = false;
async function playPath(path) {
  busy = true;
  snapshot();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const m of path) {
    if (m.t === 'wf' || m.t === 'wt') {
      let guard = 200;
      while (game.waste.length !== m.w && guard--) {
        const before = game.stock.length;
        drawStock(game);
        game.wasteFan = before ? Math.min(game.drawCount, before) : 0;
        game.moves++;
        render(); updateInfo();
        await wait(90);
      }
      doMove({ area: 'waste' }, m.t === 'wf' ? { area: 'foundation' } : { area: 'tableau', pile: m.to }, { record: false });
    } else if (m.t === 'tf') {
      doMove({ area: 'tableau', pile: m.from, idx: game.tableau[m.from].length - 1 }, { area: 'foundation' }, { record: false });
    } else if (m.t === 'tt') {
      doMove({ area: 'tableau', pile: m.from, idx: m.idx }, { area: 'tableau', pile: m.to }, { record: false });
    } else if (m.t === 'ft') {
      doMove({ area: 'foundation', suit: m.suit }, { area: 'tableau', pile: m.to }, { record: false });
    }
    if (game.won) break;
    await wait(110);
  }
  busy = false;
}

// ---------- hints (solver runs in a worker) ----------

let worker = null;
let solverReq = 0;
function askSolver(maxNodes, state = game) {
  if (!worker) worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
  const id = ++solverReq;
  const { tableau, stock, waste, foundations, drawCount } = state;
  return new Promise((resolve) => {
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMsg);
      resolve(e.data.result);
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id, maxNodes, game: { tableau, stock, waste, foundations, drawCount } });
  });
}

let hintEls = [];
function clearHint() {
  for (const el of hintEls) el.classList.remove('hint');
  hintEls = [];
}
function highlight(...els) {
  clearHint();
  hintEls = els.filter(Boolean);
  for (const el of hintEls) el.classList.add('hint');
  setTimeout(clearHint, 2600);
}

function tableauTarget(pile) {
  const p = game.tableau[pile];
  return p.length ? cardEls.get(topOf(p).c) : slotEls.tableau[pile];
}

async function hint() {
  if (busy || game.won) return;
  toast('Thinking…', 800);
  const r = await askSolver(80000);
  if (r.solved && r.path.length) return showHint(r.path[0]);
  if (r.complete) return offerRewind();
  const simple = simpleHint();
  if (simple) return showHint(simple);
  toast('No moves left. Try Undo.');
}

// The game is lost: offer to undo back to the last position that can still be won.
function offerRewind() {
  const dlg = $('stuck');
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener('close', () => { if (dlg.returnValue === 'back') rewind(); }, { once: true });
}

// Undo back to the most recent position that can still be won (see rewind.js).
async function rewind() {
  if (busy) return;
  busy = true;
  toast('Looking for the last winnable position…', 60000);
  const check = async (snap) => {
    const state = JSON.parse(snap);
    const r = await askSolver(150000, state);
    return r.solved || r.complete ? r : askSolver(500000, state);
  };
  const found = await findLastWinnable(history, check);
  busy = false;
  if (!found) return toast('Could not find a winnable position. Try Restart from the menu.', 3500);
  const back = history.length - found.index;
  restoreHistory(found.index);
  const moves = `Went back ${back} move${back === 1 ? '' : 's'}.`;
  toast(found.sure ? `${moves} This position can still be won.` : `${moves} This position may still be won.`, 3000);
}

function showHint(m) {
  if (m.t === 'wf' || m.t === 'wt') {
    if (game.waste.length !== m.w) return highlight(game.stock.length ? cardEls.get(topOf(game.stock)) : slotEls.stock);
    const from = cardEls.get(topOf(game.waste));
    return highlight(from, m.t === 'wf' ? foundationTarget(suitOf(topOf(game.waste))) : tableauTarget(m.to));
  }
  if (m.t === 'tf') {
    const c = topOf(game.tableau[m.from]).c;
    return highlight(cardEls.get(c), foundationTarget(suitOf(c)));
  }
  if (m.t === 'tt') return highlight(cardEls.get(game.tableau[m.from][m.idx].c), tableauTarget(m.to));
  if (m.t === 'ft') return highlight(cardEls.get(topOf(game.foundations[m.suit])), tableauTarget(m.to));
}

function foundationTarget(suit) {
  const slot = foundationSlotFor(suit);
  const f = game.foundations[suit];
  return f.length ? cardEls.get(topOf(f)) : slotEls.found[slot];
}

// Used only if the solver runs out of time: any useful legal move, else draw.
function simpleHint() {
  for (let i = 0; i < 7; i++) {
    const p = game.tableau[i];
    if (p.length && canGoToFoundation(game, topOf(p).c)) return { t: 'tf', from: i };
  }
  if (game.waste.length && canGoToFoundation(game, topOf(game.waste))) return { t: 'wf', w: game.waste.length };
  for (let i = 0; i < 7; i++) {
    const p = game.tableau[i];
    const idx = p.findIndex((x) => x.up);
    if (idx > 0) for (let j = 0; j < 7; j++) if (j !== i && canMove({ area: 'tableau', pile: i, idx }, { area: 'tableau', pile: j })) return { t: 'tt', from: i, idx, to: j };
  }
  if (game.waste.length) for (let j = 0; j < 7; j++) if (canMove({ area: 'waste' }, { area: 'tableau', pile: j })) return { t: 'wt', w: game.waste.length, to: j };
  if (game.stock.length || game.waste.length) return { t: 'wf', w: -1 };
  return null;
}

// ---------- layout & rendering ----------

const cardEls = new Map();
const slotEls = { stock: null, waste: null, found: [], tableau: [] };
let L = null; // current layout metrics

function makeCard(c) {
  const el = document.createElement('div');
  el.className = 'card ' + (isRed(c) ? 'red' : 'black');
  el.dataset.card = c;
  el.classList.add('su' + suitOf(c));
  const r = rankOf(c);
  // Suit shapes are CSS background images (see style.css): far cheaper to paint than inline SVG.
  const center = r > 10 ? `<div class="face"><b>${RANKS[r]}</b><i></i></div>` : '<i class="pip"></i>';
  el.innerHTML = `<div class="idx${r === 10 ? ' ten' : ''}">${RANKS[r]}</div><i class="s1"></i>${center}`;
  return el;
}

function makeSlot(cls, text = '') {
  const el = document.createElement('div');
  el.className = 'slot ' + cls;
  el.textContent = text;
  board.appendChild(el);
  return el;
}

function buildBoard() {
  board.innerHTML = '';
  slotEls.stock = makeSlot('stock');
  slotEls.waste = makeSlot('waste');
  slotEls.found = [0, 1, 2, 3].map(() => makeSlot('found', 'A'));
  slotEls.tableau = [0, 1, 2, 3, 4, 5, 6].map(() => makeSlot('tab'));
  for (let c = 0; c < 52; c++) {
    const el = makeCard(c);
    cardEls.set(c, el);
    board.appendChild(el);
  }
}

function computeLayout() {
  const bw = board.clientWidth, bh = board.clientHeight;
  const gap = Math.max(5, Math.round(bw * 0.012));
  let w = (bw - gap * 8) / 7;
  let h = w * 1.4;
  const maxH = (bh - gap * 3) / 3.15;
  if (h > maxH) { h = maxH; w = h / 1.4; }
  w = Math.floor(w); h = Math.floor(w * 1.4);
  const left = Math.round((bw - (7 * w + 6 * gap)) / 2);
  document.documentElement.style.setProperty('--cw', w + 'px');
  document.documentElement.style.setProperty('--ch', h + 'px');
  return { bw, bh, w, h, gap, left, top: gap, tabTop: gap * 2 + h + Math.round(gap * 0.6), colX: (i) => left + i * (w + gap) };
}

function pileOffsets(pile) {
  // Fan offsets that shrink when a pile would run off the bottom of the board.
  let down = L.h * 0.11, up = L.h * 0.27;
  const avail = L.bh - L.tabTop - L.h - L.gap;
  const nDown = pile.filter((x) => !x.up).length;
  const nUp = Math.max(0, pile.length - nDown - 1);
  const need = nDown * down + nUp * up;
  if (need > avail && need > 0) {
    down = Math.max(L.h * 0.05, down * (avail / need));
    const rest = avail - nDown * down;
    up = nUp ? Math.max(L.h * 0.08, Math.min(up, rest / nUp)) : up;
  }
  return { down, up };
}

// A card on the move rides above everything until it lands, then takes its real stacking order.
const MOVE_MS = 180;

// Cards are positioned with the CSS `translate` property so moves animate on the GPU
// compositor instead of re-running layout and repainting the table every frame.
function setPos(el, x, y) {
  el.px = x;
  el.py = y;
  el.style.translate = `${x}px ${y}px`;
}

function place(el, x, y, z, up, instant) {
  x = Math.round(x); y = Math.round(y); // whole pixels keep edges and text crisp
  const moving = !instant && el.px !== undefined && (el.px !== x || el.py !== y);
  setPos(el, x, y);
  clearTimeout(el.landTimer);
  if (moving || (el.landTimer && !instant)) {
    if (moving) el.style.zIndex = 1000 + z;
    el.landTimer = setTimeout(() => { el.style.zIndex = z; el.landTimer = null; }, MOVE_MS);
  } else {
    el.style.zIndex = z;
    el.landTimer = null;
  }
  el.classList.toggle('down', !up);
}

function render(fresh = false) {
  if (!L || fresh) L = computeLayout();
  const { w, top, tabTop, colX } = L;
  if (fresh) for (const el of cardEls.values()) { el.classList.remove('fly'); el.style.animationDelay = ''; }

  const setSlot = (el, x, y) => { el.style.left = x + 'px'; el.style.top = y + 'px'; };
  setSlot(slotEls.stock, colX(0), top);
  setSlot(slotEls.waste, colX(1), top);
  slotEls.waste.style.visibility = 'hidden';
  slotEls.found.forEach((el, i) => setSlot(el, colX(3 + i), top));
  slotEls.tableau.forEach((el, i) => setSlot(el, colX(i), tabTop));
  slotEls.stock.classList.toggle('empty-final', !game.stock.length && !game.waste.length);

  // Stock.
  game.stock.forEach((c, i) => place(cardEls.get(c), colX(0), top, 10 + i, false, fresh));

  // Waste: the last drawn cards fan out to the right.
  const fan = Math.min(game.wasteFan, game.waste.length);
  const fanStep = w * 0.36;
  game.waste.forEach((c, i) => {
    const fromTop = game.waste.length - 1 - i;
    const k = fromTop < fan ? fan - 1 - fromTop : 0;
    place(cardEls.get(c), colX(1) + k * fanStep, top, 100 + i, true, fresh);
  });

  // Foundations.
  game.fslots.forEach((suit, slot) => {
    if (suit < 0) return;
    game.foundations[suit].forEach((c, i) => place(cardEls.get(c), colX(3 + slot), top, 200 + i, true, fresh));
  });
  slotEls.found.forEach((el, slot) => { el.textContent = game.fslots[slot] >= 0 ? '' : 'A'; });

  // Tableau.
  game.tableau.forEach((pile, i) => {
    const { down, up } = pileOffsets(pile);
    let y = tabTop;
    pile.forEach((x, j) => {
      place(cardEls.get(x.c), colX(i), y, 300 + j, x.up, fresh);
      y += x.up ? up : down;
    });
  });
}

// ---------- info bar, timer, toast ----------

function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function updateInfo() {
  $('info-mode').textContent = `Draw ${game.drawCount} · Game ${game.dealIndex + 1}`;
  $('info-time').textContent = fmtTime(Math.floor(game.elapsed / 1000));
  $('info-moves').textContent = game.moves;
  $('info-score').textContent = game.score;
  $('btn-undo').disabled = !history.length || game.won;
}

let lastTick = performance.now();
let timer = null;
function startTimer() {
  if (timer) return;
  lastTick = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    if (game.started && !game.won && document.visibilityState === 'visible') {
      game.elapsed += now - lastTick;
      $('info-time').textContent = fmtTime(Math.floor(game.elapsed / 1000));
    }
    lastTick = now;
  }, 500);
}
function stopTimer() { /* the interval keeps running but ignores won games */ }

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- input: tap and drag ----------

function locate(c) {
  for (let i = 0; i < 7; i++) {
    const idx = game.tableau[i].findIndex((x) => x.c === c);
    if (idx >= 0) return { area: 'tableau', pile: i, idx, up: game.tableau[i][idx].up };
  }
  if (game.stock.includes(c)) return { area: 'stock' };
  if (game.waste.length && topOf(game.waste) === c) return { area: 'waste' };
  if (game.waste.includes(c)) return { area: 'waste-under' };
  const s = suitOf(c);
  if (game.foundations[s].length && topOf(game.foundations[s]) === c) return { area: 'foundation', suit: s };
  return { area: 'none' };
}

let drag = null;

function rectsOverlap(a, b) {
  const x = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));
  const y = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  return x * y;
}

function dropTarget(src, x, y) {
  const card = { l: x, t: y, r: x + L.w, b: y + L.h };
  let best = null, bestArea = 0;
  const consider = (dst, rect) => {
    const a = rectsOverlap(card, rect);
    if (a > bestArea && canMove(src, dst)) { best = dst; bestArea = a; }
  };
  for (let i = 0; i < 4; i++) {
    const x0 = L.colX(3 + i);
    consider({ area: 'foundation', slot: i }, { l: x0, t: L.top, r: x0 + L.w, b: L.top + L.h });
  }
  for (let i = 0; i < 7; i++) {
    const x0 = L.colX(i);
    const p = game.tableau[i];
    const topEl = p.length ? cardEls.get(topOf(p).c) : null;
    const ty = topEl ? topEl.py : L.tabTop;
    consider({ area: 'tableau', pile: i }, { l: x0, t: Math.min(ty, L.tabTop), r: x0 + L.w, b: ty + L.h * 1.3 });
  }
  return best;
}

board.addEventListener('pointerdown', (e) => {
  if (busy || game.won || drag) return;
  const el = e.target.closest('.card, .slot');
  if (!el) return;
  if (el.classList.contains('slot')) {
    if (el === slotEls.stock) { drag = { tapStock: true, id: e.pointerId }; }
    return;
  }
  const c = Number(el.dataset.card);
  const loc = locate(c);
  if (loc.area === 'stock') { drag = { tapStock: true, id: e.pointerId }; return; }
  if (loc.area === 'tableau' && !loc.up) return;
  if (!['tableau', 'waste', 'foundation'].includes(loc.area)) return;
  const src = loc.area === 'tableau' ? { area: 'tableau', pile: loc.pile, idx: loc.idx } : loc;
  const cards = cardsAt(src);
  if (!cards) { if (loc.area === 'tableau') shake(el); return; }
  const els = cards.map((k) => cardEls.get(k));
  drag = {
    id: e.pointerId, src, els, sx: e.clientX, sy: e.clientY, moved: false,
    orig: els.map((x) => ({ l: x.px, t: x.py, z: x.style.zIndex })),
  };
  board.setPointerCapture(e.pointerId);
});

board.addEventListener('pointermove', (e) => {
  if (!drag || drag.tapStock || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 8) return;
  if (!drag.moved) {
    drag.moved = true;
    clearHint();
    drag.els.forEach((el, i) => { el.classList.add('dragging'); el.style.zIndex = 1000 + i; });
  }
  drag.els.forEach((el, i) => setPos(el, drag.orig[i].l + dx, drag.orig[i].t + dy));
});

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (d.tapStock) { if (!cancelled) draw(); return; }
  d.els.forEach((el) => el.classList.remove('dragging'));
  if (cancelled) return render();
  if (!d.moved) {
    const dst = autoDestination(d.src);
    if (!dst || !doMove(d.src, dst)) shake(d.els[0]);
    return;
  }
  const x = d.els[0].px, y = d.els[0].py;
  const dst = dropTarget(d.src, x, y);
  if (!dst || !doMove(d.src, dst)) render();
}
board.addEventListener('pointerup', (e) => endDrag(e, false));
board.addEventListener('pointercancel', (e) => endDrag(e, true));

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 300);
}

// ---------- menu, stats, buttons ----------

function renderMenu() {
  $('menu-deal').textContent = `Draw ${game.drawCount} · Game ${game.dealIndex + 1} of ${DEALS[game.drawCount].length}`;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.draw) === store.settings.drawCount));
}

function renderStats() {
  const row = (label, f) => `<tr><td>${label}</td><td>${f(statsFor(3))}</td><td>${f(statsFor(1))}</td></tr>`;
  const pct = (s) => (s.played ? Math.round((100 * s.won) / s.played) + '%' : '–');
  $('stats-body').innerHTML = `<table class="stats">
    <tr><th></th><th>Draw 3</th><th>Draw 1</th></tr>
    ${row('Played', (s) => s.played)}
    ${row('Won', (s) => s.won)}
    ${row('Win rate', pct)}
    ${row('Current streak', (s) => s.streak)}
    ${row('Best streak', (s) => s.bestStreak)}
    ${row('Best time', (s) => (s.bestTime == null ? '–' : fmtTime(s.bestTime)))}
    ${row('Fewest moves', (s) => s.bestMoves ?? '–')}
  </table>`;
}

$('btn-new').onclick = () => { if (!busy) newGame(); };
$('btn-undo').onclick = undo;
$('btn-hint').onclick = hint;
$('btn-menu').onclick = () => { renderMenu(); $('menu').showModal(); };
$('btn-restart').onclick = () => { $('menu').close(); if (!busy) restartGame(); };
$('btn-stats').onclick = () => { $('menu').close(); renderStats(); $('stats').showModal(); };
document.querySelectorAll('.seg button').forEach((b) => {
  b.onclick = () => {
    const d = Number(b.dataset.draw);
    if (d === store.settings.drawCount) return;
    store.settings.drawCount = d;
    renderMenu();
    $('menu').close();
    newGame(d);
    toast(`Draw ${d} selected`);
  };
});
$('win').addEventListener('close', () => newGame());

window.addEventListener('resize', () => { L = computeLayout(); render(); });
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); save(); });

// ---------- start ----------

buildBoard();
if (store.game && DEALS[store.game.drawCount]) {
  game = store.game;
  history = store.history || [];
  render(true);
  updateInfo();
  if (game.won) newGame();
} else {
  newGame();
}
startTimer();

// Expose a tiny API for automated tests.
window.__solitaire = {
  get game() { return game; },
  draw, doMove, newGame, undo, hint, rewind, autoDestination,
  playSolution: async () => { const r = await askSolver(400000); if (r.solved) await playPath(r.path); return r.solved; },
};

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
