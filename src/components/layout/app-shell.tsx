"use client";

import { useState, type ReactNode } from "react";

import { PreviewBanner } from "@/components/layout/preview-banner";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { LiveEngine } from "@/components/system/live-engine";
import { Toaster } from "@/components/ui/toaster";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-plane">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <PreviewBanner />

        <main id="main" className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </main>
      </div>

      <LiveEngine />
      <Toaster />
    </div>
  );
}
