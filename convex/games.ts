import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { colorV, pieceTypeV, ruleConfigV } from "./schema";
import * as engine from "../src/engine/index.js";
import { isQuickEmote } from "../src/emotes.js";
import {
  applyMoveToClock,
  isExpired,
  newClock,
  resolveTimeControlId,
  startClock,
  type Clock,
} from "../src/timecontrol.js";

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
  if (!game) throw new ConvexError("Game not found.");
  return game;
}

/** Trim and length-cap a player-supplied display name; "" -> undefined. */
function sanitizeName(name: string | undefined): string | undefined {
  const trimmed = (name ?? "").trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolve stored names to colors via the white/black token mapping. When both
 * players entered the same display name (case-insensitive), the JOINER's copy is
 * disambiguated to "Name (2)" so the two seats never read identically — there are
 * no accounts, so a name is just a label and collisions are expected. Display-only:
 * the stored names are untouched. */
function playerNames(game: Doc<"games">): { w: string | null; b: string | null } {
  const initiatorName = game.initiatorName ?? null;
  let opponentName = game.opponentName ?? null;
  if (
    initiatorName &&
    opponentName &&
    initiatorName.toLowerCase() === opponentName.toLowerCase()
  ) {
    opponentName = `${opponentName} (2)`;
  }
  const nameForToken = (token: string | null) =>
    token === game.initiatorToken
      ? initiatorName
      : token && token === game.opponentToken
        ? opponentName
        : null;
  return { w: nameForToken(game.whiteToken), b: nameForToken(game.blackToken) };
}

/**
 * Coerce a stored game's state into a full engine GameState (lastEvent / captured
 * / history are stored optional for back-compat; the engine treats absence as the
 * default).
 */
export function engineState(game: Doc<"games">): engine.GameState {
  const s = game.state;
  return {
    ...s,
    lastEvent: s.lastEvent ?? null,
    captured: s.captured ?? { w: [], b: [] },
    history: s.history ?? [],
  };
}

// --- public API ------------------------------------------------------------

/** Create a game. The creator gets a join token to share and their seat token. The
 * time control (resolved server-side from its id) is set now but only STARTS
 * running once the opponent joins. */
export const createGame = mutation({
  args: {
    config: v.optional(ruleConfigV),
    name: v.optional(v.string()),
    timeControl: v.optional(v.string()),
  },
  handler: async (ctx, { config, name, timeControl }) => {
    const joinToken = await uniqueJoinToken(ctx);
    const initiatorToken = crypto.randomUUID();
    // Absent timeControl ⇒ untimed (back-compat). The UI picker always sends an
    // explicit id (defaulting to the rapid preset), so games made via the app are timed.
    const clock = timeControl !== undefined ? newClock(resolveTimeControlId(timeControl)) : undefined;
    const gameId = await ctx.db.insert("games", {
      state: engine.createGame(sanitizeConfig(config)),
      joinToken,
      initiatorToken,
      opponentToken: null,
      whiteToken: null,
      blackToken: null,
      initiatorName: sanitizeName(name),
      ...(clock ? { clock } : {}),
      createdAt: Date.now(),
    });
    return { gameId, joinToken, seatToken: initiatorToken };
  },
});

/**
 * Create a game against the server-side robo-player. The bot fills the opponent
 * seat immediately, so the game is active at once (no join step). The bot's color
 * is `botColor` if given, else random. If the bot is White it moves first — we
 * schedule its turn now. The bot holds a normal seat token and plays through the
 * same makeMove/phaseOut path a human would; only `botColor` marks the seat.
 */
export const createBotGame = mutation({
  args: {
    config: v.optional(ruleConfigV),
    name: v.optional(v.string()),
    timeControl: v.optional(v.string()),
    botColor: v.optional(colorV),
  },
  handler: async (ctx, { config, name, timeControl, botColor }) => {
    const joinToken = await uniqueJoinToken(ctx);
    const humanToken = crypto.randomUUID();
    const botToken = crypto.randomUUID();
    const botIsWhite = botColor === "w" || (botColor === undefined && Math.random() < 0.5);
    const resolvedBotColor: "w" | "b" = botIsWhite ? "w" : "b";
    // Active immediately (both seats filled) ⇒ white's clock starts now.
    const fresh = timeControl !== undefined ? newClock(resolveTimeControlId(timeControl)) : undefined;
    const clock = fresh ? startClock(fresh, Date.now()) : undefined;
    const gameId = await ctx.db.insert("games", {
      state: engine.createGame(sanitizeConfig(config)),
      joinToken,
      initiatorToken: humanToken,
      opponentToken: botToken, // the bot occupies the opponent seat
      whiteToken: botIsWhite ? botToken : humanToken,
      blackToken: botIsWhite ? humanToken : botToken,
      initiatorName: sanitizeName(name),
      botColor: resolvedBotColor,
      ...(clock ? { clock } : {}),
      createdAt: Date.now(),
    });
    // Mirror joinByToken's server-side flag for white's running clock.
    if (clock) {
      const timeoutJob = await scheduleTimeout(ctx, gameId, clock, "w");
      await ctx.db.patch("games", gameId, { timeoutJob });
    }
    if (botIsWhite) await ctx.scheduler.runAfter(0, internal.bot.takeTurn, { gameId });
    return {
      gameId,
      seatToken: humanToken,
      yourColor: botIsWhite ? ("b" as const) : ("w" as const),
      joinToken,
    };
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
    if (!game) throw new ConvexError("No game found for that token.");

    if (game.opponentToken === null) {
      const opponentToken = crypto.randomUUID();
      const initiatorIsWhite = Math.random() < 0.5;
      // The game is now active — white moves first, so white's clock starts and we
      // schedule the server-side flag for white's full time.
      const started = game.clock ? startClock(game.clock, Date.now()) : undefined;
      const timeoutJob = started ? await scheduleTimeout(ctx, game._id, started, "w") : undefined;
      await ctx.db.patch("games", game._id, {
        opponentToken,
        whiteToken: initiatorIsWhite ? game.initiatorToken : opponentToken,
        blackToken: initiatorIsWhite ? opponentToken : game.initiatorToken,
        opponentName: sanitizeName(name),
        ...(started ? { clock: started, timeoutJob } : {}),
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

    const s = engineState(game);
    const base = engine.viewFor(s, viewer);
    const showToken = role === "initiator" || role === "player";
    // The active ruleset (Tier-1 Settings) is public — both players see what's in
    // effect, and the joiner sees the rules they joined.
    const rules = (s.config ?? engine.DEFAULT_RULE_CONFIG).maxPhaseDuration;
    // Legal-move targets for highlighting (DESIGN.md dots/rings). Only the side to
    // move gets them, and only their OWN moves — computed on a board where phased
    // pieces are off-board for everyone, so this leaks nothing beyond the
    // square-only warnings the viewer already receives.
    const legalMoves =
      viewer !== "spectator" && s.status === "active" && s.turn === viewer
        ? legalMovesByFrom(s)
        : null;
    return {
      ...base,
      phase: waiting ? ("waiting" as const) : ("active" as const),
      role,
      joinToken: showToken ? game.joinToken : null,
      rules,
      players: playerNames(game),
      // The clock is public (both players + spectators see both times), or null
      // for an untimed game. `serverNow` lets the client cancel clock skew.
      clock: game.clock ?? null,
      serverNow: Date.now(),
      legalMoves,
    };
  },
});

/** Group the side-to-move's fully-legal moves by origin square (for UI highlights). */
function legalMovesByFrom(state: engine.GameState): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const m of engine.legalMoves(state)) {
    (out[m.from] ??= []).push(m.to);
  }
  return out;
}

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
        } else if (ev.kind === "phaseIn") {
          entry.to = ev.to;
        } else {
          entry.to = ev.square; // boostGranted / boostExpired highlight the boosted square
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
    const move: engine.Move = { from: r.from, to: r.to };
    if (r.promotion !== undefined) move.promotion = r.promotion;
    if (r.castle !== undefined) move.castle = r.castle; // Chess960 castle flag
    return { kind: "move", move };
  }
  if (r.kind === "boost") {
    const move = r.move
      ? ({ from: r.move.from, to: r.move.to, ...(r.move.promotion ? { promotion: r.move.promotion } : {}), ...(r.move.castle ? { castle: r.move.castle } : {}) } as engine.Move)
      : undefined;
    return { kind: "boost", boost: { target: r.target, fodder: r.fodder, ...(move ? { move } : {}) } };
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
      endReason: v.endReason,
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
    endReason: v.endReason,
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
    // Rebuild under the same setup + mechanics the match ran (absent ⇒ classical +
    // phasing), so the deterministic replay reproduces the archived states exactly.
    let state = engine.createGame(match.config, {
      setup: match.setup,
      mechanics: match.mechanics,
    });
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

    return { perspective, status: match.status, endReason: match.endReason, frames, moveLog };
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
    if (color === "spectator") throw new ConvexError("Only players can chat.");
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LEN);
    if (!trimmed) return null;
    await ctx.db.insert("messages", { gameId, color, text: trimmed, createdAt: Date.now() });
    return null;
  },
});

