# Deploying TinkerChess (playtest)

TinkerChess is two pieces: a **Convex** backend (schema + functions + data) and a
**Next.js** frontend. The least-friction host is **Vercel + Convex production**,
which is what this guide covers. No code changes are required; the repo ships a
`vercel.json` that wires the two together.

## 1. Create a Convex production deploy key

Everything in development runs on a personal *dev* deployment. Playtesters need a
*production* deployment, which `npx convex deploy` creates and pushes to.

1. Convex dashboard → your project → **Settings → Deploy Keys → Generate
   Production Deploy Key**.
2. When the scoped-permissions picker appears, tick **only** `deployment:deploy`
   and leave everything else unchecked. That single scope authorizes pushing
   schema + functions, which is the entire job of `convex deploy`. Least privilege
   matters here: this key lives in CI env vars and is the most likely thing to
   leak, so it should be able to push code (recoverable, in git history) but never
   read or destroy player data.
3. Name it something like `vercel-prod-deploy` and copy the key string (looks like
   `prod:<deployment-name>|<token>`).

You do **not** run `convex deploy` by hand for this setup; Vercel runs it for you
(step 2).

## 2. Set up the Vercel project

1. **Import** the GitHub repo `ljagged/tinkerchess` into a new Vercel project.
   Vercel auto-detects Next.js.
2. **Build command:** already handled. The repo's `vercel.json` sets it to
   `npx convex deploy --cmd 'npm run build'`. This deploys your Convex functions to
   production **and** injects the correct `NEXT_PUBLIC_CONVEX_URL` into the Next
   build automatically. (If you ever override the build command in the Vercel UI,
   the UI override wins over `vercel.json`, so leave the UI override off.)
3. **Environment variable:** Settings → Environment Variables → Add:
   - Name: `CONVEX_DEPLOY_KEY` (the name is fixed; `convex deploy` looks for exactly
     this).
   - Value: the production deploy key from step 1.
   - Environment: **Production** (add **Preview** too if you want PR preview
     deploys to push to Convex as well).
   - Do **not** set `NEXT_PUBLIC_CONVEX_URL` yourself; the build command derives and
     injects it. Setting it by hand can fight the wrapper.
4. **Node version:** the repo pins Node 22 via `.nvmrc` and the `engines.node`
   field in `package.json`; Vercel honors these. The Convex CLI requires Node ≥ 22.

## 3. Deploy and verify

Trigger a deploy (push to `main`, or Vercel → Deployments → Redeploy). A correct
build log shows, in order:

1. `Running "npx convex deploy ..."`
2. `Deployed Convex functions to https://<your-prod>.convex.cloud`
3. *then* `next build` / `Creating an optimized production build`

If you instead see `Running "npm run build"` with no Convex step, the build command
is not in effect, and the build fails at prerender with
`No address provided to ConvexReactClient` (the URL was never injected). Confirm
`vercel.json` is present and no conflicting UI build-command override is set.

## Playing

Open the deployed URL, click **New Game**, and share the `XXXX-XXXX` token. Join is
token-based with no accounts, which is ideal for a closed playtest.

## Notes and limits (fine for playtesting)

- **No auth or rate limiting.** Anyone with the URL can create games, and game data
  is effectively public. Good for a closed playtest; revisit before any public
  launch (see `ROADMAP.md` — accounts are post-M1).
- **Prod and dev data are separate.** Games created during development do not appear
  in the production deployment.
- **Tablets.** The primary audience is kids on tablets and the board is responsive,
  but eyeball it on a real tablet before handing out the link.
- **Cost.** Convex's free tier and Vercel's Hobby tier cover a small playtest
  (Vercel Hobby is non-commercial).

## Local development (reminder)

```sh
nvm use            # Node 22
npm install
npx convex dev     # terminal 1 — keep running; pushes schema + functions to your dev deployment
npm run dev        # terminal 2 — Next.js on http://localhost:3000
```

`npx convex dev` populates `.env.local` with your dev `NEXT_PUBLIC_CONVEX_URL`. Keep
exactly one such line; duplicates make the Convex CLI warn that it "cannot update
automatically."
