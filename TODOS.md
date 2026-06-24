# TODOS — TinkerChess

Deferred work, with enough context to pick up cold. Distilled from the M1 design
review (2026-06-22). The durable product/engine roadmap lives in [`ROADMAP.md`](./ROADMAP.md).

Effort scale: human-team estimate → with CC+gstack (S→S, M→S, L→M, XL→L).

---

## P2 — Local pass-and-play (single-device) mode

- **What:** Let two players share one device/tablet — play without two screens or two
  online clients.
- **Why:** The real audience is two kids who are often in the same room with one tablet.
  Removes the "both must be online on separate devices" barrier.
- **Cons / why deferred:** Fog-of-war assumes separate screens. Pass-and-play needs a
  "hide the board, pass the device" handoff flow so the next player doesn't see the
  prior player's hidden phase state. It pokes directly at the core privacy model
  (`getGameView`) and deserves its own design pass, not a bolt-on during M1.
- **Context / where to start:** Add a local game mode that runs both seats on one
  client, gated by an interstitial "pass to <player>" screen that blanks the board
  between turns. Decide whether the engine still runs server-side (recommended, keeps
  one code path) or locally for offline play.
- **Effort:** M (human ~3 days → CC ~1–2 hr) · **Priority:** P2
- **Depends on:** M1 fog/`ScopedView` model finalized.

## P2 — Server-side timeout adjudication (scheduler)

- **What:** End a game on time server-side instead of relying on a connected client
  to claim the flag.
- **Why:** Today `flagTimeout` only fires from a player's open client
  (`GameClient.tsx` `TimeoutFlagger`). If both players close the tab — or only a
  spectator is watching — a running clock that hits zero never ends the game; it
  sits `active` until a player returns. Rated players (the audience) routinely walk
  away from a won position to flag the opponent, so this is lichess-incorrect.
- **Cons / why deferred:** Adds a server scheduling mechanism (more moving parts).
  The current client claim self-heals the moment any player returns (the `commit`
  pre-check or `TimeoutFlagger` fires), so it's a correctness/UX gap, not a
  data-loss bug.
- **Context / where to start:** In `convex/games.ts`, at each clock switch
  (`commit`) schedule `ctx.scheduler.runAfter(remainingMs, internal.games.flagTimeout, …)`
  for the side now on the clock, and cancel/replace it on the next move. Add a
  `flagTimeout` internalMutation variant the scheduler can call (no seatToken). The
  existing `isExpired` + `endByTimeout` already do the adjudication.
- **Effort:** S (human ~1–2 hr → CC ~20 min) · **Priority:** P2
- **Depends on:** chess clock (shipped on `ljagged/chess-clock-and-ui`).

## P3 — Underpromotion picker

- **What:** Let a pawn reaching the last rank promote to knight/bishop/rook, not just
  auto-queen.
- **Why:** Underpromotion-only positions (knight-promotion fork, or avoiding stalemate)
  are currently unplayable — `doMove` always promotes to queen and `onPromotionCheck`
  is disabled. The new legal-move dots make it more visible: the dot says the square is
  legal, but only the queen move is reachable.
- **Cons / why deferred:** Pre-existing limitation, not introduced by the clock work.
  Rare in casual play; needs a small promotion-piece picker UI.
- **Context / where to start:** `GameClient.tsx` `doMove` computes `promotion` — surface
  a 4-way picker (react-chessboard has a promotion dialog, currently suppressed via
  `onPromotionCheck={() => false}`) and pass the chosen piece to `makeMove`.
- **Effort:** S (human ~half day → CC ~20 min) · **Priority:** P3
- **Depends on:** —

## P3 — Archive zero-ply finished games

- **What:** Record a `matches` row even when a timed game ends before any move.
- **Why:** `newGame` only archives when `moves.length > 0`, so a game that ends on
  timeout at ply 0 (white AFK at the start of a blitz game) leaves no "Past games"
  entry. The clock feature newly makes "finished at 0 plies" reachable.
- **Cons / why deferred:** Low value — a 0-move game has nothing to replay; only the
  result line is lost.
- **Context / where to start:** `convex/games.ts` `newGame` — broaden the archive guard
  from `moves.length > 0` to also include a finished status.
- **Effort:** S (human ~15 min → CC ~5 min) · **Priority:** P3
- **Depends on:** —

## P3 — Emoji / one-tap reactions alongside chat

- **What:** Quick one-tap emoji reactions in-game, in addition to text chat.
- **Why:** Kids may not type fast; reactions keep the game social and lighthearted.
- **Cons / why deferred:** Nice-to-have, not load-bearing for M1. Text chat (players-only)
  already ships in M1.
- **Context / where to start:** Reactions are a small per-game event stream over the same
  Convex subscription channel as chat; render as ephemeral overlays.
- **Effort:** S (human ~half day → CC ~20 min) · **Priority:** P3
- **Depends on:** M1 chat channel.

---

## Roadmap (not TODOs — see ROADMAP.md)

The mod system (Tier-1 settings, Tier-2 predicate DSL, Tier-3 scripted mods, the chess
DSL) is the M2/M3 roadmap, not loose TODO items. See [`ROADMAP.md`](./ROADMAP.md) —
specifically "Authoring power partition (three tiers)" and "Milestones".
