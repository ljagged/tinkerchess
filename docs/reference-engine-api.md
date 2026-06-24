# Reference: Engine API (`src/engine/`)

The rules engine is a **pure, headless reducer**. Every function takes a
`GameState` (and maybe an `Action`) and returns data or a *new* `GameState` — no
I/O, no network, no `Date.now`, no `Math.random`, no hidden mutation of inputs.
It is the single source of truth for the variant's rules. The Convex backend and
the frontend both consume it; the frontend only ever sees a *filtered* view (see
[Fog of war](./explanation-fog-of-war.md)).

Everything below is exported from the package entry point,
[`src/engine/index.ts`](../src/engine/index.ts). Import from there:

```ts
import * as engine from "../src/engine/index.js";
// or named:
import { createGame, applyAction, viewFor } from "../src/engine/index.js";
```

Note the `.js` extensions on imports — the engine is authored as ESM and the
Convex backend imports it directly.

## Coordinates

Squares are a single integer `0..63`:

```
index = rank * 8 + file        file 0 = 'a', rank 0 = '1'
a1 = 0    h1 = 7    a8 = 56    h8 = 63
```

| Helper | Signature | Notes |
|---|---|---|
| `FILES` | `readonly ["a".."h"]` | File letters by index. |
| `fileOf` | `(sq: SquareIndex) => number` | `0..7`. |
| `rankOf` | `(sq: SquareIndex) => number` | `0..7`. |
| `squareIndex` | `(file: number, rank: number) => SquareIndex` | Inverse of the two above. |
| `parseSquare` | `(alg: string) => SquareIndex` | `"e4"` → index. Throws on an off-board string. |
| `toAlgebraic` | `(sq: SquareIndex) => string` | Index → `"e4"`. |
| `pieceAt` | `(board, sq) => Piece \| null` | Safe read; throws on an out-of-range index. |
| `opponent` | `(color: Color) => Color` | `"w"` ↔ `"b"`. |
| `positionKey` | `(state: GameState) => string` | The threefold-repetition key: visible board + side-to-move + castling + en-passant. **Phase timers excluded.** Feeds `GameState.history`. |

## Core types

Full definitions in [`src/engine/types.ts`](../src/engine/types.ts).

```ts
type Color = "w" | "b";
type PieceType = "p" | "n" | "b" | "r" | "q" | "k";   // 'p' (pawn) cannot phase
type SquareIndex = number;                              // 0..63
interface Piece { color: Color; type: PieceType; }
type GameStatus = "active" | "w_won" | "b_won" | "draw";
type EndReason  = "checkmate" | "stalemate" | "repetition";  // why a finished game ended
```

A win (`w_won`/`b_won`) is always by `"checkmate"`; a `"draw"` is by `"stalemate"`
or threefold `"repetition"`. `EndReason` is absent while a game is `active`.

### `GameState`

The authoritative game state. JSON-serializable in full — it's stored as a single
object on the Convex `games` row.

| Field | Type | Meaning |
|---|---|---|
| `board` | `(Piece \| null)[]` (length 64) | **In-play** pieces only. Phased pieces are absent here. |
| `config?` | `RuleConfig` | Active ruleset. Absence is treated as `DEFAULT_RULE_CONFIG` everywhere (back-compat). |
| `turn` | `Color` | Side to act. |
| `status` | `GameStatus` | `active`, who won, or `draw`. |
| `endReason?` | `EndReason` | Why the game ended (`checkmate` / `stalemate` / `repetition`). Absent while active. |
| `lastEvent` | `SelfCaptureEvent \| null` | Most recent non-terminal self-capture; cleared each turn. |
| `phased` | `PhasedPiece[]` | Pieces currently off the board (both colors). **Never serialized to a viewer.** |
| `castling` | `CastlingRights` | `{ wK, wQ, bK, bQ }` booleans. |
| `enPassant` | `SquareIndex \| null` | The square a pawn skipped over, or null. |
| `turnsTaken` | `{ w: number; b: number }` | Completed turns per color. Drives phase timers. |
| `captured` | `{ w: PieceType[]; b: PieceType[] }` | Permanently captured pieces, keyed by the **captured** piece's color. Phased pieces never appear here. |
| `history?` | `string[]` | Position keys seen so far (one per position reached, incl. the start), for threefold-repetition. The key is **visible board + side-to-move + castling + en-passant only** (`positionKey`) — phase timers are excluded, so phasing can't manufacture a "new" position to dodge a draw. Absence is treated as an empty history (back-compat). |