/** Post a quick emote (a one-tap canned gesture). Players only, same as chat. The
 * emoji MUST be one of the known QUICK_EMOTES — the buttons can only send those, and
 * the server rejects anything else. Stored as a message with kind:"emote" so the UI
 * renders it as a gesture rather than a typed line. */
export const sendEmote = mutation({
  args: { gameId: v.id("games"), seatToken: v.string(), emoji: v.string() },
  handler: async (ctx, { gameId, seatToken, emoji }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    const color = viewerFromToken(game, seatToken);
    if (color === "spectator") throw new ConvexError("Only players can chat.");
    if (!isQuickEmote(emoji)) throw new ConvexError("Unknown emote.");
    await ctx.db.insert("messages", { gameId, color, text: emoji, kind: "emote", createdAt: Date.now() });
    return null;
  },
});

/** The game's chat, oldest first. Players only — spectators get an empty list
 * (the chat is private to the two seats). `mine` marks the caller's own messages;
 * `kind` is "emote" for a quick emote, else absent for a typed message. */
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
    return msgs.map((m) => ({
      id: m._id,
      color: m.color,
      text: m.text,
      kind: m.kind ?? null,
      mine: m.color === viewer,
    }));
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
  if (viewer === "spectator") throw new ConvexError("You are not a player in this game.");
  return { game, color: viewer };
}

