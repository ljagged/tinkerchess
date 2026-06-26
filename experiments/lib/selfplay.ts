// Generalized game-driver: play a full TC game between two action choosers,
// tallying per-position branching (for Game Refinement) and wall-clock time.
// Reuses the engine exactly as the app does — pure, deterministic given the choosers.
import {
  applyActionWithEvents,
  createGame,
  legalMoves,
  legalPhaseOuts,
} from "../../src/engine/index.js";
import type { Action, Color, GameEvent, GameState, RuleConfig } from "../../src/engine/index.js";

export type Chooser = (state: GameState) => Action | Promise<Action>;

export type EndedBy = "engine" | "no-progress" | "ply-cap";

export interface GameResult {
  status: GameState["status"];
  endReason?: string;
  endedBy: EndedBy;
  winner: Color | null;
  plies: number;
  positions: number;
  /** Branching sums over positions, under three B-definitions (see GR experiment). */
  sumBMove: number; // legal moves only
  sumBAll: number; // moves + every phase-out × duration
  sumBD1: number; // moves + one phase option per phaseable piece
  phaseOuts: { w: number; b: number };
  phaseOutsByWinner: number;
  durationMs: number;
}

/** 50-move-rule analog: a capture or pawn move is "progress". TC has no fifty-move
 *  rule, so weak self-play shuffles forever — this caps it AND keeps game length
 *  realistic for the GR measurement. */
function isProgress(events: GameEvent[]): boolean {
  return events.some(
    (e) =>
      ("capture" in e && e.capture) ||
      (e.kind === "move" && e.piece === "p"),
  );
}

export async function playGame(opts: {
  config?: RuleConfig;
  choosers: Record<Color, Chooser>;
  maxPlies?: number;
  /** Draw after this many plies with no capture/pawn move (default 100 = 50 moves). */
  drawAfterNoProgress?: number;
}): Promise<GameResult> {
  const maxPlies = opts.maxPlies ?? 240;
  const noProgressCap = opts.drawAfterNoProgress ?? 100;
  const t0 = performance.now();
  let state = createGame(opts.config);
  let plies = 0;
  let positions = 0;
  let sumBMove = 0;
  let sumBAll = 0;
  let sumBD1 = 0;
  let sinceProgress = 0;
  let endedBy: EndedBy = "engine";
  const phaseOuts = { w: 0, b: 0 };

  while (state.status === "active") {
    if (plies >= maxPlies) {
      endedBy = "ply-cap";
      break;
    }
    if (sinceProgress >= noProgressCap) {
      endedBy = "no-progress";
      break;
    }
    const moves = legalMoves(state);
    const phs = legalPhaseOuts(state);
    if (moves.length + phs.length === 0) break;
    sumBMove += moves.length;
    sumBAll += moves.length + phs.length;
    sumBD1 += moves.length + new Set(phs.map((p) => p.from)).size;
    positions++;

    const action = await opts.choosers[state.turn](state);
    if (action.kind === "phaseOut") phaseOuts[state.turn]++;
    const { state: next, events } = applyActionWithEvents(state, action);
    sinceProgress = isProgress(events) ? 0 : sinceProgress + 1;
    state = next;
    plies++;
  }

  const durationMs = performance.now() - t0;
  // Capped games are draws for scoring (no engine winner).
  const winner = state.status === "w_won" ? "w" : state.status === "b_won" ? "b" : null;
  return {
    status: state.status,
    endReason: state.endReason,
    endedBy,
    winner,
    plies,
    positions,
    sumBMove,
    sumBAll,
    sumBD1,
    phaseOuts,
    phaseOutsByWinner: winner ? phaseOuts[winner] : 0,
    durationMs,
  };
}
