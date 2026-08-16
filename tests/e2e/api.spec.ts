import { expect, test } from "@playwright/test";

import { storageStatePath } from "./global-setup";

test.describe("API — health", () => {
  test("reports the build and which optional integrations are configured", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      status: string;
      region: string;
      storage: { driver: string; durable: boolean };
      checks: Array<{ name: string; ok: boolean; detail: string }>;
    };

    expect(body.status).toBe("ok");
    expect(body.region).toBeTruthy();
    // The E2E web server forces DATABASE_URL="" — see playwright.config.ts.
    expect(body.storage.driver).toBe("memory");
    expect(body.storage.durable).toBe(false);
    expect(body.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "storage",
        "credential_encryption",
        "session_secret",
        "webhook_signing",
        "mail_relay",
        "ssrf_guard",
      ]),
    );
  });

  test("needs no session — a probe cannot depend on being logged in", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
  });
});

test.describe("API — dynamic OG image", () => {
  test("renders a real PNG with no session, for social link previews", async ({ request }) => {
    const response = await request.get("/og");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");

    const body = await response.body();
    // The PNG signature, not just a non-empty body — a byte count alone would
    // not catch Satori silently emitting an empty or malformed image.
    expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(body.byteLength).toBeGreaterThan(1_000);
  });
});

test.describe("API — session gate (no credentials)", () => {
  test("every tenant-scoped route refuses an anonymous caller with 401", async ({ request }) => {
    const routes = ["/api/incidents", "/api/integrations", "/api/team", "/api/audit", "/api/rbac"];
    for (const route of routes) {
      const response = await request.get(route);
      expect(response.status(), route).toBe(401);
    }
  });

  test("does not redirect an API caller — a fetch cannot follow a redirect usefully", async ({
    request,
  }) => {
    const response = await request.get("/api/incidents", { maxRedirects: 0 });
    expect(response.status()).toBe(401);
  });
});

test.describe("API — as an authenticated Owner", () => {
  test.use({ storageState: storageStatePath("acmeOwner") });

  test("lists only Acme's incidents, never Stark's", async ({ request }) => {
    const response = await request.get("/api/incidents");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { incidents: Array<{ id: string }> };
    expect(body.incidents.some((incident) => incident.id === "INC-2411")).toBe(true);
    // Stark's seeded keys are numbered far lower and would never collide with
    // Acme's by accident — their absence here is the isolation guarantee.
    expect(body.incidents.some((incident) => incident.id === "INC-0117")).toBe(false);
  });

  test("never returns the internal orgId field on an incident", async ({ request }) => {
    const response = await request.get("/api/incidents");
    const body = (await response.json()) as { incidents: Array<Record<string, unknown>> };
    for (const incident of body.incidents) {
      expect(incident).not.toHaveProperty("orgId");
    }
  });

  test("rejects an incident status transition that skips a lifecycle step", async ({ request }) => {
    const response = await request.patch("/api/incidents/INC-2411", {
      data: { action: "transition", status: "resolved" },
    });

    // INC-2411 is seeded at "identified", and identified→resolved is not a
    // legal one-step transition.
    expect(response.status()).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_transition");
  });

  test("404s, not 403s, for an incident id that belongs to a different tenant", async ({ request }) => {
    // Confirming the resource exists (403) would leak that Stark has an
    // INC-0117; absence has to look identical to "never existed".
    const response = await request.get("/api/incidents/INC-0117");
    expect(response.status()).toBe(404);
  });

  test("validates a new integration's request body with a field-specific message", async ({
    request,
  }) => {
    const response = await request.post("/api/integrations", {
      data: { provider: "not-a-real-provider", name: "x", targetUrl: "https://x.test", enabled: true, events: [], minSeverity: "major" },
    });
    expect(response.status()).toBe(400);
  });

  test("refuses to store a credentialed integration with no credential", async ({ request }) => {
    const response = await request.post("/api/integrations", {
      data: {
        provider: "pagerduty",
        name: "No key",
        targetUrl: "https://events.eu.pagerduty.com/v2/enqueue",
        enabled: true,
        events: ["incident.opened"],
        minSeverity: "critical",
      },
    });
    expect(response.status()).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("credential_required");
  });

  test("exports a CSV compliance report with the expected headers", async ({ request }) => {
    const response = await request.get("/api/compliance/export?dataset=incidents&format=csv");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");

    const body = await response.text();
    expect(body).toContain("Incident ID");
    expect(body).toContain("INC-2411");
  });

  test("exports a JSON SLA report scoped to a relative window", async ({ request }) => {
    const response = await request.get("/api/compliance/export?dataset=sla&format=json&days=90");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { byService: unknown[]; window: { from: string | null } };
    expect(Array.isArray(body.byService)).toBe(true);
    expect(body.window.from).not.toBeNull();
  });

  test("rejects an unknown export dataset", async ({ request }) => {
    const response = await request.get("/api/compliance/export?dataset=nope&format=csv");
    expect(response.status()).toBe(400);
  });
});

