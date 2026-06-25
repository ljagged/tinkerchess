import { describe, it, expect } from "vitest";
import { DEFAULT_RULE_CONFIG, parseSquare } from "../engine/index.js";
import type { Color, GameState, Piece } from "../engine/index.js";
import { evaluate } from "./evaluate.js";

function emptyState(turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    config: DEFAULT_RULE_CONFIG,
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

// Two lone kings, far apart, no checks — a neutral backdrop for isolating a term.
function kings(turn: Color = "w"): GameState {
  const s = emptyState(turn);
  put(s, "a1", P("w", "k"));
  put(s, "h8", P("b", "k"));
  return s;
}

describe("evaluate — §5.1 time-indexed phased material", () => {
  it("a long-phased queen scores below an in-play queen but above a captured one", () => {
    const inPlay = kings();
    put(inPlay, "d1", P("w", "q"));

    const phased = kings();
    phased.phased.push({ color: "w", type: "q", origin: parseSquare("d1"), returnOn: 4 });

    const captured = kings(); // no queen anywhere

    const eIn = evaluate(inPlay, "w");
    const ePhased = evaluate(phased, "w");
    const eGone = evaluate(captured, "w");

    expect(eIn).toBeGreaterThan(ePhased);
    expect(ePhased).toBeGreaterThan(eGone);
  });
});

describe("evaluate — §5.2/§5.3 phase-escape vs forcing threat", () => {
  it("a queen attacked WITHOUT check (escapable) scores far better than one attacked WITH check", () => {
    // A: white queen on d4 attacked by a black knight (not mutual, no check). White
    // is not in check, so the queen could phase to safety — only a tempo+absence hit.
    const a = emptyState("w");
    put(a, "a1", P("w", "k"));
    put(a, "c8", P("b", "k"));
    put(a, "d4", P("w", "q"));
    put(a, "e6", P("b", "n")); // knight attacks d4; queen does not attack back

    // B: same idea, but a black rook on h1 checks the white king — the queen can no
    // longer phase (must address the check), so she is genuinely hanging.
    const b = emptyState("w");
    put(b, "a1", P("w", "k"));
    put(b, "c8", P("b", "k"));
    put(b, "d4", P("w", "q"));
    put(b, "e6", P("b", "n"));
    put(b, "h1", P("b", "r")); // checks the white king along rank 1

    const eA = evaluate(a, "w");
    const eB = evaluate(b, "w");
    expect(eA).toBeGreaterThan(eB + 500); // escapable queen worth ~a whole queen more
  });
});

describe("evaluate — §5.4 ring threats near the king", () => {
  it("an own phased piece ringing the enemy king is offense", () => {
    const offense = emptyState("w");
    put(offense, "a1", P("w", "k"));
    put(offense, "e8", P("b", "k"));
    // White piece returns next turn onto e7, adjacent to the black king — a live ring.
    offense.phased.push({ color: "w", type: "b", origin: parseSquare("e7"), returnOn: 1 });

    const control = emptyState("w");
    put(control, "a1", P("w", "k"));
    put(control, "e8", P("b", "k"));
    // Same phased piece (same material), but far from the enemy king.
    control.phased.push({ color: "w", type: "b", origin: parseSquare("a3"), returnOn: 1 });

    expect(evaluate(offense, "w")).toBeGreaterThan(evaluate(control, "w"));
  });

  it("an enemy phased piece ringing your own king is danger", () => {
    const danger = emptyState("w");
    put(danger, "e1", P("w", "k"));
    put(danger, "a8", P("b", "k"));
    // Black piece returns next turn onto d2, adjacent to the white king.
    danger.phased.push({ color: "b", type: "n", origin: parseSquare("d2"), returnOn: 1 });

    const control = emptyState("w");
    put(control, "e1", P("w", "k"));
    put(control, "a8", P("b", "k"));
    control.phased.push({ color: "b", type: "n", origin: parseSquare("a6"), returnOn: 1 });

    expect(evaluate(danger, "w")).toBeLessThan(evaluate(control, "w"));
  });
});

describe("evaluate — perspective", () => {
  it("is symmetric: evaluate(s,'w') === -evaluate(s,'b')", () => {
    const s = kings();
    put(s, "d1", P("w", "q"));
    put(s, "d8", P("b", "r"));
    expect(evaluate(s, "w")).toBe(-evaluate(s, "b"));
  });
});
