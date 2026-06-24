# TinkerChess — Laws of the Game

These are the complete rules of TinkerChess, written to tournament standard:
precise enough to adjudicate any position without appeal to intuition. TinkerChess
is **standard chess plus one mechanic — phasing** — so the ordinary FIDE Laws of
Chess govern everything not addressed here (piece movement, the initial array,
promotion, en passant, the mechanics of castling, and so on). Where a phasing rule
interacts with a standard rule, the text below is controlling.

A friendlier walk-through is the [tutorial](./tutorial-your-first-game.md); the
hidden-information model is explained in [Fog of war](./explanation-fog-of-war.md).
Terms in **bold** are defined where they first appear.

---

## Article 1 — The game

1.1 TinkerChess is played by two players, **White** and **Black**, on the standard
8×8 board from the standard starting position. White moves first; the players then
alternate. Sides are assigned at random when the game begins.

1.2 On your turn you must take **exactly one action**: either

- (a) make a legal **move** (as in standard chess), or
- (b) **phase out** one eligible piece (Article 2).

You may not do both, and you may not pass. A move and a phase-out each consume the
whole turn.

1.3 The object is to **checkmate** the opponent's king (Article 6). There is no
other way to win, and **no king is ever captured or removed from the board**
(Article 9). A game may also end in a **draw** (Article 7).

---

## Article 2 — Phasing out

2.1 To **phase out** a piece is to remove it from the board for a fixed number of
your own future turns, after which it returns automatically (Article 3). While
phased, a piece is simply **not on the board**: it occupies, defends, blocks, and
attacks nothing.

2.2 **Eligibility.** Only **non-pawn** pieces may phase: knight, bishop, rook,
queen, and king. Pawns may never phase out.

2.3 **Duration.** When you phase a piece out you choose a **duration** `d`, an
integer from 1 to the maximum permitted for that piece type under the game's
**ruleset** (Article 10). The default maxima are:

| Piece | Knight | Bishop | Rook | Queen | King | Pawn |
|------:|:------:|:------:|:----:|:-----:|:----:|:----:|
| Max duration | 2 | 2 | 3 | 4 | 1 | — (cannot phase) |

A ruleset may change any of these; a maximum of 0 means that piece type cannot
phase in that game.

2.4 **The owner has no further control.** Once phased, a piece cannot be recalled,
moved, redirected, or have its duration changed. The only state retained is its
origin square, its owner, its type, and the turn on which it returns.

2.5 **Legality of a phase-out** is governed by Article 5. In particular, you may
not phase out any piece while your own king is in check, and you may not phase out
a piece if doing so would leave your own king in check.

---

## Article 3 — The return (phasing in)

