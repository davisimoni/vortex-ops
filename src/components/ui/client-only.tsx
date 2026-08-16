"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Nothing ever changes, so the subscribe callback never fires. Defined at module
 * scope because `useSyncExternalStore` re-subscribes whenever this identity
 * changes — an inline arrow would resubscribe on every render.
 */
const subscribe = (): (() => void) => () => {};

const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

/**
 * `true` once the component is running in the browser.
 *
 * Implemented with `useSyncExternalStore` rather than a `useEffect` that calls
 * `setState`: React uses the server snapshot for the hydration render and the
 * client snapshot afterwards, which is exactly the "did we hydrate yet" signal
 * — without the extra cascading render the effect version causes.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

/**
 * Defers rendering until after hydration.
 *
 * Everything live in this app — generated series, "4 min ago", the health score
 * — depends on the current clock, which differs between the server render and
 * the browser's. Rendering those on the server guarantees a hydration mismatch,
 * so they wait for the client instead.
 *
 * `fallback` should reserve the same space as the real content: a placeholder
 * that collapses causes a layout jump the moment data lands.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  return <>{useMounted() ? children : fallback}</>;
}