### `PhasedPiece`

```ts
interface PhasedPiece {
  color: Color;
  type: PieceType;
  origin: SquareIndex;   // square it left and will return to
  returnOn: number;      // owner's turnsTaken value at the END of which it returns
}
```

`returnOn` is in the **owner's own** turn count. Phasing on the owner's turn `k`
for duration `d` sets `returnOn = k + d`; the piece is absent across the owner's
turns `k+1 … k+d` and reappears at the end of turn `k+d`.

### `Action`

The input to the reducer — a player's *intent*.

```ts
type Action =
  | { kind: "move";     move: Move }
  | { kind: "phaseOut"; phaseOut: PhaseOut };

interface Move     { from: SquareIndex; to: SquareIndex; promotion?: "n" | "b" | "r" | "q"; }
interface PhaseOut { from: SquareIndex; duration: number; }
```

`promotion` is required only when a pawn reaches the last rank (defaults to queen
if omitted).

### `GameEvent`

A **derived** event — what an action *actually did*, with all consequences
resolved (captures, castling, en-passant, promotion, check, phase-ins). One
action yields one initiating event (`move` or `phaseOut`) followed by zero or more
`phaseIn` events resolved at the end of the mover's turn. Persisting these (not
just the intent) keeps the move log self-describing and replay-stable. See
[Determinism & replay](./explanation-determinism-and-replay.md).

```ts
type GameEvent =
  | { kind: "move"; color; piece; from; to;
      capture?: { color; type }; enPassant?: true; castle?: "K" | "Q";
      promotion?: "n"|"b"|"r"|"q"; check?: true; checkmate?: true }
  | { kind: "phaseOut"; color; piece; from; duration; returnOn }
  | { kind: "phaseIn"; color; piece; to;
      capture?: { color; type }; selfCapture?: true; selfDestruct?: true;
      check?: true; checkmate?: true };
```

`check?` / `checkmate?` are stamped during adjudication (they depend on the final
post-return board the opponent faces, not just the move). A `phaseIn` carries
`selfDestruct?` when the return landed on the owner's **own king** — the returning
piece self-destructs and the king is unaffected (no capture is recorded).

### `RuleConfig` (Tier-1 Settings)

```ts
interface RuleConfig {
  maxPhaseDuration: Record<PieceType, number>;   // 0 = that type cannot phase
}
```

A **single** source of truth: phase-eligibility is derived from the same field as
the duration cap (a `0` means "cannot phase"), so there's no separate boolean to
drift out of sync.

```ts
const MAX_PHASE_DURATION = { k: 1, n: 2, b: 2, r: 3, q: 4 };          // exported
const DEFAULT_RULE_CONFIG = { maxPhaseDuration: { p: 0, ...MAX_PHASE_DURATION } };
```

## Game lifecycle

From [`src/engine/game.ts`](../src/engine/game.ts).

### `createGame(config?: RuleConfig): GameState`

A fresh game in the standard starting position. `config` sets the ruleset
(defaults to `DEFAULT_RULE_CONFIG`); it is cloned, so callers can't mutate engine
state through it.

### `applyActionWithEvents(state, action): { state, events }`

**The single source of truth for applying an action.** Returns the new state and
the derived events. Throws `IllegalActionError` if the action is illegal or the
game is already over. Turn lifecycle:

1. The side to move applies a move or a phase-out.
2. The mover's turn counter increments and any of the **mover's** due pieces phase
   back in — at the **end** of their turn (S5 table; this never ends the game and
   never removes a king — S9).
3. The turn flips to the opponent, and the position the opponent now faces is
   **adjudicated** by standard chess rules: **checkmate** (opponent loses),
   **stalemate** (draw), or **threefold repetition** (draw). No king is ever
   captured or removed from the board.

```ts
const { state, events } = engine.applyActionWithEvents(state, {
  kind: "move",
  move: { from: engine.parseSquare("e2"), to: engine.parseSquare("e4") },
});
```

### `applyAction(state, action): GameState`

Convenience wrapper returning only the state. Same throwing behavior.

### `replay(actions, from?): GameState`

