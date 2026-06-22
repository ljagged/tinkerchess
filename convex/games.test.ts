/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { parseSquare } from "../src/engine/index.js";

// Functional tests through the real Convex functions. The engine's rules are
// already unit-tested; these verify the Convex layer: seat identity, turn
// gating, and — most importantly — the fog-of-war boundary at getGameView.

const modules = import.meta.glob("./**/!(*.test).ts");

describe("games API", () => {
  it("plays a move through create -> join -> makeMove", async () => {
    const t = convexTest(schema, modules);
    const white = await t.mutation(api.games.createGame, {});
    const black = await t.mutation(api.games.joinGame, { gameId: white.gameId });
    expect(black.color).toBe("b");
    expect(black.seatToken).toBeTruthy();

    const view = await t.mutation(api.games.makeMove, {
      gameId: white.gameId,
      seatToken: white.seatToken,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });
    expect(view.turn).toBe("b");
    expect(view.board[parseSquare("e4")]).toEqual({ color: "w", type: "p" });
  });

  it("rejects acting out of turn and rejects non-players", async () => {
    const t = convexTest(schema, modules);
    const white = await t.mutation(api.games.createGame, {});
    const black = await t.mutation(api.games.joinGame, { gameId: white.gameId });

    // Black tries to move while it's White's turn.
    await expect(
      t.mutation(api.games.makeMove, {
        gameId: white.gameId,
        seatToken: black.seatToken!,
        from: parseSquare("e7"),
        to: parseSquare("e5"),
      }),
    ).rejects.toThrow();

    // An unrecognized token is a spectator and cannot act.
    await expect(
      t.mutation(api.games.makeMove, {
        gameId: white.gameId,
        seatToken: "not-a-real-token",
        from: parseSquare("e2"),
        to: parseSquare("e4"),
      }),
    ).rejects.toThrow();
  });

  it("hides a phased piece from the opponent's view (fog boundary)", async () => {
    const t = convexTest(schema, modules);
    const white = await t.mutation(api.games.createGame, {});
    const black = await t.mutation(api.games.joinGame, { gameId: white.gameId });

    // White phases the queen out for 4 turns.
    await t.mutation(api.games.phaseOut, {
      gameId: white.gameId,
      seatToken: white.seatToken,
      from: parseSquare("d1"),
      duration: 4,
    });

    const whiteView = await t.query(api.games.getGameView, {
      gameId: white.gameId,
      seatToken: white.seatToken,
    });
    const blackView = await t.query(api.games.getGameView, {
      gameId: white.gameId,
      seatToken: black.seatToken!,
    });

    expect(whiteView!.yourPhased).toHaveLength(1);
    expect(blackView!.yourPhased).toHaveLength(0);
    expect(blackView!.warningSquares).toHaveLength(0); // not returning next turn yet
    expect(blackView!.board[parseSquare("d1")]).toBeNull(); // off-board for everyone
    expect(JSON.stringify(blackView)).not.toContain("returnOn"); // no timer leak
  });

  it("treats a third caller (no token) as a spectator with no phased info", async () => {
    const t = convexTest(schema, modules);
    const white = await t.mutation(api.games.createGame, {});
    await t.mutation(api.games.joinGame, { gameId: white.gameId });
    await t.mutation(api.games.phaseOut, {
      gameId: white.gameId,
      seatToken: white.seatToken,
      from: parseSquare("d1"),
      duration: 4,
    });
    const spectator = await t.query(api.games.getGameView, { gameId: white.gameId });
    expect(spectator!.you).toBe("spectator");
    expect(spectator!.yourPhased).toHaveLength(0);
    expect(spectator!.warningSquares).toHaveLength(0);
  });

  it("reports the black seat open until it is claimed (invite state)", async () => {
    const t = convexTest(schema, modules);
    const white = await t.mutation(api.games.createGame, {});
    const before = await t.query(api.games.getGameView, {
      gameId: white.gameId,
      seatToken: white.seatToken,
    });
    expect(before!.blackOpen).toBe(true);

    await t.mutation(api.games.joinGame, { gameId: white.gameId });
    const after = await t.query(api.games.getGameView, {
      gameId: white.gameId,
      seatToken: white.seatToken,
    });
    expect(after!.blackOpen).toBe(false);
  });

  it("newGame resets the board to the start, and only players may call it", async () => {
    const t = convexTest(schema, modules);
    const white = await t.mutation(api.games.createGame, {});
    await t.mutation(api.games.makeMove, {
      gameId: white.gameId,
      seatToken: white.seatToken,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });

    // A spectator (unrecognized token) cannot reset.
    await expect(
      t.mutation(api.games.newGame, { gameId: white.gameId, seatToken: "bogus" }),
    ).rejects.toThrow();

    await t.mutation(api.games.newGame, { gameId: white.gameId, seatToken: white.seatToken });
    const view = await t.query(api.games.getGameView, {
      gameId: white.gameId,
      seatToken: white.seatToken,
    });
    expect(view!.turn).toBe("w");
    expect(view!.board[parseSquare("e2")]).toEqual({ color: "w", type: "p" }); // pawn home again
    expect(view!.board[parseSquare("e4")]).toBeNull();
  });
});
