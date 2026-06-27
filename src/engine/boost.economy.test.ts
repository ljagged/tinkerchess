// Stage 3B — the boost action: sacrifice economy (exact cost, no change, no banking),
// the standing 3-turn buff and its expiry, immediate (boost + move) play, the buff
// following its piece across a move, and the king-safety gate.

import { describe, it, expect } from "vitest";
import {
  createGame,
  applyAction,
  applyActionWithEvents,
  validateBoost,
  legalBoosts,
  boostAt,
  parseSquare,
  pieceAt,
} from "./index.js";
import type { Action, BoostInput, Color, GameState, Piece } from "./index.js";

const sq = parseSquare;
/** A fresh standard game with boost (and phasing) active. */
const boostGame = (): GameState => createGame(undefined, { mechanics: ["phasing", "boost"] });
const boostAction = (boost: BoostInput): Action => ({ kind: "boost", boost });

describe("boost economy — exact cost, no change, no banking", () => {
  it("boosting a knight (cost 1) is paid by exactly one pawn", () => {
    const g = boostGame();
    expect(validateBoost(g, { target: sq("b1"), fodder: [sq("a2")] }).ok).toBe(true);
  });

  it("rejects underpayment, overpayment (no banking), and the wrong fodder", () => {
    const g = boostGame();
    expect(validateBoost(g, { target: sq("b1"), fodder: [] }).ok).toBe(false); // 0 ≠ 1
    expect(validateBoost(g, { target: sq("b1"), fodder: [sq("a2"), sq("b2")] }).ok).toBe(false); // 2 ≠ 1
    expect(validateBoost(g, { target: sq("d1"), fodder: [sq("a2")] }).ok).toBe(false); // queen costs 5, not 1
  });

  it("rejects sacrificing the king, the target itself, or an enemy/empty square", () => {
    const g = boostGame();
    expect(validateBoost(g, { target: sq("b1"), fodder: [sq("e1")] }).ok).toBe(false); // king fodder
    expect(validateBoost(g, { target: sq("b1"), fodder: [sq("b1")] }).ok).toBe(false); // self fodder
    expect(validateBoost(g, { target: sq("b1"), fodder: [sq("a7")] }).ok).toBe(false); // enemy pawn
    expect(validateBoost(g, { target: sq("b1"), fodder: [sq("a3")] }).ok).toBe(false); // empty
  });

  it("a queen boost (cost 5) accepts a rook's worth of fodder (5 pawns) exactly", () => {
    // place five spare white pawns on rank 3 by hand and clear the back rank a bit
    const g = boostGame();
    for (const s of ["a3", "b3", "c3", "f3", "g3"]) g.board[sq(s)] = { color: "w", type: "p" };
    const fodder = ["a3", "b3", "c3", "f3", "g3"].map(sq);
    expect(validateBoost(g, { target: sq("d1"), fodder }).ok).toBe(true);
  });

  it("legalBoosts offers one canonical boost per affordable piece (a knight for one pawn)", () => {
    const g = boostGame();
    const targets = legalBoosts(g).map((b) => b.target);
    expect(targets).toContain(sq("b1"));
    expect(targets).toContain(sq("g1"));
    // the queen (cost 5) is unaffordable from the opening (only 8 pawns, all needed for
    // structure — but 5 pawns DO exist, so it IS offered); knights are the cheap case.
    expect(legalBoosts(g).every((b) => validateBoost(g, b).ok)).toBe(true);
  });
});

