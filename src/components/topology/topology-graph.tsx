"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import { formatLatency, formatPercent } from "@/lib/format";
import { computeTopologyLayout, TOPOLOGY_EDGES, type TopologyNodeStatus } from "@/lib/topology";
import { cn } from "@/lib/utils";
import { SERVICES } from "@/lib/services";
import type { HealthTier } from "@/types";

/**
 * Hand-rolled node-link diagram, not a graph-layout library.
 *
 * The topology is a small, fixed DAG (six services, seven edges) — the kind
 * of graph a real layout engine is overkill for, and pulling one in would
 * cost real bundle size for a shape `computeTopologyLayout` already produces
 * in a few dozen lines. Nodes are plain HTML buttons, not SVG or a canvas
 * element, specifically so they stay real, focusable, hoverable controls
 * with their own accessible name — an `<svg>` node would need its own
 * from-scratch keyboard and screen-reader story. Only the connecting lines
 * are SVG, absolutely positioned underneath the buttons.
 */

const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 108;
const NODE_WIDTH = 172;
const NODE_HEIGHT = 76;
const MARGIN = 24;

const TIER_BORDER: Record<HealthTier, string> = {
  operational: "border-good/50 hover:border-good",
  degraded: "border-warn/60 hover:border-warn",
  partial: "border-serious/60 hover:border-serious",
  major: "border-crit/60 hover:border-crit",
};

const TIER_DOT: Record<HealthTier, string> = {
  operational: "bg-good",
  degraded: "bg-warn",
  partial: "bg-serious",
  major: "bg-crit",
};

interface NodeLayout extends TopologyNodeStatus {
  readonly x: number;
  readonly y: number;
}

export interface TopologyGraphProps {
  readonly statuses: readonly TopologyNodeStatus[];
  readonly selectedId: string | null;
  readonly onSelect: (serviceId: string) => void;
}

export function TopologyGraph({ statuses, selectedId, onSelect }: TopologyGraphProps) {
  const { nodes, width, height } = useMemo(() => {
    const layout = computeTopologyLayout(SERVICES);
    const byId = new Map(statuses.map((status) => [status.serviceId, status]));
    const maxLevel = layout.reduce((max, entry) => Math.max(max, entry.level), 0);
    const maxRows = layout.reduce((max, entry) => Math.max(max, entry.levelSize), 1);

    const canvasHeight = maxRows * ROW_HEIGHT;

    const positioned: NodeLayout[] = layout
      .map((position) => {
        const status = byId.get(position.serviceId);
        if (!status) return null;

        const columnHeight = position.levelSize * ROW_HEIGHT;
        const columnOffsetY = (canvasHeight - columnHeight) / 2;

        return {
          ...status,
          x: MARGIN + position.level * COLUMN_WIDTH + COLUMN_WIDTH / 2 - NODE_WIDTH / 2,
          y: MARGIN + columnOffsetY + position.indexInLevel * ROW_HEIGHT + ROW_HEIGHT / 2 - NODE_HEIGHT / 2,
        };
      })
      .filter((entry): entry is NodeLayout => entry !== null);

    return {
      nodes: positioned,
      width: MARGIN * 2 + (maxLevel + 1) * COLUMN_WIDTH,
      height: MARGIN * 2 + canvasHeight,
    };
  }, [statuses]);

  const nodeById = new Map(nodes.map((node) => [node.serviceId, node]));

  return (
    <div className="overflow-x-auto rounded-xl border border-hairline bg-raised/30 p-2">
      <div className="relative" style={{ width, height }}>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
        >
          {TOPOLOGY_EDGES.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;

            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_HEIGHT / 2;
            const midX = (x1 + x2) / 2;

            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--hairline-strong)"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
          const selected = node.serviceId === selectedId;
          return (
            <button
              key={node.serviceId}
              type="button"
              onClick={() => onSelect(node.serviceId)}
              aria-pressed={selected}
              title={`${node.name} — ${formatLatency(node.latencyMsEstimate)} p95, ${formatPercent(node.errorRatePctEstimate)} error rate${node.openIncidentCount > 0 ? `, ${node.openIncidentCount} open incident${node.openIncidentCount === 1 ? "" : "s"}` : ""}`}
              className={cn(
                "absolute flex flex-col justify-center gap-1 rounded-xl border-2 bg-surface px-3 py-2 text-left shadow-sm transition-colors",
                TIER_BORDER[node.health],
                selected && "ring-2 ring-brand ring-offset-2 ring-offset-plane",
              )}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TIER_DOT[node.health])} />
                <span className="truncate text-sm font-medium text-ink">{node.name}</span>
                {node.openIncidentCount > 0 ? (
                  <AlertTriangle aria-hidden="true" className="size-3 shrink-0 text-crit" />
                ) : null}
              </span>
              <span className="tabular text-[11px] text-muted">
                {formatLatency(node.latencyMsEstimate)} p95 · {formatPercent(node.errorRatePctEstimate)} err
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
