import { z } from "zod";

import { INCIDENT_SEVERITIES } from "@/lib/incidents";
import { ROLES } from "@/lib/rbac";
import { PROVIDER_IDS, WEBHOOK_EVENTS } from "@/lib/webhooks/providers";

/**
 * Shared request schemas.
 *
 * Kept in one module so the create and update routes cannot drift into
 * accepting different shapes for the same resource — the classic way a
 * validation rule ends up enforced on POST and quietly skipped on PATCH.
 */

const asEnum = <T extends readonly string[]>(values: T): [string, ...string[]] =>
  values as unknown as [string, ...string[]];

export const severitySchema = z.enum(asEnum(INCIDENT_SEVERITIES));
export const roleSchema = z.enum(asEnum(ROLES));
export const providerSchema = z.enum(asEnum(PROVIDER_IDS));
export const webhookEventSchema = z.enum(asEnum(WEBHOOK_EVENTS));

/**
 * Credentials arrive as a bundle and are never echoed back.
 *
 * `null` on an update means "leave the stored credential alone" — the browser
 * does not hold the secret, so an ordinary edit cannot resend it, and an edit
 * must not silently disconnect a working channel.
 */
export const credentialSchema = z
  .object({
    token: z.string().min(1).max(512).optional(),
    destination: z.string().min(1).max(512).optional(),
  })
  .nullable()
  .optional();

export const integrationDraftSchema = z.object({
  provider: providerSchema,
  name: z.string().min(2).max(80),
  targetUrl: z.string().min(1).max(2_048),
  enabled: z.boolean(),
  events: z.array(webhookEventSchema).min(1).max(WEBHOOK_EVENTS.length),
  minSeverity: severitySchema,
  credential: credentialSchema,
});

export const integrationPatchSchema = integrationDraftSchema.partial().extend({
  credential: credentialSchema,
});

export const inviteSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().min(5).max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid email address."),
  role: roleSchema,
});
