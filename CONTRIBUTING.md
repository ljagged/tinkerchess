# Contributing to TinkerChess

Thanks for your interest! TinkerChess is a fog-of-war chess variant built to be a
real, polished, open-source product. This guide covers setup and the conventions
that keep the codebase coherent.

## Setup

Requires **Node ≥ 22** (the repo pins it via `.nvmrc`).

```sh
nvm use
npm install
npx convex dev    # terminal 1 — keep running; deploys schema + functions on save
npm run dev       # terminal 2 — Next.js on http://localhost:3000 (or 3001 if busy)
```

First run of `npx convex dev` will prompt you to log in / select a project and
provision your own dev deployment.

> **Deploy note:** keep `npx convex dev` running. It pushes schema and function
> changes to your deployment. `npx convex codegen` only regenerates `_generated`
> types — it does **not** deploy — so backend changes won't take effect under
> codegen alone. (This is the #1 "why isn't my change working" gotcha.)

## Checks (run before a PR)

```sh
npm test          # engine unit tests + Convex functional tests (Vitest)
npm run typecheck # root + convex/ TypeScript
npm run build     # production build
```

All three must pass. New behavior needs tests — we err on the side of too many.

## Versioning

The version (in `package.json`, shown in the corner of the running app) follows
**semantic versioning**, bumped by a **test-informed** rule — the kind of test a
change adds or touches decides the bump:

| Change | Bump | In this repo |
|---|---|---|
| Add/extend a **unit** test (a fix or internal change) | **patch** | `src/engine/*.test.ts` |
| Add a **new functional / acceptance** test (new user-visible behavior) | **minor** | a new test in `convex/*.test.ts` |
| **Modify** an existing functional / acceptance test (changed behavior) | **major** | an edited test in `convex/*.test.ts` |

Unit tests are the pure engine rules (`src/engine/`); functional/acceptance tests
drive the real Convex functions end-to-end (`convex/games.test.ts`).

**Pre-release rule.** We are pre-1.0 and stay there until the milestones in
[`ROADMAP.md`](./ROADMAP.md) are done — **1.0 is the milestone release, not a
routine bump**. Until then the leading `0` is frozen, so a major-tier change (a
modified acceptance test) advances the **minor** digit, same as a minor-tier
change. In practice, pre-1.0:

- unit-test change → bump the patch (`0.x.PATCH`)
- new **or** modified acceptance test → bump the minor (`0.MINOR.0`)

Bump `package.json` `version` in the same PR as the change. Post-1.0, the three
tiers map to major / minor / patch directly.

## Architecture & hard rules

```
src/engine/   pure rules engine: GameState -> data | GameState. No I/O, no
              randomness, no hidden mutation. The single source of truth for rules.
convex/       thin backend: seat identity, persistence, the fog-of-war boundary.
              Delegates ALL rules to the engine.
app/          Next.js (App Router) frontend. Renders only the filtered view it's given.
```

1. **The engine is the single source of rules.** Keep it pure and deterministic
   (no `Date.now`/`Math.random`); add or change rules here, with tests. Determinism
   is what makes replay and the match archive work.
2. **The server is authoritative; never bundle the engine into the client.** The
   client renders only `getGameView`'s filtered output. The fog-of-war boundary
   (`getGameView` / `viewFor`) must never leak an opponent's hidden state beyond the
   one-turn square warning. There is a property-based privacy test — keep it green.
3. **All UI follows `DESIGN.md`.** Read it before any visual change. **Never encode a
   game state with color alone** — every state needs a shape/border/motion cue plus a
   label (the primary player is colorblind). Flag any code that violates this.
4. **Persisted shapes are validated.** Convex validators in `convex/schema.ts` are
   strict — any new `GameState`/event field must be added there or inserts fail.
5. **Style:** explicit over clever, smallest diff that cleanly expresses the change,
   match the surrounding code's conventions.

## Roadmap (where this is heading)

The differentiator is a **mod system**: uploadable rule modules layered on the
standard 8×8 board (no bigger boards, no new pieces). The engine is being built
"mod-ready" — config-driven rules now (see Tier-1 settings), a declarative rule layer
next, then a chess-domain DSL harvested from real mods. Keep new rule logic small,
parameterized, and data-driven so it can move into that layer later.

See [`ROADMAP.md`](./ROADMAP.md) for the full three-tier plan and the M1/M2/M3
milestones.

## Reporting issues

Open an issue with steps to reproduce. For anything visual, a screenshot helps a lot.
