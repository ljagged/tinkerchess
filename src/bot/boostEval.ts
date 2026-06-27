// Boost's eval contribution (the bot-side half of the mechanic — eval weights are a
// bot concept, so a mechanic registers its term here keyed by its engine id). A
// standing boost is worth a flat fairy bonus for its remaining life; the fodder it
// cost is already reflected in board material, so this term values only the upgrade.
//
// Registered via registerMechanicEval, so resolveEvalTerms includes it ONLY when
// "boost" is in the active mechanics — classical/phasing eval is untouched (the
// determinism golden stays byte-exact).

import { registerMechanicEval, type MechanicEvalTerm } from "./evaluate.js";
import type { Color, FairyBase } from "../engine/index.js";

/** Centipawn value of each fairy upgrade (the EXTRA power, not the base piece). The
 *  Amazon (queen+knight) dwarfs the others; the 2-step king is mostly mobility. */
const FAIRY_BONUS: Record<FairyBase, number> = { n: 50, b: 80, r: 90, q: 250, k: 20 };

const sign = (c: Color): number => (c === "w" ? 1 : -1);

const boostEvalTerm: MechanicEvalTerm = (state) => {
  if (!state.boosts || state.boosts.length === 0) return 0;
  let score = 0;
  for (const b of state.boosts) score += sign(b.color) * FAIRY_BONUS[b.base];
  return score;
};

registerMechanicEval("boost", boostEvalTerm);