describe("boost — standing buff grants the fairy power and expires after 3 turns", () => {
  it("a standing knight boost consumes the turn, grants knight-ferz, and is recorded", () => {
    const g = boostGame();
    const { state, events } = applyActionWithEvents(g, boostAction({ target: sq("b1"), fodder: [sq("a2")] }));
    expect(events[0]).toMatchObject({ kind: "boostGranted", base: "n", square: sq("b1") });
    expect((events[0] as { immediate?: true }).immediate).toBeUndefined(); // standing, not immediate
    expect(boostAt(state, sq("b1"), "w")).toBeTruthy();
    expect(pieceAt(state.board, sq("a2"))).toBeNull(); // fodder sacrificed
    expect(state.turn).toBe("b"); // the boost consumed white's turn
    expect(state.captured.w).toContain("p"); // the sacrificed pawn is the owner's loss
  });

  it("the buff expires after three of the owner's turns (boostExpired event)", () => {
    let s = boostGame();
    s = applyAction(s, boostAction({ target: sq("b1"), fodder: [sq("a2")] })); // w turn 1 (boost)
    const quiet: Action[] = [
      { kind: "move", move: { from: sq("e7"), to: sq("e6") } }, // b
      { kind: "move", move: { from: sq("g1"), to: sq("f3") } }, // w turn 2
      { kind: "move", move: { from: sq("d7"), to: sq("d6") } }, // b
      { kind: "move", move: { from: sq("f3"), to: sq("g1") } }, // w turn 3
      { kind: "move", move: { from: sq("g8"), to: sq("f6") } }, // b
    ];
    for (const a of quiet) s = applyAction(s, a);
    expect(boostAt(s, sq("b1"), "w")).toBeTruthy(); // still active through turn 3
    // white's 4th turn — the buff's timer elapses at end of turn
    const r = applyActionWithEvents(s, { kind: "move", move: { from: sq("b1"), to: sq("c3") } });
    // (the knight moved off b1, but the buff followed it to c3, then expired this turn)
    expect(r.events.some((e) => e.kind === "boostExpired")).toBe(true);
    expect(r.state.boosts ?? []).toHaveLength(0);
  });

  it("the buff follows its piece across a normal move (relocation)", () => {
    let s = boostGame();
    s = applyAction(s, boostAction({ target: sq("b1"), fodder: [sq("a2")] })); // boost knight b1
    s = applyAction(s, { kind: "move", move: { from: sq("e7"), to: sq("e6") } }); // black
    s = applyAction(s, { kind: "move", move: { from: sq("b1"), to: sq("c3") } }); // boosted knight moves
    expect(boostAt(s, sq("b1"), "w")).toBeUndefined();
    expect(boostAt(s, sq("c3"), "w")).toBeTruthy(); // the buff moved with the knight
  });
});

describe("boost — immediate (boost + move same turn) costs the premium", () => {
  it("an immediate knight boost (cost 1+2) moves the knight this turn via 3 pawns", () => {
    const g = boostGame();
    const fodder = [sq("a2"), sq("b2"), sq("c2")]; // 3 pawns = 3 = 1 + 2 premium
    const input: BoostInput = { target: sq("b1"), fodder, move: { from: sq("b1"), to: sq("c3") } };
    expect(validateBoost(g, input).ok).toBe(true);
    const { state, events } = applyActionWithEvents(g, boostAction(input));
    expect(events[0]).toMatchObject({ kind: "boostGranted", immediate: true });
    expect(events.some((e) => e.kind === "move")).toBe(true);
    expect(pieceAt(state.board, sq("c3"))).toEqual({ color: "w", type: "n" });
    expect(boostAt(state, sq("c3"), "w")).toBeTruthy(); // buff is on the moved piece
  });

  it("rejects an immediate boost paid at the standing (un-premiumed) price", () => {
    const g = boostGame();
    const input: BoostInput = { target: sq("b1"), fodder: [sq("a2")], move: { from: sq("b1"), to: sq("c3") } };
    expect(validateBoost(g, input).ok).toBe(false); // 1 ≠ 1 + 2
  });
});

describe("boost — king safety gate", () => {
  function bareState(turn: Color = "w"): GameState {
    return {
      board: new Array<Piece | null>(64).fill(null),
      config: undefined,
      mechanics: ["phasing", "boost"],
      turn,
      status: "active",
      lastEvent: null,
      phased: [],
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
      turnsTaken: { w: 0, b: 0 },
      captured: { w: [], b: [] },
      history: [],
    };
  }

  it("a standing boost is illegal while in check (it cannot end the turn in check)", () => {
    const s = bareState();
    s.board[sq("e1")] = { color: "w", type: "k" };
    s.board[sq("e8")] = { color: "b", type: "r" }; // checks the white king down the e-file
    s.board[sq("a1")] = { color: "w", type: "r" }; // a boostable rook
    s.board[sq("a2")] = { color: "w", type: "p" };
    s.board[sq("b2")] = { color: "w", type: "p" };
    s.board[sq("c2")] = { color: "w", type: "p" }; // 3 pawns = cost to boost a rook
    expect(validateBoost(s, { target: sq("a1"), fodder: [sq("a2"), sq("b2"), sq("c2")] }).ok).toBe(false);
  });
});
