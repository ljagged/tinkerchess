import { describe, it, expect } from "vitest";
import {
  getSetup,
  classicalSetup,
  buildFromBackRank,
  homeFilesFromBackRank,
  createGame,
  parseSquare,
  pieceAt,
  DEFAULT_SETUP,
  DEFAULT_MECHANICS,
  SCHEMA_VERSION,
} from "./index.js";

describe("setup registry — classical (plugin #1 of the setup axis)", () => {
  it("registers classical and resolves it by id; unknown ids are absent", () => {
    expect(getSetup("classical")).toBe(classicalSetup);
    expect(getSetup("nope")).toBeUndefined();
  });

  it("classical build lays out the standard position with king-e / rooks-a&h home files", () => {
    const { board, castlingHomeFiles } = classicalSetup.build({ id: "classical" });
    expect(pieceAt(board, parseSquare("a1"))).toEqual({ color: "w", type: "r" });
    expect(pieceAt(board, parseSquare("e1"))).toEqual({ color: "w", type: "k" });
    expect(pieceAt(board, parseSquare("d8"))).toEqual({ color: "b", type: "q" });
    expect(pieceAt(board, parseSquare("h7"))).toEqual({ color: "b", type: "p" });
    expect(pieceAt(board, parseSquare("e4"))).toBeNull();
    expect(castlingHomeFiles).toEqual({ king: 4, aRook: 0, hRook: 7 });
  });

  it("home-file derivation handles a shuffled (Chess960-style) back rank", () => {
    // #198 QNBRKBNR — king on e(4), rooks on d(3) and h(7).
    const back = ["q", "n", "b", "r", "k", "b", "n", "r"] as const;
    expect(homeFilesFromBackRank([...back])).toEqual({ king: 4, aRook: 3, hRook: 7 });
    const board = buildFromBackRank([...back]);
    expect(pieceAt(board, parseSquare("a1"))).toEqual({ color: "w", type: "q" });
    expect(pieceAt(board, parseSquare("d1"))).toEqual({ color: "w", type: "r" });
  });

  it("createGame stamps the default setup, mechanics, and schema version", () => {
    const g = createGame();
    expect(g.setup).toEqual(DEFAULT_SETUP);
    expect(g.mechanics).toEqual(DEFAULT_MECHANICS);
    expect(g.schemaVersion).toBe(SCHEMA_VERSION);
    // and the board it produced matches the classical setup
    expect(pieceAt(g.board, parseSquare("e1"))).toEqual({ color: "w", type: "k" });
  });
});
