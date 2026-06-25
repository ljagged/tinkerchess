// Quick chat emotes — a small fixed palette a player fires with one tap, the
// lichess "canned gesture" pattern. Shared by the Convex mutation (which
// whitelists the emoji so the buttons can only send known values) and the chat
// UI (which renders the buttons). Each emote carries a short label so its meaning
// is announced to a screen reader and shown as a tooltip — never glyph-only.
//
// Like timecontrol.ts this is a Convex-layer / UI concern (not a chess rule), so it
// lives outside src/engine and is imported by both the backend (`../src/emotes.js`)
// and the frontend (`@/src/emotes`).

export interface QuickEmote {
  emoji: string;
  /** Short, accessible meaning (tooltip + aria-label). */
  label: string;
}

// A deliberately tiny, friendly set — enough to be expressive, few enough to stay
// "quick" (Hick's Law). Each emoji is unambiguous and culturally neutral.
export const QUICK_EMOTES: QuickEmote[] = [
  { emoji: "👋", label: "Hi" },
  { emoji: "🤝", label: "Good luck" },
  { emoji: "👍", label: "Nice" },
  { emoji: "😮", label: "Wow" },
  { emoji: "😅", label: "Phew" },
  { emoji: "🎉", label: "Good game" },
];

/** The set of allowed emote emoji, for server-side validation. */
export const EMOTE_EMOJIS: ReadonlySet<string> = new Set(QUICK_EMOTES.map((e) => e.emoji));

/** Whether a string is one of the quick-emote emoji (the only values sendEmote accepts). */
export function isQuickEmote(emoji: string): boolean {
  return EMOTE_EMOJIS.has(emoji);
}
