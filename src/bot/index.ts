// Public surface of the TinkerChess robo-player.
//
// The bot is a server-side actor that plays from the SAME fog-filtered view a human
// seat sees (the honest model — see view.ts). The full per-move flow:
//
//   seat-filtered events ─▶ observationsFromSeatLog ─┐
//                                                    ├▶ gameStateFromView ─▶ search ─▶ Action
//   GameView + PublicState ──────────────────────────┘
//
// chooseAction is the one call the Convex wiring (PR 3) makes on the bot's turn; it
// then submits the returned Action through the normal makeMove/phaseOut server path,
// so all server-side validation and the fog boundary apply identically.

import type { Action, GameView } from "../engine/index.js";
import {
  gameStateFromView,
  observationsFromSeatLog,
  type PublicState,
  type SeatPhaseEvent,
} from "./view.js";
import { search, type SearchOptions } from "./search.js";

export {
  gameStateFromView,
  observationsFromSeatLog,
  assumeEnemyTimer,
  type PublicState,
  type SeatPhaseEvent,
  type ObservedPhaseOut,
} from "./view.js";
export { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from "./evaluate.js";
export { search, ttKey, type SearchOptions, type SearchResult } from "./search.js";

/**
 * Choose the bot's action for the current position, reasoning only from honest seat
 * knowledge. `view` is the bot seat's `viewFor` output; `pub` carries the public
 * fields the view omits (ruleset, history, castling, en-passant); `seatEvents` is
 * the fog-safe phase-event log the bot uses to track enemy phase-outs.
 */
export function chooseAction(
  view: GameView,
  pub: PublicState,
  seatEvents: readonly SeatPhaseEvent[],
  opts?: SearchOptions,
): Action {
  if (view.you !== "w" && view.you !== "b") {
    throw new Error("chooseAction requires a player seat, not a spectator view");
  }
  const observations = observationsFromSeatLog(seatEvents, view.you);
  const state = gameStateFromView(view, pub, observations);
  return search(state, opts).action;
}
