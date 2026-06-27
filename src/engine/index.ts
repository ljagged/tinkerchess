// Public surface of the TinkerChess rules engine.

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
  positionKey,
} from "./board.js";
export { isAttacked, inCheck, findKing } from "./attacks.js";
export {
  generateMoves,
  isLegalMove,
  legalMovesFrom,
  applyMove,
  deriveMoveEvent,
  movesEqual,
  resolveMove,
} from "./moves.js";
export {
  isPhaseable,
  maxDuration,
  kingSafe,
  validatePhaseOut,
  legalPhaseOuts,
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
  revealView,
  IllegalActionError,
} from "./game.js";
export type { Viewer, GameView, ViewPhasedPiece, RevealView, RevealPhasedPiece } from "./game.js";
export { toNotation, toSeatNotation } from "./notation.js";
export type { NotationOptions } from "./notation.js";
export {
  registerMechanic,
  getMechanic,
  allMechanics,
  activeMechanics,
  activeMechanicIds,
  augmentsActive,
} from "./mechanic.js";
export type { Mechanic } from "./mechanic.js";
export { phaseMechanic } from "./phase.js";
export {
  registerSetup,
  getSetup,
  classicalSetup,
  chess960Setup,
  scharnaglBackRank,
  buildFromBackRank,
  homeFilesFromBackRank,
  CHESS960_POSITIONS,
} from "./setup.js";
export type { Setup, BuiltSetup, CastlingHomeFiles } from "./setup.js";
export type { GameOptions } from "./board.js";
