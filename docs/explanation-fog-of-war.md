# Explanation: The fog-of-war model

Phase Chess is a hidden-information game. When you phase a piece out, your
opponent must not learn where it went or when it returns — beyond a single,
deliberate one-turn warning. This document explains how that secrecy is enforced,
why it lives where it does, and what the boundary deliberately reveals.

If you just want the function signatures, see
[`viewFor` in the engine reference](./reference-engine-api.md#views-the-privacy-boundary)
and [`getGameView` in the backend reference](./reference-backend-api.md#getgameview).

## The problem

The authoritative `GameState` knows everything: it holds a `phased` array listing
every off-board piece for **both** colors, each with its `origin` square and
`returnOn` timer. That's exactly the information the variant is built to hide.

The naive failure is to send the state to the client and "hide" the secret parts
in the UI. That leaks immediately — the hidden data is sitting in the browser, one
dev-tools panel away. A second, subtler failure is to filter in *most* places but
forget one: a move log that prints the opponent's phase-out duration, a replay
endpoint that reveals a live game, a "captured pieces" list that implies a timer.
Any single leak breaks the whole mechanic.

So the requirement is sharp: **no code path that a viewer can reach may carry an
opponent's hidden state** — not the board view, not the move log, not the chat,
not replay of an unfinished game.

## The approach: one server-side filter, and the secret never ships

Two rules do the work.

**1. The server is authoritative; the engine is never bundled into the client.**
The browser never holds a full `GameState`. It only ever renders the *filtered*
output of `getGameView`. There is nothing to inspect because the secret was never
sent.

**2. There is a single canonical filter, `viewFor(state, viewer)`.** Every
view a player can reach derives from it. It is the one place that decides what a
seat may see, so the rules live in one auditable function instead of scattered
across endpoints.

```
                 full GameState (server only)
                          │
                   viewFor(state, viewer)        ← the boundary
                          │
        ┌─────────────────┼─────────────────┐
     viewer "w"        viewer "b"      viewer "spectator"
   sees own phased   sees own phased     sees neither
   + opp warning     + opp warning       no warnings
```

What `viewFor` returns to a **player**:

- `board` — in-play pieces only. Phased pieces (either color) are simply absent.
- `yourPhased` — **the viewer's own** phased pieces, with a `turnsRemaining`
  countdown. This is the viewer's own secret, so they get it in full.
- `warningSquares` — origin squares of the **opponent's** pieces returning at the
  end of the opponent's next turn. **Square only** — never the piece identity,
  never the timer, never any earlier than one turn out.
- everything else (turn, status, captured, etc.) is public game state.

A **spectator** gets the board and public state but **no** `yourPhased` and **no**
`warningSquares` — they hold no seat, so they see no hidden information for either
side. `state.phased` itself is never serialized to anyone.

## The two deliberate leaks (and why they're safe)

Perfect secrecy isn't the goal; a *playable* secret is. Two things are revealed on
purpose:

1. **A piece vanishing from a visible square.** When you phase out, the opponent
   sees that square go empty. They know *which* piece left and *from where* —
   that's unavoidable, the board is public. What they never learn is the
   **duration**. In the live move log this shows as `Bf1↑?` (see
   [`toSeatNotation`](./reference-engine-api.md#notation)): piece and origin
   visible, duration redacted to `?`.

2. **The one-turn return warning.** The turn before an opponent's piece returns,
   its origin square is flagged (`warningSquares`). Square only. This gives the
   defender a single move to react, which is what makes phase-ins a duel rather
   than an ambush with no counterplay.

Everything else about the opponent's phased piece — the exact timer, whether
there even *is* a piece versus a bluff you're imagining — stays hidden until it
returns.

## Where the boundary is enforced

The filter is engine-level (`viewFor`), but every *reachable* path has to honor
it. The backend ([`convex/games.ts`](../convex/games.ts)) is where viewer identity
is established and the boundary is applied:

- **Viewer identity comes only from the seat token.** `viewerFromToken` maps a
  capability token to `"w"`, `"b"`, or `"spectator"`. A client can't claim a color
  by passing an argument — there's no argument to pass.
- **`getGameView`** wraps `viewFor` and adds lifecycle (`phase`, `role`,
  `joinToken`) without widening what's visible. The `joinToken` is returned only
  to the initiator and active players, never to spectators.
- **`getMoveLog`** renders each event through `toSeatNotation` while the game is
  active, so the opponent's durations are redacted. It returns rendered strings
  plus public highlight squares — **raw events with durations are never returned**,
  so even a malicious client can't reconstruct a timer.
- **`getMatchReplay`** only ever runs against the immutable `matches` archive — a
  **finished** game. Once a game is over there's no secret left, so full reveal is
  fine. A live game has no replay path. "Watch from a seat" perspectives still go
  through `viewFor` so they reproduce that seat's fog as it was.

## Trade-offs and what protects them

- **One filter, many call sites.** Centralizing in `viewFor` means correctness
  hinges on every endpoint actually routing through it. The mitigation is a
  **property-based privacy test** ([`src/engine/privacy.test.ts`](../src/engine/privacy.test.ts))
  that asserts a viewer's output never contains an opponent's phased piece beyond
  the allowed square warning, across generated game states. Keep it green — it's
  the backstop against a future endpoint quietly leaking.
- **Reveal-after-end is a hard switch.** The model treats "game over" as the
  moment secrecy ends: the move log flips to the true, unredacted log
  (`revealed: true`) and `revealView` exposes both sides. This is intentional —
  post-game analysis needs the truth — but it means `revealView` must **never** be
  reachable for a live game. The type system and the archive-only query keep those
  paths separate.
- **No accounts, capability tokens instead.** Simpler and shareable, but a leaked
  seat token *is* the seat. That's an acceptable trade for a link-shareable game;
  persistent identity is explicitly out of scope for M1 (see
  [`ROADMAP.md`](../ROADMAP.md)).

## Related

- [Engine API: views](./reference-engine-api.md#views-the-privacy-boundary)
- [Backend API: `getGameView`](./reference-backend-api.md#getgameview)
- [Determinism & replay](./explanation-determinism-and-replay.md) — how the archive replays a finished game's fog.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — "the server is authoritative; never bundle the engine into the client."
