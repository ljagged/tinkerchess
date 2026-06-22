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
- **`app/`** — the Next.js (App Router) frontend. A `react-chessboard` driven by
  `getGameView`, with the phasing UI, timers, and token-based join. The engine is
  intentionally **not** bundled into the client — the server is authoritative and
  the client only renders the filtered view it's given.

## Requirements

- **Node ≥ 22.** The Convex CLI requires `util.styleText` (Node 21.7+/20.12+);
  the repo pins Node 22 via `.nvmrc`. Run `nvm use` before any Convex command.

## Commands

Run the app locally with **two processes** (Convex backend + Next.js):

```sh
nvm use                 # select Node 22 (required by the Convex CLI)
npm install
npx convex dev          # terminal 1: dev deployment + regenerates convex/_generated
npm run dev             # terminal 2: Next.js on http://localhost:3000
```

Other commands:

```sh
npm test                # engine unit tests + Convex functional tests (Vitest)
npm run typecheck       # root + convex/ TypeScript
npm run build           # production build
```

## Status

- ✅ **Step 1** — rules engine (`src/engine/`), fully tested.
- ✅ **Step 2** — Convex schema + `createGame` / `joinGame` / `makeMove` /
  `phaseOut` / `getGameView`, delegating to the engine; functional tests at the
  API boundary.
- ✅ **Step 3** — Next.js board + phasing UI (`app/`): a `react-chessboard`
  driven by `getGameView`, drag-to-move, the phase-out flow (pick piece +
  duration), own-timer overlay, opponent warning highlight, and the game-over
  banner / New game. Verified by a live integration smoke against the deployment.
- ✅ **Token-based join** — splash with New Game / Join Game; the initiator
  shares a short `XXXX-XXXX` token and waits; the opponent enters it to join;
  later joiners spectate. White/Black are assigned **randomly** at join.
- ⬜ **Step 4** — real accounts/auth on top of seat tokens.
- ⬜ **Step 5** — history/replay, Elo, polish.