// --- server-side timeout adjudication ---------------------------------------
// A running clock must flag even if no client is watching (lichess-correct).
// At each clock switch we schedule a `timeoutCheck` for exactly the running
// side's remaining time and cancel/replace it on the next move. The check
// re-validates against live server time, so a stale or early fire is a safe
// no-op (it can never flag the wrong side).

/** Cancel a game's pending timeout check, if any. Harmless if it already ran
 * (Convex `cancel` is a no-op for in-progress/completed jobs). */
async function cancelTimeoutJob(ctx: MutationCtx, game: Doc<"games">): Promise<void> {
  if (game.timeoutJob) await ctx.scheduler.cancel(game.timeoutJob);
}

/** Schedule a timeout check at the running side's deadline (`remaining[sideToMove]`
 * ms out, since their period just started). Returns the job id to store. */
async function scheduleTimeout(
  ctx: MutationCtx,
  gameId: Id<"games">,
  clock: Clock,
  sideToMove: "w" | "b",
): Promise<Id<"_scheduled_functions">> {
  const delay = Math.max(0, clock.remaining[sideToMove]);
  return ctx.scheduler.runAfter(delay, internal.games.timeoutCheck, { gameId });
}

/**
 * Scheduled timeout check (the server-side flag). Fires at the running side's
 * deadline; if that side is still to move and genuinely out of time, ends the
 * game. A stale/early fire (the clock since switched, paused, or the game ended)
 * is a safe no-op because it re-checks live server time. Internal — only the
 * scheduler calls it.
 */
export const timeoutCheck = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get("games", gameId);
    if (!game || !game.clock || game.state.status !== "active") return null;
    if (!isExpired(game.clock, game.state.turn, Date.now())) return null;
    await endByTimeout(ctx, game, game.state.turn, "spectator"); // returned view unused
    return null;
  },
});

/**
 * End an active game on time: the side whose clock ran out (`flagged`) loses, the
 * other wins. Pauses the clock, cancels the pending timeout job, stamps the
 * `timeout` end reason, persists, and returns the fog view for `viewer`. (v1 always
 * awards the win — no insufficient-material draw; in a phase variant "insufficient
 * material" is murky because a phased piece can return. Revisit later.)
 */
