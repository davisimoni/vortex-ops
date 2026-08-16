import type { Metadata } from "next";

import { IncidentsView } from "@/components/incidents/incidents-view";

export const metadata: Metadata = {
  title: "Incidents",
  description:
    "Threshold alerting and incident response: assign responders and drive the investigating → identified → monitoring → resolved lifecycle.",
};

export default function IncidentsPage() {
  return <IncidentsView />;
}
