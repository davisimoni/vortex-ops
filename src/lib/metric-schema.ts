import { z } from "zod";

/**
 * Wire schema for a streamed sample.
 *
 * The stream is same-origin today, but the client parses every frame anyway:
 * a malformed frame should surface as a dropped sample and a warning, not as
 * `NaN` propagating silently into the health score and every chart on the page.
 */
export const metricPointSchema = z.object({
  t: z.number().int().positive(),
  latencyP50: z.number().nonnegative(),
  latencyP95: z.number().nonnegative(),
  latencyP99: z.number().nonnegative(),
  cpu: z.number().min(0).max(100),
  errorRate: z.number().min(0).max(100),
  throughput: z.number().nonnegative(),
});

export const streamFrameSchema = z.object({
  type: z.literal("sample"),
  point: metricPointSchema,
  /** Monotonic counter, so a client can detect gaps after a reconnect. */
  seq: z.number().int().nonnegative(),
});

export type StreamFrame = z.infer<typeof streamFrameSchema>;
