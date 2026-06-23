import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { pieceTypeV, ruleConfigV } from "./schema";
import * as engine from "../src/engine/index.js";

const PIECE_TYPES = ["p", "n", "b", "r", "q", "k"] as const;
const MAX_CONFIG_DURATION = 8;

/**
 * Clamp a client-supplied ruleset to safe, integer durations (0..8). Returns
 * undefined when no config is given (engine then uses DEFAULT_RULE_CONFIG).
 */
function sanitizeConfig(input: engine.RuleConfig | undefined): engine.RuleConfig | undefined {
  if (!input) return undefined;
  const md = {} as Record<engine.PieceType, number>;
  for (const t of PIECE_TYPES) {
    const raw = input.maxPhaseDuration[t];
    md[t] = Math.max(0, Math.min(MAX_CONFIG_DURATION, Math.floor(Number.isFinite(raw) ? raw : 0)));
  }
  return { maxPhaseDuration: md };
}

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

/** Trim and length-cap a player-supplied display name; "" -> undefined. */
function sanitizeName(name: string | undefined): string | undefined {
  const trimmed = (name ?? "").trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolve stored names to colors via the white/black token mapping. */
function playerNames(game: Doc<"games">): { w: string | null; b: string | null } {
  const nameForToken = (token: string | null) =>
    token === game.initiatorToken
      ? game.initiatorName ?? null
      : token && token === game.opponentToken
        ? game.opponentName ?? null
        : null;
  return { w: nameForToken(game.whiteToken), b: nameForToken(game.blackToken) };
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
  args: { config: v.optional(ruleConfigV), name: v.optional(v.string()) },
  handler: async (ctx, { config, name }) => {
    const joinToken = await uniqueJoinToken(ctx);
    const initiatorToken = crypto.randomUUID();
    const gameId = await ctx.db.insert("games", {
      state: engine.createGame(sanitizeConfig(config)),
      joinToken,
      initiatorToken,
      opponentToken: null,
      whiteToken: null,
      blackToken: null,
      initiatorName: sanitizeName(name),
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
  args: { token: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { token, name }) => {
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
        opponentName: sanitizeName(name),
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
    // The active ruleset (Tier-1 Settings) is public — both players see what's in
    // effect, and the joiner sees the rules they joined.
    const rules = (engineState(game).config ?? engine.DEFAULT_RULE_CONFIG).maxPhaseDuration;
    return {
      ...base,
      phase: waiting ? ("waiting" as const) : ("active" as const),
      role,
      joinToken: showToken ? game.joinToken : null,
      rules,
      players: playerNames(game),
    };
  },
});

/**
 * The per-seat move log. Renders each derived event to notation (plain + figurine)
 * with fog rules applied: while the game is ACTIVE, the opponent's phase-out
 * durations are hidden ("Bf1~?"); spectators see both sides' durations hidden.
 * Once the game is OVER, the true log is revealed in full to everyone. Raw events
 * (with durations) are never returned — only rendered strings + public highlight
 * squares — so the boundary cannot leak a timer.
 */
export const getMoveLog = query({
  args: { gameId: v.id("games"), seatToken: v.optional(v.string()) },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = await ctx.db.get("games", gameId);
    if (!game) return null;

    const waiting = game.opponentToken === null;
    const viewer: Viewer = waiting ? "spectator" : viewerFromToken(game, seatToken);
    const revealed = game.state.status !== "active";

    const rows = await ctx.db
      .query("moves")
      .withIndex("by_game_and_ply", (q) => q.eq("gameId", gameId))
      .collect();
    rows.sort((a, b) => a.ply - b.ply);

    const fig = { figurine: true } as const;
    const log = rows.flatMap((row) =>
      (row.events ?? []).map((ev) => {
        const san = revealed ? engine.toNotation(ev) : engine.toSeatNotation(ev, viewer);
        const fan = revealed ? engine.toNotation(ev, fig) : engine.toSeatNotation(ev, viewer, fig);
        const entry: {
          ply: number;
          color: "w" | "b";
          kind: engine.GameEvent["kind"];
          san: string;
          fan: string;
          from?: number;
          to?: number;
        } = { ply: row.ply, color: ev.color, kind: ev.kind, san, fan };
        // Highlight squares — all public (a vanished/appeared square is visible).
        if (ev.kind === "move") {
          entry.from = ev.from;
          entry.to = ev.to;
        } else if (ev.kind === "phaseOut") {
          entry.from = ev.from;
        } else {
          entry.to = ev.to;
        }
        return entry;
      }),
    );

    return { log, revealed };
  },
});

/** Convert a persisted recorded action (intent) back into an engine Action. */
function recordedToAction(r: Doc<"matches">["log"][number]["action"]): engine.Action {
  if (r.kind === "move") {
    const move =
      r.promotion !== undefined ? { from: r.from, to: r.to, promotion: r.promotion } : { from: r.from, to: r.to };
    return { kind: "move", move };
  }
  return { kind: "phaseOut", phaseOut: { from: r.from, duration: r.duration } };
}

type ReplayPerspective = "w" | "b" | "full";

/** One replay frame: the board (and visible phased pieces) from a perspective. */
function replayFrame(state: engine.GameState, perspective: ReplayPerspective) {
  if (perspective === "full") {
    const v = engine.revealView(state); // post-game: both sides' phased revealed
    return {
      board: v.board,
      turn: v.turn,
      status: v.status,
      wonBySelfCapture: v.wonBySelfCapture,
      lastEvent: v.lastEvent,
      captured: v.captured,
      turnsTaken: v.turnsTaken,
      phased: v.phased,
      warningSquares: [] as number[],
    };
  }
  const v = engine.viewFor(state, perspective); // what that seat saw at the time
  return {
    board: v.board,
    turn: v.turn,
    status: v.status,
    wonBySelfCapture: v.wonBySelfCapture,
    lastEvent: v.lastEvent,
    captured: v.captured,
    turnsTaken: v.turnsTaken,
    phased: v.yourPhased.map((p) => ({ color: perspective, type: p.type, origin: p.origin, returnOn: p.returnOn })),
    warningSquares: v.warningSquares,
  };
}

/**
 * Replay an archived match frame-by-frame from a chosen fog perspective:
 *   "w" / "b" — what that seat saw at each step (their fog as it was), or
 *   "full"    — everything revealed (both sides' phased pieces).
 * The move log is always fully revealed (the game is over). The engine re-derives
 * every state deterministically from the stored ruleset + action log.
 */
export const getMatchReplay = query({
  args: {
    matchId: v.id("matches"),
    perspective: v.union(v.literal("w"), v.literal("b"), v.literal("full")),
  },
  handler: async (ctx, { matchId, perspective }) => {
    const match = await ctx.db.get("matches", matchId);
    if (!match) return null;

    const actions = match.log.map((row) => recordedToAction(row.action));
    let state = engine.createGame(match.config);
    const frames = [replayFrame(state, perspective)];
    for (const action of actions) {
      state = engine.applyAction(state, action);
      frames.push(replayFrame(state, perspective));
    }

    const fig = { figurine: true } as const;
    const moveLog = match.log.flatMap((row) =>
      (row.events ?? []).map((ev) => ({
        ply: row.ply,
        color: ev.color,
        san: engine.toNotation(ev),
        fan: engine.toNotation(ev, fig),
      })),
    );

    return { perspective, status: match.status, wonBySelfCapture: match.wonBySelfCapture, frames, moveLog };
  },
});

// --- chat (players only) ---------------------------------------------------

const MAX_MESSAGE_LEN = 500;

/** Post a chat message. Players only — spectators are rejected. Empty/whitespace
 * messages are ignored; long ones are capped. */
export const sendMessage = mutation({
  args: { gameId: v.id("games"), seatToken: v.string(), text: v.string() },
  handler: async (ctx, { gameId, seatToken, text }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    const color = viewerFromToken(game, seatToken);
    if (color === "spectator") throw new Error("only players can chat");
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LEN);
    if (!trimmed) return null;
    await ctx.db.insert("messages", { gameId, color, text: trimmed, createdAt: Date.now() });
    return null;
  },
});

/** The game's chat, oldest first. Players only — spectators get an empty list
 * (the chat is private to the two seats). `mine` marks the caller's own messages. */
export const getMessages = query({
  args: { gameId: v.id("games"), seatToken: v.optional(v.string()) },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = await ctx.db.get("games", gameId);
    if (!game) return [];
    const viewer = viewerFromToken(game, seatToken);
    if (viewer === "spectator") return [];
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    msgs.sort((a, b) => a._creationTime - b._creationTime);
    return msgs.map((m) => ({ id: m._id, color: m.color, text: m.text, mine: m.color === viewer }));
  },
});

