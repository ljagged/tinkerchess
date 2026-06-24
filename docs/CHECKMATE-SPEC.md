# Task: Revert TinkerChess from king-capture to standard checkmate rules

TinkerChess is standard chess plus one added mechanic ("phasing"). The current
codebase implements a KING-CAPTURE win condition. Revert it to STANDARD CHESS
check / checkmate / stalemate rules while KEEPING the phasing mechanic intact.

This is a MIGRATION, not a fresh build. Before writing any code, locate (a) the
current king-capture logic and (b) the existing phasing logic, so the change is
surgical. Reuse existing board representation, move generation, and king-safety
predicates wherever they exist.

IMPORTANT: this document supersedes any earlier version of the prompt. Where an
earlier draft assumed start-of-turn return resolution, a loss-on-own-king
condition, or a "return can expose own king" case, those are WRONG and corrected
here. Return resolves at END of turn; phase-in is occupancy-preserving and can
never expose the owner's own king; a return onto the owner's own king destroys
the RETURNING PIECE, not the king. Details below.

---

## 0. Plan first -- wait for confirmation
Before coding, produce a short plan listing:
- (a) the king-capture code you will REMOVE,
- (b) where check / checkmate / stalemate detection will live,
- (c) how the END-OF-TURN return phase is wired into the turn loop and
  adjudication,
- (d) confirmation you understand the resolution table (S5) and the total
  no-king-removal invariant (S9).
Wait for my confirmation before finalizing.

---

## 1. What to REMOVE (current king-capture behavior)
- Win-by-capturing-the-enemy-king (normal move onto king's square, or phase-in
  onto king's square).
- Loss-by-capturing-your-own-king via phase-in. (Replaced -- see S5: a return
  onto the owner's own king now destroys the returning piece, NOT the king, and
  is NOT a loss.)
- Any code path that treats the king as a generally capturable piece, allows a
  king to be left en prise, or removes a king from the board via phasing.
- Game-over banners / result recording tied to king capture.

## 2. What to ADD / RESTORE (standard chess)
- Check detection: a king is in check when attacked by any enemy piece on the
  current visible board.
- Standard king-safety: no moving into/through check, castling legality, etc.
- Checkmate: side to move is in check and has no legal move -> that side loses.
- Stalemate: side to move is NOT in check and has no legal move -> draw.
- Automatic, Lichess-style adjudication: the engine detects mate/stalemate
  immediately after a turn resolves. There is NO "declare checkmate" action.

## 3. The phasing mechanic (preserve)
- On a turn, a player may EITHER make a normal move OR phase out one eligible
  piece. PHASING OUT costs the whole turn. PHASING IN is automatic and costs
  NOTHING -- it is not an action; it just happens on schedule.
- Eligible to phase out: knight, bishop, rook, queen, king (NOT pawns).
- Duration chosen at phase-out, capped per piece type. READ THE EXISTING CONFIG
  for caps (defaults knight 2 / bishop 2 / rook 3 / queen 4 / king 1) -- do not
  hardcode new values.
- A phased piece is OFF THE BOARD for the whole duration. The owner CANNOT recall
  it early, move it, or redirect it. Retained state is only
  (origin square, return turn, owner, piece type).
- RETURN TIMING: a phased piece reappears on its ORIGIN square at the END of the
  owner's turn (after the owner's action that turn), NOT at the start. See S8.
- Fog of war and the one-turn-ahead orange origin-square warning ring are
  UNCHANGED. Do not alter what information each side sees.

## 4. CRITICAL INVARIANT (this is what makes mate decidable)
A phased piece is identical to a normally-moved piece for ALL board-state,
attack-generation, check-detection, and legality purposes. It differs ONLY in
that the owner loses control over recall / movement / timing. For every turn it
is out, attack generation and check detection MUST run against a board where the
piece is genuinely absent -- it does not block, defend, or occupy anything.

Implement "phased" as the piece simply NOT EXISTING on the board, with separate
bookkeeping for its scheduled return. Do NOT model phase-space as a special zone
with special interaction rules. The phase tray is bookkeeping, not a board region.

## 4b. PHASE-IN IS OCCUPANCY-PRESERVING (consequence: it cannot expose own king)
A phase-in only ever ADDS a piece to its origin square. The square goes
empty->occupied or occupied->occupied (with a destruction). It NEVER goes
occupied->empty. A return does not move through or vacate any square; it
materializes on exactly one square.

