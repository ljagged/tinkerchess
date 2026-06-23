import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// --- validators mirroring the engine's plain-data types ---------------------
// The whole engine GameState is JSON-serializable, so a game's authoritative
// state is stored as a single `state` object on the games row (board 64 +
// phased ≤ ~30 entries is far under Convex's 1MB document limit). The unbounded
// move history lives in its own `moves` table per the schema guidelines.

export const colorV = v.union(v.literal("w"), v.literal("b"));
export const pieceTypeV = v.union(
  v.literal("p"),
  v.literal("n"),
  v.literal("b"),
  v.literal("r"),
  v.literal("q"),
  v.literal("k"),
);
export const pieceV = v.object({ color: colorV, type: pieceTypeV });
export const phasedPieceV = v.object({
  color: colorV,
  type: pieceTypeV,
  origin: v.number(),
  returnOn: v.number(),
});

export const selfCaptureEventV = v.object({
  by: colorV,
  piece: pieceTypeV,
  square: v.number(),
});

// Per-game ruleset (Tier-1 Settings). Single source for phase-eligibility +
// duration caps; 0 means that piece type cannot phase. Optional for back-compat
// with games stored before configs existed (the engine defaults absence).
export const ruleConfigV = v.object({
  maxPhaseDuration: v.object({
    p: v.number(),
    n: v.number(),
    b: v.number(),
    r: v.number(),
    q: v.number(),
    k: v.number(),
  }),
});

export const gameStateV = v.object({
  board: v.array(v.union(pieceV, v.null())),
  // Optional for back-compat; engine.createGame() always sets it on new games.
  config: v.optional(ruleConfigV),
  turn: colorV,
  status: v.union(v.literal("active"), v.literal("w_won"), v.literal("b_won")),
  // Optional for backward compatibility with games created before these fields
  // existed; the engine always sets them on new/updated states.
  wonBySelfCapture: v.optional(v.boolean()),
  lastEvent: v.optional(v.union(selfCaptureEventV, v.null())),
  phased: v.array(phasedPieceV),
  castling: v.object({
    wK: v.boolean(),
    wQ: v.boolean(),
    bK: v.boolean(),
    bQ: v.boolean(),
  }),
  enPassant: v.union(v.number(), v.null()),
  turnsTaken: v.object({ w: v.number(), b: v.number() }),
  // Optional for back-compat; the engine always sets it on new/updated states.
  captured: v.optional(v.object({ w: v.array(pieceTypeV), b: v.array(pieceTypeV) })),
});

// Derived event log (what an action actually did, all consequences resolved).
// Mirrors the engine's GameEvent union. Persisted alongside the raw intent so the
// move log/notation are self-describing and replay-stable as the engine evolves.
const captureV = v.object({ color: colorV, type: pieceTypeV });
// Promotion can only be to a non-pawn, non-king piece (matches engine GameEvent).
const promotionTypeV = v.union(v.literal("n"), v.literal("b"), v.literal("r"), v.literal("q"));
export const gameEventV = v.union(
  v.object({
    kind: v.literal("move"),
    color: colorV,
    piece: pieceTypeV,
    from: v.number(),
    to: v.number(),
    capture: v.optional(captureV),
    enPassant: v.optional(v.literal(true)),
    castle: v.optional(v.union(v.literal("K"), v.literal("Q"))),
    promotion: v.optional(promotionTypeV),
    check: v.optional(v.literal(true)),
    kingCapture: v.optional(v.literal(true)),
  }),
  v.object({
    kind: v.literal("phaseOut"),
    color: colorV,
    piece: pieceTypeV,
    from: v.number(),
    duration: v.number(),
    returnOn: v.number(),
  }),
  v.object({
    kind: v.literal("phaseIn"),
    color: colorV,
    piece: pieceTypeV,
    to: v.number(),
    capture: v.optional(captureV),
    selfCapture: v.optional(v.literal(true)),
    kingCapture: v.optional(v.literal(true)),
  }),
);

export const recordedActionV = v.union(
  v.object({
    kind: v.literal("move"),
    from: v.number(),
    to: v.number(),
    promotion: v.optional(promotionTypeV),
  }),
  v.object({
    kind: v.literal("phaseOut"),
    from: v.number(),
    duration: v.number(),
  }),
);

export default defineSchema({
  games: defineTable({
    state: gameStateV,
    // The short, shareable join code (canonical: uppercase, no separator).
    // Anyone with it can enter the game — as the opponent if a seat is open,
    // otherwise as a spectator.
    joinToken: v.string(),
    // Per-seat capability tokens. Holding a seat token *is* the authorization
    // to act as that color. The creator gets `initiatorToken`; the joiner gets
    // `opponentToken`. White/Black are assigned RANDOMLY at join, so each color
    // token points at one of the two seats. They are null until the opponent
    // joins (the game is "waiting" while `opponentToken` is null).
    initiatorToken: v.string(),
    opponentToken: v.union(v.string(), v.null()),
    whiteToken: v.union(v.string(), v.null()),
    blackToken: v.union(v.string(), v.null()),
    createdAt: v.number(),
  }).index("by_join_token", ["joinToken"]),

  // Append-only audit/replay log (full truth — never exposed un-filtered).
  // `action` is the raw intent; `events` is what it actually did (derived,
  // optional for back-compat with rows written before the event model existed).
  moves: defineTable({
    gameId: v.id("games"),
    ply: v.number(),
    byColor: colorV,
    action: recordedActionV,
    events: v.optional(v.array(gameEventV)),
    // Client-supplied idempotency key: a retried submission (same key) is a no-op
    // instead of a double-apply. Optional for back-compat.
    requestId: v.optional(v.string()),
  })
    .index("by_game_and_ply", ["gameId", "ply"])
    .index("by_request", ["gameId", "requestId"]),

  // Immutable archive of finished games. A rematch (newGame) recycles the `games`
  // row, so completed games are snapshotted here instead of being destroyed. A
  // match is fully self-describing: ruleset + ordered action/event log replays the
  // whole game (the engine is a deterministic reducer), and the seat->color tokens
  // let a viewer recover "their" fog perspective for replay.
  matches: defineTable({
    gameId: v.id("games"),
    endedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("w_won"), v.literal("b_won")),
    wonBySelfCapture: v.boolean(),
    config: v.optional(ruleConfigV),
    whiteToken: v.union(v.string(), v.null()),
    blackToken: v.union(v.string(), v.null()),
    log: v.array(
      v.object({
        ply: v.number(),
        byColor: colorV,
        action: recordedActionV,
        events: v.optional(v.array(gameEventV)),
      }),
    ),
  }).index("by_game", ["gameId"]),
});
