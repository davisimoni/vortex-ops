/**
 * CSV serialisation for compliance exports.
 *
 * Two things this does that a `values.join(",")` does not:
 *
 *  1. **RFC 4180 quoting.** Any field containing a comma, quote, CR or LF is
 *     wrapped in quotes with internal quotes doubled. Incident summaries contain
 *     all four, and an unquoted newline silently shifts every following column
 *     by one — a corrupted export nobody notices until an auditor reads it.
 *
 *  2. **Formula-injection neutralisation.** A field starting with `=`, `+`, `-`,
 *     `@`, tab or CR is executed as a formula when the file is opened in Excel,
 *     Sheets or LibreOffice. `=cmd|'/c calc'!A1` in an incident title becomes
 *     code execution on the auditor's machine. Prefixing with an apostrophe
 *     makes the cell inert while still reading as the original text.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const NEEDS_QUOTING = /[",\r\n]/;

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);

  // Neutralise before quoting: the guard has to be inside the quotes, or the
  // spreadsheet strips it along with them.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;

  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export interface CsvColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly value: (row: T) => unknown;
}

/**
 * Renders rows as CSV with a header line and CRLF terminators (RFC 4180 —
 * bare LF trips older Excel builds on Windows).
 *
 * A UTF-8 BOM leads the file: without it Excel decodes the bytes as the system
 * codepage and every accented service owner's name arrives mojibake'd.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCsvValue(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvValue(column.value(row))).join(","),
  );
  return `﻿${[header, ...body].join("\r\n")}\r\n`;
}

/**
 * A filename that is safe in a `Content-Disposition` header.
 *
 * Quotes and newlines in a filename are a header-injection vector, and every
 * OS rejects a different subset of punctuation — so everything outside a known
 * safe set becomes a hyphen rather than being passed through and hoped for.
 */
export function safeFilename(parts: readonly string[], extension: string): string {
  const stem = parts
    .map((part) => part.replace(/[^A-Za-z0-9._-]+/g, "-"))
    .filter((part) => part.length > 0)
    .join("_")
    .replace(/-{2,}/g, "-")
    .slice(0, 120);

  return `${stem || "export"}.${extension.replace(/[^a-z0-9]/gi, "")}`;
}

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
