import type { z } from "zod";

import { logger, requestId } from "@/lib/logger";
import { authErrorResponse } from "@/server/session/context";

/**
 * Route plumbing.
 *
 * Every handler returns `no-store`. These responses carry one tenant's data,
 * scoped by a cookie; a shared cache that keyed on the URL alone would serve
 * Acme's incidents to Stark. Setting it in one place is the only way it does
 * not get forgotten on the fifteenth route.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonOk<T>(data: T, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...NO_STORE, ...(init.headers ?? {}) },
  });
}

export function jsonError(
  error: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error, message, ...extra }, { status, headers: NO_STORE });
}

/**
 * Parses and validates a JSON body.
 *
 * Returns a discriminated result rather than throwing, so a handler reads as a
 * straight line and a malformed body produces a 400 that names the field —
 * "body: expected object" tells an integrator nothing.
 */
export async function readJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonError("invalid_json", "Request body must be valid JSON.", 400),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      response: jsonError(
        "invalid_request",
        first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request body.",
        400,
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Wraps a handler so authorisation failures become 401/403 and everything else
 * becomes a 500 that logs the cause without echoing it.
 *
 * The message returned on an unexpected error is deliberately generic: a stack
 * trace or a database error string in the response body tells an attacker about
 * the schema, the driver and the file layout.
 */
export function route(
  name: string,
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>,
) {
  return async (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      const mapped = authErrorResponse(error);
      if (mapped) return mapped;

      const id = requestId(request.headers);
      logger.exception("Unhandled route error", error, { route: name, requestId: id, method: request.method });

      return jsonError("internal_error", "Something went wrong. The failure has been logged.", 500, {
        requestId: id,
      });
    }
  };
}
