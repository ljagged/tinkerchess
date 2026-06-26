import { expect, type Page } from "@playwright/test";
import { SEL } from "./selectors";

/** Make a move by tap-to-select-then-place (clicking [data-square] fires the app's
 *  onSquareClick — the real move path; the board is server-authoritative). */
export async function playMove(page: Page, from: string, to: string) {
  await page.locator(SEL.square(from)).click();
  await page.locator(SEL.square(to)).click();
}

/** Block until it is `color`'s turn, synced on the machine-value data-turn hook
 *  (Playwright auto-retries the attribute, absorbing the websocket round-trip). */
export async function waitForMyTurn(page: Page, color: "w" | "b") {
  await expect(page.locator(SEL.game)).toHaveAttribute("data-turn", color);
}

/** Assert the terminal machine values (status enum + end reason), never UI copy. */
export async function expectOutcome(page: Page, status: string, endReason: string) {
  const game = page.locator(SEL.game);
  await expect(game).toHaveAttribute("data-game-status", status);
  await expect(game).toHaveAttribute("data-end-reason", endReason);
}

/** Assert a piece (by machine piece-code, e.g. "wP") occupies a square. */
export async function expectPieceOn(page: Page, square: string, code: string) {
  await expect(page.locator(SEL.square(square)).locator(SEL.piece(code))).toBeVisible();
}

/** Resign through the UI: open the confirm dialog, then confirm. */
export async function resignViaUi(page: Page) {
  await page.locator(SEL.resignBtn).click();
  await page.locator(SEL.resignConfirm).locator(SEL.dangerBtn).click();
}
