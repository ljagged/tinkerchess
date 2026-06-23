# Reference: Backend API (`convex/`)

The Convex backend is a **thin layer**. It owns three things — **seat identity**
(which color a caller is), **persistence**, and the **fog-of-war boundary** — and
delegates *all* rules to the pure engine ([engine API](./reference-engine-api.md)).
Every function lives in [`convex/games.ts`](../convex/games.ts); the data model is
[`convex/schema.ts`](../convex/schema.ts).

```ts
// client
import { api } from "@/convex/_generated/api";
const create = useMutation(api.games.createGame);
const view   = useQuery(api.games.getGameView, { gameId, seatToken });
```

## Identity model

There are no accounts. Authorization is **capability tokens** — holding a seat
token *is* the right to act as that color.

- **`joinToken`** — the short, shareable 8-character code (e.g. `BKMQ7TRW`,
  displayed as `BKMQ-7TRW`). Anyone with it enters the game: as the **opponent**
  if a seat is open, otherwise as a **spectator**. Charset excludes ambiguous
  `0 O 1 I L`; input is canonicalized (uppercase, `A–Z`/`0–9` only).
- **`seatToken`** — a per-seat secret (`crypto.randomUUID()`). The creator gets
  `initiatorToken`; the joiner gets `opponentToken`. **White/Black are mapped onto
  those two seats at random** when the opponent joins, so a color token points at
  one of the two seats. A caller's color is resolved **only** from their token,
  never from a client-supplied argument.

A game is **waiting** while `opponentToken` is null, and **active** once someone
joins. The `joinToken` is returned **only** to the waiting initiator and to active
players (so they can invite spectators) — never to spectators.

## Mutations

### `createGame`

```ts
args:    { config?: RuleConfig; name?: string }
returns: { gameId: Id<"games">; joinToken: string; seatToken: string }
```

Create a game. `config` (Tier-1 Settings) is **sanitized** server-side — every
per-type duration is clamped to an integer in `0..8`; omit it for the engine
default. `name` is trimmed and capped at 24 chars. The returned `seatToken` is the
creator's `initiatorToken`; hold onto it. Save `joinToken` to share.

### `joinByToken`

```ts
args:    { token: string; name?: string }
returns: { gameId; role: "player" | "spectator"; seatToken: string | null }
```

Enter a game by its join token. If a seat is open the caller becomes the
**opponent** (colors are assigned at random across both seats here) and gets a
`seatToken`. If both seats are taken they **spectate** (`role: "spectator"`,
`seatToken: null`). Throws if no game matches the token.

### `makeMove`

```ts
args:    { gameId; seatToken; from: number; to: number;
           promotion?: PieceType; requestId?: string; expectedPly?: number }
returns: GameView   // the actor's fog-filtered view after the move
```

Apply a normal move. Rejects spectators and out-of-turn callers. The engine
validates legality and throws on an illegal move. Two robustness guards:

- **`requestId`** (idempotency): a retried submission with the same key returns the
  current view **without re-applying**. Convex can re-send a committed mutation if
  the ack is lost; the turn-gate alone would mis-reject that as "not your turn".
- **`expectedPly`** (stale-view): if given and it doesn't match the live ply, the
  call is rejected so the client refreshes rather than acting on an outdated board.

### `phaseOut`

```ts
args:    { gameId; seatToken; from: number; duration: number;
           requestId?: string; expectedPly?: number }
returns: GameView
```

Phase an eligible piece out for `duration` of the owner's turns. Same identity,
turn-order, idempotency, and stale-view guards as `makeMove`. The engine enforces
phase-eligibility, the duration cap, and the king-not-in-check rule.

### `newGame`

```ts
args:    { gameId; seatToken }
returns: null
```

Rematch: keep the same two seats and join code, **re-randomize** sides, and carry
the **same ruleset** forward (no silent reset to defaults). Either player may
trigger it; spectators are rejected. The finished game is first snapshotted into
the immutable `matches` archive **before** the live `games` row is reset and its
move log cleared — history is preserved, not destroyed.

### `sendMessage`

```ts
args:    { gameId; seatToken; text: string }
returns: null
```

Post a chat message. **Players only** — spectators are rejected. Empty/whitespace
text is ignored; longer than 500 chars is capped.

