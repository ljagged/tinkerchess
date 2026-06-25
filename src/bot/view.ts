// The honest view layer: reconstruct a searchable GameState from ONLY what the
// bot's seat legitimately knows.
//
// The engine's search primitives (legalMoves, legalPhaseOuts, applyAction) operate
// on a full GameState, but a human seat — and so the honest bot — never sees the
// enemy's hidden phased pieces or their return timers. The fog-filtered GameView
// carries the public board plus the bot's OWN phased pieces and the one-turn
// warning rings; it deliberately omits everything else. To search, we rebuild a
// plausible GameState from:
//
//   - the GameView (public board, turn, the bot's own phased pieces, warning rings),
//   - the PublicState bundle (config, history, castling, en-passant — all public,
//     but not carried by the rendering-oriented GameView), and
//   - the bot's own observation history of enemy phase-outs it watched happen.
//
// Honesty boundary (the whole point): this module NEVER receives or reads the
// enemy's entries in `state.phased`. Enemy phased pieces exist in the reconstruction
// only because the bot observed them leave; their return timers are ASSUMED, never
// read. A ring collapses an assumption to certainty. See view.test.ts for the
// property test that pins this — it is the bot-side analogue of the engine's
// fog-of-war privacy invariant.

import { maxDuration } from "../engine/index.js";
import type {
  CastlingRights,
  Color,
  GameState,
  GameView,
  PhasedPiece,
  PieceType,
  RuleConfig,
  SquareIndex,
} from "../engine/index.js";

/**
 * The public facts a seat knows that `GameView` does not carry (it is a rendering
 * projection). All four are visible to both players, so supplying them keeps the
 * honest model intact. The Convex wiring (PR 3) sources these from the server's
 * authoritative GameState.
 */
export interface PublicState {
  config: RuleConfig;
  /** Position-key history for repetition adjudication (engine `state.history`). */
  history: string[];
  castling: CastlingRights;
  enPassant: SquareIndex | null;
}

/**
 * A single enemy phase-out the bot WATCHED happen. Carries only public facts: the
 * origin square it left from, the piece type (visible on the board until it
 * vanished — `toSeatNotation` renders it as e.g. "Bf1↑?"), and the enemy's
 * completed-turn count at that moment. It deliberately does NOT carry the true
 * duration / returnOn — those are the hidden information the bot must assume.
 */
export interface ObservedPhaseOut {
  origin: SquareIndex;
  type: PieceType;
  /** The owner's (enemy's) `turnsTaken` count right after the phase-out turn. */
  leftOnEnemyTurn: number;
}

/**
 * A fog-safe phase event from the seat-filtered move log. The Convex layer builds
 * these from the public facts of each event (origin/return square + piece type +
 * owner turn count) — NOT from the raw `moves.events` (which leak enemy returnOn).
 */
export interface SeatPhaseEvent {
  kind: "phaseOut" | "phaseIn";
  color: Color;
  type: PieceType;
  /** phaseOut: the origin square left; phaseIn: the square returned to. Both public. */
  square: SquareIndex;
  /** The owner's `turnsTaken` count at this event. */
  ownerTurnsTaken: number;
}

const other = (c: Color): Color => (c === "w" ? "b" : "w");

/**
 * Fold a fog-safe seat event log into the list of enemy phase-outs still pending
 * (observed to leave, not yet observed to return). Own-color events are ignored —
 * the bot's own phased pieces come exactly from `view.yourPhased`.
 *
 * A phaseIn resolves the EARLIEST pending observation at that square (returns are
 * earliest-first, and a square can host several phase-outs over a game — F4).
 */
export function observationsFromSeatLog(
  seatEvents: readonly SeatPhaseEvent[],
  botColor: Color,
): ObservedPhaseOut[] {
  const enemy = other(botColor);
  const pending: ObservedPhaseOut[] = [];
  for (const ev of seatEvents) {
    if (ev.color !== enemy) continue;
    if (ev.kind === "phaseOut") {
      pending.push({ origin: ev.square, type: ev.type, leftOnEnemyTurn: ev.ownerTurnsTaken });
    } else {
      const idx = earliestPendingIndex(pending, ev.square);
      if (idx !== -1) pending.splice(idx, 1);
    }
  }
  return pending;
}

