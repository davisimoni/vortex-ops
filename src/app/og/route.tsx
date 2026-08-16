import { ImageResponse } from "next/og";

/**
 * Dynamic OpenGraph image — dark/cyber, matching the app's own dark palette
 * rather than a generic template.
 *
 * Edge runtime, deliberately unlike the rest of the app: everywhere else
 * `node:crypto` (signing session cookies, encrypting credentials) forces the
 * Node runtime, but this route touches no session, no database and no
 * secret — it is pure, stateless rendering, exactly the case edge is for.
 */
export const runtime = "edge";

const WIDTH = 1_200;
const HEIGHT = 630;

const TITLE = "Vortex Ops — Real-Time Infrastructure Monitoring B2B SaaS";
const SUBTITLE_ITEMS = [
  "Live SSE Metrics",
  "Chaos Engineering",
  "SOC2 Compliance",
  "Multi-Tenant RBAC",
];

// The same reserved status/brand tokens `globals.css` defines for dark mode —
// hard-coded here because this route renders with no CSS file and no theme
// context, only inline styles Satori can read.
const INK = "#ffffff";
const MUTED = "#8b8f99";
const BRAND = "#3987e5";
const SERIES_TEAL = "#199e70";
const SERIES_AMBER = "#c98500";

function GridBackdrop() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
      }}
    />
  );
}

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          padding: "64px 72px",
          backgroundColor: "#0a0c10",
          backgroundImage: "linear-gradient(135deg, #0a0c10 0%, #10131a 55%, #0d1a1f 100%)",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <GridBackdrop />

        {/* Soft radial glow behind the headline, for the "cyber" depth. */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 620,
            height: 620,
            display: "flex",
            borderRadius: 9999,
            backgroundImage: `radial-gradient(circle, ${BRAND}55 0%, rgba(57,135,229,0) 70%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -80,
            width: 520,
            height: 520,
            display: "flex",
            borderRadius: 9999,
            backgroundImage: `radial-gradient(circle, ${SERIES_TEAL}40 0%, rgba(25,158,112,0) 70%)`,
          }}
        />

        {/* Brand mark, top row. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: BRAND,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round">
              <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1" />
            </svg>
          </div>
          <span
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 1,
              color: INK,
              textTransform: "uppercase",
            }}
          >
            Vortex Ops
          </span>
        </div>

        {/* Headline block. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28, position: "relative", maxWidth: 1000 }}>
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -1,
              color: INK,
            }}
          >
            {TITLE}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {SUBTITLE_ITEMS.map((item, index) => {
              const dotColor = [BRAND, SERIES_TEAL, SERIES_AMBER, BRAND][index % 4];
              return (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "10px 18px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    backgroundColor: "rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      backgroundColor: dotColor,
                    }}
                  />
                  <span style={{ display: "flex", fontSize: 22, fontWeight: 500, color: "#e6e8ec" }}>
                    {item}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer row. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
          }}
        >
          <span style={{ display: "flex", fontSize: 20, color: MUTED }}>
            Next.js 15 · Prisma · Zustand · Server-Sent Events
          </span>
          <span style={{ display: "flex", fontSize: 20, color: MUTED }}>vortex-ops.example</span>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
