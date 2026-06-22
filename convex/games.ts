import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { pieceTypeV } from "./schema";
import * as engine from "../src/engine/index.js";

// The Convex layer is thin: it owns identity (which seat is acting), persistence,
// and the fog-of-war boundary, and delegates ALL rules to the pure engine.
//
// Joining is by a short shared `joinToken`. The creator holds `initiatorToken`;
// the first joiner gets `opponentToken`; White/Black are mapped onto those two
// seats at RANDOM when the opponent joins. A game is "waiting" until then.

type Viewer = engine.Viewer;
type Role = "initiator" | "player" | "spectator";

// --- join token ------------------------------------------------------------

// 8 chars in two groups of 4. Charset excludes ambiguous 0 O 1 I L.
const TOKEN_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LEN = 8;

function randomToken(): string {
  const bytes = new Uint32Array(TOKEN_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < TOKEN_LEN; i++) {
    out += TOKEN_CHARS.charAt((bytes[i] ?? 0) % TOKEN_CHARS.length);
  }
  return out;
}

/** Canonicalize user input to compare against stored tokens (uppercase, A–Z/0–9 only). */
function canonicalToken(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function uniqueJoinToken(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const token = randomToken();
    const existing = await ctx.db
      .query("games")
      .withIndex("by_join_token", (q) => q.eq("joinToken", token))
      .unique();
    if (!existing) return token;
  }
  throw new Error("could not generate a unique join token");
}

// --- seat resolution -------------------------------------------------------

/**
 * Resolve a caller's seat from their capability token. Only matches once colors
 * are assigned (i.e. the game is active). This is the only place a viewer's
 * color is established — never from a client-supplied argument.
 */
function viewerFromToken(game: Doc<"games">, token: string | undefined): Viewer {
  if (!token) return "spectator";
  if (game.whiteToken && token === game.whiteToken) return "w";
  if (game.blackToken && token === game.blackToken) return "b";
  return "spectator";
}

function isInitiator(game: Doc<"games">, token: string | undefined): boolean {
  return !!token && token === game.initiatorToken;
}

function requireGame(game: Doc<"games"> | null): Doc<"games"> {
  if (!game) throw new Error("game not found");
  return game;
}

/**
 * Coerce a stored game's state into a full engine GameState (wonBySelfCapture /
 * lastEvent are stored optional for back-compat; the engine treats absence as
 * the default).
 */
function engineState(game: Doc<"games">): engine.GameState {
  const s = game.state;
  return {
    ...s,
    wonBySelfCapture: s.wonBySelfCapture ?? false,
    lastEvent: s.lastEvent ?? null,
    captured: s.captured ?? { w: [], b: [] },
  };
}

// --- public API ------------------------------------------------------------

/** Create a game. The creator gets a join token to share and their seat token. */
export const createGame = mutation({
  args: {},
  handler: async (ctx) => {
    const joinToken = await uniqueJoinToken(ctx);
    const initiatorToken = crypto.randomUUID();
    const gameId = await ctx.db.insert("games", {
      state: engine.createGame(),
      joinToken,
      initiatorToken,
      opponentToken: null,
      whiteToken: null,
      blackToken: null,
      createdAt: Date.now(),
    });
    return { gameId, joinToken, seatToken: initiatorToken };
  },
});

/**
 * Enter a game by its join token. If a seat is open the caller becomes the
 * opponent and colors are assigned at random; otherwise they spectate. Throws
 * if no game matches the token.
 */
export const joinByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const canonical = canonicalToken(token);
    const game = await ctx.db
      .query("games")
      .withIndex("by_join_token", (q) => q.eq("joinToken", canonical))
      .unique();
    if (!game) throw new Error("No game found for that token.");

    if (game.opponentToken === null) {
      const opponentToken = crypto.randomUUID();
      const initiatorIsWhite = Math.random() < 0.5;
      await ctx.db.patch("games", game._id, {
        opponentToken,
        whiteToken: initiatorIsWhite ? game.initiatorToken : opponentToken,
        blackToken: initiatorIsWhite ? opponentToken : game.initiatorToken,
      });
      return { gameId: game._id, role: "player" as const, seatToken: opponentToken };
    }
    return { gameId: game._id, role: "spectator" as const, seatToken: null };
  },
});

