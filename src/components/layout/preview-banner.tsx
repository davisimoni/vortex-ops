"use client";

import { Eye } from "lucide-react";

import { useIsPreviewing } from "@/components/system/session-provider";
import { Button } from "@/components/ui/button";
import { ROLE_DEFINITIONS } from "@/lib/rbac";
import { usePreviewStore } from "@/store/session-store";

/**
 * Persistent banner while a role preview is active.
 *
 * Without it a viewer wonders why every button is disabled and files a bug. The
 * escape hatch is in the banner itself, not buried back on the team page. It
 * also says, explicitly, that this is a *preview* — the enforcement it is
 * showing lives on the server, not in this banner.
 */
export function PreviewBanner() {
  const previewing = useIsPreviewing();
  const previewRole = usePreviewStore((state) => state.previewRole);
  const setPreviewRole = usePreviewStore((state) => state.setPreviewRole);

  if (!previewing || previewRole === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warn/40 bg-warn/12 px-3 py-2 sm:px-5">
      <Eye aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
      <p className="min-w-0 text-xs text-ink">
        Previewing as <strong className="font-semibold">{ROLE_DEFINITIONS[previewRole].label}</strong>.
        This is a UI preview — every API request still runs under your real role and organisation.
      </p>
      <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setPreviewRole(null)}>
        Stop previewing
      </Button>
    </div>
  );
}
