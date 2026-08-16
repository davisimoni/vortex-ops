import { redirect } from "next/navigation";

/**
 * The product has no marketing surface: the dashboard is the front door,
 * full stop. `(app)/layout.tsx`'s gate provisions a real demo session for
 * anyone arriving with none — there is no session state to branch on here.
 */
export default function HomePage() {
  redirect("/dashboard");
}
