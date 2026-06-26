import { test } from "@playwright/test";
import { seedHumanGame } from "../support/convex";
import { seatInto } from "../support/seat";
import { waitForMyTurn, resignViaUi, expectOutcome } from "../support/board";

// The one scenario that genuinely needs TWO browser contexts: prove a resignation is
// reflected live on BOTH players' screens (the Convex subscription pushes the terminal
// state to the opponent who took no action). White resigns; both boards must show it.
test("resignation is reflected live on both players' screens", async ({ browser }) => {
  const { gameId, white, black } = await seedHumanGame("Wendy", "Bart");

  const ctxW = await browser.newContext();
  const ctxB = await browser.newContext();
  await seatInto(ctxW, gameId, white.token);
  await seatInto(ctxB, gameId, black.token);

  const pageW = await ctxW.newPage();
  const pageB = await ctxB.newPage();
  await pageW.goto(`/game/${gameId}`);
  await pageB.goto(`/game/${gameId}`);
  await waitForMyTurn(pageW, "w"); // both clients loaded, White to move

  await resignViaUi(pageW);

  // Resigner and opponent both see Black-wins-by-resignation, live.
  await expectOutcome(pageW, "b_won", "resignation");
  await expectOutcome(pageB, "b_won", "resignation");

  await ctxW.close();
  await ctxB.close();
});
