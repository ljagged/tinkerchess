// Core types for the TinkerChess rules engine.
//
// The engine is pure and headless: every function takes a GameState and returns
// data or a new GameState. No I/O, no randomness, no hidden mutation of inputs.
// This is the single source of truth for the variant's rules; the Convex layer
// and the frontend both consume it (the frontend only ever sees a *filtered*
// view — see the fog-of-war notes in the plan).

export type Color = "w" | "b";

/** Piece kinds. 'p' pawns cannot phase; everything else can. */
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  color: Color;
  type: PieceType;
}

/**
 * Square index 0..63. index = rank * 8 + file, with file 0 = 'a', rank 0 = '1'.
 * So 'a1' = 0, 'h1' = 7, 'a8' = 56, 'h8' = 63.
 */
export type SquareIndex = number;

/** A piece that is currently phased out (off the board, hidden from the opponent). */
export interface PhasedPiece {
  color: Color;
  type: PieceType;
  /** Square the piece left and will reappear on. */
  origin: SquareIndex;
  /**
   * The owner's turn count at the END of which the piece phases back in. The
   * piece returns once the owner has completed `returnOn` turns, i.e. when
   * turnsTaken[owner] reaches this value. So phasing on the owner's turn k for
   * duration d sets returnOn = k + d, and the piece is absent across the owner's
   * turns k+1 … k+d, reappearing at the end of turn k+d.
   */
  returnOn: number;
}

export interface CastlingRights {
  wK: boolean; // white kingside
  wQ: boolean; // white queenside
  bK: boolean; // black kingside
  bQ: boolean; // black queenside
}

export type GameStatus = "active" | "w_won" | "b_won" | "draw";

/**
 * Why a finished game ended. Absent while the game is active. A win
 * (`w_won`/`b_won`) is by `"checkmate"`, `"timeout"`, or `"resignation"`; a
 * `"draw"` is by `"stalemate"` or threefold `"repetition"`. NOTE: `"timeout"` and
 * `"resignation"` are adjudicated by the Convex layer, NOT this engine — the
 * engine's `adjudicate` never emits them. They are part of this union only so a
 * single `endReason` field can describe every way a game can end as it flows
 * through views, the archive, and the UI.
 */
export type EndReason = "checkmate" | "stalemate" | "repetition" | "timeout" | "resignation";

/** A non-terminal "footgun": a phase-in removed one of the owner's OWN pieces. */
export interface SelfCaptureEvent {
  by: Color;
  piece: PieceType;
  square: SquareIndex;
}

/**
 * Per-game rule configuration — the "Tier-1 Settings" surface (which men may
 * phase, and for how long). A SINGLE source of truth: `maxPhaseDuration[type]`
 * of 0 means that piece type cannot phase, so phase-eligibility is derived from
 * the same field as the duration cap (no separate boolean to drift out of sync).
 * Defaults come from MAX_PHASE_DURATION; a game may override them at setup.
 */
export interface RuleConfig {
  /** Max phase-out duration (in the owner's turns) per piece type. 0 = cannot phase. */
  maxPhaseDuration: Record<PieceType, number>;
}

/**
 * The one-time SETUP axis (which starting position). Classical is the default; the
 * Chess960 setup (Stage 2) sets `position` to a Scharnagl number or shuffles. Stored
 * as a named optional field on GameState (absence ⇒ classical), so castling/home-file
 * logic and replay can read the chosen back rank without a config restructure.
 */
export interface SetupConfig {
  id: string; // "classical" | "chess960"
  /** Chess960 position number (0..959) or omitted/undefined for classical. */
  position?: number;
}

/**
 * Where castling's pieces start, as FILES (0=a .. 7=h). Classical is the special
 * case: king e (4), rooks a (0) / h (7). A Chess960 setup supplies shuffled files;
 * castling reads these instead of hard-coding the classical squares (decision 5).
 */
export interface CastlingHomeFiles {
  king: number;
  /** Queenside ("a-side") rook home file. */
  aRook: number;
  /** Kingside ("h-side") rook home file. */
  hRook: number;
}

/** The classical castling home files: king e, rooks a/h. The default when absent. */
export const CLASSICAL_HOME_FILES: CastlingHomeFiles = { king: 4, aRook: 0, hRook: 7 };

/**
 * The moddable-engine schema version, stamped on every new game/match (decision 3).
 * Bumped when the persisted Action/GameEvent/state shape changes in a way replay must
 * branch on. Legacy rows lack it (treated as version 0 / classical+phasing).
 */
