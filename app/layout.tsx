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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