3.1 **Timing.** A phased piece returns **at the end of its owner's turn**, after
that turn's action has been completed — never at the start of a turn, and never on
the opponent's turn. A piece phased out for duration `d` is absent for the `d`
turns of its owner that follow the phase-out, and **reappears at the end of the
`d`-th such turn**. (So a duration of 1 means the piece is gone for exactly the
owner's next turn and returns at the end of it.)

3.2 **The return is automatic and free.** It is not an action and is not chosen; it
simply occurs on schedule. It does not consume a turn.

3.3 **Resolution.** A returning piece reappears on the **exact square it left** (its
origin) and resolves according to what occupies that square at that moment:

| Occupant of the origin square | Result |
|---|---|
| Empty | The piece returns; nothing is destroyed. |
| An **enemy** non-king piece | The enemy piece is **captured**; the returning piece takes the square. |
| One of **your own** non-king pieces | Your own piece is **destroyed** (a footgun); the returning piece takes the square. |
| **Your own king** | The **returning piece self-destructs** and is removed; your king is unaffected and remains on the square. This is harmless beyond the loss of the phased piece and the turn spent phasing it. |
| The **enemy king** | This situation cannot arise — see 3.4 and Article 9. |

3.4 A return is **occupancy-preserving**: it only ever adds a piece to its origin
square (turning it from empty to occupied, or replacing an occupant). It never
vacates a square and never opens a line. Consequently a return can never expose its
owner's king to check.

3.5 If more than one of a player's pieces is due to return on the same turn, the
returns resolve in a fixed order (earliest scheduled return first), each on the
board left by the previous one.

---

## Article 4 — Hidden information and the return warning

4.1 **What you see.** You always see your own phased pieces: their identity, their
origin square, and their remaining duration. You see the full board of pieces in
play.

4.2 **What your opponent sees.** Your opponent does **not** see your phased pieces,
their identities, or their timers. They observe only that a piece vanished from a
visible square (so they know which piece left, and from where, but never for how
long).

4.3 **The return warning (the "ring").** During the single opponent turn that
immediately precedes a piece's return, the piece's **origin square** is shown to
the opponent as a warning — **square only**, with no piece identity and no timer.
This is the **ring**. It appears exactly one of the opponent's turns before the
return resolves, and never earlier. A return that is two or more turns away is
completely invisible to the opponent.

4.4 Spectators see neither player's phased pieces nor any warning ring.

4.5 No rule may bar a move on the basis of a phased piece that is not yet shown by a
ring. Restrictions tied to a return key **only** on the publicly visible ring
(Articles 5 and 8); this is what keeps hidden information hidden.

---

## Article 5 — Check

5.1 A king is **in check** when it stands on a square that is either

- (a) **attacked** by an enemy piece in play (standard check), or
- (b) showing an **enemy return ring** (Article 4.3) — i.e. an enemy piece is
  scheduled to return onto the king's square on the enemy's next turn. This is a
  **ringed check** (and is unique to TinkerChess).

5.2 **Ring ownership is decisive.** Only an **enemy** ring gives check. A ring for
**your own** returning piece on your own king's square is **not** a check: your king
may legally remain there, and if it does, the returning piece self-destructs
(3.3) — harmlessly.

5.3 A phased piece is **never** part of attack generation. A scheduled return does
not attack along lines, does not pin, does not defend, and does not guard any
square. Its only effect on legality is the single-square ringed check of 5.1(b),
active only while its ring is visible and only against a king standing on that exact
square.

5.4 You may never make a move, or a phase-out, that leaves your own king in check
(Articles 6.1 and 8 govern the consequences).

---

## Article 6 — Legal responses, checkmate

6.1 **Legality of a move.** A move is legal only if, in the position it produces,
the mover's own king is **not in check** — neither attacked by an enemy piece nor
standing on an enemy-ringed square. A king is **never** a legal target of a move
(no move may capture a king).

6.2 **Answering a standard check.** A standard check (5.1(a)) may be answered in the
ordinary ways: move the king to safety, capture the checking piece, or interpose a
piece on the line of check.

6.3 **Answering a ringed check.** A ringed check (5.1(b)) may be answered **only by
moving the king** off the ringed square to a safe square (a square neither attacked
nor itself enemy-ringed). It **cannot** be answered by interposition — a return
lands on its origin regardless of any blocker — nor by capturing the attacker, which
is off the board and cannot be captured. Interposition and capture are simply not
available responses to a ringed check.

6.4 You may **not** answer any check with a phase-out (Article 8.3). A check must be
answered by a move.

6.5 **Checkmate.** If the player to move is in check (standard or ringed) and has
**no legal move**, that player is **checkmated** and loses the game. A ringed king
with no safe flight square is checkmated at that moment — the turn before the
return would resolve — so the enemy return never falls on a live king (Article 9).

6.6 A ringed check is therefore **stricter** than a standard check: it admits only
king flight, so mate by a ringed check arises more readily than an ordinary mate.

---

## Article 7 — Draws

7.1 **Stalemate.** If the player to move is **not in check** and has **no legal
move**, the game is drawn by stalemate.

7.2 **A phase-out does not avert stalemate or any "no legal move" condition.** For
the purposes of stalemate (7.1) and checkmate (6.5), only legal **moves** are
counted. The availability of a legal phase-out is irrelevant: a player with no legal
move but an available phase-out is stalemated (or checkmated, if in check). Phasing
is never an escape from a drawn or lost position.

7.3 **Threefold repetition.** The game is drawn automatically when the **same
position** arises for the **third time**. No claim is required; the draw is declared
the moment the third occurrence is reached.

7.4 For 7.3, two positions are the **same** when they have the same arrangement of
pieces in play, the same player to move, the same castling rights, and the same
en-passant possibility. **Phased pieces and their timers are excluded from this
comparison.** A position in which a piece is phased out naturally differs from one
in which that piece is on the board (the boards differ); the exclusion means only
that two otherwise-identical positions are treated as the same even if a phased
piece's remaining timer differs between them. A player therefore cannot phase a
piece in and out to manufacture a "new" position and evade a repetition draw.

7.5 The fifty-move rule is **not** currently in force. Resignation and draw by
agreement are matters of tournament administration and are outside these Laws.

---

## Article 8 — Legality of a phase-out

8.1 A phase-out is legal only if the piece is eligible (2.2), the duration is within
range (2.3), and the king-safety conditions below are met.

8.2 **No self-exposure (the pin rule).** A phase-out is illegal if, after the piece
is removed, the mover's own king would be in check. This forbids, in particular,
phasing out a pinned piece, or any piece currently shielding the king from an enemy
attack. (A phase-*in* can never expose the king — 3.4 — so there is no analogous
restriction on returns.)

8.3 **No phasing while in check.** If your king is in check (standard or ringed) at
the start of your turn, **no phase-out is legal**: every phase-out leaves the king in
check (a phase-out removes one of your own pieces and so cannot address the threat),
and the king itself may not phase out of check. You must answer the check with a
move.

8.4 **Deferred exposure is not a phase-out matter.** Article 8.2 governs only the
moment of phasing. If, on a later turn, the opponent develops a piece into a line
that was opened when you earlier phased a piece out, the resulting check is an
ordinary, legal check that you must answer by on-board means — the phased piece is
unavailable until it returns. This needs no special rule; it follows from a phased
piece being genuinely absent (2.1).

---

## Article 9 — The no-king-removal invariant

9.1 **No king is ever removed from the board by any phase-in, friendly or enemy.**

9.2 A return onto the owner's **own** king destroys the returning piece, not the
king (3.3).

9.3 A return onto the **enemy** king is impossible. By Article 5.1(b) the enemy
king, while standing on a square showing your return ring, is in check and must flee
on the turn before your piece returns; if it cannot flee it is checkmated then
(6.5). In either case the enemy king has left the square — or the game has ended —
before the return resolves. There is consequently no terminal "king captured by a
return" condition, for either color.

---

## Article 10 — The ruleset (per-game settings)

10.1 Each game is played under a **ruleset** that fixes which piece types may phase
and the maximum duration of each (Article 2.3). The defaults are given in 2.3; the
creator of a game may change them before play begins.

10.2 The ruleset is **public**: both players see the durations in force, and a
joining player sees the ruleset they are joining.

10.3 A rematch between the same players carries the **same ruleset** forward; it is
not silently reset to the defaults.

---

## Article 11 — The turn, in full

For the avoidance of doubt, a single turn for the player to move, **S**, proceeds
exactly as follows.

1. **Adjudication of S's position** (carried over from the opponent's previous
   turn): if S is in check with no legal move, S is checkmated and loses; if S is
   not in check and has no legal move, the game is a stalemate draw; if the position
   has now occurred a third time, the game is a repetition draw. Otherwise play
   continues.
