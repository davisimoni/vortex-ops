import { describe, expect, it } from "vitest";

import { escapeCsvValue, safeFilename, toCsv, type CsvColumn } from "@/lib/csv";

describe("escapeCsvValue", () => {
  it("leaves a plain value unquoted", () => {
    expect(escapeCsvValue("INC-2411")).toBe("INC-2411");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvValue("Acme, Inc.")).toBe('"Acme, Inc."');
  });

  it("quotes and doubles internal quotes", () => {
    expect(escapeCsvValue('He said "hello"')).toBe('"He said ""hello"""');
  });

  it("quotes a value containing a newline", () => {
    expect(escapeCsvValue("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvValue("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("renders null and undefined as an empty field", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("serialises a Date as ISO 8601", () => {
    expect(escapeCsvValue(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stringifies a plain object as JSON", () => {
    expect(escapeCsvValue({ a: 1 })).toBe('"{""a"":1}"');
  });

  describe("formula injection", () => {
    // Opening a CSV with a formula-shaped cell in Excel/Sheets/LibreOffice
    // executes it. An incident title is operator-supplied text that lands in
    // exactly this kind of file.
    it.each(["=cmd|'/c calc'!A1", "+1+1", "-2+3", "@SUM(A1:A9)", "\tmalicious"])(
      "prefixes a leading-trigger value %s with an apostrophe",
      (input) => {
        expect(escapeCsvValue(input)).toBe(`'${input}`);
      },
    );

    it("prefixes AND quotes a leading-CR value, since \\r also forces quoting", () => {
      // Unlike the other triggers, a leading CR is itself one of the
      // characters that forces RFC 4180 quoting — both guards fire at once.
      expect(escapeCsvValue("\rmalicious")).toBe('"\'\rmalicious"');
    });

    it("keeps the apostrophe guard even when the value also needs quoting", () => {
      // The neutralising apostrophe has to be *inside* the quotes, or the
      // spreadsheet strips it along with them and the formula is live again.
      expect(escapeCsvValue("=A1,B1")).toBe('"\'=A1,B1"');
    });

    it("does not neutralise a value that merely contains an operator mid-string", () => {
      expect(escapeCsvValue("latency > 900ms")).toBe("latency > 900ms");
    });

    it("does not flag a value that starts with a digit or letter", () => {
      expect(escapeCsvValue("2x throughput")).toBe("2x throughput");
    });
  });
});

describe("toCsv", () => {
  interface Row {
    readonly id: string;
    readonly note: string;
  }

  const columns: readonly CsvColumn<Row>[] = [
    { key: "id", header: "ID", value: (row) => row.id },
    { key: "note", header: "Note", value: (row) => row.note },
  ];

  it("starts with a UTF-8 BOM so Excel decodes accented text correctly", () => {
    const csv = toCsv<Row>([], columns);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("writes a header row followed by CRLF-terminated data rows", () => {
    const csv = toCsv([{ id: "1", note: "fine" }], columns);
    const lines = csv.replace(/^﻿/, "").split("\r\n");

    expect(lines[0]).toBe("ID,Note");
    expect(lines[1]).toBe("1,fine");
    // A trailing CRLF, so the file ends cleanly rather than on a bare EOF.
    expect(lines[2]).toBe("");
  });

  it("quotes a field that needs it without breaking column alignment", () => {
    const csv = toCsv([{ id: "1", note: "has, a comma" }], columns);
    const dataLine = csv.replace(/^﻿/, "").split("\r\n")[1];
    expect(dataLine).toBe('1,"has, a comma"');
  });

  it("renders an empty dataset as just the header", () => {
    const csv = toCsv<Row>([], columns);
    expect(csv.replace(/^﻿/, "")).toBe("ID,Note\r\n");
  });
});

describe("safeFilename", () => {
  it("joins parts with underscores", () => {
    expect(safeFilename(["vortex", "acme", "incidents"], "csv")).toBe("vortex_acme_incidents.csv");
  });

  it("replaces characters unsafe in a Content-Disposition header", () => {
    expect(safeFilename(['"; evil="x'], "csv")).toBe("-evil-x.csv");
  });

  it("strips characters that could inject a header, including CRLF", () => {
    const malicious = 'report\r\nX-Injected: true"';
    const result = safeFilename([malicious], "csv");
    expect(result).not.toMatch(/[\r\n"]/);
  });

  it("collapses repeated separators", () => {
    expect(safeFilename(["a", "", "b"], "csv")).toBe("a_b.csv");
  });

  it("sanitises the extension too", () => {
    expect(safeFilename(["report"], "csv;drop")).toMatch(/^report\.[a-z]+$/);
  });

  it("falls back to a generic name when every part is genuinely empty", () => {
    expect(safeFilename(["", "", ""], "json")).toBe("export.json");
  });

  it("does not fall back when punctuation-only parts still leave a hyphen", () => {
    // "***" is not an empty part — it becomes "-", which is real (if ugly)
    // content, not nothing. Only true emptiness triggers the fallback.
    expect(safeFilename(["***"], "json")).toBe("-.json");
  });

  it("truncates a very long name", () => {
    const result = safeFilename(["x".repeat(500)], "csv");
    expect(result.length).toBeLessThan(140);
  });
});