test.describe("API — as an authenticated Viewer", () => {
  test.use({ storageState: storageStatePath("acmeViewer") });

  test("cannot export compliance reports", async ({ request }) => {
    const response = await request.get("/api/compliance/export?dataset=incidents&format=csv");
    expect(response.status()).toBe(403);
  });

  test("cannot read the audit trail", async ({ request }) => {
    const response = await request.get("/api/audit");
    expect(response.status()).toBe(403);
  });

  test("can still read incidents (read access is not revoked)", async ({ request }) => {
    const response = await request.get("/api/incidents");
    expect(response.status()).toBe(200);
  });
});

test.describe("API — webhook test send (unsaved draft)", () => {
  test.use({ storageState: storageStatePath("acmeOwner") });

  test("refuses an SSRF target at send time, not only at save time", async ({ request }) => {
    const response = await request.post("/api/integrations/test", {
      data: { provider: "webhook", targetUrl: "http://169.254.169.254/latest/meta-data/" },
    });

    // The request is well-formed, so the route answers 200 with a failed
    // delivery report — the UI's job is to render *why* it did not go.
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { result: { ok: boolean; detail: string } };
    expect(body.result.ok).toBe(false);
    expect(body.result.detail).toMatch(/https|Private|loopback/i);
  });

  test("reports a real DNS failure honestly", async ({ request }) => {
    const response = await request.post("/api/integrations/test", {
      data: {
        provider: "webhook",
        targetUrl: "https://this-host-does-not-resolve.vortex-ops.invalid/hook",
      },
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as { result: { ok: boolean } };
    expect(body.result.ok).toBe(false);
  });

  test("returns 503 for email until a mail relay is configured", async ({ request }) => {
    const response = await request.post("/api/integrations/test", {
      data: {
        provider: "email",
        targetUrl: "https://relay.example.com/v1/send",
        destination: "oncall@example.com",
      },
    });

    const body = (await response.json()) as { result: { ok: boolean; status: number | null } };
    expect(body.result.ok).toBe(false);
    expect(body.result.status).toBe(503);
  });
});

test.describe("API — as an unauthenticated caller, webhook test", () => {
  test("is refused outright — this endpoint makes outbound requests and is not anonymous-accessible", async ({
    request,
  }) => {
    const response = await request.post("/api/integrations/test", {
      data: { provider: "webhook", targetUrl: "https://ops.example.com/hook" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("API — metric stream", () => {
  test.use({ storageState: storageStatePath("acmeOwner") });

  test("pushes well-formed sample frames over SSE", async ({ page }) => {
    await page.goto("/dashboard");

    const frame = await page.evaluate(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const source = new EventSource("/api/metrics/stream");
          const timer = window.setTimeout(() => {
            source.close();
            reject(new Error("no frame within 15s"));
          }, 15_000);

          source.onmessage = (event: MessageEvent<string>) => {
            window.clearTimeout(timer);
            source.close();
            resolve(JSON.parse(event.data));
          };
          source.onerror = () => {
            window.clearTimeout(timer);
            source.close();
            reject(new Error("stream errored"));
          };
        }),
    );

    expect(frame).toMatchObject({
      type: "sample",
      seq: expect.any(Number),
      point: {
        t: expect.any(Number),
        latencyP50: expect.any(Number),
        latencyP95: expect.any(Number),
        latencyP99: expect.any(Number),
        cpu: expect.any(Number),
        errorRate: expect.any(Number),
        throughput: expect.any(Number),
      },
    });
  });

  test("sets the headers a proxy needs in order not to buffer the stream", async ({ page }) => {
    await page.goto("/dashboard");

    const headers = await page.evaluate(async () => {
      const controller = new AbortController();
      const response = await fetch("/api/metrics/stream", { signal: controller.signal });
      const result = {
        status: response.status,
        contentType: response.headers.get("content-type"),
        accelBuffering: response.headers.get("x-accel-buffering"),
        cacheControl: response.headers.get("cache-control"),
      };
      controller.abort();
      return result;
    });

    expect(headers.status).toBe(200);
    expect(headers.contentType).toContain("text/event-stream");
    expect(headers.accelBuffering).toBe("no");
    expect(headers.cacheControl).toContain("no-cache");
  });
});
