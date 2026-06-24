// A readable message from a Convex mutation rejection. The backend throws a
// ConvexError for player-facing rejections (illegal move, not your turn, no game
// for that token, ...); its message lives in `.data`. A plain Error reaches the
// client as a bare "Server Error", so prefer `.data` and fall back gracefully.
export function errText(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return e instanceof Error && !/Server Error/.test(e.message)
    ? e.message
    : "Something went wrong — try again.";
}
