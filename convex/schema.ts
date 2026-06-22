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

export const gameStateV = v.object({
  board: v.array(v.union(pieceV, v.null())),
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

export const recordedActionV = v.union(
  v.object({
    kind: v.literal("move"),
    from: v.number(),
    to: v.number(),
    promotion: v.optional(pieceTypeV),
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
  moves: defineTable({
    gameId: v.id("games"),
    ply: v.number(),
    byColor: colorV,
    action: recordedActionV,
  }).index("by_game_and_ply", ["gameId", "ply"]),
});
