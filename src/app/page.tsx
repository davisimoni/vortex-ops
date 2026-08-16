import { redirect } from "next/navigation";

import { readSession } from "@/server/session/context";

/**
 * The product has no marketing surface: signed in, the dashboard is the front
 * door; signed out, the sign-in page is.
 */
export default async function HomePage() {
  const session = await readSession();
  redirect(session ? "/dashboard" : "/sign-in");
}
