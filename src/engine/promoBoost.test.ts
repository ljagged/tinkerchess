// Stage 4 — the interface ACCEPTANCE TEST. A second mechanic (promoBoost) intercepts a
// core rule (promotion) through the single onPromotion seam and composes with the boost
// mechanic via the shared `boosts` field, with no other kernel edits. If a promoted
// pawn arrives already wielding its fairy form, the architecture is proven.

import { describe, it, expect } from "vitest";
import {
  applyAction,
  applyActionWithEvents,
  legalMovesFrom,
  boostAt,
  parseSquare,
  pieceAt,
} from "./index.js";
import type { Action, Color, GameState, Piece } from "./index.js";

const sq = parseSquare;
const P = (color: Color, type: Piece["type"]): Piece => ({ color, type });

/** A bare board with the given mechanics active and white to move. */
function state(mechanics: string[], turn: Color = "w"): GameState {
  return {
    board: new Array<Piece | null>(64).fill(null),
    config: undefined,
    mechanics,
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
const promote: Action = { kind: "move", move: { from: parseSquare("b7"), to: parseSquare("b8"), promotion: "q" } };

describe("promotion-grants-boost (acceptance: a new mechanic hooks a core rule cleanly)", () => {
  it("a promoted queen arrives as a boosted Amazon and immediately has knight leaps", () => {
    const s = state(["phasing", "boost", "promoBoost"]);
    s.board[sq("b7")] = P("w", "p");
    s.board[sq("h1")] = P("w", "k");
    s.board[sq("h8")] = P("b", "k");
    const next = applyAction(s, promote);
    expect(pieceAt(next.board, sq("b8"))).toEqual({ color: "w", type: "q" });
    expect(boostAt(next, sq("b8"), "w")).toMatchObject({ base: "q" }); // auto-boosted
    // it is BLACK to move now; flip turn back to read White's options as a sanity check
    const probe = { ...next, turn: "w" as Color };
    const tos = legalMovesFrom(probe, sq("b8")).map((m) => m.to);
    expect(tos).toContain(sq("c6")); // Amazon knight leap b8→c6 (a plain queen cannot)
    expect(tos).toContain(sq("a6"));
    expect(tos).toContain(sq("d7"));
  });

  it("the grant is recorded only as a promotion move — promoBoost adds no action/event of its own", () => {
    const s = state(["phasing", "boost", "promoBoost"]);
    s.board[sq("b7")] = P("w", "p");
    s.board[sq("h1")] = P("w", "k");
    s.board[sq("h8")] = P("b", "k");
    const { events } = applyActionWithEvents(s, promote);
    // exactly the move event (with promotion); the boost is silent engine state
    expect(events.filter((e) => e.kind === "move")).toHaveLength(1);
    expect(events.some((e) => e.kind === "boostGranted")).toBe(false);
  });

  it("without promoBoost, promotion is classical — no boost is granted", () => {
    const s = state(["phasing", "boost"]); // boost active, but no promoBoost
    s.board[sq("b7")] = P("w", "p");
    s.board[sq("h1")] = P("w", "k");
    s.board[sq("h8")] = P("b", "k");
    const next = applyAction(s, promote);
    expect(pieceAt(next.board, sq("b8"))).toEqual({ color: "w", type: "q" });
    expect(next.boosts ?? []).toHaveLength(0);
  });

  it("a capture-promotion onto an enemy boosted piece drops the enemy buff, keeps the new one", () => {
    const s = state(["phasing", "boost", "promoBoost"]);
    s.board[sq("b7")] = P("w", "p");
    s.board[sq("c8")] = P("b", "r"); // an enemy rook on the promotion-capture square...
    s.boosts = [{ color: "b", square: sq("c8"), base: "r", expiresOn: 99 }]; // ...that is boosted
    s.board[sq("h1")] = P("w", "k");
    s.board[sq("h8")] = P("b", "k");
    const next = applyAction(s, { kind: "move", move: { from: sq("b7"), to: sq("c8"), promotion: "q" } });
    expect(pieceAt(next.board, sq("c8"))).toEqual({ color: "w", type: "q" });
    expect(boostAt(next, sq("c8"), "b")).toBeUndefined(); // enemy buff gone
    expect(boostAt(next, sq("c8"), "w")).toMatchObject({ base: "q" }); // White's promo buff present
  });
});
