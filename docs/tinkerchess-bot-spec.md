# TinkerChess Robo-Player — Engine Specification (v1)

**Status:** Draft for review and implementation
**Audience:** Claude Code (implementer + reviewer), working in the `tinkerchess` repo
**Scope:** A deterministic AI opponent strong enough to beat good amateur humans. Not superhuman.
**Authority:** `docs/RULES.md` is the normative rules source. `CONTRIBUTING.md` defines the architectural hard rules. This spec governs *bot* behavior only; it must not change engine rules. Where this spec contradicts `RULES.md` or `CONTRIBUTING.md`, those win and this spec is the bug.

This version is written against the actual codebase (`src/engine/*.ts`), not an abstract interface. File and symbol references are real.

---

## 0. Context the implementer must internalize first

The engine already exists and is mature: a **pure, headless, deterministic reducer** in `src/engine/`, consumed by both the Convex backend and (via filtered views) the frontend. Read these before writing code:

- `src/engine/types.ts` — `GameState`, `Action`, `Move`, `PhaseOut`, `PhasedPiece`, `RuleConfig`, `GameEvent`.
- `src/engine/index.ts` — the public surface. The bot imports **only** from here.
- `src/engine/game.ts` — `applyAction`, `applyActionWithEvents`, `legalMoves`, `viewFor`, the `adjudicate` logic, `GameView`.
- `src/engine/phase.ts` — `validatePhaseOut`, `applyPhaseOut`, `kingSafe`, `warningSquaresFor`, `ownPhased`, `maxDuration`, `isPhaseable`.
- `src/engine/moves.ts`, `attacks.ts`, `board.ts` — move/attack mechanics and geometry (`SquareIndex` is `0..63`, `index = rank*8 + file`).
- `docs/reference-engine-api.md` — the API reference for all the above.
- `CONTRIBUTING.md` §"Architecture & hard rules" and `ROADMAP.md` — the SSOT rule, the privacy boundary, and the mod-system trajectory the bot must not break.

**Three hard rules from `CONTRIBUTING.md` that bind this work:**

1. **The engine is the single source of rules.** The bot does **not** reimplement move generation, legality, check detection, or adjudication. It calls the engine. If the bot needs a rules-level capability the engine doesn't expose, that capability is added to the engine *with tests* (see §3, the one real gap), not duplicated in the bot.
2. **The engine is pure and deterministic** — no `Date.now`, no `Math.random`. The bot must preserve this in any code that lives in or is called by the engine. The bot's *search* may use a clock for time budgeting, but that lives in the bot module, never in `src/engine/`.
3. **Never bundle the engine into the client; the server is authoritative.** The bot is a server-side actor (it runs in Convex or a server context), and it must consume the same fog-filtered view a human player gets if it is to be "honest" (see §2). Do not give the bot a code path that reads hidden state the corresponding human seat couldn't see — unless you deliberately choose the "cheating" model in §2 and document it.

**Where the bot lives:** a new module, **`src/bot/`**, importing the engine from `../engine/index.js`. It must not be added under `src/engine/` (that directory is pure rules only). Mirror the engine's ESM `.js`-extension import convention.

---

## 1. What the engine already gives you (do not rebuild)

Confirmed by reading the source. The spec's job is to *use* these, not re-create them.

| Need | Already provided | Notes |
|---|---|---|
| Legal **moves** for side to move | `legalMoves(state)` / `legalMovesFrom(state, sq)` | King-safe, no king-capture, ring-aware. **Excludes phase-outs by design.** |
| Apply an action + get result | `applyAction(state, action)` / `applyActionWithEvents` | Resolves end-of-turn returns and adjudicates. Throws `IllegalActionError`. |
| Adjudication (mate/stalemate/repetition) | `adjudicate` inside `applyAction` → sets `state.status`, `state.endReason` | **The §7.2 corner is already correct** (see §4.1). |
| Check test (standard + ringed) | `kingSafe(state, color)` | Unified predicate; ring ownership handled. |
| Phase-out **validation** | `validatePhaseOut(state, phaseOut)` → `{ ok, reason? }` | Pure. Enforces eligibility, duration cap, no-phase-in-check, S7 self-exposure. |
| Phase-out **application** | `applyPhaseOut(state, phaseOut)` | Mechanics only; `game.ts` orchestrates the turn. |
| Fog-filtered view | `viewFor(state, viewer)` → `GameView` | Carries `warningSquares` (square-only rings), `yourPhased` (own timers), `inCheck`. **Never leaks enemy timers.** |
| Phase caps from ruleset | `maxDuration(type, config)` / `isPhaseable(type, config)` | **Read these; never hardcode `n:2,b:2,r:3,q:4,k:1`.** The mod system (ROADMAP Tier-1) makes caps per-game. |
| Repetition key | `positionKey(state)` | Visible board + turn + castling + en-passant; **phase timers excluded** (matches `RULES.md` §7.4). |