Replay an action sequence from a starting state (default: a fresh game),
returning the final state. Because the engine is a deterministic reducer,
`replay(actions)` always reproduces the same state — the basis for history,
per-seat logs, and the post-game reveal. Throws `IllegalActionError` if any action
is illegal.

### `legalMoves(state): Move[]`

All fully-legal, **king-safe** moves for the side to move (not phase-outs). A move
is included only if it leaves the mover's own king safe (not in check, not on an
enemy return ring) and is never a king capture. For UI highlighting, adjudication,
and tests. Returns `[]` if the game is over.

### `legalMovesFrom(state, from): Move[]`

The same king-safe filter, but for a single piece — the legal moves of the piece on
`from`. `legalMoves` is the union of this over all the side-to-move's pieces.
Exported from `moves.ts`.

### `IllegalActionError`

Thrown by `applyAction` / `applyActionWithEvents` on an illegal action or a
move after the game is over.

## Phasing

From [`src/engine/phase.ts`](../src/engine/phase.ts). `game.ts` orchestrates turn
order; these functions never flip the turn.

| Function | Signature | Notes |
|---|---|---|
| `isPhaseable` | `(type, config?) => boolean` | Derived from the type's duration cap (`> 0`). |
| `maxDuration` | `(type, config?) => number` | The cap; `0` = cannot phase. |
| `kingSafe` | `(state, color) => boolean` | The unified king-safety predicate: `color`'s king is **safe** iff it is neither attacked by an enemy in-play piece (standard check) **nor** sitting on a square showing the **enemy's** imminent-return ring (an S5a ringed-king check). A phased-out king is trivially safe. |
| `validatePhaseOut` | `(state, action: PhaseOut) => { ok; reason? }` | Pure check, no mutation. |
| `applyPhaseOut` | `(state, action: PhaseOut) => GameState` | Removes the piece, records the timer. Throws if invalid. |
| `resolvePhaseInsWithEvents` | `(state, color) => { state, events }` | Returns due pieces for `color` at end of turn, plus events. |
| `resolvePhaseIns` | `(state, color) => GameState` | State-only wrapper of the above. |
| `ownPhased` | `(state, viewer) => Array<PhasedPiece & { turnsRemaining }>` | The viewer's own phased pieces with countdowns. |
| `warningSquaresFor` | `(state, viewer) => SquareIndex[]` | Origin squares of the **opponent's** pieces returning next turn. Square only. |

`validatePhaseOut` rejects: a game that's over, an empty/foreign square, a
non-phaseable type, a duration outside `1..maxDuration`, a **king phasing out of
check**, and — per spec **S7** — any phase-out that would leave the **mover's own
king in check** after the piece is removed (e.g. phasing a pinned piece or one
blocking an attack on the king). This is the sole own-king-exposure check; a
phase-**in** can never expose the king (it only ever adds occupancy), so there is
no analogous rule for returns.

`resolvePhaseInsWithEvents` resolves each due return on its origin square by what
occupies it (S5 table): empty → returns; enemy non-king → captured, returning piece
takes the square; **own non-king → own piece destroyed** (the retained footgun),
returning piece takes the square (`selfCapture`); **own king → the returning piece
self-destructs and the king is unaffected** (`selfDestruct`, no capture, no loss);
**enemy king → unreachable** (S5a forces the enemy king off the square or mates it
the prior turn, so a return never resolves onto a live enemy king — the engine
throws here as a safety assertion). No king is ever removed by a phase-in (S9).

## Move mechanics

From [`src/engine/moves.ts`](../src/engine/moves.ts). Lower-level than
`applyAction`; you usually want the lifecycle functions above.

| Function | Signature | Notes |
|---|---|---|
| `generateMoves` | `(state, from) => Move[]` | **Pseudo-legal** moves for the piece on `from` (not yet filtered for king safety). `[]` if empty. |
| `legalMovesFrom` | `(state, from) => Move[]` | **Fully-legal**, king-safe moves for the piece on `from`: pseudo-moves filtered to those that don't capture a king and that leave the mover's own king safe (`kingSafe`). |
| `isLegalMove` | `(state, move) => boolean` | Whether `(from, to, promotion)` is among the **legal** (king-safe) moves. |
| `applyMove` | `(state, move) => GameState` | Board mechanics only. Does **not** flip the turn or resolve phase timers. |

