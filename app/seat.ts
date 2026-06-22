// Client-side seat storage. A seat token is the capability to act as a color in
// a specific game; we keep it in localStorage keyed by gameId so refreshing or
// re-opening the link keeps your seat. Spectators are stored too (token null) so
// we don't repeatedly try to claim a seat.

export type SeatColor = "w" | "b" | "spectator";

export interface Seat {
  color: SeatColor;
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
