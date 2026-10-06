// Finds the most recent history snapshot that can still be won.
// Walks back one move at a time from the latest snapshot, so a lost game usually needs
// only one or two solver checks. Only a search that ran to completion counts as lost:
// if the solver runs out of budget the position is not proven lost, so we stop there
// rather than rewinding past a position that may well be winnable.
//
// check(state) resolves to the solver result: { solved } | { solved: false, complete }.
// Returns { index, sure } (sure = solver found a win) or null if every snapshot is lost.
export async function findLastWinnable(history, check) {
  for (let k = history.length - 1; k >= 0; k--) {
    const r = await check(history[k]);
    if (r.solved) return { index: k, sure: true };
    if (!r.complete) return { index: k, sure: false };
  }
  return null;
}
