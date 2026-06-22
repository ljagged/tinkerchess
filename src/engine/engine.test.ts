import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  generateMoves,
  inCheck,
  isAttacked,
  legalMoves,
  maxDuration,
  ownPhased,
  parseSquare,
  pieceAt,
  resolvePhaseIns,
  validatePhaseOut,
  viewFor,
  warningSquaresFor,
  IllegalActionError,
} from "./index.js";
import type { Color, GameState, Piece } from "./index.js";

// --- test helpers -----------------------------------------------------------

function emptyState(turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    turn,
    status: "active",
    wonBySelfCapture: false,
    lastEvent: null,
    phased: [],
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    enPassant: null,
    turnsTaken: { w: 0, b: 0 },
    captured: { w: [], b: [] },
  };
}

function put(state: GameState, alg: string, piece: Piece): void {
  state.board[parseSquare(alg)] = piece;
}

function at(state: GameState, alg: string): Piece | null {
  return pieceAt(state.board, parseSquare(alg));
}

const P = (color: Color, type: Piece["type"]): Piece => ({ color, type });

// --- standard movement ------------------------------------------------------

describe("standard movement", () => {
  it("has 20 legal moves from the initial position", () => {
    expect(legalMoves(createGame())).toHaveLength(20);
  });

  it("allows a pawn double-push and a knight develop, but blocks the boxed-in queen", () => {
    const g = createGame();
    const froms = (sq: string) => generateMoves(g, parseSquare(sq)).map((m) => m.to);
    expect(froms("e2")).toContain(parseSquare("e4"));
    expect(froms("g1")).toEqual(
      expect.arrayContaining([parseSquare("f3"), parseSquare("h3")]),
    );
    expect(generateMoves(g, parseSquare("d1"))).toHaveLength(0);
  });

  it("does not let a piece capture its own color", () => {
    const s = emptyState();
    put(s, "a1", P("w", "r"));
    put(s, "a4", P("w", "p"));
    const tos = generateMoves(s, parseSquare("a1")).map((m) => m.to);
    expect(tos).not.toContain(parseSquare("a4"));
    expect(tos).toContain(parseSquare("a3")); // blocked just before own pawn
  });

  it("rejects an illegal move and refuses to act on a finished game", () => {
    const g = createGame();
    expect(() =>
      applyAction(g, { kind: "move", move: { from: parseSquare("e2"), to: parseSquare("e5") } }),
    ).toThrow(IllegalActionError);

    const won: GameState = { ...emptyState(), status: "w_won" };
    expect(() =>
      applyAction(won, { kind: "move", move: { from: 0, to: 1 } }),
    ).toThrow(IllegalActionError);
  });
});

// --- win by capturing the king ---------------------------------------------

describe("win condition: capture the king", () => {
  it("ends the game the instant the enemy king is taken by a normal move", () => {
    const s = emptyState("w");
    put(s, "d1", P("w", "q"));
    put(s, "d8", P("b", "k"));
    const next = applyAction(s, {
      kind: "move",
      move: { from: parseSquare("d1"), to: parseSquare("d8") },
    });
    expect(next.status).toBe("w_won");
    expect(at(next, "d8")).toEqual(P("w", "q"));
  });
});

// --- captured-piece tracking -----------------------------------------------

describe("captured pieces", () => {
  it("records a normal capture under the captured piece's color", () => {
    const s = emptyState("w");
    put(s, "d4", P("w", "b"));
    put(s, "g7", P("b", "p"));
    const next = applyAction(s, {
      kind: "move",
      move: { from: parseSquare("d4"), to: parseSquare("g7") },
    });
    expect(next.captured.b).toEqual(["p"]);
    expect(next.captured.w).toEqual([]);
  });

  it("records a phase-in capture but never the phased piece itself", () => {
    const s = emptyState("w");
    s.turnsTaken.w = 1;
    s.phased.push({ color: "w", type: "r", origin: parseSquare("a1"), returnOn: 1 });
    put(s, "a1", P("b", "n")); // an enemy knight sitting on the rook's return square
    const next = resolvePhaseIns(s, "w");
    expect(next.captured.b).toEqual(["n"]); // the knight was captured
    expect(next.captured.w).toEqual([]); // the returning rook is not "captured"
  });
});

