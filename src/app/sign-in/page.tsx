import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { DEMO_ACCOUNTS, demoPasswordHint } from "@/components/auth/demo-accounts";
import { readSession } from "@/server/session/context";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Vortex Ops.",
};

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  // Already signed in: skip the form rather than letting somebody re-authenticate
  // into a second session for no reason.
  if (await readSession()) redirect("/dashboard");

  const hint = demoPasswordHint();

  return (
    <main className="flex min-h-dvh flex-col bg-plane">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <span className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-contrast">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">Vortex Ops</span>
        </span>
        <ThemeToggle />
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">
            Roles are per organisation. The account you use decides what you can do.
          </p>

          <div className="mt-6">
            <SignInForm accounts={DEMO_ACCOUNTS} passwordHint={hint} />
          </div>
        </div>
      </div>
    </main>
  );
}
