# Offline Solitaire

Klondike solitaire for tablets. It installs as an app from the browser, works fully offline, and every deal can be won.

- **Draw 3** is the main mode; Draw 1 is in the menu.
- **Every deal is solvable.** `tools/gen-deals.js` runs the solver in `js/solver.js` over seeded shuffles and keeps only the deals it wins, after replaying each solution with the game's own rules (`tools/replay.js`). The app deals only from that bank (`js/deals.js`: 3,000 Draw 3 and 1,000 Draw 1 deals).
- **Hint** runs the same solver in a web worker from the current position, so it points to a move that still leads to a win, and tells you if the position can no longer be won.
- **Offline**: `sw.js` caches every file on the first visit. Bump `VERSION` in `sw.js` when any file changes.

## Install on Android
Open the GitHub Pages URL in Chrome, then menu ⋮ → **Add to Home screen** (or **Install app**).

## Development
No build step: the site is the static files at the repo root.

```
npx http-server -p 8080 -c-1 &
node tools/verify-deals.js   # re-solves a sample of the bank
node tools/state.js "1.3.…"   # looks at a position copied with dev mode (Settings: tap the version 4 times)
node tests/e2e.js            # tablet-sized browser test, including offline and installability
node tools/gen-deals.js 3000 1000   # regenerate the deal bank
node tools/render-icons.js   # re-render PNG icons from icons/*.svg
```
