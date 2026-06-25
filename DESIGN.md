# Design System — TinkerChess ("Lab Slate")

## Product Context
- **What this is:** A fog-of-war chess variant. Every non-pawn man can phase out (leave
  the board for N turns and reappear on its origin square, removing whatever sits there).
  You see your own phased pieces and timers; the opponent gets only a one-turn,
  square-only warning. Standard chess win condition: checkmate (an enemy return
  ring on a king's square counts as a check).
- **Who it's for:** A generic audience of competitive online chess players — people who
  live on lichess and chess.org. (The builder's niece and nephew, rated players on those
  sites, were the genesis and a representative archetype, not the sole audience.) Then an
  open-source community. Built like a real product. Design for what these players already
  know: efficient, dense, lichess-familiar layouts and conventions.
- **Space/industry:** Online chess platforms. Peers: lichess (clean, fast, open-source),
  chess.com (rich, gamified).
- **Project type:** Real-time web game (Convex + Next.js).
- **The one thing to remember:** "a weird variant that somehow felt *instantly intuitive*."
  Clarity is the north star. Every design decision serves it.

## Core Principle — Clarity by Shape, Not Color
**Never encode a game state with color/hue alone.** Every state is conveyed by
shape, border, position, or motion, plus a text/number label. Color is reinforcement,
never the sole signal. (This is a hard rule: the primary user is colorblind, and the
whole product promise is legibility.)

Corollaries:
- The board reads as real chess at a glance. All hidden-state lives in trays, rings,
  ghosts, and pings — never as ambiguous board clutter.
- Coordinates live in a gutter outside the board, never ghosted inside squares.
- Board squares use a high-luminance-delta pair (blue/cream), never red/green.
- Pieces render at ~85% of the square (SVG piece set), with strong outline + fill so
  white/black differ by outline and shape, not hue.

## Aesthetic Direction
- **Direction:** Clarity-first "observation deck." Board owns the screen; chrome is quiet.
- **Decoration level:** Minimal. Typography + the signature fog color-vocabulary do the work.
  No gradients, no texture, no decorative blobs.
- **Mood:** Calm, precise, a little playful. Hidden information feels cool and sci-fi
  (pieces "phase out of our dimension"), not threatening.
- **Reference inspection:** lichess analysis board (table-stakes benchmark), chess.com
  (friendliness, gamified richness — but avoid its panel density).

## Typography
All open-licensed (correct for an open-source project).
- **Display / logo:** Cabinet Grotesk (Fontshare) — friendly-geometric, distinctive,
  not overused. (Chosen over Clash Display, which is overexposed.)
- **Body / UI:** Hanken Grotesk (Google Fonts) — humanist, highly legible at small sizes
  on tablets, warmer than Inter.
- **Notation / data / clocks / countdowns:** JetBrains Mono (Apache 2.0) — true monospace
  so move lists, timers, and digits align; unambiguous 0/O; renders Unicode chess glyphs.
- **Loading:** Google Fonts for Hanken + JetBrains Mono; Fontshare for Cabinet Grotesk.
  Self-host before public launch to drop the CDN dependency.
- **Scale (px):** display 40–56 / h2 22 / body 16–17 / small 13 / mono-data 13–16.

## Color
Colorblind-safe. Each state color is reserved for exactly ONE meaning and always paired
with a shape cue.

**Board (no red/green; high luminance delta):**
| Token | Light theme | Dark theme |
|---|---|---|
| Light square | `#EDE7D4` (warm cream) | `#C9D2DC` (cool fog-grey) |
| Dark square | `#6E8CA8` (slate blue) | `#3E586E` (deep slate) |

**App chrome:**
| Token | Light | Dark |
|---|---|---|
| Background | `#F4F6F8` | `#181C22` (deep slate, not pure black) |
| Surface / panels | `#FFFFFF` | `#222933` |
| Primary text | `#1B2430` | `#E8EDF2` |
| Muted text / coords | `#6B7682` | `#8A95A1` |

**State vocabulary (color + REQUIRED shape cue):**
| Meaning | Color | Shape cue (required) |
|---|---|---|
| Last move | `#F2C84B` amber | solid border on both squares (not just a wash) |
| Legal move (empty) | `#3DA5A0` teal | a dot (only shown when a piece is selected) |
| Legal capture | `#3DA5A0` teal | a ring/border around the target piece |
| Selected piece | neutral `#D9E2EC` | thick border on the origin square |
| Check / destruction | `#E5484D` red | radial inset + border; destruction = brief flash |
| **Phase / hidden (yours)** | `#27C2D8` electric cyan | dashed box/ring + countdown number badge |
| **Return warning (opponent)** | `#FF8A3D` vivid orange | dashed + pulsing ring, square only, no identity |

Two-word learnable vocabulary: **cyan = hidden/phasing (yours), orange = incoming return
(theirs)**. Dark mode is a first-class default (deep slate, never pure black).

**Clock colors (a reserved-color clarification).** The reserved hues above each mean exactly
one *game-state* thing, so the clock must NOT borrow them for "active": the **active clock is
emphasized with a NEUTRAL cue** (a `--selected` border/bar + a lifted surface + weight), never
cyan or red. The one sanctioned exception is **low time = red** (`--danger`): it's a universal
chess convention the audience expects, it lives in the panel (not on a board square, so it
never collides with a check ring), and it is still paired with a shape cue (bold + tenths). An
active clock that is also low shows the neutral active border AND the red low-time text.

## The Fog UI Patterns (signature)
- **Phase return-queue** — your phased pieces as a compact horizontal queue **under the board
  (bottom-left)**, each a cyan countdown ring + glyph + "turns left" number, **ordered
  soonest-return first** (left-most returns next). Headed by a small cyan ring **icon**, not a
  text label — the cyan vocabulary already says "phased/yours" (recognition over recall; see
  Forms/HCI). Its job is *roster + return-order triage* (how many are out, what returns next),
  which the scattered board ghosts can't give at a glance; the ghost carries *location*.
  **Collapses entirely when you have no phased pieces** (no dead "None." box). This used to be
  a labeled right-panel tray; it moved under the board to keep phased state next to the action
  and free the panel for clocks + moves + chat.
- **Ghost return-square (yours)** — on the square where your phased piece will return, a
  dashed cyan box containing the piece glyph + countdown number. Visible only to you.
- **Warning ping (opponent's)** — on the warned square, a pulsing + dashed orange ring,
  one turn before return, square only, identity concealed. Reserved color; never collides
  with last-move or check.
- **Reappearance moment** — returning piece materializes (scale-up + fade-in + brief ring
  flash, ~250–350ms); if it lands on an occupant, that piece does a quick red shatter/fade
  into the captured tray. One clear cause→effect, then stillness.

**Perspective rule:** the owner sees full detail (ghost + tray + countdown); the opponent
sees only the square pulse one turn out, with identity hidden. Each player's view is the
fog-filtered projection.

## Spacing
- **Base unit:** 8px.
- **Density:** Efficient and lichess-familiar. The audience lives on lichess/chess.org and
  expects dense, fast layouts; do not pad beyond what clarity needs. (Superseded: the earlier
  "roomier than lichess" guidance assumed a kids-on-tablets audience and no longer holds.)
- **Board squares:** 64–80px on tablet; **≥44px tap target anywhere** (dense ≠ tiny — keep
  tap targets honest even as density tightens).
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64). Panel padding 16–24px.

## Forms, controls & pickers (HCI)
Calibrated to the audience above. Named so the reasoning doesn't drift again (a roomy,
over-segmented time-control picker is what prompted this section).