Therefore a phase-in can NEVER open a line and can NEVER expose the owner's own
king. Any line through the origin square that was blocked before the return is
still blocked after (the returning piece occupies the square in place of whatever
was destroyed). There is NO "return exposes own king" case to handle -- if you
find yourself writing one, it is based on a false premise.

The ONLY phasing action that can expose the owner's own king is phase-OUT (it
removes occupancy). That is handled by S7, the sole own-king-exposure check.

---

## 5. RETURN RESOLUTION TABLE (what happens when a piece phases in)
At the END of the owner's turn, each scheduled return reappears on its origin
square and resolves by what occupies that square:

- EMPTY            -> piece returns, nothing destroyed.
- ENEMY non-king   -> enemy piece captured; returning piece takes the square.
                      (This is the signature capture-from-nowhere.)
- ENEMY king       -> UNREACHABLE on a live king. S5a guarantees the enemy king
                      was forced to flee or was mated the prior turn. A return
                      must NEVER resolve against a live enemy king.
- OWN non-king     -> own piece destroyed; returning piece takes the square.
                      (Footgun, RETAINED -- careless self-destruction of your own
                      piece.)
- OWN king         -> the RETURNING PIECE self-destructs; the king is UNAFFECTED.
                      Kings are immune to friendly fire. NOT a loss, NOT a
                      capture of the king. The piece is simply removed; the king
                      stands. (Softened footgun: you waste the phased piece and
                      the action you spent phasing it, but you do not lose.)

### 5a. Enemy imminent return -- treated as CHECK (not a move-legality bar)
A square showing the public return-warning ring for an ENEMY piece scheduled to
phase in is treated as a CHECK threat against a king occupying it -- handled in
check detection, NOT as a pre-emptive "can't move here" filter.

- A king MAY move onto a square with NO ring. A return 2+ turns out does NOT
  restrict it. MANDATORY for fog of war: barring the king on a not-yet-visible
  return would leak a hidden phased piece's existence/location to its owner. The
  restriction keys ONLY off the publicly visible ring (the imminent return).
- Once the enemy ring appears on the king's square, the king IS IN CHECK and must
  resolve it this turn. Resolution is KING FLIGHT ONLY: a return threat cannot be
  blocked (interposition is futile -- the return lands regardless and destroys
  what's there) and the phased attacker cannot be captured (it's off-board). Do
  NOT offer block or capture-attacker as legal responses; assert they're absent.
- King on an enemy-ringed square with no legal flight square -> CHECKMATE, in the
  SAME adjudication pass as standard check (S8 steps), so the enemy return NEVER
  fires on a live king.
- Intended: an enemy-ringed-king check is STRICTER than normal (flight only);
  mate arises more readily.

### 5b. RING OWNERSHIP MATTERS for check detection
The same visual (a ring on the king's square) means different things by owner:
- ENEMY ring on own king's square -> CHECK. King must flee (S5a).
- OWN ring on own king's square   -> NOT check (your own return is not an attack).
  The king may legally remain. If it does, at end of turn the returning piece
  self-destructs (S5, OWN king row) and the king is unaffected. No loss.
The engine MUST filter ring ownership when deciding check. Do NOT implement "ring
on king square -> check" without the ownership filter.

---

## 6. MENTAL MODEL: a pending return is a HAZARD, not an attacking piece
A scheduled return is NOT part of attack generation. It does not guard or attack
any square, does not give check along lines, does not pin, does not defend. It is
inert terrain until it fires. Its ONLY legality interaction is the S5a
ringed-square rule (enemy ring = check on a king occupying it, flight only).

Implement that narrowly. Do NOT inject the returning piece into attack /
check-generation as if it were on the board on a line. If you add a "phased piece
attacks square X" code path, STOP: wrong model, creates phantom restrictions
(false pins, false checks from the eventual line, guarded flight squares). The
hazard touches exactly one square (its origin) at exactly one time (its return)
and does nothing else. That spatial + temporal confinement is the balance against
the king's flight-only resolution -- preserve it by keeping the return out of
attack generation entirely.

---

## 7. Phase-OUT legality (the SOLE own-king-exposure check; analog of "can't move into check")
A phase-OUT is ILLEGAL if, after the piece is removed from the board, the phasing
player's own king would be in check at that moment (e.g. phasing out a pinned
piece or one currently blocking an attack on the own king). Reuse the SAME
king-safety predicate used to reject illegal moves, applied to the post-phase-out
board. Same predicate, different action -- no new check logic.