The single-source-of-truth concern from a generic spec is **already solved architecturally** — there is exactly one rules implementation and it's `src/engine/`. The bot's correctness requirement reduces to: *only ever reach legal positions by calling `applyAction`, and only ever consider actions the engine would accept.*

---

## 2. The information model — the central design decision

This is the crux, and it's forced by the engine's shape. The engine operates on full `GameState` (which contains `state.phased` — every phased piece, both colors, with true `returnOn` timers). The fog lives **only** in the `viewFor` projection: a `GameView` has `warningSquares` (enemy returns due *next* turn, square only) and `yourPhased` (the viewer's own timers), but **no enemy timers and no enemy phased-piece identities**.

So there are exactly two models for the bot, and you (Alex) chose **honest** in the handoff. Both are documented; build the honest one.

### 2.1 Honest bot (CHOSEN for v1)

The bot may only use information a human in its seat would have: the `GameView` from `viewFor(state, botColor)`. It does **not** read `state.phased` for enemy pieces.

**The problem this creates:** the engine's search primitives (`legalMoves`, `applyAction`) operate on `GameState`, not `GameView`. To search, the bot must reconstruct a *plausible* full `GameState` from its `GameView` — and that requires inventing the enemy's hidden phased pieces and timers, because the view doesn't contain them. The bot literally cannot know them; it must assume.

**The reconstruction (`gameStateFromView`):**

- In-play board, turn, castling, en-passant, the bot's own phased pieces (from `yourPhased`): all **known exactly**, copy straight in.
- Enemy phased pieces: **partially known.** The bot knows an enemy piece phased out only by having observed it leave (the piece vanished from a visible square on a past turn). The honest bot must therefore track, across the game, **which enemy pieces it saw phase out and from where** — this is exactly the information a human retains, and reconstructing it is the bot's analogue of human board-tracking. Maintain a running `observedEnemyPhaseOuts` list (origin square + piece type + the turn it left) updated each turn from the move log / view deltas.
- For each observed-but-not-yet-returned enemy phased piece, the bot knows its origin and type but **not** its `returnOn`. Assign an **assumed timer** (§2.3). A `warningSquares` entry collapses the assumption to certainty: a ring means that piece returns at the end of the enemy's next turn, so set its `returnOn` accordingly.

The reconstructed `GameState` is then a legal input to `legalMoves` / `applyAction`, and search proceeds normally over it. **Re-run reconstruction + search every turn**; never carry an assumed state across turns (the ring will correct it before anything irreversible — `RULES.md` §4.3).

> **Honesty boundary (test this):** `gameStateFromView` must be derivable purely from `viewFor(state, botColor)` plus the bot's own observation history. It must **never** read `state.phased` entries for the enemy. Add a test that constructs a state with a hidden enemy phased piece the bot never saw leave (e.g. injected directly) and asserts the bot's reconstruction does not contain it. This is the bot-side analogue of the engine's property-based privacy test, and it's what makes "honest" mean something.

### 2.2 Cheating bot (NOT chosen; documented for contrast)

The bot reads full `GameState` including enemy `state.phased`. Simpler — no reconstruction, no assumed timers, search is exact. But it plays a *different, easier game* than a human: it never forgets or mis-times an enemy return. Rejected for v1 because it's both less fair and less interesting, and because the honest model is what surfaces the game's signature dynamic (see §9). If a v1 schedule slips, the cheating bot is a legitimate fallback that gets *a* working opponent shipped — flag it as an explicit downgrade if you take it.

### 2.3 Assumed-timer policy (honest bot only)

Isolated in one function `assumeEnemyTimer(piece, context) -> returnOn`, so it's the single tuning point. When the bot must assume a timer for an observed enemy phased piece whose return is not yet ringed:

- **Offensive-looking phase-out** (since the piece left, the enemy moved a piece through the line the vacated origin had blocked, or made a capture/check enabled by it): assume **minimum duration (d = 1)**. Rationale (established in design discussion): a player phasing to open an attacking line wants the piece back fast; long durations dilute their own offense, so short durations dominate that use and are inferable from the opponent's incentives.
- **Quiet/defensive phase-out** (no such follow-up): assume the **midpoint** of the type's range under the *current ruleset*, rounded up — compute from `maxDuration(type, config)`, do **not** hardcode. Rationale: a quiet phase-out leaks no timing through incentives, so a neutral midpoint is the least-bad point estimate, and the ring caps the error at one turn anyway.

> **Acceptable v1 simplification:** if the "offensive-looking" detection is expensive, ship "always assume midpoint" with a `TODO`. Cost is mild strength loss, not incorrectness — the ring still prevents surprise.

---

## 3. The one real engine gap: `legalPhaseOuts`

`legalMoves(state)` deliberately returns **only moves** (correct — phase-outs must not count for mate/stalemate). The bot needs the full action space: moves **plus** legal phase-outs. There is no existing function that enumerates legal phase-outs. **This is the only rules-adjacent code to add, and it goes in the engine, not the bot** (it's a rules query; keep it next to `validatePhaseOut`).

Add to `src/engine/phase.ts` and export from `index.ts`:

```ts
/**
 * All legal phase-out actions for the side to move: every (eligible piece × legal
 * duration 1..maxDuration) that passes validatePhaseOut. Built ON TOP of the
 * existing validator — no new legality logic. Returns [] if the game is over.
 * NOTE: like legalMovesFrom this is a rules query, not an adjudication input —
 * phase-outs still never count toward "has a legal move" for mate/stalemate.
 */
export function legalPhaseOuts(state: GameState): PhaseOut[] {
  if (state.status !== "active") return [];
  const config = state.config ?? DEFAULT_RULE_CONFIG;
  const out: PhaseOut[] = [];
  for (let from = 0; from < 64; from++) {
    const p = pieceAt(state.board, from);
    if (!p || p.color !== state.turn) continue;
    const max = maxDuration(p.type, config);
    for (let d = 1; d <= max; d++) {
      if (validatePhaseOut(state, { from, duration: d }).ok) out.push({ from, duration: d });
    }
  }
  return out;
}
```

The bot's full candidate-action list for a position is then:

```ts
const actions: Action[] = [
  ...legalMoves(state).map((move) => ({ kind: "move", move } as const)),
  ...legalPhaseOuts(state).map((phaseOut) => ({ kind: "phaseOut", phaseOut } as const)),
];
```

This addition needs its own engine unit tests (§7), since it's new engine surface: in particular that it returns `[]` while in check (every phase-out fails `validatePhaseOut`'s no-phase-in-check gate — `RULES.md` §8.3), and that it omits an absolutely-pinned piece but includes a relatively-pinned one (§4.4).

---

## 4. Rules corners the bot relies on (verify, then lock with tests)

These are already implemented in the engine (confirmed by source read). The bot **depends** on each. Do not reimplement — write a bot-side or engine-side test that pins the behavior so a future engine change can't silently break the bot.

### 4.1 Phase-out is not a move for mate/stalemate (`RULES.md` §7.2) — already correct

`adjudicate` in `game.ts` computes `hasMove = legalMoves(state).length > 0` — **moves only**. A side in check whose only legal action is a phase-out is checkmated; not in check, stalemated. This is the highest-risk corner in the variant and **the engine already gets it right** (and `src/engine/checkmate.test.ts` exists). The bot inherits it for free *as long as the bot scores terminal nodes via the engine's `status`/`endReason`*, not via its own "any action available?" check. **Do not** let the bot treat "I still have a phase-out" as "not stalemated."

### 4.2 Ringed check is check; flight-only (`RULES.md` §5.1b, §6.3)

Handled by `kingSafe` (combines `isAttacked` with `warningSquaresFor`) and falls out of `legalMovesFrom` (any non-king move leaving the king on a ringed square fails `kingSafe`). The bot gets correct ringed-check responses automatically from `legalMoves`. Search must score a ringed mate as a normal mate.

### 4.3 Own ring is not a check (`RULES.md` §5.2)

`kingSafe` only counts the enemy ring (`warningSquaresFor` filters by `p.color !== viewer`). The bot must not treat its own pending returns as threats to its own king. Inherited from the engine — just don't add a bot heuristic that re-introduces the error.

### 4.4 Phase-out king-safety: absolute vs relative pin (`RULES.md` §8.2)

`validatePhaseOut` rejects a phase-out only if removing the piece leaves the **king** in check (re-runs `kingSafe` on the post-removal board). A piece pinned to the *king* can't phase; a piece pinned to a *rook* (relative pin) **can** phase — exactly as it could move. `legalPhaseOuts` (§3) inherits this. Lock it with the test in §3.

### 4.5 Return resolution + ordering, occupancy-preservation (`RULES.md` §3.3–§3.5)

`resolvePhaseInsWithEvents` handles the occupancy table (empty / enemy non-king capture / own non-king footgun / own king self-destruct / enemy king unreachable) and earliest-`returnOn`-first ordering. Returns are occupancy-preserving (never expose own king). The bot relies on `applyAction` resolving all this; it never resolves returns itself.

### 4.6 Repetition excludes phased timers (`RULES.md` §7.4)

`positionKey` excludes timers. If the bot maintains a transposition table, **key it on `positionKey` (or an extension that still excludes phased-piece timers)** — never include assumed enemy timers in the TT key, or the table fills with spurious distinct entries. (The bot's *search* carries assumed timers in the `GameState` it searches, but the *TT key* must not.)

---

## 5. Evaluation function

A handcrafted, side-to-move-relative scalar in `src/bot/evaluate.ts`. Standard chess material + piece-square terms, **plus** these TinkerChess-specific terms. One `evaluate(state, color) -> number` with named, individually-tunable weights. (The eval reads the reconstructed `GameState` from §2, so "enemy phased piece" means an *assumed* one.)

### 5.1 Time-indexed material for phased pieces

A phased piece is worth nothing now, full value on return. Value it as `base(type) * discount(turnsRemaining)`, `discount` decreasing in turns-to-return (e.g. `1/(1+k*turns)`), applied to **both** colors' phased pieces (own: exact `turnsRemaining` from `ownPhased`; enemy: from the assumed timer). Never count phased pieces at full static value, and never ignore them.

### 5.2 Threatened phase-eligible piece is not fully "hanging"

A non-pawn piece under attack that is phase-eligible (not absolutely pinned, bot not in check) has an escape valve. Score the threat as roughly `tempo_cost + absence_cost(type)`, **not** full piece value. Otherwise the bot panic-defends pieces it could simply phase, and over-values its own quiet attacks on enemy phase-eligible pieces. Use `isPhaseable(type, config)` and a `validatePhaseOut` probe to decide eligibility — don't approximate it.

### 5.3 Forcing moves win material; quiet attacks are blunted

Corollary of 5.2 and `RULES.md` §8.3 (no phasing while in check): a threat delivered **with check** or with an unanswerable second threat **cannot** be answered by a phase-out, so it actually wins the piece. Weight forcing lines (checks, captures, must-answer threats) as the route to winning heavy material; discount quiet attacks on phase-eligible enemy pieces. This will not emerge from standard-chess eval intuitions — the phase-escape is invisible to conventional threat scoring — so it must be an explicit term.

### 5.4 Ring threats near the enemy king (`RULES.md` §6.6)

A ring is the only way phasing bears on the enemy king. Reward having (or being able to create) a pending return whose origin is on/adjacent to the enemy king's likely squares, scaled up as enemy king flight squares shrink (the "ringed mate" motif). Penalize the bot's own king near an enemy ring. The bot can read enemy-relevant rings against itself from `warningSquares`; for its own offensive rings it knows its own `ownPhased` origins.

### 5.5 Phase-out tempo cost

A phase-out is a non-developing, non-defending turn that also removes the bot's own piece for the duration. Eval and move ordering must treat phase-outs as usually inferior to a developing/threatening move, justified only by concrete payoff (line opened with immediate threat; piece saved from a non-checking attack; ring laid near the enemy king). The bot must not phase speculatively.

---

## 6. Search

**Algorithm:** negamax alpha-beta with iterative deepening, in `src/bot/search.ts`. Deterministic given (reconstructed state, depth/time budget). No `Math.random`.

**Per-move flow:**
1. `view = viewFor(state, botColor)` (or the bot is handed the view directly by Convex).
2. `searchState = gameStateFromView(view, observationHistory)` (§2.1).
3. Enumerate candidate actions = `legalMoves(searchState)` + `legalPhaseOuts(searchState)` (§3).
4. Alpha-beta to the time/depth budget; child nodes via `applyAction(searchState, action)`.
5. Return the best `Action`.

**Components:**
- **Iterative deepening** with a configurable per-move time budget (the budget lives in the bot, not the engine — engine purity).
- **Transposition table** keyed on `positionKey` (§4.6) — **timers excluded from the key**. Store best move + bound + depth.
- **Move ordering** (where alpha-beta earns its strength):
  1. TT best move.
  2. Captures (MVV-LVA), then checks, then other forcing moves.
  3. Quiet moves (history/killer heuristics).
  4. **Phase-outs last**, except a phase-out that opens an immediate check or winning capture next ply is promoted up to the forcing tier. Most phase-outs are bad; search them late so they prune.
- **Quiescence** at leaves over forcing moves (captures, checks, ring-laying that gives ringed check) to kill horizon effects — important here because phase-out-then-ring is a two-ply threat a fixed-depth search misjudges.
- **Terminal scoring via the engine:** after `applyAction`, read `status`/`endReason`. Checkmate = large value offset by ply-to-mate (prefer faster mates, slower losses); stalemate/repetition = draw. This is how the bot inherits the §4.1 corner correctly — **never** score terminality from the bot's own action-availability check.

**Determinism:** identical (state, budget) ⇒ identical chosen `Action`. With a *time* budget, "identical" holds only at equal depth reached; for reproducible tests, expose a fixed-**depth** mode and use it in the test suite (see §7.4). If you'd rather the whole bot be depth-budgeted for simplicity, that's a one-line policy change — flag it and I'll bless it.

---

## 7. Testing

Build and test in order: **`legalPhaseOuts` (engine) → reconstruction/honesty (bot) → eval (bot) → search (bot).** Repo convention (`CONTRIBUTING.md`): engine unit tests in `src/engine/*.test.ts`, functional tests in `convex/*.test.ts`; Vitest; `npm test` must pass. Put bot tests in `src/bot/*.test.ts`.

### 7.1 `legalPhaseOuts` engine tests (`src/engine/phase.test.ts`)
- Standard start: returns the expected count (each non-pawn with a clear/eligible state × its duration range under default config).
- **In check ⇒ returns `[]`** (every phase-out fails the no-phase-in-check gate, `RULES.md` §8.3).
- **Absolute pin excluded, relative pin included** (§4.4): bishop pinned to own king → its phase-outs absent; bishop pinned to own rook → present.
- Respects a non-default `RuleConfig` (e.g. a ruleset with `q:0` emits no queen phase-outs; one with `r:2` caps rook durations at 2) — proves no hardcoded caps.

### 7.2 Honesty / reconstruction tests (`src/bot/view.test.ts`) — the integrity gate
- `gameStateFromView` round-trips all **known** fields (board, turn, castling, ep, own phased) exactly.
- **Never invents enemy state it didn't observe:** inject a hidden enemy phased piece the bot never saw leave; assert the reconstruction omits it. (Bot-side analogue of the engine's privacy test.)
- A `warningSquares` entry pins the corresponding assumed timer to "returns next enemy turn."
- `assumeEnemyTimer` returns d=1 for an offensive-looking phase-out and the config-derived midpoint for a quiet one; uses `maxDuration`, not constants.

### 7.3 Eval tests (`src/bot/evaluate.test.ts`)
- Queen phased for a long duration evaluates below the same position with her in play, above the same position with her captured (5.1).
- Queen attacked by a **non-checking** move evaluates far better than a hung queen (she can phase, 5.2); queen attacked **with check** evaluates as nearly lost (she can't phase, 5.3).
- Ring adjacent to enemy king scores as offense; own king adjacent to enemy ring scores as danger (5.4).

### 7.4 Search tests (`src/bot/search.test.ts`)
- Mate-in-1 and mate-in-2 suites, including at least one **ringed** mate-in-1 (drive-and-ring) and several standard mates — confirms terminal scoring and the §4.1 corner interact correctly via engine `status`.
- Does **not** hang a phase-eligible piece to a quiet attack (sees the phase-escape); **does** lose it when attacked with check.
- In a quiet position with no concrete payoff, the chosen action is a move, not a phase-out (5.5).
- **Determinism:** same position + same fixed depth ⇒ same `Action`, every run.

### 7.5 Regression hook
Re-run the existing engine suites (`checkmate.test.ts`, `privacy.test.ts`, `reveal.test.ts`, etc.) unchanged — the only engine edit is the additive `legalPhaseOuts`, which must not perturb them. `npm test`, `npm run typecheck`, `npm run build` all green before PR (`CONTRIBUTING.md`).

---

## 8. Integration & non-goals

### 8.1 Wiring (separate PR from the engine logic)
The bot is a server-side actor. A natural shape: a Convex action/mutation that, when it's the bot's turn in a bot game, calls `chooseAction(view, history)` and submits the result through the **same** path a human move takes (so all server-side validation and the fog boundary apply identically). Do not let the bot bypass the normal `applyAction` server path. Keep this wiring in its own PR after the `src/bot/` logic lands and is tested in isolation.

### 8.2 Versioning (`CONTRIBUTING.md`)
New functionality → minor bump (`0.MINOR.0`) with an acceptance test (likely `convex/*.test.ts` for the integration). The additive `legalPhaseOuts` + bot module is new functionality. Bump `package.json` in the same PR.

### 8.3 Non-goals for v1
- **IS-MCTS / determinization / expectimax** over enemy timers — replaced by the honest-reconstruction + modal-assumption + re-plan-on-ring approach (§2). Revisit only if play-testing shows the bot is exploitably wrong on quiet enemy phase-outs (§9).
- **Neural eval / self-play training** — no human dataset exists and none is needed for amateur strength. A possible v2 upgrade, bootstrappable from this bot's self-play games later. Note: self-play games will show **none** of the human cognitive dynamic (§9), so they validate tactics/rules only.
- **Opening book / tablebases** — none exist for the variant; out of scope.
- **Difficulty levels / handicapping** — v1 is one strength (§9 records the natural knob for later).

---

## 9. Known limitations to record (not fix) for v2

1. **The bot is blind to the game's signature human mechanic.** "Out of sight, out of mind" — a human dropping a phased piece from their mental board — is a human attention failure. Even the *honest* bot tracks every enemy piece it observed leaving and reasons about it perfectly; it never forgets. Consequences:
   - **Bot-vs-bot self-play exhibits none of the human cognitive dynamic.** Valid for testing rules/tactics; tells you **nothing** about whether the human game is fun or fair. Do not mistake clean self-play for play-test validation.
   - **Against humans the bot has an unearned edge** (perfect phased-piece memory). May feel inhuman.
2. **Difficulty / human-likeness (v2).** The cleanest knob maps directly to the signature mechanic: have the bot occasionally *corrupt its own `observationHistory`* — "forget" an observed enemy phase-out, or mis-assume a timer — to mimic the human failure and tune strength down. The honest model's `gameStateFromView` + `observationHistory` design (§2.1) is deliberately structured so this can be injected later as a corruption pass, without rearchitecting. Deferred.
3. **Timer-assumption exploitability (§2.3).** A sophisticated adversary could exploit the modal-timer assumption on quiet enemy phase-outs. Accepted for v1 (amateurs won't; the ring caps the downside at one turn). The fix, if ever needed, is the deferred IS-MCTS path over the small hidden-timer space.

---

## 10. Suggested build sequence

1. Add `legalPhaseOuts` to `src/engine/phase.ts`, export from `index.ts`, write §7.1 tests. (Smallest, lowest-risk, and everything else needs it.)
2. Build `src/bot/view.ts`: `gameStateFromView` + `observationHistory` + `assumeEnemyTimer`; write the §7.2 honesty tests **first** — they're the integrity gate that makes "honest" real.
3. `src/bot/evaluate.ts` with named weights; §7.3 tests.
4. `src/bot/search.ts`: negamax + ordering + TT (keyed on `positionKey`) + quiescence; §7.4 tests. Terminal scoring via engine `status`.
5. Tune weights and time budget against human amateurs; record outcomes.
6. Separate PR: Convex wiring (§8.1), routing the bot's chosen action through the normal server move path.

Steps 1–2 carry the real risk (the engine gap and the honesty boundary). Steps 3–4 are standard once the engine surface and the reconstruction are trustworthy.