/** Resolve the acting seat (a player, not a spectator). Turn order is enforced in
 * commit() — AFTER the idempotency check, so a retried submission whose move already
 * applied (turn since flipped) is a graceful no-op rather than a "not your turn" error. */
async function actingSeat(
  ctx: MutationCtx,
  gameId: Id<"games">,
  seatToken: string,
): Promise<{ game: Doc<"games">; color: "w" | "b" }> {
  const game = requireGame(await ctx.db.get("games", gameId));
  const viewer = viewerFromToken(game, seatToken);
  if (viewer === "spectator") throw new Error("not a player in this game");
  return { game, color: viewer };
}

/**
 * Apply an action, persist the new state, append to the move log, return the
 * actor's view. Two robustness guards:
 *   - idempotency: a retried submission with the same requestId returns the current
 *     view without re-applying (Convex can re-send a committed mutation if the ack
 *     is lost; the turn-gate alone would mis-reject that as "not your turn").
 *   - stale-view: if expectedPly is given and doesn't match the live ply, reject so
 *     the client refreshes rather than acting on an outdated board.
 */
async function commit(
  ctx: MutationCtx,
  game: Doc<"games">,
  color: "w" | "b",
  action: engine.Action,
  recorded: Doc<"moves">["action"],
  opts: { requestId?: string; expectedPly?: number } = {},
) {
  const { requestId, expectedPly } = opts;

  if (requestId) {
    const dup = await ctx.db
      .query("moves")
      .withIndex("by_request", (q) => q.eq("gameId", game._id).eq("requestId", requestId))
      .first();
    if (dup) return engine.viewFor(engineState(game), color); // already applied — no-op
  }

  if (game.state.turn !== color) throw new Error("not your turn");

  const currentPly = game.state.turnsTaken.w + game.state.turnsTaken.b;
  if (expectedPly !== undefined && expectedPly !== currentPly) {
    throw new Error("Your board is out of sync — it will refresh, then try again.");
  }

  const { state: next, events } = engine.applyActionWithEvents(engineState(game), action); // throws on illegal action
  await ctx.db.patch("games", game._id, { state: next });
  await ctx.db.insert("moves", {
    gameId: game._id,
    ply: next.turnsTaken.w + next.turnsTaken.b,
    byColor: color,
    action: recorded,
    events,
    ...(requestId ? { requestId } : {}),
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
    requestId: v.optional(v.string()),
    expectedPly: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { game, color } = await actingSeat(ctx, args.gameId, args.seatToken);
    const move =
      args.promotion !== undefined
        ? { from: args.from, to: args.to, promotion: args.promotion as engine.Move["promotion"] }
        : { from: args.from, to: args.to };
    return commit(ctx, game, color, { kind: "move", move }, { kind: "move", ...move }, {
      requestId: args.requestId,
      expectedPly: args.expectedPly,
    });
  },
});

