import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Live system metrics: latency percentiles, CPU load, 5xx error rate and throughput.",
};

export default function DashboardPage() {
  return <DashboardView />;
}
