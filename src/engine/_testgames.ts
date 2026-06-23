// Shared test helpers (not part of the public engine surface — note the leading
// underscore and absence from index.ts). Generates reproducible random legal
// games so multiple test files can exercise the engine over a wide state space
// without duplicating the generator.

import {
  applyAction,
  createGame,
  legalMoves,
  maxDuration,
  isPhaseable,
  pieceAt,
  validatePhaseOut,
} from "./index.js";
import type { Action, GameState, RuleConfig } from "./index.js";

/** Tiny seeded PRNG (mulberry32) — reproducible so a failing seed can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every legal action (moves + phase-outs) for the side to move under its ruleset. */
export function legalActions(state: GameState): Action[] {
  const actions: Action[] = [];
  for (const move of legalMoves(state)) actions.push({ kind: "move", move });
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (!p || p.color !== state.turn || !isPhaseable(p.type, state.config)) continue;
    for (let d = 1; d <= maxDuration(p.type, state.config); d++) {
      if (validatePhaseOut(state, { from: sq, duration: d }).ok) {
        actions.push({ kind: "phaseOut", phaseOut: { from: sq, duration: d } });
      }
    }
  }
  return actions;
}

/**
 * Play a random legal game. Returns the action list and every state visited
 * (states[0] is the initial state; the last entry is the final state).
 */
export function randomGame(
  seed: number,
  maxPlies = 60,
  config?: RuleConfig,
): { actions: Action[]; states: GameState[] } {
  const rand = mulberry32(seed);
  let state = createGame(config);
  const actions: Action[] = [];
  const states: GameState[] = [state];
  for (let ply = 0; ply < maxPlies && state.status === "active"; ply++) {
    const options = legalActions(state);
    if (options.length === 0) break;
    const action = options[Math.floor(rand() * options.length)]!;
    state = applyAction(state, action);
    actions.push(action);
    states.push(state);
  }
  return { actions, states };
}
