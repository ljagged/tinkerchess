# Order vs Chaos — Karma Campaign (north-star vision)

> **Status:** brainstorm capture, 2026-06-29. This is the *full vision*, deliberately
> over-scoped — NOT a build spec. It exists so nothing is lost while we winnow to an
> MVP. The proposed MVP cut is §9; everything above it is the long-term north star.

## 1. Concept

A **campaign mode**: two players wage a **war of attrition** across a best-of-N set
(3–5 games). Unlike normal best-of-N chess, the *consequences* of each battle carry
forward — lost pieces stay lost, and a **karma economy** lets players **durably upgrade**
surviving pieces. Each player secretly chooses a **faction — Order or Chaos** — revealed
only through how they play (a new layer of the game's existing fog-of-war identity).

The feel we're chasing (per the Gwent / MTG inspiration): **bait your opponent into
overcommitting in an early battle, then capitalize when they can't refresh.**

## 2. The campaign model (war of attrition)

- Each player owns a **stockpile** larger than one army — e.g. `20♟ / 2♛ / 5♞ / 5♝ / 4♜`
  + an eternal king (~2¼ standard armies). The surplus **buffers** attrition so a single
  bad battle doesn't instantly cripple you.
- **Round 1:** standard 16-piece layout. **Rounds 2..N:** each player **deploys** an army
  from *remaining* stockpile into legal spots; not obligated to field everything.
- **Losses are permanent** (removed from the stockpile). Only the **king escapes** a
  checkmate.
- **Buffs ride the specific surviving pieces** and persist battle-to-battle (a knight that
  earned a one-step-diagonal keeps it next game).
- **Open questions:** deployment/placement rules (how do you field a 2nd queen or extra
  knights given limited home squares? free placement on ranks 1–2? color constraints for
  bishops?); set length; snowball control (§7).

## 3. Karma economy

- Per-player **karma**, earned via the faction's engine, spent on durable buffs and
  one-shot effects.
- **Order engine — Tribute:** karma from *capturing* enemy pieces (no self-inflicted
  material deficit; slower, demands solid play).
- **Chaos engine — Immolation:** karma from *sacrificing* your own pieces (≈ classical
  point value; cheap, fast, high-volume, but bleeds material — pure attrition).
- **Open fork (instant-scalar vs token karma):** if karma banks instantly as a running
  total, "steal the karma from *that* capture" (Karma Theft) is ill-defined. To make
  theft targeted, each capture's karma could sit as a **claimable token** for a window
  before banking. Instant-scalar is simpler; token-karma is richer and ripples through
  the whole ledger. Decide during the winnow.
- **Open:** is "good play" karma (graded by the analysis engine, §existing tooling) in
  scope, or is karma purely *event-based* (capture / sacrifice)? Event-based is simpler
  and already telegraphs faction; analysis-graded is closer to the original "karma for
  good play" idea but couples the economy to a weak evaluator.

## 4. Faction identity & the strategic spine

The factions are a **dyad**, not a grab-bag — the tension falls out of their identities:

- **Chaos = front-loaded.** Spends material for power + destruction. Snowballs if it
  converts fast; bleeds out if stalled. Wants **short games**, high variance.
- **Order = back-loaded.** Capture-fed; invests in defense, teamwork, healing, and
  **growth that compounds across the campaign**. Wants **long games**, low variance.
- **The hinge:** when Chaos *trades*, it feeds Order's capture-karma — so Chaos must
  **kill cleanly, not trade**, while Order **baits Chaos into overextending**. This is the
  Gwent dynamic, and it maps onto the attrition campaign (Chaos depletes its stockpile;
  Order's veterans compound).

**The 2×2 — each faction has a build-engine AND an anti-engine** aimed at the opponent's
economy. The asymmetry *within* the symmetry is in-theme:

| | Build your economy | Attack their economy |
|---|---|---|
| **Order** | Tribute (karma from captures) | **Moratorium** — globally bans Immolation for *n* turns; gains no karma (selfless, broad) |
| **Chaos** | Immolation (karma from sacrifice) | **Karma Theft** — steals one capture's karma; single-target, *profits* (selfish, narrow) |

- **Hidden identity:** the faction choice is one boolean of hidden state per player; the
  **karma engine you use is the tell** (sacrifice vs capture), reinforced by first ability
  use. Fits the fog model for free.

## 5. Ability catalog (tagged by cost)

**Legend:** ✅ reuses a seam we already built · 🟡 new in-turn action (+ a little state;
the add-action seam exists) · 🔶 new rule seam (capture-legality / neighbor-aware aura /
add-piece placement) · ❌ out of scope for now (reactive / temporal — §8).

### Order — defense · structure · teamwork · healing · growth
| Ability | Type | Sketch | Cost |
|---|---|---|---|
| **Tribute** | karma engine | captures → karma; no self-deficit | ✅ event scoring |
| **Veterancy** | passive / durable | a piece that *survives a whole game* gains a small permanent step; compounds across the set (Order's engine AND the campaign's heart) | ✅/🟡 campaign layer + per-piece state |
| **Mend** | one-shot | permanently restore a captured piece to your back rank; karma scales with value | 🟡 add-piece + placement |
| **Moratorium** | one-shot (deny) | globally ban Immolation for *n* turns; cost scales with duration; no karma | 🟡 action + gating flag |
| **Aegis** | durable buff | protection aura: adjacent friendlies only capturable by a *higher-ranked* piece | 🔶 capture-legality |
| **Rally** | durable buff | friendly pieces *adjacent* to this one inherit a movement buff (teamwork aura) | 🔶 neighbor-aware fold |

### Chaos — destruction · individuality · power · aggression
| Ability | Type | Sketch | Cost |
|---|---|---|---|
| **Immolation** | karma engine | sacrifice own pieces → karma ≈ point value | ✅ boost economy |
| **Ascend** | durable buff | fairy-upgrade a piece (Amazon, Dragon Horse…); persists across games | ✅ moveset fold |
| **Explode** | one-shot | a piece self-destructs, taking one chosen adjacent piece | 🟡 |
| **Karma Theft** | one-shot (deny) | on your turn, steal one of Order's captures' karma (single-target, profits) | 🟡 action + ledger (needs token-karma to be targeted) |
| **It's Alive!** | one-shot | resurrect a captured piece as a 3-turn zombie; cheap karma | 🟡 add-piece + expiry timer |
| **Overload** | durable buff | huge power, but the piece is a *loner* — can't be defended / defend others | 🔶 capture-legality |
| **Maelstrom** | one-shot | destroy/push pawns in a small chosen area (no randomness — see §8) | 🟡 |

## 6. Architecture mapping (what's cheap vs net-new)

**Reuses what we already built:**
- Mechanic **registry** (add-action / apply / onTurnEnd seams) — abilities register like boost did.
- Boost **`pieceMovesAndAttacks` fold** — all durable moveset buffs (Ascend, Veterancy steps).
- **Analysis / eval engine** — optional "good-play" karma grading.
- **`matches` archive** — the natural per-pairing series record.
- **Expiry-timer pattern** (phasing / boost) — zombies, Moratorium duration.
- **`schemaVersion`** — append-only catalog growth.

**Net-new infrastructure (the expensive part):**
- **Campaign/series layer** — stockpile state, a **deployment phase between games**,
  permanent attrition. The engine today knows nothing above a single game.
- **Per-player (per-color) mechanics** — today `state.mechanics` is *game-wide*; asymmetric
  factions need mechanics keyed by color.
- **Karma ledger** (+ the instant-scalar vs token fork, §3).
- **New rule seams** — capture-legality (`canBeCaptured`-style) for Aegis / Overload;
  neighbor-aware moveset auras for Rally; add-piece + placement for Mend / It's Alive!.

## 7. Open forks / decisions (resolve during winnow)

- Instant-scalar vs **token karma** (§3).
- **Deployment rules**, stockpile sizing, set length.
- **Snowball control** — does a clean round-1 win let the leader run away across rounds
  2–3? Candidate levers: karma-to-the-loser rubber-band, deployment handicap for the
  leader, or trust attrition to self-correct. This is the "balance mechanism still
  missing" the idea acknowledges.
- Event-based vs **analysis-graded** karma (§3).
- **Fog interaction** — faction is hidden; are buffs / karma totals visible to the opponent?

## 8. Out of scope (for now)

**Reactive / instant-speed / temporal-reversal effects** — Nope! (rewind the opponent's
move + skip their turn), take-backs, counterspells. These break the engine's pure
forward-only reducer, append-only move log, and fog/replay model — a category jump, not
just another action. Explicitly deferred (possibly never).

## 9. Proposed MVP cut

*(Pending approval — see the winnow discussion. The MVP will be the smallest vertical
slice that proves the core loop is fun and balanceable, using only ✅/🟡 seams, with the
🔶 auras and the faction effect-trees deferred to later phases.)*
