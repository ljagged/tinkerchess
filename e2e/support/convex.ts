// Convex-client setup helpers. Tests SEED state through the public API (fast,
// deterministic) and then drive gameplay through the browser. Colors are read from
// getGameView.you (authoritative) — never inferred from the DOM.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CONVEX_URL } from "./env";

const client = () => new ConvexHttpClient(CONVEX_URL);

/** Algebraic square → 0..63 board index (matches the engine's indexing). */
const idx = (sq: string) => (sq.charCodeAt(1) - 49) * 8 + (sq.charCodeAt(0) - 97);

export type Seat = { token: string };
export type SeededGame = { gameId: Id<"games">; white: Seat; black: Seat };

/** The color a seat token plays, straight from the fog view (authoritative). */
export async function colorOfSeat(gameId: Id<"games">, token: string): Promise<"w" | "b"> {
  const v = await client().query(api.games.getGameView, { gameId, seatToken: token });
  if (v?.you !== "w" && v?.you !== "b") throw new Error(`seat ${token} is not a player`);
  return v.you;
}

/**
 * Seed an UNTIMED two-player game (no clock ⇒ no timeout jobs) and resolve which
 * seat token is White via the query. Returns both seats keyed by color so a spec
 * can drive the right side regardless of the random color assignment.
 */
export async function seedHumanGame(nameA = "Alice", nameB = "Bob"): Promise<SeededGame> {
  const c = client();
  const a = await c.mutation(api.games.createGame, { name: nameA }); // untimed (no timeControl)
  const b = await c.mutation(api.games.joinByToken, { token: a.joinToken, name: nameB });
  if (!b.seatToken) throw new Error("joinByToken did not return a seat token");
  const initiatorIsWhite = (await colorOfSeat(a.gameId, a.seatToken)) === "w";
  return {
    gameId: a.gameId,
    white: { token: initiatorIsWhite ? a.seatToken : b.seatToken },
    black: { token: initiatorIsWhite ? b.seatToken : a.seatToken },
  };
}

/** Apply a move over HTTP (used to drive the OPPONENT in the one-context spec). */
export async function makeMoveHttp(gameId: Id<"games">, token: string, from: string, to: string) {
  return client().mutation(api.games.makeMove, {
    gameId,
    seatToken: token,
    from: idx(from),
    to: idx(to),
  });
}
