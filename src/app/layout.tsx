import type { Metadata, Viewport } from "next";

import "@/app/globals.css";

import { THEME_BOOTSTRAP_SCRIPT } from "@/components/theme/theme-toggle";

export const metadata: Metadata = {
  title: {
    default: "Vortex Ops — Infrastructure monitoring & incident response",
    template: "%s · Vortex Ops",
  },
  description:
    "Real-time infrastructure metrics, threshold alerting, incident response, webhook routing and SOC 2 compliance exports for engineering teams.",
  applicationName: "Vortex Ops",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the page plane in each mode so the mobile browser chrome does not
  // sit as a white band above a dark dashboard.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f13" },
  ],
};

/**
 * Root layout — document shell only.
 *
 * The application chrome lives in `(app)/layout.tsx`, behind the authentication
 * gate. Keeping it out of here is what lets the sign-in page render without a
 * sidebar, a session, or a call to the database.
 */
export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint to avoid a light flash in dark mode. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
