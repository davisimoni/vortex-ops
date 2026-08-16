import { z } from "zod";

import { LOG_LEVELS } from "@/lib/logger";

/**
 * Wire schema for the log stream, mirroring `metric-schema.ts`.
 *
 * Same-origin today, parsed anyway: a malformed frame should surface as one
 * dropped line and a warning, not as a viewer that silently stops updating.
 */
export const logEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  capturedAt: z.string(),
  level: z.enum(LOG_LEVELS as unknown as [string, ...string[]]),
  line: z.string(),
});

/**
 * Client components import this rather than `LogEntry` from `@/lib/log-buffer`
 * — that module holds the actual server-side ring buffer, and there is no
 * reason for a browser bundle to reference it even via an erased type-only
 * import. The two shapes are structurally identical by construction.
 */
export type LogEntry = z.infer<typeof logEntrySchema>;

export const logStreamFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("backlog"), entries: z.array(logEntrySchema) }),
  z.object({ type: z.literal("entry"), entry: logEntrySchema }),
]);

export type LogStreamFrame = z.infer<typeof logStreamFrameSchema>;
