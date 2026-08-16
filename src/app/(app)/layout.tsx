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
 */
export default async function AuthenticatedLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const session = await readSession();

  if (!session) {
    // No `?next=` parameter: an open redirect parameter is a phishing primitive,
    // and the dashboard is one click away.
    redirect("/sign-in");
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
