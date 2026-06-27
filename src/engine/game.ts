// Top-level game orchestration: applying actions in turn order, adjudicating
// standard checkmate / stalemate / threefold-repetition, and producing the
// per-viewer (fog-of-war) view.
//
// Turn lifecycle for each action:
//   1. The side to move applies a move or a phase-out (board mechanics).
//   2. The mover's turn counter increments and any of the MOVER's due pieces
//      phase back in — at the END of their turn (S5 table; never ends the game).
//   3. The turn flips to the opponent, and the position the opponent faces is
//      adjudicated: checkmate (opponent loses), stalemate (draw), or threefold
//      repetition (draw). No king is ever captured/removed (S9).
//
// Phase-in resolves at the END of the owner's turn (not the start) so the owner
// gets to play the turn with the piece still out and exploit the open space.
// A piece phased for duration d is therefore absent across d of the owner's own
// turns and reappears at the end of the d-th one. The enemy-imminent-return ring
// is treated as a check on a king occupying that square (S5a), evaluated in this
// same adjudication, so an enemy return never fires against a live king.

import { cloneState, initialState, pieceAt, positionKey } from "./board.js";
import type { GameOptions } from "./board.js";
import { applyMove, deriveMoveEvent, legalMovesFrom, isLegalMove } from "./moves.js";
import { ownPhased, kingSafe, warningSquaresFor } from "./phase.js";
import { activeMechanics, mechanicForAction } from "./mechanic.js";
import type {
  Action,
  Color,
  EndReason,
  GameEvent,
  GameState,
  GameStatus,
  Move,
  Piece,
  RuleConfig,
  SelfCaptureEvent,
  SquareIndex,
} from "./types.js";

/**
 * Start a fresh game. `config` is phasing's ruleset (Tier-1 Settings); `options`
 * selects the moddable axes — the starting-position setup and the active mechanics
 * (both default to classical + phasing, preserving today's behavior).
 */
export function createGame(config?: RuleConfig, options?: GameOptions): GameState {
  return initialState(config, options);
}

export class IllegalActionError extends Error {}

/**
 * Apply an action for the side to move, returning the new state AND the derived
 * events (move/phaseOut, then any end-of-turn phaseIns). Throws
 * IllegalActionError if the action is not legal or the game is already over.
 * This is the single source of truth; `applyAction` returns only the state.
 */
export function applyActionWithEvents(
  state: GameState,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  if (state.status !== "active") {
    throw new IllegalActionError("game is over");
  }

  const mover = state.turn;
  const events: GameEvent[] = [];
  let next: GameState;

  if (action.kind === "move") {
    if (!ownsPiece(state, action.move.from, mover)) {
      throw new IllegalActionError("not your piece");
    }
    if (!isLegalMove(state, action.move)) {
      throw new IllegalActionError("illegal move");
    }
    next = applyMove(state, action.move);
    events.push(deriveMoveEvent(state, action.move));
  } else {
    // A non-move action is owned by a mechanic (phasing's phase-out today). The
    // mechanic validates internally and derives its own initiating event(s).
    const mechanic = mechanicForAction(state, action);
    if (!mechanic?.applyAction) {
      throw new IllegalActionError(`no mechanic owns action kind "${action.kind}"`);
    }
    const applied = mechanic.applyAction(state, action);
    next = applied.state;
    events.push(...applied.events);
  }

  // The self-capture notice reflects only the action just applied.
  next.lastEvent = null;

  next.turnsTaken[mover] += 1;

  // End-of-turn ticks for the mover across active mechanics, in pinned order
  // (phasing's due phase-ins today; S5 table — never ends the game).
  for (const mechanic of activeMechanics(next)) {
    if (!mechanic.onTurnEnd) continue;
    const ticked = mechanic.onTurnEnd(next, mover);
    next = ticked.state;
    events.push(...ticked.events);
  }

  // Pass to the opponent and adjudicate the position they now face.
  next.turn = mover === "w" ? "b" : "w";
  adjudicate(next, events);
  return { state: next, events };
}

/**
 * Adjudicate the position the side to move faces, mutating `state` in place:
 * checkmate (the side to move loses), stalemate (draw), or threefold repetition
 * (draw). Stalemate/checkmate use ONLY the current visible board and count legal
 * MOVES only — a legal phase-out never averts a draw. The deciding event is
 * stamped with check (+) / checkmate (#) for notation.
 */
function adjudicate(state: GameState, events: GameEvent[]): void {
  const toMove = state.turn;

  // Record the position the side to move faces, for threefold repetition. The key
  // excludes phase timers (see positionKey), so phasing can't dodge a repetition.
  const history = (state.history ??= []);
  const key = positionKey(state);
  history.push(key);

  const inCheck = !kingSafe(state, toMove);
  const hasMove = legalMoves(state).length > 0;

  if (!hasMove) {
    if (inCheck) {
      state.status = toMove === "w" ? "b_won" : "w_won"; // checkmate: side to move loses
      state.endReason = "checkmate";
      stampDecidingEvent(events, "checkmate");
    } else {
      state.status = "draw";
      state.endReason = "stalemate";
    }
    return;
  }

  // Threefold repetition -> automatic draw (Lichess-style; no claim action).
  if (history.filter((k) => k === key).length >= 3) {
    state.status = "draw";
    state.endReason = "repetition";
    return;
  }

  // Game continues: mark the deciding event as a check if the opponent is in one.
  if (inCheck) stampDecidingEvent(events, "check");
}

/**
 * Stamp the turn's deciding (last) event with check / checkmate, for notation.
 * Only move and phaseIn events carry these flags; a phase-out that delivers a
 * discovered check is not marked (a rare, cosmetic-only gap).
 */
