import { describe, it, expect } from "vitest";
import { initialState, parseSquare, applyAction, createGame } from "./index.js";
import { toFEN, uciToMove, moveToUci, isTcLegal, isChess960 } from "./classical.js";

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

describe("Chess960 FEN/UCI bridge (Stage 2 lane 3)", () => {
  it("classical games are not flagged 960 and keep standard KQkq", () => {
    expect(isChess960(initialState())).toBe(false);
    expect(toFEN(initialState())).toContain(" w KQkq ");
  });

  it("renders a Chess960 start with Shredder-FEN castling (rook files)", () => {
    // #198 QNBRKBNR: king e(4), rooks d(3)/h(7) ⇒ Shredder rights HDhd.
    const g = createGame(undefined, { setup: { id: "chess960", position: 198 } });
    expect(isChess960(g)).toBe(true);
    expect(toFEN(g)).toBe("qnbrkbnr/pppppppp/8/8/8/8/PPPPPPPP/QNBRKBNR w HDhd - 0 1");
  });

  it("encodes a Chess960 castle as king-onto-rook UCI and parses it back", () => {
    // a flagged castle's `to` is the rook square, so moveToUci is king-onto-rook
    expect(moveToUci({ from: parseSquare("b1"), to: parseSquare("h1"), castle: "K" })).toBe("b1h1");
    expect(uciToMove("b1h1")).toEqual({ from: parseSquare("b1"), to: parseSquare("h1") });
  });
});
