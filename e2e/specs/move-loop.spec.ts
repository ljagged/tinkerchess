import { test } from "@playwright/test";
import { seedHumanGame, makeMoveHttp } from "../support/convex";
import { seatInto } from "../support/seat";
import { playMove, waitForMyTurn, expectPieceOn, resignViaUi, expectOutcome } from "../support/board";

// Core acceptance loop: a human clicking the board produces a server-applied move
// that renders back, and a terminal action renders the right outcome. ONE browser
// context (White, via the UI); Black replies over HTTP (its moves don't need the
// UI). Proves human → DOM → mutation → fog view → DOM, plus terminal rendering.
test("white drives moves through the board and reaches a terminal state via resign", async ({
  browser,
}) => {
  const { gameId, white, black } = await seedHumanGame("Driver", "HttpOpp");

  const ctx = await browser.newContext();
  await seatInto(ctx, gameId, white.token);
  const page = await ctx.newPage();
  await page.goto(`/game/${gameId}`);

  // 1. White opens e2-e4 via the board; assert the pawn actually lands on e4.
  await waitForMyTurn(page, "w");
  await playMove(page, "e2", "e4");
  await expectPieceOn(page, "e4", "wP");

  // 2. Black replies over HTTP; White's board updates and the turn returns to White.
  await makeMoveHttp(gameId, black.token, "e7", "e5");
  await waitForMyTurn(page, "w");
  await expectPieceOn(page, "e5", "bP");

  // 3. White resigns through the UI → Black wins by resignation (machine values).
  await resignViaUi(page);
  await expectOutcome(page, "b_won", "resignation");

  await ctx.close();
});
