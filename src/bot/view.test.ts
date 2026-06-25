import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULE_CONFIG,
  legalMoves,
  parseSquare,
  viewFor,
} from "../engine/index.js";
import type { Color, GameState, GameView, Piece, RuleConfig } from "../engine/index.js";
import { randomGame } from "../engine/_testgames.js";
import {
  assumeEnemyTimer,
  gameStateFromView,
  observationsFromSeatLog,
  type ObservedPhaseOut,
  type PublicState,
  type SeatPhaseEvent,
} from "./view.js";

// --- helpers (mirror engine.test.ts hand-builder conventions) ---------------
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

function publicOf(s: GameState): PublicState {
  return {
    config: s.config ?? DEFAULT_RULE_CONFIG,
    history: s.history ?? [],
    castling: s.castling,
    enPassant: s.enPassant,
  };
}

// A GameView literal for testing reconstruction in isolation (no need to drive
// viewFor to produce a specific ring).
function viewStub(over: Partial<GameView>): GameView {
  return {
    board: new Array<Piece | null>(64).fill(null),
    turn: "w",
    status: "active",
    inCheck: false,
    lastEvent: null,
    captured: { w: [], b: [] },
    turnsTaken: { w: 6, b: 6 },
    you: "w",
    yourPhased: [],
    warningSquares: [],
    ...over,
  };
}
const STUB_PUBLIC: PublicState = {
  config: DEFAULT_RULE_CONFIG,
  history: [],
  castling: { wK: false, wQ: false, bK: false, bQ: false },
  enPassant: null,
};

describe("gameStateFromView — known fields", () => {
  it("round-trips every public field and the bot's own phased pieces exactly", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "e8", P("b", "k"));
    put(s, "a1", P("w", "r"));
    s.castling = { wK: true, wQ: false, bK: false, bQ: true };
    s.enPassant = parseSquare("e6");
    s.turnsTaken = { w: 5, b: 5 };
    s.history = ["pos1", "pos2"];
    s.phased.push({ color: "w", type: "b", origin: parseSquare("c1"), returnOn: 8 });

    const r = gameStateFromView(viewFor(s, "w"), publicOf(s), []);

    expect(r.board).toEqual(s.board);
    expect(r.turn).toBe(s.turn);
    expect(r.castling).toEqual(s.castling);
    expect(r.enPassant).toBe(s.enPassant);
    expect(r.config).toEqual(s.config);
    expect(r.history).toEqual(s.history);
    expect(r.turnsTaken).toEqual(s.turnsTaken);
    expect(r.phased).toContainEqual({
      color: "w",
      type: "b",
      origin: parseSquare("c1"),
      returnOn: 8,
    });
  });

  it("throws on a spectator view (no seat to be honest about)", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    expect(() => gameStateFromView(viewFor(s, "spectator"), publicOf(s), [])).toThrow();
  });
});

describe("gameStateFromView — honesty boundary", () => {
  it("never invents enemy phased pieces it did not observe", () => {
    const s = emptyState("w");
    put(s, "e1", P("w", "k"));
    put(s, "e8", P("b", "k"));
    s.turnsTaken = { w: 4, b: 4 };
    // A hidden enemy phased piece the bot never saw leave (far returnOn ⇒ no ring).
    s.phased.push({ color: "b", type: "q", origin: parseSquare("d8"), returnOn: 99 });

    const r = gameStateFromView(viewFor(s, "w"), publicOf(s), []);
    expect(r.phased.filter((p) => p.color === "b")).toEqual([]);
  });

  it("is invariant to unobserved enemy phased state (injection cannot leak)", () => {
    const base = emptyState("w");
    put(base, "e1", P("w", "k"));
    put(base, "e8", P("b", "k"));
    base.turnsTaken = { w: 4, b: 4 };

    const injected = emptyState("w");
    put(injected, "e1", P("w", "k"));
    put(injected, "e8", P("b", "k"));
    injected.turnsTaken = { w: 4, b: 4 };
    // returnOn 99 keeps it out of warningSquares (which shows only returnOn === b+1).
    injected.phased.push({ color: "b", type: "r", origin: parseSquare("a8"), returnOn: 99 });

    const rBase = gameStateFromView(viewFor(base, "w"), publicOf(base), []);
    const rInjected = gameStateFromView(viewFor(injected, "w"), publicOf(injected), []);
    expect(rInjected.phased).toEqual(rBase.phased);
    expect(rInjected.board).toEqual(rBase.board);
  });

  it("honesty sweep: with no observations, never invents enemy phased over random games", () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const s of randomGame(seed).states) {
        for (const viewer of ["w", "b"] as const) {
          const view = viewFor(s, viewer);
          const r = gameStateFromView(view, publicOf(s), []);
          const enemy: Color = viewer === "w" ? "b" : "w";
          expect(r.phased.some((p) => p.color === enemy)).toBe(false);
          expect(r.phased.filter((p) => p.color === viewer)).toHaveLength(view.yourPhased.length);
          expect(r.board).toEqual(view.board);
          // The reconstruction is a legal engine input.
          if (r.status === "active") expect(() => legalMoves(r)).not.toThrow();
        }
      }
    }
  });
});

