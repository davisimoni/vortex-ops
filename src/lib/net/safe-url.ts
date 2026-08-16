/**
 * SSRF guard for user-supplied webhook destinations.
 *
 * The integration builder lets a customer type a URL that our server will then
 * request. Without this check that is a server-side request forgery primitive:
 * `http://169.254.169.254/latest/meta-data/` reads the cloud instance's
 * credentials, and `http://localhost:5432` port-scans our own network from
 * inside the perimeter.
 *
 * The rules live in exactly one module and are applied twice — when the
 * integration is saved and again immediately before delivery. Validating only
 * at save time is not enough: DNS can be re-pointed at a private address after
 * the record is stored.
 */

import { isProductionDeployment } from "@/lib/runtime-env";

export type UrlRejectionReason =
  | "invalid"
  | "scheme"
  | "credentials"
  | "private_host"
  | "port"
  | "host_not_allowed";

export interface UrlCheckResult {
  readonly ok: boolean;
  readonly reason?: UrlRejectionReason;
  readonly message?: string;
  readonly url?: URL;
}

/** Ports a webhook may target. Anything else is almost certainly a scan. */
const ALLOWED_PORTS = new Set([80, 443, 8443]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  // Cloud metadata endpoints, by name.
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** RFC1918 + loopback + link-local + CGNAT, as literal IPv4. */
function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;

  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;

  const [a = 0, b = 0] = octets;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const normalised = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalised === "::1" || normalised === "::") return true;
  // fc00::/7 (unique local), fe80::/10 (link-local).
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalised)) return true;
  // IPv4-mapped, e.g. ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalised);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

function allowsPrivateHosts(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  return (
    process.env.VORTEX_ALLOW_PRIVATE_WEBHOOK_HOSTS === "1" && !isProductionDeployment()
  );
}

/**
 * Exact-suffix host match.
 *
 * `hostname.endsWith(allowed)` alone would accept `hooks.slack.com.evil.test`,
 * so the character before the suffix must be a dot — or the host must equal the
 * allowed domain exactly.
 */
export function hostMatches(hostname: string, allowed: string): boolean {
  const host = hostname.toLowerCase();
  const domain = allowed.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export interface UrlCheckOptions {
  /** When provided, the host must match one of these domains exactly. */
  readonly allowedHosts?: readonly string[];
  /** Permit `http://`. Off by default — a webhook carries incident data. */
  readonly allowHttp?: boolean;
}

export function checkWebhookUrl(raw: string, options: UrlCheckOptions = {}): UrlCheckResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid", message: "Enter a full URL, including https://" };
  }

  const httpAllowed = options.allowHttp === true || allowsPrivateHosts();
  if (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:")) {
    return {
      ok: false,
      reason: "scheme",
      message: "Only https:// endpoints are accepted.",
    };
  }

  // Credentials in the URL end up in logs and proxy access records.
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      reason: "credentials",
      message: "Remove the username and password from the URL. Use a header or a signed payload.",
    };
  }

  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!ALLOWED_PORTS.has(port)) {
    return {
      ok: false,
      reason: "port",
      message: `Port ${port} is not allowed. Use 443, 80 or 8443.`,
    };
  }

  const hostname = url.hostname.toLowerCase();
  const isPrivate =
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    isPrivateIPv4(hostname) ||
    isPrivateIPv6(hostname) ||
    // A bare, dotless hostname resolves through internal search domains.
    !hostname.includes(".");

  if (isPrivate && !allowsPrivateHosts()) {
    return {
      ok: false,
      reason: "private_host",
      message: "Private, loopback and link-local addresses cannot receive webhooks.",
    };
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const matched = options.allowedHosts.some((allowed) => hostMatches(hostname, allowed));
    if (!matched) {
      return {
        ok: false,
        reason: "host_not_allowed",
        message: `This provider only accepts endpoints on: ${options.allowedHosts.join(", ")}.`,
      };
    }
  }

  return { ok: true, url };
}
