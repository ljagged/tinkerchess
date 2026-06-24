import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app never imports the pure engine (the server is authoritative; the
  // engine is bundled only by Convex and the test runner, which resolve its
  // `./foo.js` -> `.ts` ESM specifiers themselves). So Next needs no custom
  // module resolution — Turbopack (the Next 16 default) runs with defaults.
  turbopack: {},
  // Surface the build's identity to the client, inlined at build time: the semver
  // version from package.json, plus the short commit SHA on Vercel deploys (empty
  // locally). Shown in the corner of the UI — see app/layout.tsx.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
  },
};

export default nextConfig;
