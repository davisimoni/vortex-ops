import type { Metadata } from "next";

import { TopologyView } from "@/components/topology/topology-view";

export const metadata: Metadata = {
  title: "Service topology",
  description: "Interactive service dependency map, coloured live by open-incident health.",
};

export default function TopologyPage() {
  return <TopologyView />;
}