/** Index of the earliest-left pending observation at `origin`, or -1. */
function earliestPendingIndex(pending: readonly ObservedPhaseOut[], origin: SquareIndex): number {
  let best = -1;
  for (let i = 0; i < pending.length; i++) {
    if (pending[i]!.origin !== origin) continue;
    if (best === -1 || pending[i]!.leftOnEnemyTurn < pending[best]!.leftOnEnemyTurn) best = i;
  }
  return best;
}

/**
 * Assume a return timer for an observed enemy phased piece whose return is not yet
 * ringed. The single tuning point (spec §2.3).
 *
 * v1 (D2): the midpoint of the type's duration range under the active ruleset,
 * derived from `maxDuration` (never hardcoded). `returnOn = (turn it left) +
 * assumed duration`.
 *
 * TODO(v2 §2.3): detect "offensive-looking" phase-outs (the vacated square opened a
 * line the enemy then used for a capture/check) and assume the minimum duration
 * (d=1) for those. That needs board-delta context threaded in here; until then the
 * midpoint applies everywhere and the ring caps any error at a single turn.
 */
export function assumeEnemyTimer(obs: ObservedPhaseOut, config: RuleConfig): number {
  const assumedDuration = Math.ceil(maxDuration(obs.type, config) / 2);
  return obs.leftOnEnemyTurn + assumedDuration;
}

/**
 * Reconstruct a full, legal, searchable GameState from the seat's honest knowledge.
 *
 * Known exactly (copied straight in): the public board, turn, status, castling,
 * en-passant, config, history, captured, turn counts, and the bot's OWN phased
 * pieces (from `view.yourPhased`).
 *
 * Assumed: each observed-but-not-returned enemy phased piece is injected at its
 * origin with an ASSUMED returnOn (§2.3). A `view.warningSquares` ring on an origin
 * collapses the assumption to certainty for the EARLIEST pending observation there
 * (it returns at the end of the enemy's next turn); the rest stay assumed. The
 * absence of a ring is itself information — a still-pending piece that is not ringed
 * cannot return next turn, so its assumed returnOn is floored above that.
 *
 * This function never receives the enemy's true `state.phased`; it cannot leak what
 * it never holds.
 */
export function gameStateFromView(
  view: GameView,
  pub: PublicState,
  observations: readonly ObservedPhaseOut[],
): GameState {
  if (view.you !== "w" && view.you !== "b") {
    throw new Error("gameStateFromView requires a player view, not a spectator");
  }
  const botColor: Color = view.you;
  const enemy = other(botColor);

  // Own phased pieces: known exactly from the view.
  const phased: PhasedPiece[] = view.yourPhased.map((p) => ({
    color: botColor,
    type: p.type,
    origin: p.origin,
    returnOn: p.returnOn,
  }));

  // Enemy phased pieces: assumed from observations, with ring collapse (F4).
  const ringed = new Set(view.warningSquares);
  const enemyNextTurn = view.turnsTaken[enemy] + 1; // a ring means returnOn === this

  // Group by origin so a ring pins the earliest pending one and the rest stay assumed.
  const byOrigin = new Map<SquareIndex, ObservedPhaseOut[]>();
  for (const obs of observations) {
    const list = byOrigin.get(obs.origin);
    if (list) list.push(obs);
    else byOrigin.set(obs.origin, [obs]);
  }

  for (const [origin, list] of byOrigin) {
    list.sort((a, b) => a.leftOnEnemyTurn - b.leftOnEnemyTurn); // earliest-left first
    const originRinged = ringed.has(origin);
    list.forEach((obs, i) => {
      let returnOn: number;
      if (originRinged && i === 0) {
        returnOn = enemyNextTurn; // certainty
      } else {
        // Not ringed ⇒ cannot return next turn; floor the assumption above it.
        returnOn = Math.max(assumeEnemyTimer(obs, pub.config), enemyNextTurn + 1);
      }
      phased.push({ color: enemy, type: obs.type, origin, returnOn });
    });
  }

  return {
    board: view.board.slice(),
    config: pub.config,
    turn: view.turn,
    status: view.status,
    endReason: view.endReason,
    lastEvent: view.lastEvent,
    phased,
    castling: { ...pub.castling },
    enPassant: pub.enPassant,
    turnsTaken: { ...view.turnsTaken },
    captured: { w: view.captured.w.slice(), b: view.captured.b.slice() },
    history: pub.history.slice(),
  };
}