export const SCHEMA_VERSION = 1;

/** The default active mechanics — phasing only, preserving today's behavior. */
export const DEFAULT_MECHANICS: string[] = ["phasing"];

/** A piece type that can receive a boost (everything but a pawn). */
export type FairyBase = Exclude<PieceType, "p">;

/**
 * A standing boost on a single piece (the boost mechanic's named state, decision 4).
 * Tracked by the boosted piece's CURRENT square (relocated when it moves) and the
 * underlying piece type, which selects the fairy upgrade (bishop→Dragon Horse, etc.).
 * The buff ends once the owner's `turnsTaken` reaches `expiresOn`.
 */
export interface BoostState {
  color: Color;
  square: SquareIndex;
  base: FairyBase;
  expiresOn: number;
}

/** The default setup — classical chess. */
export const DEFAULT_SETUP: SetupConfig = { id: "classical" };

export interface GameState {
  /** 64 squares; holds only IN-PLAY pieces. Phased pieces are absent here. */
  board: (Piece | null)[];
  /**
   * Phasing's ruleset (Tier-1 Settings). Optional for back-compat with games stored
   * before this field existed; absence is treated as DEFAULT_RULE_CONFIG everywhere.
   * This stays phasing's per-mechanic config; the moddable axes live in the named
   * fields below (decision 4: named optional fields, not a config restructure).
   */
  config?: RuleConfig;
  /**
   * The active mechanics, in pinned (fold) order. Optional for back-compat; absence
   * ⇒ DEFAULT_MECHANICS (["phasing"]), preserving today's behavior exactly.
   */
  mechanics?: string[];
  /** The starting-position setup. Optional; absence ⇒ DEFAULT_SETUP (classical). */
  setup?: SetupConfig;
  /**
   * Castling home files for this game's back rank (decision 5). Optional; absence ⇒
   * CLASSICAL_HOME_FILES. Stamped at creation from the setup so castling/rights logic
   * reads it without rebuilding the setup each move.
   */
  castlingHomeFiles?: CastlingHomeFiles;
  /** Moddable-engine schema version (decision 3). Optional; absence ⇒ legacy (0). */
  schemaVersion?: number;
  /** Whose turn it is to act. */
  turn: Color;
  status: GameStatus;
  /** Why the game ended (checkmate / stalemate / repetition). Absent while active. */
  endReason?: EndReason;
  /**
   * The most recent non-terminal self-capture, or null. Reflects only the most
   * recently applied action (cleared each turn). Used to surface "X captured
   * their own rook" to both players.
   */
  lastEvent: SelfCaptureEvent | null;
  /** Pieces currently phased out, for both colors. */
  phased: PhasedPiece[];
  /**
   * Standing boosts (the boost mechanic's named state). Optional; absent ⇒ no boosts.
   * Its presence is the cheap gate for the decision-1 attack/move fold: classical and
   * phasing-only games never have it, so the kernel's augmentation path stays dormant.
   */
  boosts?: BoostState[];
  castling: CastlingRights;
  /** En-passant target square (the square a pawn skipped over), or null. */
  enPassant: SquareIndex | null;
  /** Completed turns per color. Incremented when a player finishes an action. */
  turnsTaken: { w: number; b: number };
  /**
   * Pieces that have been permanently captured, keyed by the CAPTURED piece's
   * color (so `captured.w` is White's losses). Phased pieces are NOT captured —
   * they never appear here — so this reveals nothing about return timers.
   */
  captured: { w: PieceType[]; b: PieceType[] };
  /**
   * Position keys seen so far (one per position reached, including the start), for
   * threefold-repetition detection. The key is the visible board + side-to-move +
   * castling + en-passant only (see `positionKey`): phased pieces are absent from
   * the board and their timers are excluded, so phasing can never manufacture a
   * "new" position to dodge a repetition draw. Optional for back-compat; absence
   * is treated as an empty history.
   */
  history?: string[];
}

/**
 * A normal chess move. `promotion` is required only when a pawn reaches the last
 * rank. `castle` is the EXPLICIT castle flag (decision 5): set on a castling move
 * whose king does not start on the e-file (Chess960), where positional detection
 * (king moves two files) is ambiguous — there it is encoded king-onto-rook (`to` is
 * the castling rook's square). Classical castling (king on e) omits the flag and
 * stays positional, so classical move objects are byte-identical to before.
 */