export const phaseOut = mutation({
  args: {
    gameId: v.id("games"),
    seatToken: v.string(),
    from: v.number(),
    duration: v.number(),
    requestId: v.optional(v.string()),
    expectedPly: v.optional(v.number()),
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
      { requestId: args.requestId, expectedPly: args.expectedPly },
    );
  },
});

/**
 * Reset a game for a rematch, keeping the same seats and join token but
 * RE-RANDOMIZING sides. Either player may trigger it. The finished game is first
 * archived as an immutable match record (history is preserved, not destroyed), and
 * the rematch carries the same ruleset forward (no silent reset to defaults).
 */
export const newGame = mutation({
  args: { gameId: v.id("games"), seatToken: v.string() },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    if (viewerFromToken(game, seatToken) === "spectator") {
      throw new Error("only a player can start a new game");
    }
    if (game.opponentToken === null) throw new Error("game has not started");

    // Snapshot the played game into the immutable match archive BEFORE resetting.
    const moves = await ctx.db
      .query("moves")
      .withIndex("by_game_and_ply", (q) => q.eq("gameId", gameId))
      .collect();
    if (moves.length > 0) {
      moves.sort((a, b) => a.ply - b.ply);
      await ctx.db.insert("matches", {
        gameId,
        endedAt: Date.now(),
        status: game.state.status,
        wonBySelfCapture: game.state.wonBySelfCapture ?? false,
        config: game.state.config,
        whiteToken: game.whiteToken,
        blackToken: game.blackToken,
        log: moves.map((m) => ({
          ply: m.ply,
          byColor: m.byColor,
          action: m.action,
          events: m.events,
        })),
      });
    }

    const initiatorIsWhite = Math.random() < 0.5;
    await ctx.db.patch("games", gameId, {
      // Carry the ruleset forward — a rematch keeps the same Tier-1 settings.
      state: engine.createGame(game.state.config),
      whiteToken: initiatorIsWhite ? game.initiatorToken : game.opponentToken,
      blackToken: initiatorIsWhite ? game.opponentToken : game.initiatorToken,
    });
    // Now safe to clear the live move log (already archived above).
    for (const m of moves) await ctx.db.delete("moves", m._id);
    return null;
  },
});

/**
 * The finished games archived under this game's seats, newest first. Returns only
 * summaries (never the seat tokens); `yourColor` lets the caller default a replay
 * to their own fog perspective. Full per-game replay is getMatchReplay.
 */
export const getMatchHistory = query({
  args: { gameId: v.id("games"), seatToken: v.optional(v.string()) },
  handler: async (ctx, { gameId, seatToken }) => {
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    matches.sort((a, b) => b.endedAt - a.endedAt);
    return matches.map((m) => ({
      matchId: m._id,
      endedAt: m.endedAt,
      status: m.status,
      wonBySelfCapture: m.wonBySelfCapture,
      plies: m.log.length,
      yourColor:
        seatToken && m.whiteToken === seatToken
          ? ("w" as const)
          : seatToken && m.blackToken === seatToken
            ? ("b" as const)
            : null,
    }));
  },
});
