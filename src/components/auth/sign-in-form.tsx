"use client";

import { useState } from "react";

import type { DemoAccount } from "@/components/auth/demo-accounts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { apiPost } from "@/lib/api-client";

interface SignInResponse {
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
  readonly organization: { readonly id: string; readonly slug: string; readonly name: string };
}

export function SignInForm({
  accounts,
  passwordHint,
}: {
  readonly accounts: readonly DemoAccount[];
  readonly passwordHint: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);

    const result = await apiPost<SignInResponse>("/api/auth/sign-in", { email, password });

    setSubmitting(false);

    if (!result.ok) {
      setError(result.failure.message);
      return;
    }

    // A full navigation, not client-side routing: the layout above every page
    // reads the session server-side, and a client transition would render the
    // dashboard shell with the *previous* (absent) session for one frame.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional, see above
    window.location.assign("/dashboard");
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Email" required>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ada.okafor@vortex-ops.example"
            />
          )}
        </Field>

        <Field
          label="Password"
          required
          error={error ?? undefined}
          description={passwordHint ? `Demo password: ${passwordHint}` : undefined}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          )}
        </Field>

        <Button type="submit" variant="primary" loading={submitting} className="mt-1">
          Sign in
        </Button>
      </form>

      <div className="rounded-xl border border-hairline bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-ink2">Demo accounts</p>
        <ul className="flex flex-col gap-1.5">
          {accounts.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                onClick={() => setEmail(account.email)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-raised"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink">{account.name}</span>
                  <span className="block truncate text-[11px] text-muted">{account.summary}</span>
                </span>
                <span className="shrink-0 text-[11px] text-brand">Use</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
