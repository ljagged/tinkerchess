/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Allow webpack to resolve the engine's `./foo.js` import specifiers to the
    // `.ts` source (the engine is written with explicit ESM extensions). Only
    // matters if the engine is ever imported into client/runtime code; harmless
    // otherwise.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
