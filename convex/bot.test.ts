/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { parseSquare } from "../src/engine/index.js";

// Functional tests for the bot wiring: createBotGame seats the bot, and takeTurn
// plays through the normal move path from honest seat inputs. The bot's search is
// unit-tested in src/bot; here we use a shallow fixed depth for speed/determinism.
const modules = import.meta.glob("./**/!(*.test).ts");

describe("bot wiring", () => {
  it("replies to a human move (bot plays Black)", async () => {
    const t = convexTest(schema, modules);
    const g = await t.mutation(api.games.createBotGame, { botColor: "b" });
    expect(g.yourColor).toBe("w");

    // Human (White) opens.
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.seatToken,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });
    // Run the bot's scheduled turn (shallow, deterministic).
    await t.action(internal.bot.takeTurn, { gameId: g.gameId, maxDepth: 2 });

    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.seatToken });
    expect(view!.turnsTaken).toEqual({ w: 1, b: 1 }); // both have moved
    expect(view!.turn).toBe("w"); // back to the human
  });

  it("opens the game when the bot plays White", async () => {
    const t = convexTest(schema, modules);
    const g = await t.mutation(api.games.createBotGame, { botColor: "w" });
    expect(g.yourColor).toBe("b");

    // createBotGame scheduled the bot's first move; run it.
    await t.action(internal.bot.takeTurn, { gameId: g.gameId, maxDepth: 2 });

    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.seatToken });
    expect(view!.turnsTaken).toEqual({ w: 1, b: 0 }); // bot (White) has moved
    expect(view!.turn).toBe("b"); // now the human
  });

  it("feeds the bot a fog-safe event log — no enemy returnOn/duration leaks", async () => {
    const t = convexTest(schema, modules);
    const g = await t.mutation(api.games.createBotGame, { botColor: "b" });

    // Human (White) phases out the b1 knight for 2 turns.
    await t.mutation(api.games.phaseOut, {
      gameId: g.gameId,
      seatToken: g.seatToken,
      from: parseSquare("b1"),
      duration: 2,
    });

    // It is now the bot's turn — inspect the inputs it would receive.
    const ctx = await t.query(internal.bot.botContext, { gameId: g.gameId });
    expect(ctx).not.toBeNull();
    const phaseEvents = ctx!.seatEvents.filter((e) => e.kind === "phaseOut");
    expect(phaseEvents).toHaveLength(1);
    const e = phaseEvents[0]!;
    expect(e).toEqual({
      kind: "phaseOut",
      color: "w",
      type: "n",
      square: parseSquare("b1"),
      ownerTurnsTaken: 1,
    });
    // The hidden timing must NOT be present anywhere in the bot's feed.
    expect("returnOn" in e).toBe(false);
    expect("duration" in e).toBe(false);
  });
});
