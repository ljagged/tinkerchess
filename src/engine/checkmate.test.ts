// Standard checkmate / stalemate / repetition rules, plus the TinkerChess
// king-vs-return rulings (CHECKMATE-SPEC.md S5-S9). The win condition is now
// standard chess: no king is ever captured (S9); an enemy imminent-return ring is
// a check on a king sitting on that square (S5a), answerable by king flight only.

import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  generateMoves,
  isAttacked,
  kingSafe,
  legalMoves,
  resolvePhaseIns,
  parseSquare,
  pieceAt,
  validatePhaseOut,
  warningSquaresFor,
} from "./index.js";
import type { Action, Color, GameState, Piece } from "./index.js";

function emptyState(turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
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
const at = (s: GameState, alg: string) => pieceAt(s.board, parseSquare(alg));
const P = (color: Color, type: Piece["type"]): Piece => ({ color, type });
const move = (from: string, to: string): Action =>
  ({ kind: "move", move: { from: parseSquare(from), to: parseSquare(to) } });

// --- checkmate & stalemate --------------------------------------------------

describe("checkmate and stalemate", () => {
  it("a normal move can deliver checkmate (back-rank), ending the game", () => {
    const s = emptyState("w");
    put(s, "a1", P("w", "k"));
    put(s, "e1", P("w", "r"));
    put(s, "g8", P("b", "k"));
    put(s, "f7", P("b", "p"));
    put(s, "g7", P("b", "p"));
    put(s, "h7", P("b", "p"));
    const next = applyAction(s, move("e1", "e8"));
    expect(next.status).toBe("w_won");
    expect(next.endReason).toBe("checkmate");
  });

  it("stalemate is a draw, and a legal phase-out does NOT avert it", () => {
    const s = emptyState("w");
    put(s, "c3", P("w", "k"));
    put(s, "a1", P("w", "r"));
    put(s, "f6", P("w", "p"));
    put(s, "h6", P("w", "p"));
    put(s, "h8", P("b", "k"));
    put(s, "g8", P("b", "b")); // boxed by its own pawns f7/h7 — no legal move
    put(s, "f7", P("b", "p"));
    put(s, "h7", P("b", "p"));
    // White seals g7 (the king's only empty escape) -> Black is stalemated.
    const next = applyAction(s, move("a1", "g1"));
    expect(next.status).toBe("draw");
    expect(next.endReason).toBe("stalemate");

    // Black had a legal phase-out (the boxed bishop), but stalemate counts legal
    // MOVES only — phasing never averts the draw.
    const live = { ...next, status: "active" as const };
    expect(legalMoves(live)).toHaveLength(0);
    expect(validatePhaseOut(live, { from: parseSquare("g8"), duration: 1 }).ok).toBe(true);
  });
});

// --- S7: phase-out may not expose your own king -----------------------------

describe("phase-out legality (S7)", () => {
  it("phasing a pinned piece that would expose your own king is illegal", () => {
    const s = emptyState("b");
    put(s, "e1", P("b", "k"));
    put(s, "e4", P("b", "b")); // blocks the e-file
    put(s, "e8", P("w", "r")); // would pin the bishop to the king
    put(s, "h1", P("w", "k"));
    expect(kingSafe(s, "b")).toBe(true); // not in check while the bishop blocks
    expect(validatePhaseOut(s, { from: parseSquare("e4"), duration: 2 }).ok).toBe(false);
  });

  it("S4b occupancy: a return re-occupies a blocking square, leaving the king safe", () => {
    const s = emptyState("b");
    s.turnsTaken = { w: 0, b: 1 };
    put(s, "e1", P("b", "k"));
    put(s, "e8", P("w", "r"));
    s.phased.push({ color: "b", type: "r", origin: parseSquare("e4"), returnOn: 1 });
    // While phased out, the e-file is open and the king is attacked...
    expect(isAttacked(s, parseSquare("e1"), "w")).toBe(true);
    // ...but the return re-occupies e4, so the king is no longer in check.
    const next = resolvePhaseIns(s, "b");
    expect(at(next, "e4")).toEqual(P("b", "r"));
    expect(isAttacked(next, parseSquare("e1"), "w")).toBe(false);
  });
});

// --- S5a / S5b: the enemy imminent-return ring as a check -------------------

describe("ringed-king check (S5a/S5b)", () => {
  it("an enemy ring on the king is a check answerable ONLY by king flight", () => {
    const s = emptyState("b");
    s.turnsTaken = { w: 1, b: 1 };
    put(s, "e4", P("b", "k"));
    put(s, "a1", P("b", "r")); // cannot block or capture a phased attacker
    put(s, "h1", P("w", "k"));
    s.phased.push({ color: "w", type: "r", origin: parseSquare("e4"), returnOn: 2 });

    expect(isAttacked(s, parseSquare("e4"), "w")).toBe(false); // not a standard attack
    expect(warningSquaresFor(s, "b")).toContain(parseSquare("e4")); // the ring is visible
    expect(kingSafe(s, "b")).toBe(false); // ...and it IS a check
    const legal = legalMoves(s);
    expect(legal.length).toBeGreaterThan(0); // flight squares exist (not mate)
    expect(legal.every((m) => m.from === parseSquare("e4"))).toBe(true); // king flight only
  });

  it("a ringed king with no flight is checkmate; the king is never removed (S9)", () => {
    const s = emptyState("b");
    s.turnsTaken = { w: 1, b: 1 };
    put(s, "a8", P("b", "k"));
    put(s, "c6", P("w", "n")); // covers a7 and b8
    put(s, "a5", P("w", "n")); // covers b7
    put(s, "h1", P("w", "k"));
    s.phased.push({ color: "w", type: "r", origin: parseSquare("a8"), returnOn: 2 });

    expect(isAttacked(s, parseSquare("a8"), "w")).toBe(false); // the check is the RING
    expect(kingSafe(s, "b")).toBe(false); // in check
    expect(legalMoves(s)).toHaveLength(0); // no flight -> checkmate
    expect(at(s, "a8")).toEqual(P("b", "k")); // the return never removes the live king
  });

  it("ring ownership: your OWN imminent return on your king is not a check", () => {
    const s = emptyState("b");
    s.turnsTaken = { w: 1, b: 1 };
    put(s, "e4", P("b", "k"));
    put(s, "h1", P("w", "k"));
    s.phased.push({ color: "b", type: "r", origin: parseSquare("e4"), returnOn: 2 });
    expect(warningSquaresFor(s, "b")).not.toContain(parseSquare("e4"));
    expect(kingSafe(s, "b")).toBe(true); // your own return is not an attack; the king may stay
  });
});

// --- castling vs the ring ---------------------------------------------------

describe("castling and the return ring", () => {
  const base = (): GameState => {
    const s = emptyState("w");
    s.turnsTaken = { w: 1, b: 1 };
    put(s, "e1", P("w", "k"));
    put(s, "h1", P("w", "r"));
    put(s, "e8", P("b", "k"));
    s.castling.wK = true;
    return s;
  };

  it("cannot castle through an enemy ring, but may castle across a non-imminent phased square", () => {
    const ringed = base();
    ringed.phased.push({ color: "b", type: "r", origin: parseSquare("f1"), returnOn: 2 }); // imminent
    expect(warningSquaresFor(ringed, "w")).toContain(parseSquare("f1"));
    expect(generateMoves(ringed, parseSquare("e1")).map((m) => m.to)).not.toContain(parseSquare("g1"));

    const later = base();
    later.phased.push({ color: "b", type: "r", origin: parseSquare("f1"), returnOn: 3 }); // 2+ turns out
    expect(warningSquaresFor(later, "w")).not.toContain(parseSquare("f1"));
    expect(generateMoves(later, parseSquare("e1")).map((m) => m.to)).toContain(parseSquare("g1"));
  });
});

// --- fog: no early restriction ----------------------------------------------

describe("fog of war (no early restriction)", () => {
  it("a king may move onto a square whose enemy return is 2+ turns out (no ring, no bar)", () => {
    const s = emptyState("b");
    s.turnsTaken = { w: 1, b: 1 };
    put(s, "d5", P("b", "k"));
    put(s, "h1", P("w", "k"));
    s.phased.push({ color: "w", type: "r", origin: parseSquare("e5"), returnOn: 3 }); // not imminent
    expect(warningSquaresFor(s, "b")).not.toContain(parseSquare("e5"));
    expect(legalMoves(s).map((m) => m.to)).toContain(parseSquare("e5"));
  });
});

// --- threefold repetition ---------------------------------------------------

describe("threefold repetition", () => {
  it("is an automatic draw (Lichess-style, no claim)", () => {
    let g = createGame();
    const cycle: Array<[string, string]> = [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
    ];
    // Two full knight cycles return to the start position a 2nd and 3rd time.
    for (let i = 0; i < 2; i++) {
      for (const [from, to] of cycle) {
        expect(g.status).toBe("active");
        g = applyAction(g, move(from, to));
      }
    }
    expect(g.status).toBe("draw");
    expect(g.endReason).toBe("repetition");
  });
});
