# Phase Chess

A fog-of-war chess variant. Every non-pawn piece can **phase out** — leave the
board for a chosen number of turns and reappear on its origin square, removing
whatever sits there (own pieces included). You see your own phased pieces and
their timers; your opponent doesn't, beyond a one-turn, square-only warning
before a piece returns. There is no checkmate: **you win by capturing the king.**

## Rules

Standard chess, plus **phasing**:

- On your turn you may **phase out** an eligible piece instead of moving: it leaves
  the board for a chosen number of your turns and reappears on its origin square at
  the **end** of the last one, removing whatever sits there — **including your own
  pieces** (a footgun) or a king (a win, or a loss if it's your own).
- **Fog of war:** you see your own phased pieces and their timers. Your opponent
  sees only a one-turn, square-only warning the turn before a piece returns — never
  the piece, the duration, or anything sooner.
- **No checkmate:** capturing the king (by a move or a phase-in) wins.
- **Per-game ruleset (Tier-1 settings):** the game creator chooses which piece
  types may phase and each type's maximum duration (0 = can't phase). Defaults:
  knight/bishop 2, rook 3, queen 4, king 1, pawns can't phase. Both players see the
  ruleset; a rematch keeps it.

## Design

The visual system ("Lab Slate") lives in [`DESIGN.md`](./DESIGN.md) — read it before
any UI change. **Hard rule:** never encode a game state with color alone; every state
pairs a shape/border/motion cue with a label (the primary player is colorblind).

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
npx convex dev          # terminal 1: dev deployment (keep running — it deploys schema + functions)
npm run dev             # terminal 2: Next.js on http://localhost:3000 (or 3001 if busy)
```

> Keep `npx convex dev` running while developing. It deploys schema and function
> changes to your dev deployment on save. `npx convex codegen` only regenerates
> types — it does **not** deploy — so backend changes won't take effect under
> codegen alone.

Other commands:

```sh
npm test                # engine unit tests + Convex functional tests (Vitest)
npm run typecheck       # root + convex/ TypeScript
npm run build           # production build
```

## Status

Milestone 1 (polished, deterministic game) is largely complete:

- ✅ **Rules engine** (`src/engine/`) — config-driven ruleset, deterministic replay,
  derived event model, fog-aware notation, exhaustively unit-tested.
- ✅ **Convex backend** — `createGame` / `joinByToken` / `makeMove` / `phaseOut` /
  `getGameView`, the fog-of-war boundary, immutable match archive, per-seat move log,
  idempotent submits + stale-view guard, players-only chat.
- ✅ **Frontend** — "Lab Slate" design system, colorblind-safe board, JohnPablok
  Cburnett pieces (white-outlined black men; flat + drop-shadow variants), phase
  tray (countdown rings), figurine move log, history + replay viewer
  (with a fog perspective toggle), Tier-1 settings picker, in-game chat.
- ✅ **Token-based join** — splash with New Game / Join Game; the initiator shares a
  short `XXXX-XXXX` token and waits; the opponent enters it to join; later joiners
  spectate. White/Black are assigned **randomly** at join.
- ⬜ **Remaining M1 polish** — how-to-play tutorial, sound/motion on phase events.
- ⬜ **Beyond M1** — the mod system (uploadable rule modules), accounts, ratings.
  See [`ROADMAP.md`](./ROADMAP.md) for the full plan.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). In short: the engine is the single source
of rules (keep it pure and tested), the server is authoritative (never bundle the
engine into the client), and all UI follows `DESIGN.md`.

## License

MIT — see [`LICENSE`](./LICENSE). The bundled piece set
(`public/pieces/johnpablok/`, "JohnPablok's improved Cburnett" by John Pablok) is
CC-BY-SA 3.0; see its `ATTRIBUTION.md`.
