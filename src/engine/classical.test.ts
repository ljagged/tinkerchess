import { describe, it, expect } from "vitest";
import { initialState, parseSquare, applyAction } from "./index.js";
import { toFEN, uciToMove, moveToUci, isTcLegal } from "./classical.js";

describe("classical FEN/UCI interop", () => {
  it("renders the start position as standard FEN", () => {
    expect(toFEN(initialState())).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
  });

  it("reflects a move + en passant target in the FEN", () => {
    const after = applyAction(initialState(), {
      kind: "move",
      move: { from: parseSquare("e2"), to: parseSquare("e4") },
    });
    expect(toFEN(after)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
  });

  it("round-trips UCI ↔ Move (incl. promotion)", () => {
    expect(uciToMove("e2e4")).toEqual({ from: parseSquare("e2"), to: parseSquare("e4") });
    expect(uciToMove("e7e8q")).toEqual({
      from: parseSquare("e7"),
      to: parseSquare("e8"),
      promotion: "q",
    });
    expect(moveToUci({ from: parseSquare("e2"), to: parseSquare("e4") })).toBe("e2e4");
    expect(moveToUci({ from: parseSquare("e7"), to: parseSquare("e8"), promotion: "q" })).toBe("e7e8q");
  });

  it("isTcLegal accepts a legal move and rejects an illegal one", () => {
    const s = initialState();
    expect(isTcLegal(s, uciToMove("e2e4"))).toBe(true);
    expect(isTcLegal(s, uciToMove("e2e5"))).toBe(false); // pawn can't jump three
  });
});
