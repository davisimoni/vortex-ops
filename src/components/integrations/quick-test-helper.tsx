"use client";

import { ArrowRight, Rocket } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PROVIDERS } from "@/lib/webhooks/providers";
import type { IntegrationProvider } from "@/types";

const QUICK_PROVIDERS: readonly IntegrationProvider[] = ["discord", "telegram"];

export interface QuickTestHelperProps {
  readonly mayManage: boolean;
  readonly onStart: (provider: IntegrationProvider) => void;
}

/**
 * A fast path into a real send, for a visitor with no Discord server or
 * Telegram bot sitting open.
 *
 * There is nothing to pre-fill that would actually deliver anywhere — a
 * webhook URL or bot token committed to a public repository is a live
 * credential anyone reading the source could fire messages through, and a
 * fake one would just fail silently, teaching a visitor nothing. What *can*
 * be removed is everything else: this jumps straight to a builder pre-set to
 * the right provider (`draftForProvider` in `webhook-builder.tsx`, with a
 * throwaway name already filled in) with each provider's own setup hint —
 * already the source of truth in `PROVIDERS` — right underneath. Paste a URL
 * or token, save, and "Send test payload" fires a real, clearly-marked
 * notification.
 */
export function QuickTestHelper({ mayManage, onStart }: QuickTestHelperProps) {
  return (
    <Card className="border-brand/30 bg-brand/5">
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <Rocket aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">One-click notification test</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink2">
              Paste a real Discord webhook URL or Telegram bot token — takes under a minute to get
              one — and this sends a genuine, clearly-marked test notification: the exact request a
              real incident would trigger, not a simulation.
            </p>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {QUICK_PROVIDERS.map((provider) => {
            const definition = PROVIDERS[provider];
            return (
              <div
                key={provider}
                className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{definition.label}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!mayManage}
                    title={mayManage ? undefined : "Your role cannot create integrations."}
                    onClick={() => onStart(provider)}
                  >
                    Test with {definition.label}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted">{definition.setupHint}</p>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