async function endByTimeout(
  ctx: MutationCtx,
  game: Doc<"games">,
  flagged: "w" | "b",
  viewer: Viewer,
) {
  const winner: "w" | "b" = flagged === "w" ? "b" : "w";
  const next: engine.GameState = {
    ...engineState(game),
    status: winner === "w" ? "w_won" : "b_won",
    endReason: "timeout",
  };
  // Zero the flagged side's clock (it ran out) and pause the running period.
  const clock: Clock | undefined = game.clock
    ? { ...game.clock, remaining: { ...game.clock.remaining, [flagged]: 0 }, runningSince: null }
    : undefined;
  await cancelTimeoutJob(ctx, game);
  await ctx.db.patch("games", game._id, {
    state: next,
    ...(clock ? { clock } : {}),
    timeoutJob: undefined, // game over — no pending check
  });
  return engine.viewFor(next, viewer);
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

  if (game.state.turn !== color) throw new ConvexError("It's not your turn.");

  const currentPly = game.state.turnsTaken.w + game.state.turnsTaken.b;
  if (expectedPly !== undefined && expectedPly !== currentPly) {
    throw new ConvexError("Your board is out of sync — it'll refresh, then try again.");
  }

  // One server timestamp for both the flag check and the clock switch, so they can
  // never disagree within this mutation.
  const now = Date.now();
  // Flag-on-press: if the mover's clock already ran out, they've lost on time and
  // the submitted action does NOT apply (the flag fell before the press landed).
  if (game.clock && isExpired(game.clock, color, now)) {
    return endByTimeout(ctx, game, color, color);
  }

  // The engine throws on an illegal action. Surface it as a readable ConvexError
  // (a plain Error reaches the client as a bare "Server Error"). Until the client
  // highlights legal moves, this is the only feedback for, e.g., a move that
  // leaves your own king in check.
  let applied: ReturnType<typeof engine.applyActionWithEvents>;
  try {
    applied = engine.applyActionWithEvents(engineState(game), action);
  } catch (e) {
    if (e instanceof engine.IllegalActionError) {
      const inCheck = !engine.kingSafe(engineState(game), color);
      throw new ConvexError(
        inCheck
          ? "You're in check — that move doesn't get your king to safety."
          : "That move isn't legal.",
      );
    }
    throw e;
  }
  const { state: next, events } = applied;
  // Switch the clock: deduct the mover's elapsed, add their increment, and start
  // the opponent's clock — or pause it if this move ended the game. Re-point the
  // server-side flag at the new running side (or clear it when the game is over).
  const clockPatch: { clock?: Clock; timeoutJob?: Id<"_scheduled_functions"> } = {};
  if (game.clock) {
    const gameOver = next.status !== "active";
    const switched = applyMoveToClock(game.clock, color, now, gameOver).clock;
    clockPatch.clock = switched;
    await cancelTimeoutJob(ctx, game);
    clockPatch.timeoutJob = gameOver
      ? undefined
      : await scheduleTimeout(ctx, game._id, switched, next.turn);
  }
  await ctx.db.patch("games", game._id, { state: next, ...clockPatch });
  await ctx.db.insert("moves", {
    gameId: game._id,
    ply: next.turnsTaken.w + next.turnsTaken.b,
    byColor: color,
    action: recorded,
    events,
    ...(requestId ? { requestId } : {}),
  });
  // If it is now the bot's turn, let the server-side actor play. Scheduled so it
  // runs AFTER this mutation commits and routes back through this same commit path
  // (the bot's own move then flips the turn back, so this never loops).
  if (game.botColor && next.status === "active" && next.turn === game.botColor) {
    await ctx.scheduler.runAfter(0, internal.bot.takeTurn, { gameId: game._id });
  }
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
    const intent = {
      from: args.from,
      to: args.to,
      promotion: args.promotion as engine.Move["promotion"],
    };
    // Resolve the client intent to the canonical legal move, which carries the castle
    // flag in Chess960 (a king-onto-rook gesture). For classical play and ordinary
    // moves this is the same {from,to,promotion}. Fall back to the raw intent when no
    // legal move matches, so an illegal submission still hits commit's normal error.
    const move = engine.resolveMove(engineState(game), intent) ?? intent;
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
 * End the game if the side to move has run out of time. Any player may call it —
 * typically the OPPONENT's client when it watches the running clock hit zero. The
 * server re-checks against its own clock, so a premature or wrong claim is a
 * graceful no-op that just returns the current view.
 */
export const flagTimeout = mutation({
  args: { gameId: v.id("games"), seatToken: v.string() },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    const viewer = viewerFromToken(game, seatToken);
    if (viewer === "spectator") throw new ConvexError("You are not a player in this game.");
    if (!game.clock || game.state.status !== "active") {
      return engine.viewFor(engineState(game), viewer);
    }
    if (!isExpired(game.clock, game.state.turn, Date.now())) {
      return engine.viewFor(engineState(game), viewer); // not actually out of time
    }
    return endByTimeout(ctx, game, game.state.turn, viewer);
  },
});

