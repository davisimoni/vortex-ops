"use client";

/**
 * Browser-side API client.
 *
 * Returns a discriminated result instead of throwing. Every call site here has
 * to render the failure — a 403 from the permission guard, a 409 from the
 * incident state machine, a 503 when credential encryption is unconfigured —
 * and each of those is a message a person needs to read, not an exception to
 * swallow in a catch block three layers up.
 */

export interface ApiFailure {
  readonly status: number;
  readonly error: string;
  readonly message: string;
  readonly requiredPermission?: string;
  readonly retryAfter?: number;
}

export type ApiResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: ApiFailure };

const NETWORK_FAILURE: ApiFailure = {
  status: 0,
  error: "network_error",
  // Distinguished from a server-reported failure on purpose: "the request never
  // left the browser" and "the server said no" need different fixes.
  message: "Could not reach Vortex Ops. Check your connection and try again.",
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      // The session cookie is same-origin and httpOnly; this is explicit so a
      // future move to a separate API origin fails loudly rather than silently
      // dropping credentials.
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, failure: NETWORK_FAILURE };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = (payload ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      failure: {
        status: response.status,
        error: typeof body.error === "string" ? body.error : "request_failed",
        message:
          typeof body.message === "string"
            ? body.message
            : `The request failed with status ${response.status}.`,
        ...(typeof body.requiredPermission === "string"
          ? { requiredPermission: body.requiredPermission }
          : {}),
        ...(typeof body.retryAfter === "number" ? { retryAfter: body.retryAfter } : {}),
      },
    };
  }

  return { ok: true, data: (payload ?? {}) as T };
}

export function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<ApiResult<T>> {
  return apiFetch<T>(path, { method: "DELETE" });
}
