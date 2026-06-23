# TODOS — Phase Chess

Deferred work, with enough context to pick up cold. Distilled from the M1 design
review (2026-06-22). The durable product/engine roadmap lives in [`ROADMAP.md`](./ROADMAP.md).

Effort scale: human-team estimate → with CC+gstack (S→S, M→S, L→M, XL→L).

---

## P2 — Local pass-and-play (single-device) mode

- **What:** Let two players share one device/tablet — play without two screens or two
  online clients.
- **Why:** The real audience is two kids who are often in the same room with one tablet.
  Removes the "both must be online on separate devices" barrier.
- **Cons / why deferred:** Fog-of-war assumes separate screens. Pass-and-play needs a
  "hide the board, pass the device" handoff flow so the next player doesn't see the
  prior player's hidden phase state. It pokes directly at the core privacy model
  (`getGameView`) and deserves its own design pass, not a bolt-on during M1.
- **Context / where to start:** Add a local game mode that runs both seats on one
  client, gated by an interstitial "pass to <player>" screen that blanks the board
  between turns. Decide whether the engine still runs server-side (recommended, keeps
  one code path) or locally for offline play.
- **Effort:** M (human ~3 days → CC ~1–2 hr) · **Priority:** P2
- **Depends on:** M1 fog/`ScopedView` model finalized.

## P3 — Emoji / one-tap reactions alongside chat

- **What:** Quick one-tap emoji reactions in-game, in addition to text chat.
- **Why:** Kids may not type fast; reactions keep the game social and lighthearted.
- **Cons / why deferred:** Nice-to-have, not load-bearing for M1. Text chat (players-only)
  already ships in M1.
- **Context / where to start:** Reactions are a small per-game event stream over the same
  Convex subscription channel as chat; render as ephemeral overlays.
- **Effort:** S (human ~half day → CC ~20 min) · **Priority:** P3
- **Depends on:** M1 chat channel.

---

## Roadmap (not TODOs — see ROADMAP.md)

The mod system (Tier-1 settings, Tier-2 predicate DSL, Tier-3 scripted mods, the chess
DSL) is the M2/M3 roadmap, not loose TODO items. See [`ROADMAP.md`](./ROADMAP.md) —
specifically "Authoring power partition (three tiers)" and "Milestones".
