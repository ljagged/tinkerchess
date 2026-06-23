// Public surface of the Phase Chess rules engine.

export * from "./types.js";
export {
  FILES,
  fileOf,
  rankOf,
  squareIndex,
  parseSquare,
  toAlgebraic,
  pieceAt,
  initialState,
  cloneState,
  opponent,
} from "./board.js";
export { isAttacked, inCheck, findKing } from "./attacks.js";
export { generateMoves, isLegalMove, applyMove } from "./moves.js";
export {
  isPhaseable,
  maxDuration,
  validatePhaseOut,
  applyPhaseOut,
  resolvePhaseIns,
  resolvePhaseInsWithEvents,
  ownPhased,
  warningSquaresFor,
} from "./phase.js";
export {
  createGame,
  applyAction,
  applyActionWithEvents,
  replay,
  legalMoves,
  viewFor,
  IllegalActionError,
} from "./game.js";
export type { Viewer, GameView, ViewPhasedPiece } from "./game.js";
