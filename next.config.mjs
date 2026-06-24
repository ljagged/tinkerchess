/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app never imports the pure engine (the server is authoritative; the
  // engine is bundled only by Convex and the test runner, which resolve its
  // `./foo.js` -> `.ts` ESM specifiers themselves). So Next needs no custom
  // module resolution — Turbopack (the Next 16 default) runs with defaults.
  turbopack: {},
};

export default nextConfig;
