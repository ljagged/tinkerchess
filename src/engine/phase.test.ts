import { describe, it, expect } from "vitest";
import {
  initialState,
  legalPhaseOuts,
  maxDuration,
  parseSquare,
  pieceAt,
} from "./index.js";
import { legalActions } from "./_testgames.js";
import type { Color, GameState, PhaseOut, Piece, RuleConfig } from "./index.js";

// Local hand-builder helpers, matching the convention in engine.test.ts.
function emptyState(turn: Color = "w", config?: RuleConfig): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    config,
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
function put(state: GameState, alg: string, piece: Piece): void {
  state.board[parseSquare(alg)] = piece;
}
const P = (color: Color, type: Piece["type"]): Piece => ({ color, type });
const originsOf = (outs: PhaseOut[]) => new Set(outs.map((o) => o.from));
const durationsFrom = (outs: PhaseOut[], alg: string) =>
  outs.filter((o) => o.from === parseSquare(alg)).map((o) => o.duration).sort((a, b) => a - b);

describe("legalPhaseOuts", () => {
  it("standard start: one entry per (back-rank piece × its duration cap), pawns never phase", () => {
    const start = initialState();
    const backRank = ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"];
    // Expected total derived from the engine's own caps (not hardcoded), which
    // also proves no caps are baked into legalPhaseOuts: r3+n2+b2+q4+k1 = 19.
    const expected = backRank.reduce(
      (n, sq) => n + maxDuration(pieceAt(start.board, parseSquare(sq))!.type),
      0,
    );
    const outs = legalPhaseOuts(start);
    expect(outs).toHaveLength(expected);
    expect(expected).toBe(19);
    // Every phase-out is from a back-rank square (0..7); no pawn (rank 2) phases.
    for (const o of outs) expect(o.from).toBeLessThan(8);
    expect(durationsFrom(outs, "a1")).toEqual([1, 2, 3]); // rook, cap 3
    expect(durationsFrom(outs, "d1")).toEqual([1, 2, 3, 4]); // queen, cap 4
  });

  it("returns [] when the side to move is in check (no phase-in-check, RULES §8.3)", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "b1", P("w", "n"));
    put(s, "e8", P("b", "r")); // checks the white king down the open e-file
    expect(legalPhaseOuts(s)).toEqual([]);
  });

  it("returns [] when the game is over", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    s.status = "draw";
    expect(legalPhaseOuts(s)).toEqual([]);
  });

  it("excludes an absolutely-pinned piece but includes a relatively-pinned one (§4.4)", () => {
    // Absolute pin: bishop a2 is pinned to its own king a1 by the rook on a8.
    const abs = emptyState("w");
    put(abs, "a1", P("w", "k"));
    put(abs, "a2", P("w", "b"));
    put(abs, "a8", P("b", "r"));
    put(abs, "h8", P("b", "k"));
    expect(originsOf(legalPhaseOuts(abs)).has(parseSquare("a2"))).toBe(false);

    // Relative pin: bishop a2 is pinned to its own ROOK a3 (king is off the file),
    // so phasing it does not expose the king — it stays legal, just as a move would.
    const rel = emptyState("w");
    put(rel, "g1", P("w", "k"));
    put(rel, "a3", P("w", "r"));
    put(rel, "a2", P("w", "b"));
    put(rel, "a8", P("b", "r"));
    put(rel, "g8", P("b", "k"));
    expect(originsOf(legalPhaseOuts(rel)).has(parseSquare("a2"))).toBe(true);
  });

  it("respects a non-default RuleConfig (q:0 cannot phase; r:2 caps duration)", () => {
    const config: RuleConfig = {
      maxPhaseDuration: { p: 0, n: 2, b: 2, r: 2, q: 0, k: 1 },
    };
    const s = emptyState("w", config);
    put(s, "e1", P("w", "k"));
    put(s, "d1", P("w", "q"));
    put(s, "a1", P("w", "r"));
    const outs = legalPhaseOuts(s);
    // Queen cannot phase under this ruleset.
    expect(originsOf(outs).has(parseSquare("d1"))).toBe(false);
    // Rook is capped at duration 2, not the default 3.
    expect(durationsFrom(outs, "a1")).toEqual([1, 2]);
  });

  it("equals the phase-outs from _testgames.legalActions (single source of truth, F3)", () => {
    const start = initialState();
    const viaActions = legalActions(start)
      .filter((a): a is Extract<typeof a, { kind: "phaseOut" }> => a.kind === "phaseOut")
      .map((a) => a.phaseOut);
    expect(legalPhaseOuts(start)).toEqual(viaActions);
  });
});
