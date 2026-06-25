// Server-side wiring for the robo-player (src/bot). The bot is just a player whose
// seat happens to be driven by the server: when it is the bot's turn, commit() (or
// createBotGame, for a bot playing White) schedules `takeTurn`, which picks an
// action and submits it through the SAME makeMove/phaseOut path a human uses — so
// all server validation and the fog boundary apply identically.
//
// HONESTY: the bot only ever receives what its seat legitimately knows. botContext
// builds the bot's GameView (engine.viewFor), the public-but-not-rendered fields
// (config/history/castling/en-passant), and a fog-safe phase-event log carrying
// only the PUBLIC facts of each phase event (origin/return square, piece type, and
// the owner's turn count) — never the enemy's hidden returnOn/duration. The bot
// assumes enemy timers itself (see src/bot/view.ts).

import { internalAction, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import * as engine from "../src/engine/index.js";
import { chooseAction, moveTimeBudgetMs, UNTIMED_BUDGET_MS } from "../src/bot/index.js";
import type { PublicState, SeatPhaseEvent } from "../src/bot/index.js";
import { engineState } from "./games";

// F5 (runtime budget): the search runs in an ACTION (not the move mutation), so a
// few hundred ms of CPU never blocks a transaction or risks OCC contention.
//
// In a TIMED game the per-move budget is derived from the bot's OWN remaining clock
// time (see moveTimeBudgetMs) so the bot spends time like a player — more when the
// clock is healthy, less under pressure, never into a self-inflicted flag. In an
// untimed game there is no clock to spend, so a fixed responsive budget is used.
// The clock's banked `remaining[botColor]` is effectively live here: the bot's turn
// is scheduled the instant the human's move switches the clock (runAfter 0), so the
// elapsed since the bot's period started is negligible.

/**
 * Fold the move log into a fog-safe phase-event stream for the bot. Each phase
 * event carries only public facts; `ownerTurnsTaken` is the owner's completed-turn
 * count at the event, derived purely from the public ply order — NOT from the
 * event's hidden returnOn/duration, which are never read here.
 */
function seatPhaseEvents(rows: Doc<"moves">[]): SeatPhaseEvent[] {
  const ordered = [...rows].sort((a, b) => a.ply - b.ply);
  const turns = { w: 0, b: 0 };
  const out: SeatPhaseEvent[] = [];
  for (const row of ordered) {
    turns[row.byColor] += 1; // owner's completed-turn count after this row
    for (const ev of row.events ?? []) {
      if (ev.kind === "phaseOut") {
        out.push({ kind: "phaseOut", color: ev.color, type: ev.piece, square: ev.from, ownerTurnsTaken: turns[ev.color] });
      } else if (ev.kind === "phaseIn") {
        out.push({ kind: "phaseIn", color: ev.color, type: ev.piece, square: ev.to, ownerTurnsTaken: turns[ev.color] });
      }
    }
  }
  return out;
}

/**
 * Assemble the bot's honest decision inputs, or null if it isn't the bot's move
 * (game over, not a bot game, or the human's turn). Internal — only takeTurn calls it.
 */
export const botContext = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get("games", gameId);
    if (!game || !game.botColor || game.state.status !== "active") return null;
    const botColor = game.botColor;
    if (game.state.turn !== botColor) return null;

    const s = engineState(game);
    const rows = await ctx.db
      .query("moves")
      .withIndex("by_game_and_ply", (q) => q.eq("gameId", gameId))
      .collect();

    const publicState: PublicState = {
      config: s.config ?? engine.DEFAULT_RULE_CONFIG,
      history: s.history ?? [],
      castling: s.castling,
      enPassant: s.enPassant,
    };
    const budgetMs = game.clock
      ? moveTimeBudgetMs(game.clock.remaining[botColor], game.clock.incrementMs)
      : UNTIMED_BUDGET_MS;
    return {
      botColor,
      botSeatToken: botColor === "w" ? game.whiteToken : game.blackToken,
      view: engine.viewFor(s, botColor),
      publicState,
      seatEvents: seatPhaseEvents(rows),
      ply: s.turnsTaken.w + s.turnsTaken.b,
      budgetMs,
    };
  },
});

/**
 * Play the bot's turn: pick an action from honest inputs and submit it through the
 * normal move path. `maxDepth` (tests) forces a deterministic fixed-depth search;
 * production uses the bounded time budget. Idempotent per (game, ply) so a re-fired
 * schedule cannot double-move. Internal — scheduled by commit()/createBotGame.
 */
export const takeTurn = internalAction({
  args: { gameId: v.id("games"), maxDepth: v.optional(v.number()) },
  handler: async (ctx, { gameId, maxDepth }) => {
    const c = await ctx.runQuery(internal.bot.botContext, { gameId });
    if (!c || !c.botSeatToken) return null;

    const opts = maxDepth !== undefined ? { maxDepth } : { timeBudgetMs: c.budgetMs };
    const action = chooseAction(c.view as engine.GameView, c.publicState, c.seatEvents, opts);
    const requestId = `bot:${gameId}:${c.ply}`; // one move per ply, even if re-scheduled

    if (action.kind === "move") {
      await ctx.runMutation(api.games.makeMove, {
        gameId,
        seatToken: c.botSeatToken,
        from: action.move.from,
        to: action.move.to,
        ...(action.move.promotion ? { promotion: action.move.promotion } : {}),
        requestId,
      });
    } else {
      await ctx.runMutation(api.games.phaseOut, {
        gameId,
        seatToken: c.botSeatToken,
        from: action.phaseOut.from,
        duration: action.phaseOut.duration,
        requestId,
      });
    }
    return null;
  },
});