/**
 * The fog-filtered view for a caller, plus join lifecycle. THE privacy boundary:
 * never leaks the opponent's phased pieces/timers (beyond the square-only
 * warning), and the join token is returned ONLY to the waiting initiator and to
 * active players (to invite spectators) — never to spectators.
 */
export const getGameView = query({
  args: { gameId: v.id("games"), seatToken: v.optional(v.string()) },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = await ctx.db.get("games", gameId);
    if (!game) return null;

    const waiting = game.opponentToken === null;
    const viewer: Viewer = waiting ? "spectator" : viewerFromToken(game, seatToken);
    const role: Role = waiting
      ? isInitiator(game, seatToken)
        ? "initiator"
        : "spectator"
      : viewer === "spectator"
        ? "spectator"
        : "player";

    const base = engine.viewFor(engineState(game), viewer);
    const showToken = role === "initiator" || role === "player";
    return {
      ...base,
      phase: waiting ? ("waiting" as const) : ("active" as const),
      role,
      joinToken: showToken ? game.joinToken : null,
    };
  },
});

/** Resolve the acting seat and verify it is that seat's turn. */
async function actingSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  seatToken: string,
): Promise<{ game: Doc<"games">; color: "w" | "b" }> {
  const game = requireGame(await ctx.db.get("games", gameId));
  const viewer = viewerFromToken(game, seatToken);
  if (viewer === "spectator") throw new Error("not a player in this game");
  if (game.state.turn !== viewer) throw new Error("not your turn");
  return { game, color: viewer };
}

/** Apply an action, persist the new state, append to the move log, return the actor's view. */
async function commit(
  ctx: MutationCtx,
  game: Doc<"games">,
  color: "w" | "b",
  action: engine.Action,
  recorded: Doc<"moves">["action"],
) {
  const next = engine.applyAction(engineState(game), action); // throws on illegal action
  await ctx.db.patch("games", game._id, { state: next });
  await ctx.db.insert("moves", {
    gameId: game._id,
    ply: next.turnsTaken.w + next.turnsTaken.b,
    byColor: color,
    action: recorded,
  });
  return engine.viewFor(next, color);
}

export const makeMove = mutation({
  args: {
    gameId: v.id("games"),
    seatToken: v.string(),
    from: v.number(),
    to: v.number(),
    promotion: v.optional(pieceTypeV),
  },
  handler: async (ctx, args) => {
    const { game, color } = await actingSeat(ctx, args.gameId, args.seatToken);
    const move =
      args.promotion !== undefined
        ? { from: args.from, to: args.to, promotion: args.promotion as engine.Move["promotion"] }
        : { from: args.from, to: args.to };
    return commit(ctx, game, color, { kind: "move", move }, { kind: "move", ...move });
  },
});

export const phaseOut = mutation({
  args: {
    gameId: v.id("games"),
    seatToken: v.string(),
    from: v.number(),
    duration: v.number(),
  },
  handler: async (ctx, args) => {
    const { game, color } = await actingSeat(ctx, args.gameId, args.seatToken);
    const phase = { from: args.from, duration: args.duration };
    return commit(
      ctx,
      game,
      color,
      { kind: "phaseOut", phaseOut: phase },
      { kind: "phaseOut", ...phase },
    );
  },
});

/**
 * Reset an ended game to a fresh board for a rematch, keeping the same seats and
 * join token but RE-RANDOMIZING sides. Either player may trigger it.
 */
export const newGame = mutation({
  args: { gameId: v.id("games"), seatToken: v.string() },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    if (viewerFromToken(game, seatToken) === "spectator") {
      throw new Error("only a player can start a new game");
    }
    if (game.opponentToken === null) throw new Error("game has not started");

    const initiatorIsWhite = Math.random() < 0.5;
    await ctx.db.patch("games", gameId, {
      state: engine.createGame(),
      whiteToken: initiatorIsWhite ? game.initiatorToken : game.opponentToken,
      blackToken: initiatorIsWhite ? game.opponentToken : game.initiatorToken,
    });
    // Clear this game's move log so ply history restarts cleanly.
    const moves = await ctx.db
      .query("moves")
      .withIndex("by_game_and_ply", (q) => q.eq("gameId", gameId))
      .take(500);
    for (const m of moves) await ctx.db.delete("moves", m._id);
    return null;
  },
});
