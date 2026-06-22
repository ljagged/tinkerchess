// Client-side seat storage. A seat token is the capability to act in a specific
// game; we keep it in localStorage keyed by gameId so a refresh keeps the seat.
// Spectators are stored too (token null) so we know they entered via a token and
// shouldn't be redirected back to the splash. Color is NOT stored — it's
// assigned server-side at join time and read from the game view's `you`.

export interface Seat {
  seatToken: string | null;
}

const key = (gameId: string) => `phasechess:seat:${gameId}`;

export function loadSeat(gameId: string): Seat | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key(gameId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Seat;
  } catch {
    return null;
  }
}

export function saveSeat(gameId: string, seat: Seat): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(gameId), JSON.stringify(seat));
}
