import type { Metadata } from "next";

import { TeamView } from "@/components/team/team-view";

export const metadata: Metadata = {
  title: "Team & access",
  description:
    "Manage workspace members and role-based access control, with a simulator that applies each role across the whole product.",
};

export default function TeamPage() {
  return <TeamView />;
}