describe("assumeEnemyTimer — config-derived midpoint (D2)", () => {
  it("returns leftOnEnemyTurn + ceil(maxDuration/2), from maxDuration not constants", () => {
    // Default caps: q=4 ⇒ +2, n=2 ⇒ +1.
    expect(assumeEnemyTimer({ origin: 0, type: "q", leftOnEnemyTurn: 3 }, DEFAULT_RULE_CONFIG)).toBe(5);
    expect(assumeEnemyTimer({ origin: 0, type: "n", leftOnEnemyTurn: 0 }, DEFAULT_RULE_CONFIG)).toBe(1);
    // Non-default ruleset caps rook at 2 ⇒ +1 (proves no hardcoded caps).
    const cfg: RuleConfig = { maxPhaseDuration: { p: 0, n: 2, b: 2, r: 2, q: 0, k: 1 } };
    expect(assumeEnemyTimer({ origin: 0, type: "r", leftOnEnemyTurn: 3 }, cfg)).toBe(4);
  });
});

describe("gameStateFromView — rings and origin collisions", () => {
  it("a ring pins the assumed timer to 'returns next enemy turn'", () => {
    const e2 = parseSquare("e2");
    const view = viewStub({ warningSquares: [e2], turnsTaken: { w: 3, b: 3 } });
    const r = gameStateFromView(view, STUB_PUBLIC, [
      { origin: e2, type: "b", leftOnEnemyTurn: 2 },
    ]);
    const p = r.phased.find((x) => x.origin === e2)!;
    expect(p.returnOn).toBe(4); // enemyNextTurn = turnsTaken.b + 1
  });

  it("(F4) two observations on one origin: the ring resolves the earliest; the rest stay assumed", () => {
    const f3 = parseSquare("f3");
    const view = viewStub({ warningSquares: [f3], turnsTaken: { w: 6, b: 6 } });
    const r = gameStateFromView(view, STUB_PUBLIC, [
      { origin: f3, type: "n", leftOnEnemyTurn: 5 }, // earliest ⇒ ringed
      { origin: f3, type: "b", leftOnEnemyTurn: 6 }, // later ⇒ assumed, clamped above next turn
    ]);
    const atF3 = r.phased.filter((p) => p.color === "b" && p.origin === f3);
    expect(atF3.find((p) => p.type === "n")!.returnOn).toBe(7); // enemyNextTurn
    // bishop assume: 6 + ceil(2/2)=7, clamped to enemyNextTurn+1 = 8 (not ringed).
    expect(atF3.find((p) => p.type === "b")!.returnOn).toBe(8);
  });

  it("floors a non-ringed assumption above the next enemy turn", () => {
    const a6 = parseSquare("a6");
    // Piece left long ago; midpoint assumption would land in the past — must be clamped.
    const view = viewStub({ warningSquares: [], turnsTaken: { w: 10, b: 10 } });
    const r = gameStateFromView(view, STUB_PUBLIC, [
      { origin: a6, type: "n", leftOnEnemyTurn: 1 }, // 1 + 1 = 2, in the past
    ]);
    const p = r.phased.find((x) => x.origin === a6)!;
    expect(p.returnOn).toBe(12); // enemyNextTurn(11) + 1 — cannot have returned already
  });
});

describe("observationsFromSeatLog", () => {
  it("adds enemy phase-outs, removes the earliest on phase-in, ignores own-color events", () => {
    const b8 = parseSquare("b8");
    const log: SeatPhaseEvent[] = [
      { kind: "phaseOut", color: "b", type: "n", square: b8, ownerTurnsTaken: 2 },
      { kind: "phaseOut", color: "w", type: "r", square: parseSquare("a1"), ownerTurnsTaken: 2 },
      { kind: "phaseOut", color: "b", type: "n", square: b8, ownerTurnsTaken: 5 },
      { kind: "phaseIn", color: "b", type: "n", square: b8, ownerTurnsTaken: 4 },
    ];
    const obs = observationsFromSeatLog(log, "w");
    // own (white) phase-out ignored; the b8 phase-in removed the earliest (turn 2).
    expect(obs).toEqual<ObservedPhaseOut[]>([{ origin: b8, type: "n", leftOnEnemyTurn: 5 }]);
  });
});