export interface Move {
  from: SquareIndex;
  to: SquareIndex;
  promotion?: Exclude<PieceType, "p" | "k">;
  castle?: "K" | "Q";
}

/** A phase-out action: take a non-pawn piece off the board for `duration` of the owner's turns. */
export interface PhaseOut {
  from: SquareIndex;
  duration: number;
}

/**
 * A boost action: upgrade your own non-pawn piece on `target` to its fairy form by
 * sacrificing `fodder` (your own pieces, classically valued, summing EXACTLY to the
 * cost — no change, no banking). With `move` present the boost is IMMEDIATE — the
 * piece also moves this turn (cost + a premium); without it, the boost consumes the
 * turn. The fodder squares are removed; the boosted piece stands for a 3-turn buff.
 */
export interface BoostInput {
  target: SquareIndex;
  fodder: SquareIndex[];
  /** When present, the boosted piece moves this turn (immediate boost). */
  move?: Move;
}

export type Action =
  | { kind: "move"; move: Move }
  | { kind: "phaseOut"; phaseOut: PhaseOut }
  | { kind: "boost"; boost: BoostInput };

/**
 * A DERIVED event: what actually happened when an action was applied, with all
 * consequences resolved (captures, castling, en-passant, promotion, check, and
 * phase-ins). The move log and notation render these; the per-seat log filters
 * them by fog rules. Persisting derived events (not just the intent `Action`)
 * keeps the log self-describing and replay-stable even as the engine evolves.
 *
 * A single action yields one initiating event (move/phaseOut) followed by zero or
 * more phaseIn events resolved at the end of the mover's turn.
 */
export type GameEvent =
  | {
      kind: "move";
      color: Color;
      piece: PieceType;
      from: SquareIndex;
      to: SquareIndex;
      /** The piece removed (normal or en-passant capture), if any. */
      capture?: { color: Color; type: PieceType };
      /** True when the capture was en passant. */
      enPassant?: true;
      /** "K" = kingside, "Q" = queenside, when this move castled. */
      castle?: "K" | "Q";
      /** The promoted-to type, when a pawn promoted. */
      promotion?: Exclude<PieceType, "p" | "k">;
      /** The move gives check to the opponent. */
      check?: true;
      /** The move delivered checkmate (set during adjudication). Renders as "#". */
      checkmate?: true;
    }
  | {
      kind: "phaseOut";
      color: Color;
      piece: PieceType;
      from: SquareIndex;
      duration: number;
      returnOn: number;
    }
  | {
      kind: "boostGranted";
      color: Color;
      /** The upgraded piece type (selects the fairy form) and its square. */
      base: FairyBase;
      square: SquareIndex;
      /** The sacrificed fodder piece types (for the move log). */
      fodder: PieceType[];
      /** True when the boost was immediate (the piece also moved this turn). */
      immediate?: true;
      /** Owner's turnsTaken value at which the buff expires. */
      expiresOn: number;
    }
  | {
      kind: "boostExpired";
      color: Color;
      base: FairyBase;
      square: SquareIndex;
    }
  | {
      kind: "phaseIn";
      color: Color;
      piece: PieceType;
      /** Origin square the piece returns to. */
      to: SquareIndex;
      /** The occupant destroyed on return (the returning piece's new square), if any. */
      capture?: { color: Color; type: PieceType };
      /** The destroyed occupant was the owner's own (non-king) piece (footgun). */
      selfCapture?: true;
      /**
       * The origin square held the owner's OWN king: the returning piece
       * self-destructs and the king is unaffected (kings are immune to friendly
       * fire). No capture is recorded; the king stays.
       */
      selfDestruct?: true;
      /** The return gives check to the opponent (set during adjudication). Renders as "+". */
      check?: true;
      /** The return delivered checkmate (set during adjudication). Renders as "#". */
      checkmate?: true;
    };

/** Maximum phase-out duration per piece type, in the owner's own turns. */
export const MAX_PHASE_DURATION: Record<Exclude<PieceType, "p">, number> = {
  k: 1,
  n: 2,
  b: 2,
  r: 3,
  q: 4,
};

/**
 * The default ruleset: pawns cannot phase (duration 0); others use
 * MAX_PHASE_DURATION. This is the single default that per-game configs override.
 */
export const DEFAULT_RULE_CONFIG: RuleConfig = {
  maxPhaseDuration: { p: 0, ...MAX_PHASE_DURATION },
};
