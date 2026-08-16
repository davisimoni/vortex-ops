import { CSV_CONTENT_TYPE, JSON_CONTENT_TYPE, safeFilename, toCsv } from "@/lib/csv";
import { recordAudit } from "@/server/audit";
import {
  AUDIT_COLUMNS,
  buildSlaReport,
  INCIDENT_COLUMNS,
  SLA_COLUMNS,
} from "@/server/compliance/report";
import { jsonError, route } from "@/server/http";
import { getRepository } from "@/server/repository";
import { requirePermission } from "@/server/session/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATASETS = ["incidents", "audit", "sla"] as const;
const FORMATS = ["json", "csv"] as const;

type Dataset = (typeof DATASETS)[number];
type Format = (typeof FORMATS)[number];

function isDataset(value: string | null): value is Dataset {
  return value !== null && (DATASETS as readonly string[]).includes(value);
}

function isFormat(value: string | null): value is Format {
  return value !== null && (FORMATS as readonly string[]).includes(value);
}

/**
 * Compliance export.
 *
 * Three datasets — the incident register, the audit trail, and the SLA summary
 * — in JSON for a pipeline or CSV for a spreadsheet.
 *
 * Two things the response headers do, both deliberate:
 *
 *  - `Content-Disposition: attachment` with a sanitised filename. A CSV served
 *    inline that a browser decides to render is a stored-XSS surface, and an
 *    unsanitised filename is header injection.
 *  - `X-Content-Type-Options: nosniff`, so a browser cannot decide the CSV is
 *    really HTML and execute it.
 *
 * The CSV writer additionally neutralises spreadsheet formula injection — see
 * `src/lib/csv.ts`. Incident titles are operator-supplied text, and this file is
 * opened by an auditor in Excel.
 */
export const GET = route("/api/compliance/export", async (request) => {
  const session = await requirePermission("compliance:export");

  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset");
  const format = url.searchParams.get("format") ?? "json";

  if (!isDataset(dataset)) {
    return jsonError(
      "invalid_dataset",
      `dataset must be one of: ${DATASETS.join(", ")}.`,
      400,
    );
  }
  if (!isFormat(format)) {
    return jsonError("invalid_format", `format must be one of: ${FORMATS.join(", ")}.`, 400);
  }

  const repository = await getRepository();
  const generatedAt = Date.now();

  /*
   * The window boundary is resolved here, against the server's clock, not the
   * caller's. `days` (a relative count — "last 90 days") is the primary form:
   * it is what the export card sends, and it means "now" is always *this*
   * request's now. `from` (an absolute ISO instant) is accepted too, for a
   * script or a saved link that wants a fixed boundary rather than a rolling
   * one — the two are mutually exclusive; `days` wins if both are present.
   */
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Number(daysParam) : Number.NaN;

  const fromParam = url.searchParams.get("from");
  const from = fromParam ? Date.parse(fromParam) : Number.NaN;

  const window = Number.isFinite(days) && days > 0
    ? generatedAt - days * 86_400_000
    : Number.isFinite(from)
      ? from
      : null;

  let body: string;
  let rowCount: number;

  if (dataset === "audit") {
    // The audit trail is a superset of what the incident register shows, so it
    // carries its own permission rather than riding on the export one.
    if (!session.permissions.includes("audit:read")) {
      return jsonError("forbidden", "Your role cannot read the audit trail.", 403, {
        requiredPermission: "audit:read",
      });
    }

    const events = await repository.listAudit(session.organization.id, {
      limit: 5_000,
      ...(window === null ? {} : { since: window }),
    });
    rowCount = events.length;

    body =
      format === "csv"
        ? toCsv(events, AUDIT_COLUMNS)
        : JSON.stringify(
            {
              generatedAt: new Date(generatedAt).toISOString(),
              organization: { id: session.organization.id, slug: session.organization.slug },
              window: { from: window === null ? null : new Date(window).toISOString() },
              count: events.length,
              events,
            },
            null,
            2,
          );
  } else if (dataset === "incidents") {
    const all = await repository.listIncidents(session.organization.id);
    const incidents = window === null ? all : all.filter((incident) => incident.startedAt >= window);
    rowCount = incidents.length;

    body =
      format === "csv"
        ? toCsv(incidents, INCIDENT_COLUMNS)
        : JSON.stringify(
            {
              generatedAt: new Date(generatedAt).toISOString(),
              organization: { id: session.organization.id, slug: session.organization.slug },
              window: { from: window === null ? null : new Date(window).toISOString() },
              count: incidents.length,
              incidents,
            },
            null,
            2,
          );
  } else {
    const incidents = await repository.listIncidents(session.organization.id);
    const report = buildSlaReport(
      {
        id: session.organization.id,
        name: session.organization.name,
        slug: session.organization.slug,
      },
      incidents,
      { from: window },
    );
    rowCount = report.byService.length;

    body = format === "csv" ? toCsv(report.byService, SLA_COLUMNS) : JSON.stringify(report, null, 2);
  }

  const contentType = format === "csv" ? CSV_CONTENT_TYPE : JSON_CONTENT_TYPE;

  const filename = safeFilename(
    ["vortex", session.organization.slug, dataset, new Date(generatedAt).toISOString().slice(0, 10)],
    format,
  );

  // Exporting *is* an auditable event: an access review wants to know who took
  // a copy of the incident register off the platform, and when.
  await recordAudit(
    session,
    {
      action: "compliance.export",
      targetType: "report",
      targetId: dataset,
      metadata: { format, rows: rowCount, from: window },
    },
    request,
  );

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
});
