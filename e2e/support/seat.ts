import type { BrowserContext } from "@playwright/test";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Give a browser context ownership of a seat by writing the seat token to
 * localStorage BEFORE the first paint of /game/[id] (GameClient redirects to / if
 * the seat is absent). `addInitScript` runs before page scripts on every
 * navigation in the context, so the seat is present when GameClient loads.
 */
export async function seatInto(ctx: BrowserContext, gameId: Id<"games">, seatToken: string) {
  await ctx.addInitScript(
    ([g, t]) => localStorage.setItem(`tinkerchess:seat:${g}`, JSON.stringify({ seatToken: t })),
    [gameId as string, seatToken] as const,
  );
}
