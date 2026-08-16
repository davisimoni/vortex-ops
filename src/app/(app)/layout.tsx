import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/system/session-provider";
import { readSession } from "@/server/session/context";

/**
 * The authentication gate.
 *
 * Server-side, in a layout, rather than in middleware. Middleware runs on the
 * edge runtime by default, where `node:crypto` — which signs and verifies the
 * session cookie — does not exist. Doing it here keeps one implementation of
 * session verification for both pages and API routes instead of a second,
 * subtly different one compiled for a different runtime.
 *
 * Every page below this layout is therefore guaranteed a session, and every API
 * route re-checks independently: the gate decides what to *render*, the routes
 * decide what to *allow*.
 *
 * This is a portfolio deployment, so there is no sign-in wall: a request with
 * no valid session is sent to `/api/auth/demo-session`, which provisions a
 * real session for the seeded Owner persona and sends the visitor straight to
 * the dashboard — not to `/sign-in`. A Server Component cannot set a cookie
 * mid-render, which is why that provisioning lives in a route handler rather
 * than here. Explicit sign-in has not gone anywhere; it is one click away via
 * "Switch account" in the user menu, for anyone who wants a specific role.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const session = await readSession();

  if (!session) {
    redirect("/api/auth/demo-session");
  }

  return (
    <SessionProvider session={session}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
