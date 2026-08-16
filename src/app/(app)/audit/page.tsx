import type { Metadata } from "next";

import { AuditComplianceView } from "@/components/compliance/audit-compliance-view";

export const metadata: Metadata = {
  title: "Audit & compliance",
  description:
    "Immediate CSV or JSON export of the incident register, SLA attainment and audit trail, plus the full append-only log of every action taken in this organisation.",
};

export default function AuditPage() {
  return <AuditComplianceView />;
}
