import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { pieceTypeV } from "./schema";
import * as engine from "../src/engine/index.js";

// The Convex layer is thin: it owns identity (which seat is acting), persistence,
// and the fog-of-war boundary, and delegates ALL rules to the pure engine. The
// engine never mutates its input, so reading `game.state` and passing it to
// engine functions is safe.

type Viewer = engine.Viewer;

/**
 * Resolve a caller's seat from their capability token. Spectators (no token, or
 * an unrecognized one) get the "spectator" view. This mapping is the only place
 * a viewer identity is established — it is NEVER taken from a client-supplied
 * color argument.
 */
function viewerFromToken(game: Doc<"games">, token: string | undefined): Viewer {
  if (token && token === game.whiteToken) return "w";
  if (token && token === game.blackToken) return "b";
  return "spectator";
}

function requireGame(game: Doc<"games"> | null): Doc<"games"> {
  if (!game) throw new Error("game not found");
  return game;
}

/** Create a new game. The creator takes White and receives White's seat token. */
export const createGame = mutation({
  args: {},
  handler: async (ctx) => {
    const whiteToken = crypto.randomUUID();
    const blackToken = crypto.randomUUID();
    const gameId = await ctx.db.insert("games", {
      state: engine.createGame(),
      whiteToken,
      blackToken,
      whiteClaimed: true,
      blackClaimed: false,
      createdAt: Date.now(),
    });
    return { gameId, color: "w" as const, seatToken: whiteToken };
  },
});

/**
 * Claim the open seat for a shared-game link. First caller takes Black; once
 * both seats are claimed, further callers are spectators (no token). Step 4
 * will gate this behind authenticated identities.
 */
export const joinGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    if (!game.blackClaimed) {
      await ctx.db.patch("games", gameId, { blackClaimed: true });
      return { color: "b" as const, seatToken: game.blackToken };
    }
    return { color: "spectator" as const, seatToken: null };
  },
});

/**
 * The fog-filtered view for a caller. THE privacy boundary: it returns only what
 * the resolved viewer is allowed to see — never the opponent's phased pieces,
 * timers, or return squares beyond the one-turn square-only warning. The full
 * `state.phased` is never serialized out; `engine.viewFor` enforces this.
 */
export const getGameView = query({
  args: { gameId: v.id("games"), seatToken: v.optional(v.string()) },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = await ctx.db.get("games", gameId);
    if (!game) return null;
    return engine.viewFor(game.state, viewerFromToken(game, seatToken));
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
  const next = engine.applyAction(game.state, action); // throws on illegal action
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
