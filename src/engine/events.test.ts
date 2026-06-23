// Derived event model (eng-review 0b / Lane A #2 foundation).
//
// applyActionWithEvents returns the new state PLUS the derived events the move log
// and notation render: one move/phaseOut event, then any end-of-turn phaseIns.
// Persisting these (not just the raw intent) keeps the log self-describing and
// replay-stable as the engine evolves.

import { describe, it, expect } from "vitest";
import {
  applyActionWithEvents,
  createGame,
  parseSquare,
  pieceAt,
  resolvePhaseInsWithEvents,
} from "./index.js";
import type { Action, Color, GameEvent, GameState, Piece } from "./index.js";

const P = (color: Color, type: Piece["type"]): Piece => ({ color, type });
const sq = (alg: string) => parseSquare(alg);

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

/** Apply a chain of actions, returning the final state and the LAST action's events. */
function run(actions: Action[]): { state: GameState; events: GameEvent[] } {
  let state = createGame();
  let events: GameEvent[] = [];
  for (const a of actions) ({ state, events } = applyActionWithEvents(state, a));
  return { state, events };
}

const mv = (from: string, to: string, promotion?: "q" | "r" | "b" | "n"): Action => ({
  kind: "move",
  move: promotion ? { from: sq(from), to: sq(to), promotion } : { from: sq(from), to: sq(to) },
});

describe("move events", () => {
  it("a quiet move emits a plain move event", () => {
    const { events } = run([mv("g1", "f3")]);
    expect(events).toEqual([{ kind: "move", color: "w", piece: "n", from: sq("g1"), to: sq("f3") }]);
  });

  it("a capture records the captured piece", () => {
    const { events } = run([mv("e2", "e4"), mv("d7", "d5"), mv("e4", "d5")]);
    expect(events).toEqual([
      { kind: "move", color: "w", piece: "p", from: sq("e4"), to: sq("d5"), capture: { color: "b", type: "p" } },
    ]);
  });

  it("en passant is flagged and records the captured pawn", () => {
    const { events } = run([mv("e2", "e4"), mv("a7", "a6"), mv("e4", "e5"), mv("d7", "d5"), mv("e5", "d6")]);
    expect(events).toEqual([
      { kind: "move", color: "w", piece: "p", from: sq("e5"), to: sq("d6"), capture: { color: "b", type: "p" }, enPassant: true },
    ]);
  });

  it("castling kingside is flagged", () => {
    const { events } = run([
      mv("g1", "f3"), mv("a7", "a6"), mv("e2", "e3"), mv("b7", "b6"), mv("f1", "e2"), mv("c7", "c6"), mv("e1", "g1"),
    ]);
    expect(events).toEqual([{ kind: "move", color: "w", piece: "k", from: sq("e1"), to: sq("g1"), castle: "K" }]);
  });

  it("a checking move sets check", () => {
    const { events } = run([mv("e2", "e4"), mv("f7", "f5"), mv("d1", "h5")]);
    expect(events).toEqual([{ kind: "move", color: "w", piece: "q", from: sq("d1"), to: sq("h5"), check: true }]);
  });

  it("promotion records the promoted type", () => {
    const s = createGame();
    s.board[sq("a7")] = P("w", "p");
    s.board[sq("a8")] = null;
    const { events } = applyActionWithEvents(s, mv("a7", "a8", "q"));
    expect(events).toEqual([{ kind: "move", color: "w", piece: "p", from: sq("a7"), to: sq("a8"), promotion: "q" }]);
  });
});

describe("phase events", () => {
  it("phase-out emits a phaseOut event with the return timer", () => {
    const { events } = applyActionWithEvents(createGame(), { kind: "phaseOut", phaseOut: { from: sq("g1"), duration: 2 } });
    expect(events).toEqual([
      { kind: "phaseOut", color: "w", piece: "n", from: sq("g1"), duration: 2, returnOn: 3 },
    ]);
  });

  it("a phase-in onto an empty origin emits a plain phaseIn event after the mover's move", () => {
    const s1 = applyActionWithEvents(createGame(), { kind: "phaseOut", phaseOut: { from: sq("g1"), duration: 1 } }).state;
    const s2 = applyActionWithEvents(s1, mv("a7", "a6")).state;
    const { events } = applyActionWithEvents(s2, mv("e2", "e4")); // White's 2nd turn -> knight returns
    expect(events).toContainEqual({ kind: "phaseIn", color: "w", piece: "n", to: sq("g1") });
    expect(events[0]).toEqual({ kind: "move", color: "w", piece: "p", from: sq("e2"), to: sq("e4") });
  });
});

describe("phase-in capture events (resolvePhaseInsWithEvents)", () => {
  function returningRook(occupant: Piece | null) {
    const s = emptyState("w");
    s.turnsTaken.w = 1;
    s.phased.push({ color: "w", type: "r", origin: sq("a1"), returnOn: 1 });
    if (occupant) s.board[sq("a1")] = occupant;
    return resolvePhaseInsWithEvents(s, "w");
  }

  it("no occupant -> plain phaseIn", () => {
    expect(returningRook(null).events).toEqual([{ kind: "phaseIn", color: "w", piece: "r", to: sq("a1") }]);
  });

  it("enemy occupant -> capture, no selfCapture", () => {
    expect(returningRook(P("b", "n")).events).toEqual([
      { kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "b", type: "n" } },
    ]);
  });

  it("own occupant -> selfCapture", () => {
    const { state, events } = returningRook(P("w", "b"));
    expect(events).toEqual([
      { kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "w", type: "b" }, selfCapture: true },
    ]);
    expect(state.lastEvent).toEqual({ by: "w", piece: "b", square: sq("a1") });
  });

  it("enemy king -> kingCapture (win)", () => {
    const { state, events } = returningRook(P("b", "k"));
    expect(events).toEqual([
      { kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "b", type: "k" }, kingCapture: true },
    ]);
    expect(state.status).toBe("w_won");
    expect(state.wonBySelfCapture).toBe(false);
  });

  it("own king -> kingCapture (footgun loss)", () => {
    const { state, events } = returningRook(P("w", "k"));
    expect(events).toEqual([
      { kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "w", type: "k" }, kingCapture: true },
    ]);
    expect(state.status).toBe("b_won");
    expect(state.wonBySelfCapture).toBe(true);
  });
});
