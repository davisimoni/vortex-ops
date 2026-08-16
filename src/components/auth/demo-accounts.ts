import { DEMO_PASSWORD } from "@/server/seed/fixtures";

/**
 * The seeded accounts, offered as one-click sign-ins on the demo.
 *
 * Listed with their roles because that is the point of the page: RBAC is real
 * now, so the way to see a Viewer's experience is to *be* a Viewer, not to
 * toggle a client-side flag. Ada is deliberately an Owner at Acme and a Viewer
 * at Stark — the same person, different authority, decided per tenant.
 */
export interface DemoAccount {
  readonly email: string;
  readonly name: string;
  readonly summary: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "ada.okafor@vortex-ops.example",
    name: "Ada Okafor",
    summary: "Owner at Acme Corp · Viewer at Stark Industries",
  },
  {
    email: "marco.bellini@vortex-ops.example",
    name: "Marco Bellini",
    summary: "DevOps at Acme Corp",
  },
  {
    email: "lena.vogt@vortex-ops.example",
    name: "Lena Vogt",
    summary: "Viewer at Acme Corp",
  },
  {
    email: "nina.kovac@vortex-ops.example",
    name: "Nina Kovač",
    summary: "Owner at Stark Industries",
  },
] as const;

/**
 * The demo password, shown on the sign-in page — but only when it is the
 * built-in one.
 *
 * A deployment that sets `VORTEX_DEMO_PASSWORD` has chosen its own, and
 * printing that on an unauthenticated page would hand it to anyone who loads
 * the URL.
 */
export function demoPasswordHint(): string | null {
  return process.env.VORTEX_DEMO_PASSWORD ? null : DEMO_PASSWORD;
}
