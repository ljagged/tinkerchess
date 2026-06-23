/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { parseSquare } from "../src/engine/index.js";

// Functional tests through the real Convex functions. The engine's rules are
// already unit-tested; these verify the Convex layer: token join, random color
// assignment, seat identity / turn gating, and the fog-of-war boundary.

const modules = import.meta.glob("./**/!(*.test).ts");

type T = ReturnType<typeof convexTest>;

/** Create a game and join it, returning the resolved white/black seat tokens. */
async function startGame(t: T) {
  const init = await t.mutation(api.games.createGame, {});
  const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
  const initView = await t.query(api.games.getGameView, {
    gameId: init.gameId,
    seatToken: init.seatToken,
  });
  const initIsWhite = initView!.you === "w";
  return {
    gameId: init.gameId,
    joinToken: init.joinToken,
    initSeat: init.seatToken,
    oppSeat: opp.seatToken!,
    whiteSeat: initIsWhite ? init.seatToken : opp.seatToken!,
    blackSeat: initIsWhite ? opp.seatToken! : init.seatToken,
  };
}

describe("games API", () => {
  it("creates a waiting game, then an opponent joins and the game becomes active", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, {});
    expect(init.joinToken).toMatch(/^[A-Z0-9]{8}$/);

    const waiting = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(waiting!.phase).toBe("waiting");
    expect(waiting!.role).toBe("initiator");
    expect(waiting!.joinToken).toBe(init.joinToken); // initiator can see/share it

    const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
    expect(opp.role).toBe("player");
    expect(opp.seatToken).toBeTruthy();

    const active = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(active!.phase).toBe("active");
  });

  it("assigns the two seats exactly one White and one Black", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    const a = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.initSeat });
    const b = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.oppSeat });
    expect([a!.you, b!.you].sort()).toEqual(["b", "w"]);
  });

  it("lets a third caller in as a spectator (no seat, no token leak)", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    const third = await t.mutation(api.games.joinByToken, { token: g.joinToken });
    expect(third.role).toBe("spectator");
    expect(third.seatToken).toBeNull();

    const spec = await t.query(api.games.getGameView, { gameId: g.gameId });
    expect(spec!.role).toBe("spectator");
    expect(spec!.joinToken).toBeNull(); // spectators never receive the token
  });

  it("rejects an unknown token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.games.joinByToken, { token: "ZZZZ9999" })).rejects.toThrow();
  });

  it("plays a move once active, and rejects acting out of turn / by non-players", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);

    // Black can't move first.
    await expect(
      t.mutation(api.games.makeMove, {
        gameId: g.gameId,
        seatToken: g.blackSeat,
        from: parseSquare("e7"),
        to: parseSquare("e5"),
      }),
    ).rejects.toThrow();

    // White (whichever seat that is) plays e2-e4.
    const view = await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });
    expect(view.turn).toBe("b");
    expect(view.board[parseSquare("e4")]).toEqual({ color: "w", type: "p" });

    // A spectator (unrecognized token) cannot move.
    await expect(
      t.mutation(api.games.makeMove, {
        gameId: g.gameId,
        seatToken: "bogus",
        from: parseSquare("e7"),
        to: parseSquare("e5"),
      }),
    ).rejects.toThrow();
  });

  it("hides a phased piece from the opponent (fog boundary)", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    // White phases the queen out for 4.
    await t.mutation(api.games.phaseOut, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("d1"),
      duration: 4,
    });

    const whiteView = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.whiteSeat });
    const blackView = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.blackSeat });
    expect(whiteView!.yourPhased).toHaveLength(1);
    expect(blackView!.yourPhased).toHaveLength(0);
    expect(blackView!.board[parseSquare("d1")]).toBeNull();
    expect(JSON.stringify(blackView)).not.toContain("returnOn");
  });

  it("persists derived events to the move log", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });
    const moves = await t.run(async (ctx) =>
      ctx.db
        .query("moves")
        .withIndex("by_game_and_ply", (q) => q.eq("gameId", g.gameId))
        .collect(),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]!.events).toEqual([
      { kind: "move", color: "w", piece: "p", from: parseSquare("e2"), to: parseSquare("e4") },
    ]);
  });

  it("move log hides the opponent's phase-out duration while active, reveals it on game over", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.phaseOut, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("d1"),
      duration: 4,
    });

    const ownerLog = await t.query(api.games.getMoveLog, { gameId: g.gameId, seatToken: g.whiteSeat });
    const oppLog = await t.query(api.games.getMoveLog, { gameId: g.gameId, seatToken: g.blackSeat });
    expect(ownerLog!.log[0]!.san).toBe("Qd1~4"); // owner sees the duration
    expect(oppLog!.log[0]!.san).toBe("Qd1~?"); // opponent does not
    expect(oppLog!.revealed).toBe(false);
    // The raw timer never crosses the boundary.
    expect(JSON.stringify(oppLog)).not.toContain("duration");
    expect(JSON.stringify(oppLog)).not.toContain("returnOn");

    // End the game -> the true log is revealed to everyone.
    await t.run(async (ctx) => {
      const game = (await ctx.db.get("games", g.gameId))!;
      await ctx.db.patch("games", g.gameId, { state: { ...game.state, status: "w_won" } });
    });
    const revealed = await t.query(api.games.getMoveLog, { gameId: g.gameId, seatToken: g.blackSeat });
    expect(revealed!.revealed).toBe(true);
    expect(revealed!.log[0]!.san).toBe("Qd1~4");
  });

  it("newGame resets the board and keeps both players seated", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });

    // A spectator cannot reset.
    await expect(
      t.mutation(api.games.newGame, { gameId: g.gameId, seatToken: "bogus" }),
    ).rejects.toThrow();

    await t.mutation(api.games.newGame, { gameId: g.gameId, seatToken: g.initSeat });

    // Both original seats are still players, covering exactly White and Black.
    const a = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.initSeat });
    const b = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.oppSeat });
    expect([a!.you, b!.you].sort()).toEqual(["b", "w"]);
    expect(a!.board[parseSquare("e2")]).toEqual({ color: "w", type: "p" }); // pawn home again
    expect(a!.board[parseSquare("e4")]).toBeNull();
  });
});
