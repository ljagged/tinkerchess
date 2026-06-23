# Roadmap — Phase Chess

Phase Chess M1 is a polished, deterministic two-player game. The longer arc is a
**mod system**: layered, uploadable rule modules on the standard 8×8 board. The
engine is built "mod-ready" — config-driven now, declarative rules next, scripted
mods last — with no rewrites along the way.

This is the durable roadmap. For deferred near-term items with pickup context, see
[`TODOS.md`](./TODOS.md). For the visual design system, see [`DESIGN.md`](./DESIGN.md).

## The idea: rule design as play

The differentiator isn't a single fixed variant — it's letting players **invent**
variants and feel out which ones are fun (hypothesize → play → observe → refine).
Most mods will be dead ends, and that's the point: the value is in cheaply trying a
rule and trying it again. Two consequences shape everything below:

- **Rules are knob-shaped.** A rule like "pawns may phase, but only after capturing"
  is one rule with parameters (trigger, window, target), not a bespoke script.
  Authoring favors small, composable, parameterized hooks over monolithic scripts.
- **Rulesets are forkable and versionable.** A refined ruleset (v1 → v2 → v3) is
  saved by forking the prior one, so the *evolution* of a rule is itself an artifact.

**Permanent constraints:** standard 8×8 board, standard pieces. No bigger boards, no
new piece types — mods layer rules onto the classic board, they don't redraw it.

## Authoring power partition (three tiers)

Modding partitions by how much power the author needs:

- **Tier 1 — Settings (parameters, no logic).** Toggles and values over the existing
  ruleset: which men can phase, per-type phase duration, phase visibility. Authored
  via in-game UI. Zero code, zero sandbox — safe by definition.
- **Tier 2 — Predicate DSL (declarative guards).** Small, pure condition snippets that
  gate existing actions, read against a stable man-state model. Examples: a pawn-phase
  precondition `man.hasCaptured`; "a man can't phase onto a square already holding a
  phased piece" → `man.currentPosition.hasPhase == false`. Composable, safe by grammar,
  no imperative effects.
- **Tier 3 — Full mods (imperative hooks; new state/mechanics).** For rules that need
  *new* state or a *new* capability, not just a guard — e.g. "a man may capture a phased
  piece, but only after a power-up earned by capturing ≥3 points of material." Scripted,
  sandboxed (QuickJS-WASM), returning intent-patches the host applies.

Tiers 2 and 3 both read a **stable, capability-scoped man-state model** — the read
surface of the fog-filtered view. Proposed vocabulary, to lock when the seam is built:
`hasMoved`, `hasCaptured`, `position` / `currentPosition`, `isThreatened`,
`currentPosition.hasPhase`, point-value, owner/seat, piece-type.

## Milestones

### M1 — Polished deterministic game (config-first) — ✅ largely complete

Keep the engine a pure reducer; add only the low-risk pieces the rest needs anyway:

- a **Settings accessor** as the single source for phase-eligibility and per-type
  durations (the engine's `MAX_PHASE_DURATION` / `isPhaseable` become its defaults);
- a persisted **derived-event log** (drives the move log, replay, and the match archive);
- a **single canonical fog-filter** that both the render view and any future mod view
  derive from, host-owned.

Run **zero mods**. Ship the polished game on top: board, phasing, fog-of-war, players-only
chat, history + replay, token-based join, Tier-1 settings. *(Tier-1 settings exist in the
engine/backend; the per-piece duration picker is hidden in the UI for now, pending a
fuller settings screen.)*

### M2 — Declarative mods + the fast loop

Tier 1 (Settings UI) + Tier 2 (predicate DSL). Upload and persist rulesets as reusable,
**forkable / versionable** game templates. Write the first handful of real rules
(pawn-phase-after-capture, per-man durations, no-phase-onto-phase) to **discover the
actual man-state vocabulary from real usage** instead of guessing it up front. The
priority is a near-instant tweak-and-replay loop — a knob change must not pay a full
upload/compile cost. This is where the generalized seam (prioritized hook pipeline,
visibility hooks, injected RNG, the mod read-surface) gets built, shaped by the first
real variant.

### M3 — Scripted mods + the chess DSL

Tier 3 (full scripted mods via QuickJS-WASM) for rules predicates can't express. Harvest
a chess-domain DSL from the accumulated Tier-1/2 vocabulary and make it the headline
authoring layer, compiling to the same intent-patch contract. The engine's authority and
determinism stay server-side (Convex) at every tier.

## Deferred / out of scope

- **Local pass-and-play (single-device)** — touches the fog model; needs its own design
  pass. See [`TODOS.md`](./TODOS.md) (P2).
- **Emoji / one-tap reactions** — nice-to-have; text chat covers M1. See `TODOS.md` (P3).
- **Accounts / persistent auth** — token-link identity is enough for now.
- **Bigger board / new pieces** — permanently out (see constraints above).
