# Variant findings & open balance questions

Running notes on the boost variant's balance, to revisit when tuning parameters. These
are *findings to act on later*, not decisions — the engine ships them as-is for now.

## Boost

### F1 — The bishop boost confers a PERMANENT effect; the others are temporary
The Dragon Horse (boosted bishop) gains a wazir step (one orthogonal square). An
orthogonal step lands on the opposite color, so a single wazir move **permanently
converts a light-squared bishop into a dark-squared one** (and vice-versa): the buff
expires after 3 turns, but the bishop is then a normal bishop *on its new color
complex*, for the rest of the game. The other four upgrades (knight-ferz, Dragon King,
Amazon, 2-step king) grant only temporary repositioning — nothing structural survives
expiry, because those pieces aren't colorbound.

Implication: the bishop boost is in a different valuation class — one pawn buys a
permanent color-complex swap (e.g. rescue a "bad bishop"). It is plausibly underpriced.
A candidate tune (per the external review) is raising its cost 1 → 2.

### F2 — `boostEval` under-prices the bishop boost (consequence of F1)
`src/bot/boostEval.ts` credits each active boost a flat fairy bonus **only while the
boost is in `state.boosts`** — the bonus vanishes on expiry. For the four temporary
upgrades that's correct, but for the bishop it misses the PERMANENT color-flip value
(F1): once the buff expires the eval sees a plain bishop and credits nothing, even if it
has relocated to a decisive color complex. To model F1, add a small lasting
color-complex / bishop-pair term that survives expiry when a Dragon Horse's wazir step
changed its color. (Deferred — would shift the determinism baseline for boost games.)

### F3 — One-shot mates are blunder-punishers, not forced (weak-bot, 1-ply)
`boost-oneshot.ts` (avoidability test): across ~7.5k random-play positions/seed,
~98–100% of immediate-boost mates-in-0 were AVOIDABLE on the opponent's preceding move;
only ~1–2% were 1-ply-forced, and forced + boost-created + materially-even was ~0. So at
this depth/sample, boost reads as a blunder-punisher. LIMITS: 1-ply forcedness (not
perfect-play-from-opening); random-sample positions; weak detection (mate-in-0 only).

## External review (Gemini) — claims worth testing, not yet adjudicated
- **Amazon (queen→Amazon for a rook) is the strongest upgrade.** Agreed in spirit; the
  eval already prices it highest (+250cp). Whether 3 turns converts is unproven.
- **"Turn-3 Amazon" gives White a near-forced win (amplifies the first-move edge).**
  The headline claim. Hand-waved (no forced line; the d1 queen starts buried) and in
  tension with F3. First measurement below (F4) does not support it.

### F4 — First bias baseline: no significant White amplification (and underpowered)
`boost-bias.ts`, 60 shared openings, depth 2, seed 1:

| ruleset | W | B | draws | White score% |
|---|---|---|---|---|
| baseline `["phasing"]` | 6 | 15 | 39 | 42.5% |
| boost `["phasing","boost"]` | 9 | 10 | 41 | 49.2% |

Delta = **+6.7 pts**. Read honestly: **inconclusive, leaning against FM1.**
- The delta is **within noise** — only ~20 decisive games per side (≈⅔ draws), so the
  error bar on each win-rate is ~±10 pts; +6.7 is ~1σ.
- The baseline shows White at **42.5% (Black-favored)** — the depth-2 engine can't even
  reproduce the classical first-move edge, so it is **underpowered to test FM1**. Can't
  confirm or refute amplification with a bot too weak to show the baseline bias.
- Boost did **not** produce a White-win surge; draw rate was equal-to-higher (41 vs 39),
  the opposite of an "Amazon blitzkrieg," and consistent with F3 (attrition → draws).

To firm up: stronger play (depth ≥3, much slower) and/or many more games + multiple
seeds. This is the baseline harness + first read, per plan — not a verdict.
- **Immediate boosts cause cognitive overload for humans.** A real UX concern (non-local
  move possibilities), independent of engine balance. Tunable: raise the immediate
  premium (currently +2) or restrict same-turn checks/captures.
