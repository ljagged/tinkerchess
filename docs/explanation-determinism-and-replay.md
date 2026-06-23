# Explanation: Determinism, derived events, and replay

Phase Chess stores a finished game as a **ruleset plus an ordered list of
actions** — not as board snapshots. The whole game, including each player's fog at
every step, is re-derived on demand by replaying those actions through the engine.
This document explains why that works, what makes it safe, and what it buys.

For signatures see [`replay` and `applyActionWithEvents`](./reference-engine-api.md#game-lifecycle)
and [`getMatchReplay`](./reference-backend-api.md#getmatchreplay).

## The problem

A game produces a lot of state: a board after every ply, captured lists, castling
rights, en-passant targets, phase timers. You want three things from history:

- a **move log** that reads correctly for each seat (with the fog applied),
- **replay** of a finished game from either side's perspective or fully revealed,
- an **archive** that survives a rematch recycling the live game row.

The tempting approach is to snapshot the board after each move and store the
snapshots. That's heavy, it duplicates information, and it rots: the day you add a
field to `GameState`, every stored snapshot is a different shape than the engine
now expects.

## The approach: a deterministic reducer

The engine is a **pure, deterministic reducer**. `applyAction(state, action)`
depends only on its inputs — no `Date.now`, no `Math.random`, no I/O, no hidden
mutation. The one place randomness exists (which side is White) is resolved in the
backend at join time and then **baked into the stored ruleset/seat mapping**, not
re-rolled. So:

```ts
replay(actions) === replay(actions)   // always, byte for byte
```

Given the same starting ruleset and the same action list, you always land on the
same state. That single property is what makes everything below possible.

```
stored:   config  +  [action, action, action, …]
                          │  replay through the engine
                          ▼
          state₀ → state₁ → state₂ → …            (re-derived, never stored)
                          │  viewFor / revealView per frame
                          ▼
          what each seat saw, or the full truth
```

An archived match is therefore **fully self-describing**: ruleset + ordered
action/event log replays the whole game. No board snapshots needed.

## Derived events: intent vs. what happened

Each ply stores **two** things (see [`schema.ts`](../convex/schema.ts), the
`moves` table):

- **`action`** — the raw *intent*: "move e2→e4", "phase out f1 for 3". This is
  what `replay` consumes.
- **`events`** — the *derived* `GameEvent`s: what the action actually did with all
  consequences resolved (capture, en-passant, castle, promotion, check, and any
  end-of-turn phase-ins). One action yields one initiating event plus zero or more
  `phaseIn` events.

Why store both? The action is enough to replay, but the **event** is what the move
log and notation render. Persisting the derived event keeps the log
**self-describing and replay-stable as the engine evolves** — an old row already
carries what happened, so rendering it never depends on re-running a possibly
newer engine over an old intent. `applyActionWithEvents` is the single source of
truth that produces both together.

A worked example of the two-part shape: phasing a rook out for 1 turn, then its
return capturing a knight, are recorded across the plies as
`[{kind:"phaseOut", …}]` then later `[{kind:"phaseIn", capture:{type:"n"}, …}]` —
intent and consequence, each self-contained.

## Replay reproduces fog, not just the board

Because the engine is deterministic *and* the fog filter is a pure function of
state, replay can reproduce **what a specific seat saw** at each step, not just the
final board. `getMatchReplay` re-derives every frame and runs it through:

- **`viewFor(state, "w" | "b")`** for a seat perspective — that seat's fog **as it
  was at the time** (their own phased pieces, the one-turn warnings they got), or
- **`revealView(state)`** for `"full"` — both sides' phased pieces exposed.

The move log in replay is always the **true** log (the game is over, so there's
nothing left to hide). See [Fog of war](./explanation-fog-of-war.md) for why
reveal-after-end is safe.

## The archive: history survives a rematch

A rematch (`newGame`) **recycles the live `games` row** — same seats, same join
code, re-randomized sides, board reset. If history lived only on that row, every
rematch would destroy the prior game.

So `newGame` snapshots the finished game into the **immutable `matches` table**
*before* resetting: the ruleset, the ordered action/event log, and the
seat→color token mapping (so a viewer can recover "their" perspective for replay).
Only after the archive write does it clear the live move log. History is preserved,
not destroyed — and because a match stores actions, the archive is small and
replays exactly.

## Trade-offs

- **Replay cost is O(plies).** Re-deriving frames means replaying the whole game
  each time `getMatchReplay` runs, rather than reading a stored snapshot. For a
  board game's ply counts this is trivial, and it buys a far smaller, rot-proof
  archive. If games ever got pathologically long, frame caching would be the
  escape hatch — not needed at M1.
- **Determinism is a standing constraint, not a one-time choice.** The moment any
  rule reaches for `Date.now`/`Math.random` or mutates an input, replay diverges
  and the archive lies. This is why "keep the engine pure and deterministic" is a
  [hard contributing rule](../CONTRIBUTING.md), enforced by the replay and
  determinism tests ([`src/engine/replay.test.ts`](../src/engine/replay.test.ts),
  [`src/engine/events.test.ts`](../src/engine/events.test.ts)). Randomness that
  *must* exist (side assignment) is resolved at the boundary and frozen into stored
  data, never re-rolled during replay.
- **Stored events couple to the schema.** Persisting derived events means the
  `gameEventV` validator must mirror the engine's `GameEvent` union; a new event
  field has to be added in both places. The payoff is logs that render without
  re-running the engine, and the strict validator catches drift at insert time.

## Related

- [Engine API: game lifecycle](./reference-engine-api.md#game-lifecycle) — `applyActionWithEvents`, `replay`.
- [Backend API: `getMatchReplay` / `newGame`](./reference-backend-api.md#getmatchreplay) — the archive and replay endpoints.
- [Fog of war](./explanation-fog-of-war.md) — why per-seat replay reproduces the original fog.
- [`ROADMAP.md`](../ROADMAP.md) — determinism is the foundation the mod system is built on.