// --- phase-out validation ---------------------------------------------------

describe("phase-out validation", () => {
  it("enforces per-piece maximum durations", () => {
    expect(maxDuration("k")).toBe(1);
    expect(maxDuration("n")).toBe(2);
    expect(maxDuration("b")).toBe(2);
    expect(maxDuration("r")).toBe(3);
    expect(maxDuration("q")).toBe(4);
  });

  it("rejects out-of-range and zero/negative durations", () => {
    const s = emptyState("w");
    put(s, "d1", P("w", "q"));
    expect(validatePhaseOut(s, { from: parseSquare("d1"), duration: 4 }).ok).toBe(true);
    expect(validatePhaseOut(s, { from: parseSquare("d1"), duration: 5 }).ok).toBe(false);
    expect(validatePhaseOut(s, { from: parseSquare("d1"), duration: 0 }).ok).toBe(false);
  });

  it("forbids phasing pawns and the opponent's pieces", () => {
    const s = emptyState("w");
    put(s, "e2", P("w", "p"));
    put(s, "e7", P("b", "n"));
    expect(validatePhaseOut(s, { from: parseSquare("e2"), duration: 1 }).ok).toBe(false);
    expect(validatePhaseOut(s, { from: parseSquare("e7"), duration: 1 }).ok).toBe(false);
  });

  it("blocks the king from phasing while in check, but not other pieces", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "b1", P("w", "n"));
    put(s, "e8", P("b", "r")); // checks the white king down the e-file
    expect(inCheck(s, "w")).toBe(true);
    expect(validatePhaseOut(s, { from: parseSquare("e1"), duration: 1 }).ok).toBe(false);
    expect(validatePhaseOut(s, { from: parseSquare("b1"), duration: 2 }).ok).toBe(true);
  });
});

// --- phase-in resolution ----------------------------------------------------

describe("phase-in resolution", () => {
  function returningRook(occupant: Piece | null): GameState {
    // A white rook phased from a1, due at the end of White's turn 1 (resolve
    // happens once turnsTaken.w reaches returnOn).
    const s = emptyState("w");
    s.turnsTaken.w = 1;
    s.phased.push({ color: "w", type: "r", origin: parseSquare("a1"), returnOn: 1 });
    if (occupant) put(s, "a1", occupant);
    return s;
  }

  it("returns the piece to its origin when the square is empty", () => {
    const next = resolvePhaseIns(returningRook(null), "w");
    expect(at(next, "a1")).toEqual(P("w", "r"));
    expect(next.phased).toHaveLength(0);
    expect(next.status).toBe("active");
  });

  it("removes an occupant of ANY color (self-capture) and records the footgun", () => {
    const next = resolvePhaseIns(returningRook(P("w", "r")), "w");
    expect(at(next, "a1")).toEqual(P("w", "r")); // own rook was removed
    expect(next.lastEvent).toEqual({ by: "w", piece: "r", square: parseSquare("a1") });
  });

  it("does not record a self-capture event when capturing an enemy piece", () => {
    const next = resolvePhaseIns(returningRook(P("b", "n")), "w");
    expect(next.lastEvent).toBeNull();
  });

  it("wins by removing the ENEMY king on phase-in (not a self-capture)", () => {
    const next = resolvePhaseIns(returningRook(P("b", "k")), "w");
    expect(next.status).toBe("w_won");
    expect(next.wonBySelfCapture).toBe(false);
  });

  it("loses by removing your OWN king on phase-in (a footgun)", () => {
    const next = resolvePhaseIns(returningRook(P("w", "k")), "w");
    expect(next.status).toBe("b_won");
    expect(next.wonBySelfCapture).toBe(true);
  });
});

// --- owner-turn timer counting ---------------------------------------------

