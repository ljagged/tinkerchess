// Stage 2 lane 2: castling reads the setup's home files and uses an explicit flag
// when the king does not start on the e-file (Chess960), encoded king-onto-rook. The
// FIDE rule still applies: the king lands on g/c and the rook on f/d. Classical
// castling (king on e) is covered by the existing engine tests and stays positional.

import { describe, it, expect } from "vitest";
import {
  legalMovesFrom,
  applyMove,
  isLegalMove,
  resolveMove,
  movesEqual,
  parseSquare,
  pieceAt,
  toAlgebraic,
  createGame,
  deriveMoveEvent,
} from "./index.js";
import type { CastlingHomeFiles, Color, GameState, Move, Piece } from "./index.js";

/** A bare board with both kings and the given home files / rights (king off e-file). */
function state(homeFiles: CastlingHomeFiles, turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    config: undefined,
    mechanics: ["phasing"],
    setup: { id: "chess960" },
    castlingHomeFiles: homeFiles,
    turn,
    status: "active",
    lastEvent: null,
    phased: [],
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    turnsTaken: { w: 0, b: 0 },
    captured: { w: [], b: [] },
    history: [],
  };
}
const put = (s: GameState, alg: string, p: Piece) => (s.board[parseSquare(alg)] = p);
const K = (c: Color): Piece => ({ color: c, type: "k" });
const R = (c: Color): Piece => ({ color: c, type: "r" });

describe("Chess960 castling — king off the e-file (explicit flag, king-onto-rook)", () => {
  // Home rank: king on b, rooks on a and h. Castling clears files c..g.
  const home: CastlingHomeFiles = { king: 1, aRook: 0, hRook: 7 };

  it("generates kingside castle as a flagged king-onto-rook move", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "b8", K("b"));
    const castles = legalMovesFrom(s, parseSquare("b1")).filter((m) => m.castle);
    const kingside = castles.find((m) => m.castle === "K");
    expect(kingside).toEqual({ from: parseSquare("b1"), to: parseSquare("h1"), castle: "K" });
  });

  it("applies the castle to FIDE squares: king→g1, rook→f1", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "b8", K("b"));
    const move: Move = { from: parseSquare("b1"), to: parseSquare("h1"), castle: "K" };
    const next = applyMove(s, move);
    expect(pieceAt(next.board, parseSquare("g1"))).toEqual(K("w"));
    expect(pieceAt(next.board, parseSquare("f1"))).toEqual(R("w"));
    expect(pieceAt(next.board, parseSquare("b1"))).toBeNull();
    expect(pieceAt(next.board, parseSquare("h1"))).toBeNull();
    // both castling rights are forfeited (the king moved)
    expect(next.castling.wK).toBe(false);
    expect(next.castling.wQ).toBe(false);
    // it derives a castle event (renders O-O), with no phantom self-capture of the rook
    const ev = deriveMoveEvent(s, move);
    expect(ev).toMatchObject({ kind: "move", castle: "K" });
    expect("capture" in ev).toBe(false);
  });

  it("queenside castle: king→c1, rook(a1)→d1", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "b8", K("b"));
    const move: Move = { from: parseSquare("b1"), to: parseSquare("a1"), castle: "Q" };
    expect(isLegalMove(s, move)).toBe(true);
    const next = applyMove(s, move);
    expect(pieceAt(next.board, parseSquare("c1"))).toEqual(K("w"));
    expect(pieceAt(next.board, parseSquare("d1"))).toEqual(R("w"));
  });

  it("resolveMove maps a king-onto-rook intent to the flagged canonical move", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "b8", K("b"));
    const resolved = resolveMove(s, { from: parseSquare("b1"), to: parseSquare("h1") });
    expect(resolved).toEqual({ from: parseSquare("b1"), to: parseSquare("h1"), castle: "K" });
    // the flagged move and a hypothetical flag-free same-square move are NOT equal
    expect(movesEqual(resolved!, { from: parseSquare("b1"), to: parseSquare("h1") })).toBe(false);
  });

  it("is illegal when a square on the king's path is attacked", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "b8", K("b"));
    put(s, "e8", R("b")); // black rook rakes the e-file → e1 is on the king's b1→g1 path
    const kingside = legalMovesFrom(s, parseSquare("b1")).find((m) => m.castle === "K");
    expect(kingside).toBeUndefined();
  });

  it("is illegal when a piece blocks the relevant travel (kingside only here)", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "e1", { color: "w", type: "n" }); // own knight sits on the b1→g1 king path
    put(s, "b8", K("b"));
    const castles = legalMovesFrom(s, parseSquare("b1")).filter((m) => m.castle);
    // kingside is blocked (e1 is on the king's path); queenside (b1→c1) is unaffected.
    expect(castles.some((m) => m.castle === "K")).toBe(false);
    expect(castles.some((m) => m.castle === "Q")).toBe(true);
  });

  it("a c-file blocker kills BOTH sides (it lies on each king path)", () => {
    const s = state(home);
    put(s, "b1", K("w"));
    put(s, "a1", R("w"));
    put(s, "h1", R("w"));
    put(s, "c1", { color: "w", type: "b" });
    put(s, "b8", K("b"));
    expect(legalMovesFrom(s, parseSquare("b1")).some((m) => m.castle)).toBe(false);
  });
});

describe("Chess960 castling — integration via createGame", () => {
  it("stamps the shuffled home files and a setup that round-trips through play", () => {
    // #198 QNBRKBNR: king on e(4) — still classical king file, rooks d(3)/h(7).
    const g = createGame(undefined, { setup: { id: "chess960", position: 198 } });
    expect(g.castlingHomeFiles).toEqual({ king: 4, aRook: 3, hRook: 7 });
    expect(g.setup).toEqual({ id: "chess960", position: 198 });
    expect(toAlgebraic(parseSquare("a1"))).toBe("a1"); // sanity on the helper
    expect(pieceAt(g.board, parseSquare("d1"))).toEqual({ color: "w", type: "r" });
  });
});
