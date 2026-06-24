"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  // Fail loud with an actionable message instead of Convex's terse
  // "No address provided to ConvexReactClient" (which surfaces during the
  // production build's prerender, far from the actual cause).
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Locally: run `npx convex dev` so .env.local " +
      "is populated. On Vercel: set the Build Command to " +
      "`npx convex deploy --cmd 'npm run build'` so Convex injects the URL at build time " +
      "(see docs/DEPLOY.md).",
  );
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
