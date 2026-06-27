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
 *  Amazon (queen+knight) dwarfs the others; the 2-step king is mostly mobility.
 *
 *  KNOWN GAP (experiments/FINDINGS.md F1/F2): the bishop bonus is credited only while
 *  the buff is live, but a Dragon Horse's wazir step can PERMANENTLY flip the bishop's
 *  color complex — value that outlives expiry and is not modelled here. The bishop term
 *  therefore under-prices the boost; revisit when tuning balance. */
const FAIRY_BONUS: Record<FairyBase, number> = { n: 50, b: 80, r: 90, q: 250, k: 20 };

const sign = (c: Color): number => (c === "w" ? 1 : -1);

const boostEvalTerm: MechanicEvalTerm = (state) => {
  if (!state.boosts || state.boosts.length === 0) return 0;
  let score = 0;
  for (const b of state.boosts) score += sign(b.color) * FAIRY_BONUS[b.base];
  return score;
};

registerMechanicEval("boost", boostEvalTerm);
