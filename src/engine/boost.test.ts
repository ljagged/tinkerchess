// Stage 3A — the load-bearing correctness of the decision-1 fold. A boosted piece's
// fairy squares MUST flow through BOTH move-gen and isAttacked from one function, or
// (a) the king could move into a boosted piece's line (missed check) or (b) a boosted
// move could leave the mover's own king in check (illegal state). These are the plan's
// two CRITICAL gates, plus an Amazon smothered-mate positive control.

import { describe, it, expect } from "vitest";
import {
  isAttacked,
  legalMovesFrom,
  legalMoves,
  kingSafe,
  augmentsActive,
  parseSquare,
  createGame,
  toNotation,
} from "./index.js";
import type { GameEvent } from "./index.js";
import type { BoostState, Color, GameState, Piece, SquareIndex } from "./index.js";

function boostState(boosts: BoostState[], turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    config: undefined,
    mechanics: ["phasing", "boost"],
    boosts,
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
const put = (s: GameState, alg: string, p: Piece) => (s.board[parseSquare(alg)] = p);
const P = (color: Color, type: Piece["type"]): Piece => ({ color, type });
const boost = (color: Color, alg: string, base: BoostState["base"]): BoostState => ({
  color,
  square: parseSquare(alg),
  base,
  expiresOn: 99,
});
const sq = parseSquare;

describe("boost — the gate (augmentation dormant unless a boost is active)", () => {
  it("augmentsActive is false for a classical/phasing game, true once boost is in the mechanics", () => {
    expect(augmentsActive(createGame())).toBe(false);
    expect(augmentsActive(boostState([]))).toBe(true);
  });
});

describe("CRITICAL — a boosted piece registers in isAttacked (gives check / mates)", () => {
  it("a Dragon Horse (bishop+wazir) attacks the orthogonal square a bishop cannot", () => {
    const s = boostState([boost("w", "d4", "b")]);
    put(s, "d4", P("w", "b"));
    put(s, "h1", P("w", "k"));
    put(s, "d5", P("b", "k"));
    // classical bishop on d4 does NOT attack d5 (orthogonal); the wazir upgrade does.
    expect(isAttacked(s, sq("d5"), "w")).toBe(true);
    // and a sanity diagonal the plain bishop also hits
    expect(isAttacked(s, sq("e5"), "w")).toBe(true);
  });

  it("without the boost, the same bishop does NOT attack the orthogonal square", () => {
    const s = boostState([]); // boost mechanic active but no boost on the board
    put(s, "d4", P("w", "b"));
    expect(isAttacked(s, sq("d5"), "w")).toBe(false);
  });

  it("the enemy king is in check from a Dragon Horse's wazir step", () => {
    const s = boostState([boost("w", "d4", "b")], "b");
    put(s, "d4", P("w", "b"));
    put(s, "h1", P("w", "k"));
    put(s, "d5", P("b", "k"));
    expect(kingSafe(s, "b")).toBe(false);
  });

  it("Amazon smothered mate (queen+knight): knight-attack delivers mate to a boxed-in king", () => {
    // Black king h8 smothered by its own g8/g7/h7; white Amazon on f7 gives a knight
    // check (f7→h8) that cannot be blocked, captured, or fled — checkmate.
    const s = boostState([boost("w", "f7", "q")], "b");
    put(s, "f7", P("w", "q"));
    put(s, "a1", P("w", "k"));
    put(s, "h8", P("b", "k"));
    put(s, "g8", P("b", "r"));
    put(s, "g7", P("b", "p"));
    put(s, "h7", P("b", "p"));
    expect(kingSafe(s, "b")).toBe(false); // in check via the Amazon's knight leap
    expect(legalMoves(s)).toHaveLength(0); // no escape → mate
  });
});

describe("CRITICAL — a boosted move is filtered by kingSafe (no illegal self-check)", () => {
  it("a pinned Dragon King may not take its fairy (ferz) step off the pin line", () => {
    // White Kd1, white Rd2 boosted (Dragon King = rook + ferz), black Rd8 pins the rook
    // on the d-file. The classical rook may slide on the d-file; the ferz diagonals
    // (c3/e3) would expose the king and MUST be rejected.
    const s = boostState([boost("w", "d2", "r")]);
    put(s, "d1", P("w", "k"));
    put(s, "d2", P("w", "r"));
    put(s, "d8", P("b", "r"));
    const tos = legalMovesFrom(s, sq("d2")).map((m) => m.to);
    expect(tos).not.toContain(sq("c3")); // ferz diagonal — illegal (breaks the pin)
    expect(tos).not.toContain(sq("e3"));
    expect(tos).toContain(sq("d3")); // sliding up the pin line stays legal
  });
});

describe("boost — notation (the mechanic renders its own events)", () => {
  it("renders boostGranted (with fairy tag + fodder) and boostExpired", () => {
    const granted: GameEvent = {
      kind: "boostGranted",
      color: "w",
      base: "q",
      square: parseSquare("d1"),
      fodder: ["r"],
      immediate: true,
      expiresOn: 4,
    };
    expect(toNotation(granted)).toBe("+AM@d1[R]!"); // Amazon on d1, fodder rook, immediate
    const expired: GameEvent = { kind: "boostExpired", color: "w", base: "q", square: parseSquare("d1") };
    expect(toNotation(expired)).toBe("-boost@d1");
  });
});

describe("boost — fairy move generation (positive controls)", () => {
  it("Amazon adds the knight leaps to a queen's moves", () => {
    const s = boostState([boost("w", "d4", "q")]);
    put(s, "d4", P("w", "q"));
    put(s, "h1", P("w", "k"));
    const tos = legalMovesFrom(s, sq("d4")).map((m) => m.to);
    expect(tos).toContain(sq("e6")); // knight leap d4→e6 (queen cannot reach it)
    expect(tos).toContain(sq("c6"));
    expect(tos).toContain(sq("f5"));
  });

  it("a 2-step king slides two squares when the intervening square is empty, not when blocked", () => {
    const s = boostState([boost("w", "d4", "k")]);
    put(s, "d4", P("w", "k"));
    put(s, "d5", P("w", "p")); // blocks the straight-up 2-step
    const tos = legalMovesFrom(s, sq("d4")).map((m) => m.to);
    expect(tos).toContain(sq("f4")); // two steps right (e4 empty)
    expect(tos).toContain(sq("b4")); // two steps left (c4 empty)
    expect(tos).toContain(sq("f6")); // two steps diagonally (e5 empty)
    expect(tos).not.toContain(sq("d6")); // blocked by the pawn on d5
  });

  it("a home-square 2-step king defers the g/c castle squares to castling", () => {
    // On e1 (home square) the 2-step to g1/c1 would be ambiguous with castling, so it
    // is not offered as a plain king move; the other 2-step directions remain.
    const s = boostState([boost("w", "e1", "k")]);
    put(s, "e1", P("w", "k"));
    const tos = legalMovesFrom(s, sq("e1")).map((m) => m.to);
    expect(tos).not.toContain(sq("g1"));
    expect(tos).not.toContain(sq("c1"));
    expect(tos).toContain(sq("e3")); // straight up still fine (e2 empty)
  });
});
