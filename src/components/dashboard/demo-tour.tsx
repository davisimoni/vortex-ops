"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Eye, Flame, Sparkles, SquareTerminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/system/session-provider";
import { usePreviewStore } from "@/store/session-store";
import { cn } from "@/lib/utils";

interface TourStep {
  readonly icon: typeof Sparkles;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly cta: ReactNode;
}

/**
 * A three-step walkthrough of the features most worth a recruiter's ninety
 * seconds — pointed entirely at things that are real: a live permission
 * table, a chaos drill that pages a real integration, and a public status
 * page nobody had to fake data for.
 *
 * Manually triggered, never on mount. An unsolicited modal on first load is
 * a cost every visitor pays, including the ones who came here to read code,
 * not click through a tour.
 */
export function DemoTour() {
  const router = useRouter();
  const session = useSession();
  const setPreviewRole = usePreviewStore((state) => state.setPreviewRole);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const close = (): void => setOpen(false);

  const previewAsViewer = (): void => {
    setPreviewRole(session.role === "viewer" ? null : "viewer");
    close();
    router.push("/settings/team");
  };

  const revealChaosButton = (): void => {
    close();
    document
      .getElementById("chaos-trigger")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const openLogs = (): void => {
    close();
    router.push("/dashboard/logs");
  };

  const steps: readonly TourStep[] = [
    {
      icon: Eye,
      eyebrow: "1 / 3 — Access control",
      title: "RBAC simulator — live, not decorative",
      body: "Every control in this app is gated by a real per-organisation permission table, the same one the API enforces. Flip your own view from Owner to Viewer and watch buttons lock across incidents, integrations and team — instantly, with no reload.",
      cta: (
        <Button size="sm" variant="primary" onClick={previewAsViewer}>
          <Eye aria-hidden="true" className="size-3.5" />
          Preview as Viewer
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Button>
      ),
    },
    {
      icon: Flame,
      eyebrow: "2 / 3 — Chaos engineering",
      title: "Chaos drill engine",
      body: "One click opens a real CRITICAL incident, fires a real notification to every subscribed integration, and drives a decaying spike through the live charts — a gameday exercise, not a canned animation. It's already on this page, in the header above the charts.",
      cta: (
        <Button size="sm" variant="primary" onClick={revealChaosButton}>
          <Flame aria-hidden="true" className="size-3.5" />
          Show me the button
        </Button>
      ),
    },
    {
      icon: SquareTerminal,
      eyebrow: "3 / 3 — Operations & transparency",
      title: "Live logs & the public status page",
      body: "A dark terminal tails this app's real structured logs over SSE, filterable and exportable. And the public status page needs no session at all — it's what an outside customer would actually see, redacted the way a real one would be.",
      cta: (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={openLogs}>
            <SquareTerminal aria-hidden="true" className="size-3.5" />
            Open live logs
          </Button>
          {/* A real link, not a button: it opens the public status page in a new
              tab, so `Button`'s `<button>` element (with no `href` to carry) is
              the wrong element for the job. Classes mirror `Button`'s own
              `secondary`/`sm` styling so it reads as part of the same set. */}
          <a
            href="/status/acme-corp"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-lg px-3",
              "border border-hairline bg-raised text-[13px] font-medium text-ink transition-colors",
              "hover:border-hairline-strong",
            )}
          >
            View public status page ↗
          </a>
        </div>
      ),
    },
  ];

  const current = steps[step];
  if (!current) return null;
  const isLast = step === steps.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-gradient-to-r from-brand to-s3 px-3 py-1.5 text-xs font-semibold text-brand-contrast shadow-[var(--shadow-card)] transition-opacity hover:opacity-90"
      >
        <Sparkles aria-hidden="true" className="size-3.5" />
        Quick Portfolio Tour
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Quick Portfolio Tour"
        subtitle="Three features worth the ninety seconds it takes to try them for real."
        widthClassName="max-w-md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={step === 0}
              onClick={() => setStep((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft aria-hidden="true" className="size-3.5" />
              Back
            </Button>

            <div className="flex items-center gap-1.5" aria-hidden="true">
              {steps.map((entry, index) => (
                <span
                  key={entry.title}
                  className={
                    index === step
                      ? "h-1.5 w-4 rounded-full bg-brand"
                      : "h-1.5 w-1.5 rounded-full bg-hairline-strong"
                  }
                />
              ))}
            </div>

            {isLast ? (
              <Button size="sm" variant="secondary" onClick={close}>
                Done
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setStep((value) => value + 1)}>
                Next
                <ChevronRight aria-hidden="true" className="size-3.5" />
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <current.icon aria-hidden="true" className="size-3.5 text-brand" />
            {current.eyebrow}
          </span>
          <h3 className="text-sm font-semibold text-ink">{current.title}</h3>
          <p className="text-sm leading-relaxed text-ink2">{current.body}</p>
          {current.cta}
        </div>
      </Modal>
    </>
  );
}
