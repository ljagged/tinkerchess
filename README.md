# Phase Chess

A fog-of-war chess variant. Every non-pawn piece can **phase out** — leave the
board for a chosen number of turns and reappear on its origin square, removing
whatever sits there (own pieces included). You see your own phased pieces and
their timers; your opponent doesn't, beyond a one-turn, square-only warning
before a piece returns. There is no checkmate: **you win by capturing the king.**

See [`docs/` / the plan](#status) for the full ruleset.

## Architecture

- **`src/engine/`** — the pure, headless rules engine. No I/O, no network: every
  function maps a `GameState` to data or a new `GameState`. This is the single
  source of truth for the variant's rules and is exhaustively unit-tested.
- **`convex/`** — the [Convex](https://convex.dev) backend. A thin layer that owns
  seat identity, persistence, and the fog-of-war boundary, delegating all rules to
  the engine. `getGameView` is the privacy boundary: it returns each caller only
  what they're allowed to see.
- **frontend** — _(Step 3, not yet built)_ Next.js + react-chessboard.

## Requirements

- **Node ≥ 22.** The Convex CLI requires `util.styleText` (Node 21.7+/20.12+);
  the repo pins Node 22 via `.nvmrc`. Run `nvm use` before any Convex command.

## Commands

```sh
nvm use                 # select Node 22
npm install
npm test                # engine unit tests + Convex functional tests (Vitest)
npm run typecheck       # root + convex/ TypeScript
npx convex dev          # run the dev deployment + regenerate convex/_generated
```

## Status

- ✅ **Step 1** — rules engine (`src/engine/`), fully tested.
- ✅ **Step 2** — Convex schema + `createGame` / `joinGame` / `makeMove` /
  `phaseOut` / `getGameView`, delegating to the engine; functional tests at the
  API boundary.
- ⬜ **Step 3** — Next.js board + phasing UI.
- ⬜ **Step 4** — seats, shareable links, spectators, accounts.
- ⬜ **Step 5** — history/replay, Elo, polish.
