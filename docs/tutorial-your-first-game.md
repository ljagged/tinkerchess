# Tutorial: Your first game of Phase Chess

By the end of this tutorial you'll have played a complete game of Phase Chess
against a friend: created a game, shared a join code, made moves, **phased a
piece out** and watched it reappear, and won by capturing a king. You'll come
away understanding the one mechanic that makes this not-quite-chess — phasing —
by actually using it.

This is a learning walk-through. For the exact rules see the
[README](../README.md#rules); for the design rationale see
[Fog of war](./explanation-fog-of-war.md).

## What you'll need

- The app running and reachable in a browser. If you're running it locally, see
  [Run it locally](../README.md#commands) — you'll want `npx convex dev` and
  `npm run dev` both running, then open `http://localhost:3000`.
- A second player (a second browser, an incognito window, or a friend on another
  machine). Phase Chess is two-player; there's no single-device pass-and-play yet.

You don't need to know much chess. If you can move the pieces, you can follow
along — phasing is the only new idea.

## Step 1: Create a game

Open the app. You'll land on the splash screen with a one-paragraph rules
summary and two buttons: **New Game** and **Join Game**.

1. Click **New Game**.
2. Type a player name (e.g. `Alex`) and click **Create game**.

The screen switches to a waiting room showing an **8-character token** in two
groups of four, like `BKMQ-7TRW`, with a copy button.

```
Waiting for opponent to join…
Share this token with your opponent:

   BKMQ-7TRW   [copy]

Sides are chosen at random when they join.
You'll go to the board automatically.
```

You're now waiting. The board hasn't appeared yet — by design, so you never see
a color that might flip before the game actually starts.

## Step 2: Have your opponent join

Copy the token and send it to your second player. On their device:

1. Open the same app.
2. Click **Join Game**.
3. Enter a player name and type (or paste) the token.
4. Click **Join**.

The moment they join, **both screens jump to the board**. White and Black are
assigned **at random** between the two of you — neither player chooses a side.
Whoever got White moves first.

> If a third person enters the same token, both seats are already taken, so they
> join as a **spectator** — they watch with no hidden information for either side.

You now have a live board with both players' pieces in the standard starting
position. That's your first visible result.

## Step 3: Make a move

Find the board. Coordinate labels sit just outside the edge (files `a`–`h`,
ranks `1`–`8`). The header shows you, your opponent, and a **"● to move"** tag on
whoever's turn it is.

If it's your turn, drag a piece to a legal square — a pawn from `e2` to `e4`, say.
The move appears in the move list on the left rail (`e4`), the turn flips, and
your opponent's board updates live.

Trade a few normal moves back and forth to get comfortable. Everything so far is
ordinary chess. Now for the part that isn't.

## Step 4: Phase a piece out

Phasing lets you take a **non-pawn** piece off the board for a chosen number of
**your own** turns. While it's gone, that square is empty and your opponent can't
see where the piece went or when it's coming back. At the end of the last turn it
reappears on the **square it left**, destroying whatever is sitting there.

On your turn, instead of moving:

1. **Right-click** an eligible piece (a knight, bishop, rook, queen, or king —
   not a pawn). A small popover opens over that square.
2. Drag the **slider** to choose a duration. The maximum depends on the piece
   (knight/bishop up to 2, rook up to 3, queen up to 4, king up to 1 — these are
   the defaults).
3. Click **Phase out**.

The piece vanishes from the board. On your **left rail** it shows up in the
**phase tray** — a glyph wrapped in a cyan countdown ring telling you how many of
your turns remain until it returns. Only **you** see this.

Your opponent, meanwhile, saw the piece simply disappear from a visible square.
They know *which* piece left and *from where* (the move log shows `Bf1↑?` — the
`?` hides the duration), but they do **not** know how long it'll be gone.

> **Phasing costs your turn.** You either move *or* phase a piece, not both. And
> the piece is absent during the turns you'd otherwise have it — phasing is a
> gambit, not a free hide.

## Step 5: Watch it reappear

Keep playing. After your chosen number of turns, at the **end** of that turn, the
phased piece reappears on its origin square.

- If the square is **empty**, the piece just returns. No fuss.
- If an **enemy piece** is sitting there, it's destroyed — a capture out of
  nowhere.
- If **one of your own pieces** drifted onto that square, you destroy your own
  piece. This is the footgun the variant is built around: plan your return.

The turn before a piece returns, your opponent gets exactly one hint: the origin
square **pulses with an orange ring**. Square only — never the piece, never the
timer, and never any sooner. That one-turn warning is the entire window they get.

## Step 6: Win by capturing the king

There is **no checkmate** in Phase Chess. You win by **capturing the enemy king**
outright — either with a normal move onto the king's square, or by phasing a
piece back in onto it.

That second path is the dramatic one: phase a rook out from `a1`, maneuver the
enemy king onto `a1` over the next couple of turns, and your rook returns *onto
the king* to win. The opponent only saw an orange ring on `a1` the turn before.

When a king is captured, both boards show a **game-over banner** naming the
winner. If you capture your **own** king by a careless phase-in, you lose — and
the banner says so.

Click **New game** on the banner to play again. The same two seats and join code
carry over, sides are re-randomized, the previous game is archived (you can
replay it), and the ruleset stays the same.

## What you built

You played a full game and used the mechanic that defines Phase Chess:

- **Phasing out** — hiding a piece for a few of your turns, visible only to you.
- **Phasing in** — its reappearance on the origin square, capturing whatever's
  there (theirs, or yours).
- **Fog of war** — your opponent's piece is information you don't have, and yours
  is information they don't have, beyond a one-turn square warning.
- **King capture** — the win condition that replaces checkmate.

### Where to next

- **The exact rules and edge cases:** [README → Rules](../README.md#rules).
- **Why the fog works the way it does** (and what your opponent can and can't
  ever learn): [Fog of war](./explanation-fog-of-war.md).
- **Replaying a finished game** from either side's fog, or fully revealed: open a
  past game from the history list after a rematch.
- **Building on the engine:** [Engine API reference](./reference-engine-api.md)
  and [Backend API reference](./reference-backend-api.md).