TinkerChess plays standard chess for move legality: a **king is never a legal
capture target** (S9), and moves **are** filtered for king safety
(`legalMovesFrom` / `kingSafe`) — you may not move into, or leave your king in,
check. The S5a "ringed-king flight only" rule falls out for free: any non-king move
that leaves the king on an enemy return ring fails `kingSafe` and is pruned.
Castling keeps the standard not-in / through / into-check constraints, **extended**
so an enemy imminent-return ring counts like an attacked square — the king may not
castle into or through a ringed square.

## Attack detection

From [`src/engine/attacks.ts`](../src/engine/attacks.ts). Check now constrains
ordinary moves — the king-safety filter (`legalMovesFrom` / `kingSafe`) reuses
these predicates, as do the king-can't-phase-out-of-check gate and castling
constraints. `kingSafe` combines a standard attack (`isAttacked` on the king's
square) with the enemy-return-ring term (`warningSquaresFor`), so a ringed king
registers as in check.

| Function | Signature | Notes |
|---|---|---|
| `isAttacked` | `(state, sq, byColor) => boolean` | Is `sq` attacked by any in-play `byColor` piece? |
| `findKing` | `(state, color) => SquareIndex \| null` | `null` if the king is captured or phased. |
| `inCheck` | `(state, color) => boolean` | Is `color`'s in-play king attacked? `false` if it's off-board. |

## Views (the privacy boundary)

From [`src/engine/game.ts`](../src/engine/game.ts). These are how hidden
information stays hidden — see [Fog of war](./explanation-fog-of-war.md).

### `viewFor(state, viewer): GameView`

```ts
type Viewer = Color | "spectator";
```

The filtered view for a viewer. **Must never** leak an opponent's phased pieces,
timers, or return squares beyond the allowed square-only warning. `state.phased`
is never serialized. A `GameView` carries: `board`, `turn`, `status`, `endReason?`,
`inCheck`, `lastEvent`, `captured`, `turnsTaken`, `you`, plus:

- `inCheck: boolean` — whether the **viewer's own** king is in check, per the
  viewer's fog: a standard attack **or** an enemy imminent-return ring on the
  king's square. Always `false` for spectators (they have no ring visibility).
  Drives the check indicator.
- `yourPhased: ViewPhasedPiece[]` — the **viewer's own** phased pieces with
  `turnsRemaining`. Empty for spectators.
- `warningSquares: SquareIndex[]` — opponent pieces returning next turn, **square
  only**, never identity or timer. Empty for spectators.

### `revealView(state): RevealView`

A fully-revealed view for replaying a **finished** game: exposes **both** sides'
phased pieces (origin, type, timer). Carries `endReason?` (but no per-viewer
`inCheck` — reveal has no seat). There's no secrecy once a game is over. **Never**
use this for a live game — it would leak the fog. Live "watch from a seat" replay
uses `viewFor` instead.

## Notation

From [`src/engine/notation.ts`](../src/engine/notation.ts). Display-only; the
engine replays from the action/event log, never from notation.

| Function | Signature | Notes |
|---|---|---|
| `toNotation` | `(event, opts?) => string` | Full notation (no redaction). Used for the post-game true log. |
| `toSeatNotation` | `(event, viewer, opts?) => string` | As the viewer sees it live: the **opponent's** phase-out duration is redacted to `↑?`. |

`NotationOptions = { figurine?: boolean }` switches letters (`Nf3`, `Bf1↑3`) to
Unicode glyphs (`♘f3`, `♗f1↑3`). TinkerChess SAN extensions: phase-out
`<piece><from>↑<duration>` (`Bf1↑3`); phase-in `<piece>↓<square>[x<piece>]`
(`R↓a1xN`); **checkmate `#`** (standard win); check `+`; self-capture (own
non-king footgun) `(self)`; and self-destruct `(lost)` — a return onto your **own
king**, where the returning piece is lost and the king stands.

## Related

- [Backend API reference](./reference-backend-api.md) — the Convex layer that wraps this engine.
- [Fog of war](./explanation-fog-of-war.md) — why `viewFor` is shaped the way it is.
- [Determinism & replay](./explanation-determinism-and-replay.md) — why events are derived and persisted.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the "engine is the single source of rules" hard rule.