This covers only IMMEDIATE exposure at phase-out time. If the opponent LATER
develops into the line opened by an already-phased piece, that is a NORMAL, LEGAL
check the phasing player must answer by on-board means (the phased piece is
unavailable until it returns). NO special rule -- it falls out of the S4
invariant, because the origin square is genuinely empty for the whole duration.
Confirm the check-detection loop handles it purely by the piece's absence.

(There is no phase-IN own-king-exposure check, per S4b -- phase-in cannot expose.)

---

## 8. TURN LOOP -- END-OF-TURN return ordering (the only real divergence)
TinkerChess differs from a stock engine in one place: a phased piece returns at
the END of the owner's turn, AFTER the owner's action. Implement the loop as:

1. BEGIN turn for side S.
2. CHECK EVALUATION (start of S's turn): is S's king in check -- from a standard
   attack, or from an ENEMY imminent-return ring on the king's square (S5a)?
   Enumerate S's legal moves + legal phase-outs (subject to S7) on the current
   board.
   - In check and NO legal move -> CHECKMATE, S loses.
   - NOT in check and NO legal move -> STALEMATE, draw.
3. S takes ONE action: a normal move OR a legal phase-out. (Phase-in is NOT an
   action and is not chosen here.)
4. RETURN PHASE (end of S's turn): for every phased piece owned by S scheduled to
   return at the end of this turn, reappear it on its origin square and resolve
   per the S5 RETURN RESOLUTION TABLE (empty / enemy non-king captured / own
   non-king destroyed / own king -> returning piece self-destructs). Apply all
   such returns.
5. POST-RETURN EVALUATION: recompute the board. A return may have delivered check
   to the OPPONENT (e.g. a returning piece now attacks the enemy king), or
   captured a piece that was checking S (note: a return cannot exposed S's own
   king -- S4b). Determine whether the opponent is now checkmated/stalemated
   using standard detection on the board the opponent will face, INCLUDING any
   S5a enemy-ring check S's return/move created on the opponent's king. Do NOT
   look ahead into the opponent's own hidden returns -- those resolve at the end
   of the opponent's turn in their step 4.
6. END turn; pass to opponent.

Mate/stalemate detection uses ONLY the visible board at the moment of evaluation.
Phased pieces returning on FUTURE turns are irrelevant to current adjudication --
checkmate is present-tense: king attacked now, no legal response now. Do not
account for not-yet-returned pieces.

---

## 9. HARD INVARIANT to assert in tests (now total, no exceptions)
NO king is EVER removed from the board by ANY phase-in -- friendly or enemy.
- Enemy return onto a king: unreachable (S5a forces flight or mate first).
- Own return onto own king: returning piece self-destructs; king untouched (S5).
If any code path removes any king via a return, it is a bug. There is no longer
any terminal loss-by-own-king-return condition; do not implement one.

## 10. Tests to add
- Phase-out that would expose own king (pinned/blocking piece) -> ILLEGAL.
- Deferred exposure: opponent develops into a line opened by an already-phased
  piece -> LEGAL check, S must answer by on-board means.
- Return captures the piece that was checking S -> check resolved.
- Mate delivered by a normal move (standard).
- Mate delivered or averted at/after a return (the return is the closer); verify
  end-of-turn ordering -- the return resolves after S's move, and any resulting
  check on the opponent is detected in step 5.
- Stalemate (no legal move, not in check) -> draw.
- King MAY occupy a square whose enemy return is 2+ turns out (no ring, no bar)
  -- FOG CHECK: the restriction must NOT appear early.
- Enemy ring appears on king's square -> king in check -> must move; NOT
  answerable by interposition or capturing the phased attacker (assert absent)
  -> flight only.
- Enemy-ringed king with no flight square -> checkmate; assert no king is removed
  from the board (invariant S9).
- RING OWNERSHIP: own ring on own king's square does NOT register as check (king
  may legally stay); enemy ring on own king's square DOES register as check.
- Own return onto own king -> RETURNING PIECE destroyed, king unaffected, game
  continues (NOT a loss, NOT a king removal).
- Own return onto own non-king piece -> own piece destroyed, returning piece
  takes the square (footgun retained).
- Occupancy invariant: a phase-in never opens a line / never exposes own king
  (construct a position where the returning piece lands on a square that was
  blocking an attack on the owner's king; assert the king is NOT in check after
  the return, because the returning piece re-occupies the blocking square).

---

## Constraints
- Keep changes surgical; reuse existing move-generation, board representation,
  and king-safety predicates.
- Preserve all fog-of-war / information-visibility behavior exactly.
- Do not hardcode phase durations; read existing config.