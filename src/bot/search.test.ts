import { describe, it, expect } from "vitest";
import { applyAction, initialState, parseSquare, positionKey } from "../engine/index.js";
import type { Action, Color, GameState, Piece } from "../engine/index.js";
import { search, ttKey } from "./search.js";

function emptyState(turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    config: undefined,
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
const won = (s: GameState, a: Action) => applyAction(s, a).status;

describe("search — mate detection (terminal scoring via engine status)", () => {
  it("finds a standard mate-in-1 (Qg7#)", () => {
    const s = emptyState("w");
    put(s, "h8", P("b", "k"));
    put(s, "f6", P("w", "k"));
    put(s, "g1", P("w", "q"));
    const { action, score } = search(s, { maxDepth: 1 });
    expect(won(s, action)).toBe("w_won"); // the chosen action delivers mate
    expect(score).toBeGreaterThan(900_000); // scored as a mate
  });

  it("delivers mate by PHASE-OUT (discovered check) and the search finds the mate", () => {
    // White Qh1 is blocked by the white knight on h4. Phasing the knight opens the
    // h-file: Qh1 checks Kh8 with every flight covered (Ba2→g8, Kg6→g7/h7) ⇒ mate.
    const s = emptyState("w");
    put(s, "h8", P("b", "k"));
    put(s, "h1", P("w", "q"));
    put(s, "h4", P("w", "n")); // h-file blocker
    put(s, "g6", P("w", "k"));
    put(s, "a2", P("w", "b")); // covers g8 along a2–g8
    // The phase-out itself is mate:
    const phaseMate: Action = { kind: "phaseOut", phaseOut: { from: parseSquare("h4"), duration: 1 } };
    expect(won(s, phaseMate)).toBe("w_won");
    // And the search finds a mate (it may pick any mating action).
    const { action } = search(s, { maxDepth: 1 });
    expect(won(s, action)).toBe("w_won");
  });
});

describe("search — transposition key (F2)", () => {
  it("distinguishes states with equal positionKey but different phased timers", () => {
    const base = (): GameState => {
      const s = emptyState("w");
      put(s, "e1", P("w", "k"));
      put(s, "e8", P("b", "k"));
      return s;
    };
    const s1 = base();
    s1.phased.push({ color: "w", type: "r", origin: parseSquare("a1"), returnOn: 5 });
    const s2 = base();
    s2.phased.push({ color: "w", type: "r", origin: parseSquare("a1"), returnOn: 8 });

    // The board (and so the repetition key) is identical — only the hidden timer differs.
    expect(positionKey(s1)).toBe(positionKey(s2));
    // ...but the search TT key must separate them, or cutoffs would be reused unsoundly.
    expect(ttKey(s1)).not.toBe(ttKey(s2));
  });
});

describe("search — determinism", () => {
  it("returns the identical action across runs at a fixed depth", () => {
    const s = emptyState("w");
    put(s, "g1", P("w", "k"));
    put(s, "d1", P("w", "q"));
    put(s, "f1", P("w", "r"));
    put(s, "c3", P("w", "n"));
    put(s, "e4", P("w", "p"));
    put(s, "g8", P("b", "k"));
    put(s, "d8", P("b", "q"));
    put(s, "f8", P("b", "r"));
    put(s, "c6", P("b", "n"));
    put(s, "e5", P("b", "p"));

    const a1 = search(s, { maxDepth: 3 }).action;
    const a2 = search(s, { maxDepth: 3 }).action;
    const a3 = search(s, { maxDepth: 3 }).action;
    expect(a2).toEqual(a1);
    expect(a3).toEqual(a1);
  });
});

describe("search — does not phase speculatively (§5.5)", () => {
  it("chooses a move, not a phase-out, in a quiet opening position", () => {
    const action = search(initialState(), { maxDepth: 2 }).action;
    expect(action.kind).toBe("move");
  });
});
