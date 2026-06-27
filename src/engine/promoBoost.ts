// promotion-grants-boost — the interface ACCEPTANCE TEST (plan Stage 4).
//
// A mechanic that INTERCEPTS a core rule (promotion) rather than adding an action:
// when a pawn promotes, the new piece is automatically granted its fairy form for the
// standing buff — a promoted queen arrives as an Amazon, etc. It needs NO kernel edits
// beyond the one promotion seam (Mechanic.onPromotion, folded in applyMove), and it
// carries no state of its own — it composes with the boost mechanic through the shared
// `boosts` field. That a second mechanic can hook a core rule and cooperate with a
// first, with only that seam added, is the proof the architecture extends cleanly.
//
// Composition: promoBoost grants boosts; the boost mechanic renders them as fairy
// moves/attacks. So promoBoost is meant to run WITH boost active (e.g. mechanics
// ["phasing","boost","promoBoost"]); on its own it would record boosts that nothing
// reads.

import { registerMechanic, type Mechanic } from "./mechanic.js";
import type { FairyBase } from "./types.js";

/** A promotion grants this many turns of fairy buff (matches the boost mechanic). */
const BUFF_TURNS = 3;

export const promoBoostMechanic: Mechanic = {
  id: "promoBoost",

  onPromotion(state, square, promoted) {
    // `promoted` is always n/b/r/q here (never a pawn or king), i.e. a valid FairyBase.
    const piece = state.board[square];
    if (!piece) return;
    const expiresOn = state.turnsTaken[piece.color] + 1 + BUFF_TURNS;
    (state.boosts ??= []).push({
      color: piece.color,
      square,
      base: promoted as FairyBase,
      expiresOn,
    });
  },
};

registerMechanic(promoBoostMechanic);
