import type { Metadata } from "next";

import { IntegrationsView } from "@/components/integrations/integrations-view";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Configure Slack, PagerDuty, email and custom webhook destinations, with signed payloads and server-side test delivery.",
};

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
