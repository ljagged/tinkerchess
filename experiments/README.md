# Phasing experiments

Research tooling (not part of the app/CI) for quantifying how much the phasing
mechanic matters in TinkerChess, across three lenses. Reuses the pure engine + bot;
the only library change is the additive, default-off `phaseBias` eval knob.

Run with `tsx` (already a devDependency). All knobs are env vars.

## A — Game Refinement (`npm run experiment:gr`)
Measures `GR = √B / D` (Iida, Takeshita & Yoshimura 2003) from bot self-play, under
three branching definitions and across configs (classical / TC default / TC with
`phaseBias`). The `classical` row is a methodology check.

- `N` games per config (default 40), `DEPTH` bot ply depth (2), `OPENING` random
  opening plies (4).
- **Caveat:** this is a *relative* instrument. Weak self-play yields longer,
  lower-branching games than master records, so the absolute classical GR reads below
  the canonical ~0.074 — read the TC rows relative to the classical row, not the
  literature.

## B — Endgame power probe (`npm run experiment:endgame`)
Full-width win/draw/loss solver (alpha-beta, optimal defense, mate = win, horizon =
draw) over curated material configs, classical vs phasing. A `DRAW→WIN` flip means
phasing forces a mate classical can't (within the horizon).

- `DEPTH` plies (default 7). KQ-v-K is a positive control (must find the classical
  mate). **Limit:** proves "mate within DEPTH plies", NOT general winnability — drawn
  positions have no alpha-beta cutoffs, so depth is bounded. A true answer needs a
  TC-aware retrograde tablebase (out of scope).

## C — Stockfish match + timing (`npm run experiment:stockfish`)
TC bot (phase variant) vs Stockfish (classical) on the same board via FEN-per-turn
(Stockfish never sees phasing; phased TC pieces are simply absent from the FEN).
Reports W/D/L from TC's view and **per-game wall-clock median, σ, and games/hour**.

- `N` games/condition (20), `TC_DEPTH` (3), `SF_SKILL` 0–20 (2 — handicap toward
  parity), `SF_DEPTH` (6) or `SF_MOVETIME` ms, `BIAS` the phase-biased condition's
  `phaseBias` (600). Two conditions run: baseline (bias 0) and phase-biased.
- King-phasing is disabled in the match config so every FEN has both kings.
- Stockfish moves are re-validated against TC's `legalMoves` (the ring rule can
  forbid a classically-legal move); MultiPV provides the legal fallback.

Outputs also write to `experiments/out/` (gitignored).
