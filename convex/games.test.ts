/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
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

  it("rejects an in-check non-resolving move with a readable message, accepts a legal one", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    const mv = (seat: string, from: string, to: string) =>
      t.mutation(api.games.makeMove, { gameId: g.gameId, seatToken: seat, from: parseSquare(from), to: parseSquare(to) });

    await mv(g.whiteSeat, "e2", "e4");
    await mv(g.blackSeat, "f7", "f5");
    await mv(g.whiteSeat, "d1", "h5"); // Qh5+ — Black is now in check

    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.blackSeat });
    expect(view!.inCheck).toBe(true);

    // A move that ignores the check is illegal. The client must get a readable
    // ConvexError ("...in check..."), not a bare "Server Error" (the playtest bug).
    await expect(mv(g.blackSeat, "a7", "a6")).rejects.toThrow(/in check/i);

    // A legal response (interposing on g6) is accepted from the same state.
    const after = await mv(g.blackSeat, "g7", "g6");
    expect(after.turn).toBe("w");
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
    expect(ownerLog!.log[0]!.san).toBe("Qd1↑4"); // owner sees the duration
    expect(oppLog!.log[0]!.san).toBe("Qd1↑?"); // opponent does not
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
    expect(revealed!.log[0]!.san).toBe("Qd1↑4");
  });

  it("chat is players-only: players exchange messages; spectators can't read or post", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.sendMessage, { gameId: g.gameId, seatToken: g.whiteSeat, text: "hi" });
    await t.mutation(api.games.sendMessage, { gameId: g.gameId, seatToken: g.blackSeat, text: "hello" });

    const whiteView = await t.query(api.games.getMessages, { gameId: g.gameId, seatToken: g.whiteSeat });
    expect(whiteView.map((m) => m.text)).toEqual(["hi", "hello"]);
    expect(whiteView[0]!.mine).toBe(true); // white's own
    expect(whiteView[1]!.mine).toBe(false); // black's

    // Spectators can neither read nor post (chat is private to the two seats).
    expect(await t.query(api.games.getMessages, { gameId: g.gameId, seatToken: "bogus" })).toEqual([]);
    await expect(
      t.mutation(api.games.sendMessage, { gameId: g.gameId, seatToken: "bogus", text: "spy" }),
    ).rejects.toThrow();

    // Whitespace-only messages are ignored.
    await t.mutation(api.games.sendMessage, { gameId: g.gameId, seatToken: g.whiteSeat, text: "   " });
    expect(await t.query(api.games.getMessages, { gameId: g.gameId, seatToken: g.whiteSeat })).toHaveLength(2);
  });

  it("makeMove is idempotent on a retried requestId (no double-apply)", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    const args = {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
      requestId: "req-1",
    };
    await t.mutation(api.games.makeMove, args);
    // Retry with the SAME key: a no-op (not an error, not a second move).
    await t.mutation(api.games.makeMove, args);
    const moves = await t.run(async (ctx) =>
      ctx.db.query("moves").withIndex("by_game_and_ply", (q) => q.eq("gameId", g.gameId)).collect(),
    );
    expect(moves).toHaveLength(1);
    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.whiteSeat });
    expect(view!.turn).toBe("b");
  });

  it("rejects a move made against a stale board (expectedPly mismatch)", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await expect(
      t.mutation(api.games.makeMove, {
        gameId: g.gameId,
        seatToken: g.whiteSeat,
        from: parseSquare("e2"),
        to: parseSquare("e4"),
        expectedPly: 99,
      }),
    ).rejects.toThrow();
    // The correct expectedPly succeeds.
    const view = await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
      expectedPly: 0,
    });
    expect(view.turn).toBe("b");
  });

  it("a phased piece's return is driven by turn count (survives a gap / disconnect)", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.phaseOut, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("g1"),
      duration: 1,
    });
    // Time/connection are irrelevant — nothing returns until turns are actually taken.
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.blackSeat,
      from: parseSquare("e7"),
      to: parseSquare("e5"),
    });
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });
    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.whiteSeat });
    expect(view!.board[parseSquare("g1")]).toEqual({ color: "w", type: "n" }); // returned on schedule
    expect(view!.yourPhased).toHaveLength(0);
  });

  it("createGame stores a custom ruleset; getGameView exposes it; defaults are standard", async () => {
    const t = convexTest(schema, modules);

    const custom = await t.mutation(api.games.createGame, {
      config: { maxPhaseDuration: { p: 2, n: 2, b: 2, r: 3, q: 4, k: 1 } },
    });
    const customView = await t.query(api.games.getGameView, {
      gameId: custom.gameId,
      seatToken: custom.seatToken,
    });
    expect(customView!.rules.p).toBe(2); // pawns may phase in this game

    const std = await t.mutation(api.games.createGame, {});
    const stdView = await t.query(api.games.getGameView, {
      gameId: std.gameId,
      seatToken: std.seatToken,
    });
    expect(stdView!.rules).toEqual({ p: 0, n: 2, b: 2, r: 3, q: 4, k: 1 });
  });

  it("createGame sanitizes out-of-range durations to 0..8", async () => {
    const t = convexTest(schema, modules);
    const g = await t.mutation(api.games.createGame, {
      config: { maxPhaseDuration: { p: -5, n: 99, b: 2, r: 3, q: 4, k: 1 } },
    });
    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.seatToken });
    expect(view!.rules.p).toBe(0); // clamped up from -5
    expect(view!.rules.n).toBe(8); // clamped down from 99
  });

  it("newGame archives the finished game (history preserved, not destroyed)", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });

    expect(await t.query(api.games.getMatchHistory, { gameId: g.gameId, seatToken: g.whiteSeat })).toHaveLength(0);

    await t.mutation(api.games.newGame, { gameId: g.gameId, seatToken: g.initSeat });

    const history = await t.query(api.games.getMatchHistory, { gameId: g.gameId, seatToken: g.whiteSeat });
    expect(history).toHaveLength(1);
    expect(history[0]!.plies).toBe(1);
    expect(history[0]!.yourColor).toBe("w"); // the seat that was White in the archived game
    // The live log is cleared for the rematch, but the archive kept the history.
    const liveLog = await t.query(api.games.getMoveLog, { gameId: g.gameId, seatToken: g.whiteSeat });
    expect(liveLog!.log).toHaveLength(0);
    // Seat tokens never leak in the history summary.
    expect(JSON.stringify(history)).not.toContain(g.whiteSeat);
  });

  it("getMatchReplay reconstructs an archived game with a fog toggle", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    await t.mutation(api.games.phaseOut, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
      from: parseSquare("d1"),
      duration: 4,
    });
    await t.mutation(api.games.makeMove, {
      gameId: g.gameId,
      seatToken: g.blackSeat,
      from: parseSquare("e7"),
      to: parseSquare("e5"),
    });
    await t.mutation(api.games.newGame, { gameId: g.gameId, seatToken: g.initSeat });
    const hist = await t.query(api.games.getMatchHistory, { gameId: g.gameId, seatToken: g.whiteSeat });
    const matchId = hist[0]!.matchId;

    const full = await t.query(api.games.getMatchReplay, { matchId, perspective: "full" });
    expect(full!.frames).toHaveLength(3); // initial + 2 actions
    // Full reveal: after White's phase-out, White's phased queen is visible.
    expect(full!.frames[1]!.phased.some((p) => p.color === "w" && p.type === "q")).toBe(true);
    expect(full!.moveLog[0]!.san).toBe("Qd1↑4"); // true log, full reveal

    // Watching from Black's perspective: Black never saw White's phased piece.
    const asBlack = await t.query(api.games.getMatchReplay, { matchId, perspective: "b" });
    expect(asBlack!.frames).toHaveLength(3);
    expect(asBlack!.frames[1]!.phased).toHaveLength(0);
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