describe("owner-turn timer counting", () => {
  function shuffleBoard(): GameState {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "e8", P("b", "k"));
    put(s, "g1", P("w", "n"));
    put(s, "g8", P("b", "n"));
    put(s, "d1", P("w", "q"));
    return s;
  }
  const move = (from: string, to: string) =>
    ({ kind: "move", move: { from: parseSquare(from), to: parseSquare(to) } }) as const;

  it("returns a piece at the END of the owner's d-th subsequent turn (queen, d=2)", () => {
    let s = shuffleBoard();
    // White turn 1: phase the queen out for 2.
    s = applyAction(s, { kind: "phaseOut", phaseOut: { from: parseSquare("d1"), duration: 2 } });
    expect(at(s, "d1")).toBeNull();

    s = applyAction(s, move("g8", "f6")); // black
    s = applyAction(s, move("g1", "f3")); // white turn 2 — still out (White plays with it gone)
    expect(at(s, "d1")).toBeNull();

    s = applyAction(s, move("f6", "g8")); // black -> White to move for turn 3; still out
    expect(at(s, "d1")).toBeNull();

    s = applyAction(s, move("f3", "g1")); // white turn 3 — returns at the END of this turn
    expect(at(s, "d1")).toEqual(P("w", "q"));
    expect(s.phased).toHaveLength(0);
  });

  it("lets the owner exploit the open square for a full turn (duration 1)", () => {
    // The user's scenario: phase a bishop for 1, opponent moves, and the bishop
    // is STILL out during the owner's next turn (so the owner can use the open
    // square), returning only at the end of that turn.
    const s = emptyState("w");
    put(s, "c1", P("w", "b"));
    put(s, "e1", P("w", "k"));
    put(s, "h1", P("w", "r"));
    put(s, "e8", P("b", "k"));
    put(s, "a8", P("b", "r"));

    let g: GameState = s;
    g = applyAction(g, { kind: "phaseOut", phaseOut: { from: parseSquare("c1"), duration: 1 } });
    g = applyAction(g, move("a8", "a7")); // black

    // White's turn: the bishop is still off-board — the square is open to use.
    expect(at(g, "c1")).toBeNull();
    g = applyAction(g, move("h1", "g1")); // white plays its exploit turn
    // ...and the bishop returns at the end of it.
    expect(at(g, "c1")).toEqual(P("w", "b"));
    expect(g.phased).toHaveLength(0);
  });

  it("shows the opponent a square-only warning exactly one of their turns before return", () => {
    let s = shuffleBoard();
    s = applyAction(s, { kind: "phaseOut", phaseOut: { from: parseSquare("d1"), duration: 2 } });
    // Right after phasing (black to move): returns in 2 white-turns, no warning yet.
    expect(warningSquaresFor(s, "b")).toHaveLength(0);

    s = applyAction(s, move("g8", "f6")); // black
    s = applyAction(s, move("g1", "f3")); // white turn 2 -> black to move
    // Now the queen returns on white's very next turn: black sees the warning.
    expect(warningSquaresFor(s, "b")).toEqual([parseSquare("d1")]);
  });
});

// --- concurrent phases ------------------------------------------------------

describe("concurrent phases", () => {
  it("tracks multiple phased pieces with independent timers", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "e8", P("b", "k"));
    put(s, "b1", P("w", "n"));
    put(s, "g1", P("w", "n"));
    put(s, "g8", P("b", "n"));

    let g: GameState = s;
    g = applyAction(g, { kind: "phaseOut", phaseOut: { from: parseSquare("b1"), duration: 2 } });
    g = applyAction(g, { kind: "move", move: { from: parseSquare("g8"), to: parseSquare("f6") } });
    g = applyAction(g, { kind: "phaseOut", phaseOut: { from: parseSquare("g1"), duration: 2 } });

    const phased = ownPhased(g, "w");
    expect(phased).toHaveLength(2);
    expect(phased.map((p) => p.origin).sort()).toEqual(
      [parseSquare("b1"), parseSquare("g1")].sort(),
    );
  });
});

// --- phased pieces exert no influence ---------------------------------------

