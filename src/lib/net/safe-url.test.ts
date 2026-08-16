import { describe, expect, it } from "vitest";

import { checkWebhookUrl, hostMatches } from "@/lib/net/safe-url";

describe("checkWebhookUrl — accepts", () => {
  it("a public https endpoint", () => {
    expect(checkWebhookUrl("https://hooks.slack.com/services/T/B/X").ok).toBe(true);
  });

  it("an explicit port 443", () => {
    expect(checkWebhookUrl("https://ops.example.com:443/hook").ok).toBe(true);
  });

  it("http only when the caller opts in", () => {
    expect(checkWebhookUrl("http://ops.example.com/hook").ok).toBe(false);
    expect(checkWebhookUrl("http://ops.example.com/hook", { allowHttp: true }).ok).toBe(true);
  });
});

describe("checkWebhookUrl — rejects SSRF targets", () => {
  it.each([
    ["http://localhost:3000/hook", "scheme"],
    ["https://localhost/hook", "private_host"],
    ["https://127.0.0.1/hook", "private_host"],
    ["https://10.0.0.5/hook", "private_host"],
    ["https://172.16.4.2/hook", "private_host"],
    ["https://192.168.1.10/hook", "private_host"],
    // The AWS/GCP instance metadata endpoint — the classic SSRF payoff.
    ["https://169.254.169.254/latest/meta-data/", "private_host"],
    ["https://metadata.google.internal/computeMetadata/v1/", "private_host"],
    ["https://100.64.0.1/hook", "private_host"],
    ["https://[::1]/hook", "private_host"],
    ["https://redis.internal/hook", "private_host"],
    ["https://buildserver/hook", "private_host"],
  ])("%s", (url, reason) => {
    const result = checkWebhookUrl(url);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it("a non-http scheme", () => {
    expect(checkWebhookUrl("file:///etc/passwd").reason).toBe("scheme");
    expect(checkWebhookUrl("gopher://example.com/").reason).toBe("scheme");
  });

  it("credentials embedded in the URL", () => {
    // They end up in proxy logs and access records.
    expect(checkWebhookUrl("https://user:pass@example.com/hook").reason).toBe("credentials");
  });

  it("a port that is neither 80, 443 nor 8443", () => {
    expect(checkWebhookUrl("https://example.com:22/hook").reason).toBe("port");
    expect(checkWebhookUrl("https://example.com:6379/hook").reason).toBe("port");
  });

  it("unparseable input", () => {
    expect(checkWebhookUrl("not a url").reason).toBe("invalid");
    expect(checkWebhookUrl("").reason).toBe("invalid");
  });
});

describe("checkWebhookUrl — host allowlist", () => {
  it("accepts the exact domain and its subdomains", () => {
    expect(checkWebhookUrl("https://hooks.slack.com/x", { allowedHosts: ["hooks.slack.com"] }).ok).toBe(
      true,
    );
    expect(
      checkWebhookUrl("https://eu.events.pagerduty.com/x", {
        allowedHosts: ["events.pagerduty.com"],
      }).ok,
    ).toBe(true);
  });

  it("refuses a lookalike suffix", () => {
    // `endsWith` alone would accept this, which is the whole point of the check.
    const result = checkWebhookUrl("https://hooks.slack.com.evil.test/x", {
      allowedHosts: ["hooks.slack.com"],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("host_not_allowed");
  });

  it("refuses a host outside the list", () => {
    expect(
      checkWebhookUrl("https://example.com/x", { allowedHosts: ["hooks.slack.com"] }).reason,
    ).toBe("host_not_allowed");
  });
});

describe("hostMatches", () => {
  it("matches the domain itself and true subdomains only", () => {
    expect(hostMatches("hooks.slack.com", "hooks.slack.com")).toBe(true);
    expect(hostMatches("eu.hooks.slack.com", "hooks.slack.com")).toBe(true);
    expect(hostMatches("HOOKS.SLACK.COM", "hooks.slack.com")).toBe(true);
    expect(hostMatches("evilhooks.slack.com.attacker.test", "hooks.slack.com")).toBe(false);
    expect(hostMatches("nothooks.slack.com", "hooks.slack.co")).toBe(false);
  });
});