describe("chess clock", () => {
  it("createGame stores a clock from the time-control id; join starts white's clock", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });

    // While waiting, the clock is seeded but not running.
    const waiting = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(waiting!.clock).toMatchObject({
      preset: "blitz_3_2",
      remaining: { w: 180_000, b: 180_000 },
      runningSince: null,
    });

    await t.mutation(api.games.joinByToken, { token: init.joinToken });
    const active = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(active!.clock!.runningSince).not.toBeNull(); // white's clock now runs
  });

  it("an untimed game has no clock", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);
    const view = await t.query(api.games.getGameView, { gameId: g.gameId, seatToken: g.whiteSeat });
    expect(view!.clock).toBeNull();
  });

  it("a move deducts the mover's elapsed and adds the increment, then switches sides", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" }); // 180s + 2s
    const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
    const initView = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    const whiteSeat = initView!.you === "w" ? init.seatToken : opp.seatToken!;

    await t.mutation(api.games.makeMove, {
      gameId: init.gameId,
      seatToken: whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });

    const after = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: whiteSeat,
    });
    // White spent only a few ms, so remaining ≈ 180s + 2s increment (just under).
    expect(after!.clock!.remaining.w).toBeGreaterThan(180_000);
    expect(after!.clock!.remaining.w).toBeLessThanOrEqual(182_000);
    expect(after!.clock!.remaining.b).toBe(180_000); // black untouched, now running
  });

  it("flagTimeout ends the game for the opponent when the side to move is out of time", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
    const initView = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    const whiteSeat = initView!.you === "w" ? init.seatToken : opp.seatToken!;
    const blackSeat = whiteSeat === init.seatToken ? opp.seatToken! : init.seatToken;

    // Backdate white's running clock so its full time has elapsed.
    await t.run(async (ctx) => {
      const game = (await ctx.db.get("games", init.gameId))!;
      await ctx.db.patch("games", init.gameId, {
        clock: { ...game.clock!, runningSince: Date.now() - 200_000 },
      });
    });

    // Black (the opponent) claims the flag.
    await t.mutation(api.games.flagTimeout, { gameId: init.gameId, seatToken: blackSeat });

    const view = await t.query(api.games.getGameView, { gameId: init.gameId, seatToken: blackSeat });
    expect(view!.status).toBe("b_won"); // white flagged -> black wins
    expect(view!.endReason).toBe("timeout");
    expect(view!.clock!.remaining.w).toBe(0); // flagged clock reads zero
    expect(view!.clock!.runningSince).toBeNull(); // clock paused
  });

  it("a timed game's untimed rematch clears the clock (patch undefined deletes it)", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
    const iv = await t.query(api.games.getGameView, { gameId: init.gameId, seatToken: init.seatToken });
    const whiteSeat = iv!.you === "w" ? init.seatToken : opp.seatToken!;
    await t.mutation(api.games.makeMove, {
      gameId: init.gameId,
      seatToken: whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });
    await t.mutation(api.games.newGame, {
      gameId: init.gameId,
      seatToken: init.seatToken,
      timeControl: "untimed",
    });
    const after = await t.query(api.games.getGameView, { gameId: init.gameId, seatToken: init.seatToken });
    expect(after!.clock).toBeNull();
  });

  it("a rematch carries the prior preset forward when timeControl is omitted", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    await t.mutation(api.games.joinByToken, { token: init.joinToken });
    await t.mutation(api.games.newGame, { gameId: init.gameId, seatToken: init.seatToken });
    const after = await t.query(api.games.getGameView, { gameId: init.gameId, seatToken: init.seatToken });
    expect(after!.clock?.preset).toBe("blitz_3_2");
    expect(after!.clock?.runningSince).not.toBeNull(); // rematch is immediately active
  });

  it("flagTimeout is a no-op when the clock has not actually expired", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "rapid_10_5" });
    const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
    await t.mutation(api.games.flagTimeout, { gameId: init.gameId, seatToken: opp.seatToken! });
    const view = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: opp.seatToken!,
    });
    expect(view!.status).toBe("active");
  });

  it("submitting a move after your own flag has fallen loses on time (move not applied)", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    const opp = await t.mutation(api.games.joinByToken, { token: init.joinToken });
    const initView = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    const whiteSeat = initView!.you === "w" ? init.seatToken : opp.seatToken!;

    await t.run(async (ctx) => {
      const game = (await ctx.db.get("games", init.gameId))!;
      await ctx.db.patch("games", init.gameId, {
        clock: { ...game.clock!, runningSince: Date.now() - 200_000 },
      });
    });

    await t.mutation(api.games.makeMove, {
      gameId: init.gameId,
      seatToken: whiteSeat,
      from: parseSquare("e2"),
      to: parseSquare("e4"),
    });

    const view = await t.query(api.games.getGameView, { gameId: init.gameId, seatToken: whiteSeat });
    expect(view!.status).toBe("b_won");
    expect(view!.endReason).toBe("timeout");
    expect(view!.board[parseSquare("e4")]).toBeNull(); // the move did not apply
  });
});

