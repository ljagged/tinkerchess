// Notation rendering for the move log (letters + figurine).

import { describe, it, expect } from "vitest";
import {
  applyActionWithEvents,
  createGame,
  parseSquare,
  toNotation,
  toSeatNotation,
} from "./index.js";
import type { Action, GameEvent } from "./index.js";

const sq = (alg: string) => parseSquare(alg);
const fig = { figurine: true } as const;

describe("toNotation — moves", () => {
  it("quiet pawn and piece moves", () => {
    expect(toNotation({ kind: "move", color: "w", piece: "p", from: sq("e2"), to: sq("e4") })).toBe("e4");
    expect(toNotation({ kind: "move", color: "w", piece: "n", from: sq("g1"), to: sq("f3") })).toBe("Nf3");
    expect(toNotation({ kind: "move", color: "w", piece: "n", from: sq("g1"), to: sq("f3") }, fig)).toBe("♘f3");
    expect(toNotation({ kind: "move", color: "b", piece: "n", from: sq("g8"), to: sq("f6") }, fig)).toBe("♞f6");
  });

  it("captures: pawn shows the file, pieces show x", () => {
    expect(
      toNotation({ kind: "move", color: "w", piece: "p", from: sq("e4"), to: sq("d5"), capture: { color: "b", type: "p" } }),
    ).toBe("exd5");
    expect(
      toNotation({ kind: "move", color: "w", piece: "n", from: sq("f3"), to: sq("e5"), capture: { color: "b", type: "p" } }),
    ).toBe("Nxe5");
  });

  it("castling", () => {
    expect(toNotation({ kind: "move", color: "w", piece: "k", from: sq("e1"), to: sq("g1"), castle: "K" })).toBe("O-O");
    expect(toNotation({ kind: "move", color: "w", piece: "k", from: sq("e1"), to: sq("c1"), castle: "Q" })).toBe("O-O-O");
  });

  it("check and promotion", () => {
    expect(toNotation({ kind: "move", color: "w", piece: "q", from: sq("d1"), to: sq("h5"), check: true })).toBe("Qh5+");
    expect(toNotation({ kind: "move", color: "w", piece: "p", from: sq("a7"), to: sq("a8"), promotion: "q" })).toBe("a8=Q");
    expect(toNotation({ kind: "move", color: "w", piece: "p", from: sq("a7"), to: sq("a8"), promotion: "q" }, fig)).toBe("a8=♕");
    expect(
      toNotation({ kind: "move", color: "w", piece: "p", from: sq("b7"), to: sq("a8"), capture: { color: "b", type: "r" }, promotion: "q" }),
    ).toBe("bxa8=Q");
  });

  it("king capture is the win marker (#)", () => {
    expect(
      toNotation({ kind: "move", color: "w", piece: "q", from: sq("h5"), to: sq("e8"), capture: { color: "b", type: "k" }, kingCapture: true }),
    ).toBe("Qxe8#");
  });
});

describe("toNotation — phase events", () => {
  it("phase-out: piece, square, duration", () => {
    expect(toNotation({ kind: "phaseOut", color: "w", piece: "b", from: sq("f1"), duration: 3, returnOn: 4 })).toBe("Bf1~3");
    expect(toNotation({ kind: "phaseOut", color: "b", piece: "b", from: sq("f8"), duration: 2, returnOn: 3 }, fig)).toBe("♝f8~2");
  });

  it("phase-in: plain, enemy capture, self-capture, king capture", () => {
    expect(toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("a1") })).toBe("R@a1");
    expect(toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("a1") }, fig)).toBe("♖@a1");
    expect(
      toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "b", type: "n" } }),
    ).toBe("R@a1xN");
    expect(
      toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "b", type: "n" } }, fig),
    ).toBe("♖@a1x♞");
    expect(
      toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "w", type: "b" }, selfCapture: true }),
    ).toBe("R@a1xB(self)");
    expect(
      toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("e8"), capture: { color: "b", type: "k" }, kingCapture: true }),
    ).toBe("R@e8xK#");
    // own-king footgun: king capture of one's own color -> # and (self)
    expect(
      toNotation({ kind: "phaseIn", color: "w", piece: "r", to: sq("e1"), capture: { color: "w", type: "k" }, kingCapture: true }),
    ).toBe("R@e1xK#(self)");
  });
});

describe("toSeatNotation — per-seat fog filtering", () => {
  const oppPhaseOut: GameEvent = { kind: "phaseOut", color: "w", piece: "b", from: sq("f1"), duration: 3, returnOn: 4 };

  it("redacts ONLY the opponent's phase-out duration", () => {
    expect(toSeatNotation(oppPhaseOut, "b")).toBe("Bf1~?"); // opponent: duration hidden
    expect(toSeatNotation(oppPhaseOut, "w")).toBe("Bf1~3"); // owner: full
    expect(toSeatNotation(oppPhaseOut, "b", fig)).toBe("♗f1~?");
  });

  it("leaves moves, captures, and phase-ins public for both seats", () => {
    const move: GameEvent = { kind: "move", color: "w", piece: "n", from: sq("g1"), to: sq("f3") };
    const phaseIn: GameEvent = { kind: "phaseIn", color: "w", piece: "r", to: sq("a1"), capture: { color: "b", type: "n" } };
    for (const viewer of ["w", "b"] as const) {
      expect(toSeatNotation(move, viewer)).toBe("Nf3");
      expect(toSeatNotation(phaseIn, viewer)).toBe("R@a1xN");
    }
  });
});

describe("toNotation — integration over a real sequence", () => {
  it("renders a short game's move log", () => {
    const mv = (from: string, to: string): Action => ({ kind: "move", move: { from: sq(from), to: sq(to) } });
    let state = createGame();
    const rendered: string[] = [];
    for (const a of [mv("e2", "e4"), mv("d7", "d5"), mv("e4", "d5")]) {
      const r = applyActionWithEvents(state, a);
      state = r.state;
      rendered.push(...r.events.map((e: GameEvent) => toNotation(e)));
    }
    expect(rendered).toEqual(["e4", "d5", "exd5"]);
  });
});