- **Recognition over recall + Jakob's Law.** A self-describing option label (e.g. a `3+2`
  time-control chip) IS the recognition cue — don't add a category header that restates what
  the chip already says. Match patterns the audience knows from lichess/chess.org (a dense
  preset grid, not stacked labeled rows).
- **Gestalt — proximity & common region.** Group by layout (one shared grid/container +
  consistent chip styling), not by redundant text headers; visual similarity already reads as
  "one group."
- **Chunking (Miller).** Don't give a 1–2 item group its own labeled section — the header
  costs more parsing than it saves. Reserve sub-headers for genuinely distinct clusters.
- **Signal-to-noise (Tufte).** Cut non-data ink: redundant labels, oversized gaps, a
  full-width single chip. Raise the ratio of options to chrome.
- **Fitts's Law.** Keep related options close in a compact grid to shorten pointer travel;
  fill the container width instead of left-packing into a sparse column.
- **Hick's Law (caveat).** A handful of options is fine — the cost is usually visual parsing,
  not the count. Fix density and grouping before cutting options.

**Preset-picker pattern:** a compact multi-column grid of equal chips that fills the
container width; selection uses the neutral **Selected** cue (border + subtle fill + weight +
`aria-checked`), **never a reserved state color** (cyan/red/amber/orange/teal each mean one
game-state thing — see Color). Numeric/data chips use JetBrains Mono (`--mono`).

## Layout
- **Approach:** Board-dominant; **a single quiet right-hand panel. Never multiple sidebars.**
  The panel sits **right next to the board** (a left-aligned board+panel block), not flush to
  the screen edge, so the clock/log stays in sight while you look at the board.
