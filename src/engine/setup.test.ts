import { describe, it, expect } from "vitest";
import {
  getSetup,
  classicalSetup,
  chess960Setup,
  scharnaglBackRank,
  buildFromBackRank,
  homeFilesFromBackRank,
  createGame,
  parseSquare,
  pieceAt,
  CHESS960_POSITIONS,
  DEFAULT_SETUP,
  DEFAULT_MECHANICS,
  SCHEMA_VERSION,
} from "./index.js";
import type { PieceType } from "./index.js";

const back = (b: PieceType[]) => b.join("");

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

describe("setup registry — Chess960 (Scharnagl numbering)", () => {
  it("registers chess960", () => {
    expect(getSetup("chess960")).toBe(chess960Setup);
  });

  it("hits the two anchor positions exactly", () => {
    expect(back(scharnaglBackRank(518))).toBe("rnbqkbnr"); // classical
    expect(back(scharnaglBackRank(198))).toBe("qnbrkbnr"); // plan's worked example
  });

  it("#518 is byte-identical to the classical back rank", () => {
    expect(scharnaglBackRank(518)).toEqual(classicalSetup.build({ id: "classical" }).board.slice(0, 8).map((p) => p!.type));
  });

  it("every one of the 960 positions satisfies the Chess960 invariants", () => {
    for (let n = 0; n < CHESS960_POSITIONS; n++) {
      const r = scharnaglBackRank(n);
      // exactly the standard army on the back rank
      const counts: Record<string, number> = {};
      for (const t of r) counts[t] = (counts[t] ?? 0) + 1;
      expect(counts).toEqual({ r: 2, n: 2, b: 2, q: 1, k: 1 });
      // bishops on opposite colors
      const bishops = r.flatMap((t, f) => (t === "b" ? [f] : []));
      expect(bishops[0]! % 2).not.toBe(bishops[1]! % 2);
      // king strictly between the two rooks
      const rooks = r.flatMap((t, f) => (t === "r" ? [f] : []));
      const king = r.indexOf("k");
      expect(king).toBeGreaterThan(rooks[0]!);
      expect(king).toBeLessThan(rooks[1]!);
    }
  });

  it("the 960 positions are all distinct (a true bijection)", () => {
    const seen = new Set<string>();
    for (let n = 0; n < CHESS960_POSITIONS; n++) seen.add(back(scharnaglBackRank(n)));
    expect(seen.size).toBe(CHESS960_POSITIONS);
  });

  it("position number wraps and floors defensively", () => {
    expect(back(scharnaglBackRank(518 + CHESS960_POSITIONS))).toBe("rnbqkbnr");
    expect(back(scharnaglBackRank(-1))).toBe(back(scharnaglBackRank(959)));
  });

  it("chess960Setup.build derives home files from the shuffled rank (#198: king e, rooks d/h)", () => {
    const built = chess960Setup.build({ id: "chess960", position: 198 });
    expect(built.castlingHomeFiles).toEqual({ king: 4, aRook: 3, hRook: 7 });
    expect(pieceAt(built.board, parseSquare("a1"))).toEqual({ color: "w", type: "q" });
    expect(pieceAt(built.board, parseSquare("a8"))).toEqual({ color: "b", type: "q" });
  });
});
