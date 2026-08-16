/**
 * Demo accounts used across the E2E suite, mirroring `src/server/seed/fixtures.ts`.
 *
 * Kept in one place so a seed change only needs updating here, not in every
 * spec file that signs in as one of these people.
 */
export const DEMO_PASSWORD = process.env.VORTEX_DEMO_PASSWORD ?? "vortex-demo-2026";

export const ACCOUNTS = {
  /** Owner at Acme (production), Viewer at Stark (staging) — the same person. */
  acmeOwner: { email: "ada.okafor@vortex-ops.example", name: "Ada Okafor", org: "org_acme" },
  acmeDevops: { email: "marco.bellini@vortex-ops.example", name: "Marco Bellini", org: "org_acme" },
  acmeViewer: { email: "lena.vogt@vortex-ops.example", name: "Lena Vogt", org: "org_acme" },
  starkOwner: { email: "nina.kovac@vortex-ops.example", name: "Nina Kovač", org: "org_stark" },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