2. **S acts:** S makes one legal move, **or** one legal phase-out (Article 8). A
   phase-out while in check is illegal (8.3), so a check must be answered by a move.
3. **Returns resolve:** at the end of S's turn, every one of S's pieces due to
   return does so, per the resolution table (3.3), in the fixed order of 3.5.
4. **The turn passes** to the opponent, whose position is then adjudicated as in
   step 1.

Mate, stalemate, and repetition are always assessed on the **present, visible
board** at the moment of adjudication. Pieces scheduled to return on future turns
are irrelevant to the present assessment; a king is in check, or not, **now**, and
has a legal move, or not, **now**.

---

## Article 12 — Notation

12.1 TinkerChess uses standard algebraic notation (SAN), with these additions for
phasing (the arrows read as the piece leaving or returning to the board; `↑` = out,
`↓` = back in):

- **Phase-out:** `‹piece›‹from›↑‹duration›` — e.g. `Bf1↑3` (a bishop on f1 phases
  out for 3).
- **Phase-in:** `‹piece›↓‹square›` with `x‹piece›` appended on a capture — e.g.
  `R↓a1` or `R↓a1xN`.
- **Check:** trailing `+`. **Checkmate:** trailing `#`.
- **Own-piece footgun** (a return destroyed your own non-king piece): trailing
  `(self)` — e.g. `R↓a1xB(self)`.