/**
 * Resign. Either player may resign their ACTIVE game at any time (it need not be
 * their turn); the opponent wins by "resignation". Pauses and clears the clock and
 * cancels the pending flag, exactly like a checkmate/timeout end. A spectator can't
 * resign; resigning a not-yet-started or already-finished game is a graceful no-op
 * that just returns the current view (so a double-tap or a race can't error).
 */
export const resign = mutation({
  args: { gameId: v.id("games"), seatToken: v.string() },
  handler: async (ctx, { gameId, seatToken }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    const viewer = viewerFromToken(game, seatToken);
    if (viewer === "spectator") throw new ConvexError("You are not a player in this game.");
    if (game.opponentToken === null || game.state.status !== "active") {
      return engine.viewFor(engineState(game), viewer);
    }
    const winner: "w" | "b" = viewer === "w" ? "b" : "w";
    const next: engine.GameState = {
      ...engineState(game),
      status: winner === "w" ? "w_won" : "b_won",
      endReason: "resignation",
    };
    // The game is over: pause the running period and drop the pending timeout job.
    const clock: Clock | undefined = game.clock ? { ...game.clock, runningSince: null } : undefined;
    await cancelTimeoutJob(ctx, game);
    await ctx.db.patch("games", game._id, {
      state: next,
      ...(clock ? { clock } : {}),
      timeoutJob: undefined,
    });
    return engine.viewFor(next, viewer);
  },
});

/**
 * Reset a game for a rematch, keeping the same seats and join token but
 * RE-RANDOMIZING sides. Either player may trigger it. The finished game is first
 * archived as an immutable match record (history is preserved, not destroyed). The
 * rematch carries the same ruleset forward; the time control is the one chosen now
 * (the "New game" picker), defaulting to carrying the previous game's forward.
 */
export const newGame = mutation({
  args: { gameId: v.id("games"), seatToken: v.string(), timeControl: v.optional(v.string()) },
  handler: async (ctx, { gameId, seatToken, timeControl }) => {
    const game = requireGame(await ctx.db.get("games", gameId));
    if (viewerFromToken(game, seatToken) === "spectator") {
      throw new ConvexError("Only a player can start a new game.");
    }
    if (game.opponentToken === null) throw new ConvexError("The game has not started yet.");

    // Snapshot the played game into the immutable match archive BEFORE resetting.
    const moves = await ctx.db
      .query("moves")
      .withIndex("by_game_and_ply", (q) => q.eq("gameId", gameId))
      .collect();
    // Archive any game that actually happened: one with moves, OR a finished game
    // with none (e.g. a flag falls before either side moves). Skip only a fresh,
    // never-played, still-active game (nothing to record).
    if (moves.length > 0 || game.state.status !== "active") {
      moves.sort((a, b) => a.ply - b.ply);
      await ctx.db.insert("matches", {
        gameId,
        endedAt: Date.now(),
        status: game.state.status,
        endReason: game.state.endReason,
        config: game.state.config,
        // Carry the moddable axes so the match replays faithfully (setup + mechanics
        // change the derived states; schemaVersion records the shape it ran under).
        setup: game.state.setup,
        mechanics: game.state.mechanics,
        schemaVersion: game.state.schemaVersion,
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

    // The rematch is immediately active (both seats are still filled), so the new
    // clock starts running right away (white to move). An explicit timeControl
    // overrides; otherwise carry the previous game's preset forward (absent = untimed).
    const presetId =
      timeControl !== undefined
        ? resolveTimeControlId(timeControl)
        : (game.clock?.preset ?? "untimed");
    const fresh = newClock(presetId);
    const clock = fresh ? startClock(fresh, Date.now()) : undefined;
    // Replace the prior game's pending flag: cancel it, then schedule the rematch's
    // (white to move) if it's timed.
    await cancelTimeoutJob(ctx, game);
    const timeoutJob = clock ? await scheduleTimeout(ctx, gameId, clock, "w") : undefined;

    const initiatorIsWhite = Math.random() < 0.5;
    await ctx.db.patch("games", gameId, {
      // Carry the ruleset + moddable axes forward — a rematch keeps the same Tier-1
      // settings, setup, and mechanics.
      state: engine.createGame(game.state.config, {
        setup: game.state.setup,
        mechanics: game.state.mechanics,
      }),
      whiteToken: initiatorIsWhite ? game.initiatorToken : game.opponentToken,
      blackToken: initiatorIsWhite ? game.opponentToken : game.initiatorToken,
      // `undefined` clears any prior clock/job so an untimed rematch is truly untimed.
      clock,
      timeoutJob,
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
      endReason: m.endReason,
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