## Queries

All queries are **live** (Convex subscriptions): the UI re-renders when the
underlying data changes.

### `getGameView`

```ts
args:    { gameId; seatToken? }
returns: (GameView & {
           phase: "waiting" | "active";
           role: "initiator" | "player" | "spectator";
           joinToken: string | null;     // only for initiator/player
           rules: Record<PieceType, number>;
           players: { w: string | null; b: string | null };
         }) | null
```

**The privacy boundary.** Returns the caller's fog-filtered view plus join
lifecycle. Never leaks the opponent's phased pieces/timers beyond the square-only
warning. `joinToken` is included **only** for the initiator and active players.
The active ruleset (`rules`) is public — both players see what's in effect.
`players` resolves stored names to colors via the white/black token mapping.
Returns `null` if the game doesn't exist.

### `getMoveLog`

```ts
args:    { gameId; seatToken? }
returns: { log: Array<{ ply; color; kind; san; fan; from?; to? }>;
           revealed: boolean } | null
```

The per-seat move log, each event rendered to notation (`san` = letters, `fan` =
figurine) with fog rules applied. While the game is **active**, the opponent's
phase-out durations are hidden (`Bf1↑?`); spectators see both sides' durations
hidden. Once the game is **over**, the **true** log is revealed to everyone
(`revealed: true`). Raw events with durations are never returned — only rendered
strings plus public highlight squares (`from`/`to`) — so the boundary can't leak a
timer.

### `getMessages`

```ts
args:    { gameId; seatToken? }
returns: Array<{ id; color; text; mine: boolean }>
```

The game's chat, oldest first. **Players only** — spectators get an empty list.
`mine` marks the caller's own messages. Chat is tied to `gameId`, so it persists
across rematches between the same two players.

### `getMatchHistory`

```ts
args:    { gameId; seatToken? }
returns: Array<{ matchId; endedAt; status; wonBySelfCapture; plies;
                 yourColor: "w" | "b" | null }>
```

Finished games archived under this game's seats, newest first. Summaries only —
**never** the seat tokens. `yourColor` lets the caller default a replay to their
own fog perspective.

### `getMatchReplay`

```ts
args:    { matchId; perspective: "w" | "b" | "full" }
returns: { perspective; status; wonBySelfCapture;
           frames: Frame[]; moveLog: Array<{ ply; color; san; fan }> } | null
```

Replay an archived match **frame by frame** from a chosen fog perspective:

- **`"w"` / `"b"`** — what that seat saw at each step (their fog as it was then),
  via `engine.viewFor`.
- **`"full"`** — everything revealed (both sides' phased pieces), via
  `engine.revealView`.

The move log is always fully revealed (the game is over). The engine re-derives
every frame **deterministically** from the stored ruleset + action log — no board
snapshots are stored. See
[Determinism & replay](./explanation-determinism-and-replay.md).

## Data model (`convex/schema.ts`)

| Table | Purpose | Key indexes |
|---|---|---|
| `games` | The live game: full engine `state` + tokens + names. | `by_join_token` |
| `moves` | Append-only per-ply log: raw `action` + derived `events`, optional `requestId`. | `by_game_and_ply`, `by_request` |
| `matches` | Immutable archive of finished games: ruleset + ordered action/event log + seat→color tokens. | `by_game` |
| `messages` | Players-only chat, tied to `gameId`. | `by_game` |

The entire engine `GameState` is JSON-serializable, so a game's authoritative
state is stored as a single `state` object on the `games` row (board 64 + phased
≤ ~30 entries is far under Convex's 1 MB document limit). The unbounded move
history lives in its own `moves` table. All persisted shapes are **strictly
validated** — any new `GameState`/event field must be added to the matching
validator in `schema.ts` or inserts fail.

## Related

- [Engine API reference](./reference-engine-api.md) — the rules this layer delegates to.
- [Fog of war](./explanation-fog-of-war.md) — what `getGameView` may and may not return.
- [Determinism & replay](./explanation-determinism-and-replay.md) — why `matches` stores actions, not snapshots.
- Convex usage guidelines live in [`convex/_generated/ai/guidelines.md`](../convex/_generated/ai/guidelines.md).