describe("server-side timeout (scheduler)", () => {
  it("scheduling: a timed game has a pending timeout job once it starts", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    // Before join: no job (clock not running yet). An absent optional field comes
    // back as null through t.run's return serialization.
    const before = await t.run(async (ctx) => (await ctx.db.get("games", init.gameId))!.timeoutJob);
    expect(before).toBeFalsy();
    await t.mutation(api.games.joinByToken, { token: init.joinToken });
    const after = await t.run(async (ctx) => (await ctx.db.get("games", init.gameId))!.timeoutJob);
    expect(after).toBeTruthy(); // white's flag is scheduled server-side
  });

  it("timeoutCheck ends the game when the running side is out of time (no client needed)", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    await t.mutation(api.games.joinByToken, { token: init.joinToken });
    // Backdate white's running clock past its full time.
    await t.run(async (ctx) => {
      const game = (await ctx.db.get("games", init.gameId))!;
      await ctx.db.patch("games", init.gameId, {
        clock: { ...game.clock!, runningSince: Date.now() - 200_000 },
      });
    });
    // The scheduler fires this internal mutation — invoke it directly.
    await t.mutation(internal.games.timeoutCheck, { gameId: init.gameId });
    const view = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(view!.status).toBe("b_won"); // white (to move) flagged → black wins
    expect(view!.endReason).toBe("timeout");
  });

  it("timeoutCheck is a no-op when the clock has not expired", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "rapid_10_5" });
    await t.mutation(api.games.joinByToken, { token: init.joinToken });
    await t.mutation(internal.games.timeoutCheck, { gameId: init.gameId });
    const view = await t.query(api.games.getGameView, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(view!.status).toBe("active");
  });

  it("a game that ends on a zero-ply timeout is still archived on rematch", async () => {
    const t = convexTest(schema, modules);
    const init = await t.mutation(api.games.createGame, { timeControl: "blitz_3_2" });
    await t.mutation(api.games.joinByToken, { token: init.joinToken });
    await t.run(async (ctx) => {
      const game = (await ctx.db.get("games", init.gameId))!;
      await ctx.db.patch("games", init.gameId, {
        clock: { ...game.clock!, runningSince: Date.now() - 200_000 },
      });
    });
    await t.mutation(internal.games.timeoutCheck, { gameId: init.gameId }); // flags at ply 0
    await t.mutation(api.games.newGame, { gameId: init.gameId, seatToken: init.seatToken });
    const history = await t.query(api.games.getMatchHistory, {
      gameId: init.gameId,
      seatToken: init.seatToken,
    });
    expect(history.length).toBe(1);
    expect(history[0]!.plies).toBe(0);
    expect(history[0]!.endReason).toBe("timeout");
  });
});

describe("legal-move highlights", () => {
  it("getGameView exposes legalMoves only to the side to move", async () => {
    const t = convexTest(schema, modules);
    const g = await startGame(t);

    const whiteView = await t.query(api.games.getGameView, {
      gameId: g.gameId,
      seatToken: g.whiteSeat,
    });
    expect(whiteView!.legalMoves).not.toBeNull();
    expect(whiteView!.legalMoves![parseSquare("e2")]).toEqual(
      expect.arrayContaining([parseSquare("e3"), parseSquare("e4")]),
    );

    // Not black's turn -> no legal-move hints leak to them.
    const blackView = await t.query(api.games.getGameView, {
      gameId: g.gameId,
      seatToken: g.blackSeat,
    });
    expect(blackView!.legalMoves).toBeNull();
  });
});