describe("phased pieces exert no influence", () => {
  it("a phased rook gives no check and does not block a ray", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    // A black rook is phased out from e8 — off the board entirely.
    s.phased.push({ color: "b", type: "r", origin: parseSquare("e8"), returnOn: 9 });
    expect(inCheck(s, "w")).toBe(false);
    expect(isAttacked(s, parseSquare("e1"), "b")).toBe(false);

    // Put it back on the board and the check is real.
    put(s, "e8", P("b", "r"));
    expect(isAttacked(s, parseSquare("e1"), "b")).toBe(true);
  });
});

// --- fog-of-war view privacy ------------------------------------------------

describe("fog-of-war view", () => {
  it("never leaks the opponent's phased pieces or timers", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "e8", P("b", "k"));
    put(s, "d1", P("w", "q"));
    const phased = applyAction(s, {
      kind: "phaseOut",
      phaseOut: { from: parseSquare("d1"), duration: 4 },
    });

    const ownerView = viewFor(phased, "w");
    expect(ownerView.yourPhased).toHaveLength(1);
    expect(ownerView.yourPhased[0]!.origin).toBe(parseSquare("d1"));

    const oppView = viewFor(phased, "b");
    expect(oppView.yourPhased).toHaveLength(0);
    // Not returning next turn yet, so not even the square is exposed.
    expect(oppView.warningSquares).toHaveLength(0);
    // The board the opponent sees has no queen on d1 (it's off-board for everyone).
    expect(oppView.board[parseSquare("d1")]).toBeNull();
    // Nothing in the serialized opponent payload reveals the timer (returnOn 4).
    expect(JSON.stringify(oppView)).not.toContain('"returnOn"');
  });

  it("gives spectators neither side's phased information", () => {
    const s = emptyState("w");
    put(s, "d1", P("w", "q"));
    put(s, "e8", P("b", "k"));
    const phased = applyAction(s, {
      kind: "phaseOut",
      phaseOut: { from: parseSquare("d1"), duration: 4 },
    });
    const spectator = viewFor(phased, "spectator");
    expect(spectator.yourPhased).toHaveLength(0);
    expect(spectator.warningSquares).toHaveLength(0);
  });
});

// --- standard-rule special moves -------------------------------------------

describe("special moves", () => {
  it("captures en passant", () => {
    const s = emptyState("b");
    put(s, "e5", P("w", "p"));
    put(s, "d7", P("b", "p"));
    let g = applyAction(s, {
      kind: "move",
      move: { from: parseSquare("d7"), to: parseSquare("d5") },
    });
    expect(g.enPassant).toBe(parseSquare("d6"));
    g = applyAction(g, {
      kind: "move",
      move: { from: parseSquare("e5"), to: parseSquare("d6") },
    });
    expect(at(g, "d6")).toEqual(P("w", "p"));
    expect(at(g, "d5")).toBeNull(); // captured pawn removed
    expect(at(g, "e5")).toBeNull();
  });

  it("castles kingside and relocates the rook", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "h1", P("w", "r"));
    s.castling.wK = true;
    const next = applyAction(s, {
      kind: "move",
      move: { from: parseSquare("e1"), to: parseSquare("g1") },
    });
    expect(at(next, "g1")).toEqual(P("w", "k"));
    expect(at(next, "f1")).toEqual(P("w", "r"));
    expect(at(next, "h1")).toBeNull();
  });

  it("forbids castling through an attacked square", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "h1", P("w", "r"));
    put(s, "f8", P("b", "r")); // attacks f1, the king's path square
    s.castling.wK = true;
    const tos = generateMoves(s, parseSquare("e1")).map((m) => m.to);
    expect(tos).not.toContain(parseSquare("g1"));
  });

  it("promotes a pawn, offering all four piece types", () => {
    const s = emptyState("w");
    put(s, "a7", P("w", "p"));
    const promos = generateMoves(s, parseSquare("a7"))
      .filter((m) => m.to === parseSquare("a8"))
      .map((m) => m.promotion);
    expect(promos.sort()).toEqual(["b", "n", "q", "r"]);

    const next = applyAction(s, {
      kind: "move",
      move: { from: parseSquare("a7"), to: parseSquare("a8"), promotion: "n" },
    });
    expect(at(next, "a8")).toEqual(P("w", "n"));
  });
});
