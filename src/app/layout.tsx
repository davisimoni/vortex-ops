import type { Metadata, Viewport } from "next";

import "@/app/globals.css";

import { THEME_BOOTSTRAP_SCRIPT } from "@/components/theme/theme-toggle";

const DESCRIPTION =
  "Real-time infrastructure metrics, threshold alerting, incident response, webhook routing and SOC 2 compliance exports for engineering teams.";

const SOCIAL_TITLE = "Vortex Ops — Real-Time Infrastructure Monitoring B2B SaaS";
const SOCIAL_DESCRIPTION =
  "Live SSE Metrics • Chaos Engineering • SOC2 Compliance • Multi-Tenant RBAC";

export const metadata: Metadata = {
  // Absolute URLs for og:image / twitter:image require a known base — unset,
  // Next resolves them against localhost and every shared link previews
  // broken on a real deployment. Falls back to localhost only for local dev.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Vortex Ops — Infrastructure monitoring & incident response",
    template: "%s · Vortex Ops",
  },
  description: DESCRIPTION,
  applicationName: "Vortex Ops",
  robots: { index: false, follow: false },
  // `robots: noindex` above keeps search engines out — it does not affect link
  // unfurling. Slack, LinkedIn and X all render a preview card from these tags
  // regardless of the indexing directive, generated dynamically by `/og`
  // (`src/app/og/route.tsx`) rather than a static asset that drifts from the copy.
  openGraph: {
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    siteName: "Vortex Ops",
    type: "website",
    images: [{ url: "/og", width: 1_200, height: 630, alt: SOCIAL_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    images: ["/og"],
  },
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