- **Past vs present/future split** — the right panel holds the **past** (captured material +
  time + recent moves); the **board + under-board phase queue** hold the **present & future**
  (current position + which pieces return, when). The board itself carries no name/material rows.
- **The right panel (top → bottom):** the lichess pattern — opponent **clock** (top), opponent
  **name + their captured material**, the **move list** (windowed, current highlighted, ending
  in the game-result line on game over), your **name + your captured material**, your **clock**
  (bottom), then **chat** below (right-sized, secondary). The two clocks bracket the move list
  so a player reads both times in one glance; each player's captured material sits by their clock.
- **Clocks are stacked, not flanking the board.** Active side marked by a border/background
  (not by waiting for the digit to tick — see Color). Both visible together.
- **Phase pieces live UNDER the board** as a return queue (not in the panel) — see Fog UI.
- **Coordinates:** rank numbers down the left gutter, file letters along the bottom gutter.
- **Last move:** the from + to squares are highlighted on the board (amber, see Color).
- **Move list:** a short window of recent moves (≈4), current move highlighted, scrollable
  for history. On game over it ends with the standard **result token** (`1-0` / `0-1` / `½-½`)
  plus the cause (checkmate / stalemate / repetition / "out of time" — a clock loss is PGN
  `Termination "Time forfeit"`, which has no inline move glyph). Move-nav (first / prev / next /
  last that rewinds the board) is deferred.
- **Max content width:** board + one panel; let the board scale to viewport.
- **Border radius:** sm 8px, md 14px, full 999px.

## Interaction
- **Tap-to-select-then-tap-to-place is the default** (better for kids/touch; keeps the
  board still). Drag is an optional power-user toggle.
- **Motion is semantic and rare** — reserved for phase events (phase-out, warning ping,
  reappearance). Because motion is rare, movement reliably means "hidden information is
  changing." Everything else is calm.
- **Legal-move dots appear only when a piece is selected.**

## Accessibility
- Colorblind-safe board (blue/cream); every state has a non-color cue (see Core Principle).
- Pieces differ by outline + shape, not hue; offer a high-contrast piece toggle.
- WCAG AA (4.5:1) for text/badges; AAA (7:1) for the notation panel.
- Tap targets ≥44px; tap-to-move so motor precision isn't required.

## Standard chess affordances (table stakes — must have)
JohnPablok Cburnett piece set (flat + drop-shadow variants), last-move highlight, legal-move dots,
coordinate labels, two-column algebraic move list (clickable, current move highlighted),
stacked clocks (active emphasized), captured-piece trays with material count, board +
piece theme pickers, promotion picker, flip-board, game-over banner.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-22 | "Lab Slate" system created | /design-consultation; research vs lichess/chess.com; north star = "instantly intuitive" |
| 2026-06-22 | Clarity-by-shape-not-color is a hard rule | Primary user is colorblind; caught faint-cyan + wash-only highlights failing in review |
| 2026-06-22 | Cabinet Grotesk over Clash Display | Clash Display overexposed; Cabinet Grotesk same feel, distinctive, open |
| 2026-06-22 | Coordinates in gutters; pieces ~85% of square | Colorblind-user review: in-square coords invisible, glyphs dwarfed by squares |
| 2026-06-24 | Audience generalized to competitive lichess/chess.org players | The niece/nephew were the genesis but the product targets people like them; density + conventions calibrate to that audience, not two specific kids |
| 2026-06-24 | Density retargeted: efficient/lichess-familiar (was "roomier than lichess") | The roomy directive was keyed to kids-on-tablets; the real audience expects dense layouts. Added Forms/HCI section + preset-picker pattern after a cluttered time-control picker |
| 2026-06-24 | Gameplay screen → single right panel (lichess pattern): stacked clocks bracket a windowed move list, chat below | Collapsed a two-rail layout that violated "never multiple sidebars"; clocks stacked + active-emphasized (restores the documented intent) so both times read at a glance |
| 2026-06-24 | Phase tray → under-board return-queue (soonest first, icon-headed, collapse-empty) | Affordance pass: tray's job is roster/return-order triage, not location; moved it next to the board and dropped the redundant "Your phased pieces" label + empty "None." box |
| 2026-06-24 | Clock active = neutral cue; low-time = red (sanctioned reuse) | Resolves the reserved-color question: active never borrows cyan/red; low-time red is the universal convention, lives in the panel (no check-ring collision), still shape-paired |
| 2026-06-25 | Time-control chips show their game-type category ("Blitz" under "3 + 2"); a static game-type badge appears in-game | Owner-requested. The category is the lichess lobby taxonomy (bullet/blitz/rapid/classical), not a restatement of the numbers, so it adds info a newcomer needs; rendered as a text label (colorblind-safe), partially superseding the earlier "no category labels" picker call |
