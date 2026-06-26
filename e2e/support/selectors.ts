// SINGLE source of truth for DOM selectors. Per the project rule, tests select and
// assert on stable hooks (ids / classes / data-* machine values), NEVER on UI copy.
// `main.game` carries the always-on machine-value attributes (data-turn,
// data-game-status, data-end-reason); pieces expose their piece code via `alt`.
export const SEL = {
  /** Top-level element holding data-turn / data-game-status / data-end-reason. */
  game: "main.game",
  /** A board square by algebraic coordinate, e.g. square("e4"). react-chessboard
   *  renders one [data-square] per square (64 total) and it's page-unique — the
   *  `id` prop is NOT a real DOM id, so don't scope under it. */
  square: (sq: string) => `[data-square="${sq}"]`,
  /** A piece image by its machine piece-code alt, e.g. piece("wP"), piece("bQ"). */
  piece: (code: string) => `img[alt="${code}"]`,
  /** In-board Resign button. */
  resignBtn: ".resign-btn",
  /** Resign confirmation dialog + its destructive confirm button. */
  resignConfirm: '[role="alertdialog"][aria-label="Confirm resignation"]',
  dangerBtn: "button.danger",
} as const;