function stampDecidingEvent(events: GameEvent[], kind: "check" | "checkmate"): void {
  const last = events[events.length - 1];
  if (!last) return;
  if (last.kind === "move" || last.kind === "phaseIn") {
    if (kind === "checkmate") last.checkmate = true;
    else last.check = true;
  }
}

/**
 * Apply an action for the side to move, returning the new state. Throws
 * IllegalActionError if the action is not legal or the game is already over.
 */
export function applyAction(state: GameState, action: Action): GameState {
  return applyActionWithEvents(state, action).state;
}

function ownsPiece(state: GameState, sq: SquareIndex, color: Color): boolean {
  const p = pieceAt(state.board, sq);
  return p !== null && p.color === color;
}

/**
 * Replay an action sequence from a starting state (default: a fresh game),
 * returning the final state. The engine is a pure, deterministic reducer with no
 * randomness, so `replay(actions)` always reproduces the same state — this is the
 * foundation for game history, per-seat logs, and the post-game reveal: a finished
 * game is stored as `{ initialState, actions }` and re-derived on demand rather
 * than as board snapshots. Throws IllegalActionError if any action is illegal.
 */
export function replay(actions: Action[], from: GameState = createGame()): GameState {
  let state = from;
  for (const action of actions) state = applyAction(state, action);
  return state;
}

/** All fully-legal (king-safe) moves for the side to move (UI highlighting,
 * adjudication, tests). Excludes phase-outs — they are not "moves" for
 * checkmate/stalemate purposes. */
export function legalMoves(state: GameState): Move[] {
  if (state.status !== "active") return [];
  const moves: Move[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (p && p.color === state.turn) moves.push(...legalMovesFrom(state, sq));
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Fog-of-war view
// ---------------------------------------------------------------------------

export type Viewer = Color | "spectator";

export interface ViewPhasedPiece {
  type: Piece["type"];
  origin: SquareIndex;
  returnOn: number;
  turnsRemaining: number;
}

export interface GameView {
  /** In-play pieces only — phased pieces are absent for everyone. */
  board: (Piece | null)[];
  turn: Color;
  status: GameStatus;
  /** Why the game ended (checkmate / stalemate / repetition), or undefined while active. */
  endReason?: EndReason;
  /**
   * Whether the VIEWER's own king is in check — standard attack OR an enemy
   * imminent-return ring on the king's square (per the viewer's fog). False for
   * spectators (they have no ring visibility). Drives the check indicator.
   */
  inCheck: boolean;
  /** Most recent non-terminal self-capture (visible to all), or null. */
  lastEvent: SelfCaptureEvent | null;
  /** Permanently captured pieces per color (the captured piece's color). */
  captured: { w: Piece["type"][]; b: Piece["type"][] };
  turnsTaken: { w: number; b: number };
  /** The viewer's seat, or "spectator". */
  you: Viewer;
  /** The viewer's OWN phased pieces with timers. Empty for spectators. */
  yourPhased: ViewPhasedPiece[];
  /**
   * Squares to highlight as a one-turn warning: the opponent's pieces returning
   * next turn (square only). Empty for spectators. NEVER includes the opponent's
   * timers or piece identities.
   */
  warningSquares: SquareIndex[];
}

/**
 * Build the filtered view for a given viewer. This is the privacy boundary:
 * it must never leak an opponent's phased pieces, timers, or return squares
 * beyond the allowed square-only warning. `state.phased` is never serialized.
 */
export function viewFor(state: GameState, viewer: Viewer): GameView {
  const isPlayer = viewer === "w" || viewer === "b";
  return {
    board: state.board.slice(),
    turn: state.turn,
    status: state.status,
    endReason: state.endReason,
    inCheck: isPlayer ? !kingSafe(state, viewer) : false,
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
    turnsTaken: { ...state.turnsTaken },
    you: viewer,
    yourPhased: isPlayer
      ? ownPhased(state, viewer).map((p) => ({
          type: p.type,
          origin: p.origin,
          returnOn: p.returnOn,
          turnsRemaining: p.turnsRemaining,
        }))
      : [],
    warningSquares: isPlayer ? warningSquaresFor(state, viewer) : [],
  };
}

// ---------------------------------------------------------------------------
// Post-game reveal view (replay only)
// ---------------------------------------------------------------------------

export interface RevealPhasedPiece {
  color: Color;
  type: Piece["type"];
  origin: SquareIndex;
  returnOn: number;
}

/**
 * A fully-revealed view for replaying a FINISHED game: exposes BOTH sides' phased
 * pieces (origin, type, timer). There is no secrecy once a game is over, so unlike
 * viewFor this hides nothing. Never use this for a live game — it would leak the
 * fog. Replay's "watch from a seat" perspectives use viewFor instead.
 */
export interface RevealView {
  board: (Piece | null)[];
  turn: Color;
  status: GameStatus;
  endReason?: EndReason;
  lastEvent: SelfCaptureEvent | null;
  captured: { w: Piece["type"][]; b: Piece["type"][] };
  turnsTaken: { w: number; b: number };
  /** Every phased piece, both colors, fully revealed. */
  phased: RevealPhasedPiece[];
}

export function revealView(state: GameState): RevealView {
  return {
    board: state.board.slice(),
    turn: state.turn,
    status: state.status,
    endReason: state.endReason,
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
    turnsTaken: { ...state.turnsTaken },
    phased: state.phased.map((p) => ({
      color: p.color,
      type: p.type,
      origin: p.origin,
      returnOn: p.returnOn,
    })),
  };
}

export { cloneState };