- **Self-destruct** (a return landed on your own king and was lost): trailing
  `(lost)` — e.g. `B↓f1(lost)`.

12.2 **Fog in the live record.** In the running move record shown to a player, the
**duration** of an *opponent's* phase-out is concealed, rendered `↑?` (e.g.
`Bf1↑?`): the opponent's piece and origin are public, but how long it will be gone
is not. Once the game is over, the true record — all durations revealed — is shown
to everyone.

---

## Appendix A — Illustrative cases

These follow from the Articles above; they are included to settle the situations
most likely to be questioned at the board.

- **A return capturing out of nowhere.** You phase a rook out of `a1`. Two of your
  turns later it returns to `a1`; an enemy knight has since moved there. The knight
  is captured and your rook stands on `a1` (3.3). Your opponent saw only an orange
  ring on `a1` on their previous turn.
- **The ringed mate.** You phase a rook out of `a1`; over the next turns you drive
  the enemy king onto `a1`. On the turn before your rook returns, the ring appears
  on `a1`: the enemy king is in check (5.1(b)) and must flee (6.3). If it has no safe
  square, it is checkmated then and there (6.5) — your rook never actually returns
  onto a live king (9.3).
- **Your own king on the return square.** You move your king onto a square where
  your own piece is about to return. This is legal (your own ring is not a check,
  5.2). When the piece returns, it self-destructs; your king is unharmed (3.3). You
  have merely wasted the phased piece.
- **Phasing a pinned piece.** Your bishop on e4 is the only thing between an enemy
  rook on e8 and your king on e1. You may not phase the bishop out — doing so would
  expose your king (8.2). If, however, the bishop was already phased out before the
  rook arrived on the e-file, the resulting check is ordinary and you must answer it
  by a move (8.4); when the bishop later returns to e4, it re-blocks and the check is
  gone (3.4).
- **Castling across a phased square.** Your king may castle across a square whose
  piece is merely phased out (the square is empty), but may **not** castle into or
  through a square that is showing an enemy return ring — the ring counts as an
  attack on the king's path, exactly as a standard attacked square would. As always,
  you may not castle while in check.
- **Repetition with phasing.** Shuffling a knight out and back to reach a
  board-identical position does not create a "new" position: the repetition count is
  taken on the visible board (7.4). You cannot phase to dodge a threefold draw.

---

## Related

- [Tutorial: your first game](./tutorial-your-first-game.md) — learn by playing.
- [Fog of war](./explanation-fog-of-war.md) — why the hidden information stays hidden.
- [Engine API](./reference-engine-api.md) — the rules as code (the engine is the
  single, authoritative source of these Laws).
