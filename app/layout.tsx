import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";

export const metadata: Metadata = {
  title: "TinkerChess",
  description: "A fog-of-war chess variant where pieces phase out and reappear.",
};

// Mobile/iPad: render at device width and allow zoom (accessibility — never cap
// maximum-scale). The board itself opts out of browser touch gestures via CSS so
// dragging a piece never pans the page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// A small build-identity tag in the corner, so it's always clear which version is
// running. Version comes from package.json (NEXT_PUBLIC_APP_VERSION); the short
// commit SHA is appended on Vercel deploys. Both are inlined at build time.
function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!version) return null;
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;
  return (
    <div className="version-badge" aria-hidden>
      v{version}
      {sha ? ` · ${sha}` : ""}
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <VersionBadge />
      </body>
    </html>
  );
}
