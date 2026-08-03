import type { Anchor } from "./regions";

export interface CalloutInput {
  regionId: string;
  anchor: Anchor;
}

export interface LaidOutCallout {
  regionId: string;
  /** Where the label is drawn, as a percentage of the body box. */
  leftPct: number;
  topPct: number;
  /** Where the region actually is, before any nudging. */
  anchorXPct: number;
  anchorYPct: number;
}

export interface LabelLayoutOptions {
  /** Approximate label width, as a percentage of the body box width. */
  labelWidthPct: number;
  /** Approximate label height, as a percentage of the body box height. */
  labelHeightPct: number;
  /** Percentage of the box a label may not cross at the top/bottom edge. */
  edgePaddingPct?: number;
  viewBox: { minX: number; minY: number; width: number; height: number };
}

const MAX_PASSES = 24;

interface Node {
  /** One entry, or two for a left/right pair that must stay level. */
  members: { regionId: string; xPct: number; anchorYPct: number }[];
  topPct: number;
  sortKey: number;
}

/** "bicep_left" -> "bicep"; anything else keeps its own id. */
function pairKey(regionId: string): string {
  return regionId.replace(/_(left|right)$/, "");
}

function collides(a: Node, b: Node, widthPct: number, heightPct: number): boolean {
  if (Math.abs(a.topPct - b.topPct) >= heightPct) {
    return false;
  }
  return a.members.some((am) => b.members.some((bm) => Math.abs(am.xPct - bm.xPct) < widthPct));
}

/**
 * Places a label directly on top of each region it labels.
 *
 * Labels start centred on their region's anchor, which is what makes the value
 * read as belonging to that muscle rather than to a column at the edge. Most
 * anchors are far enough apart to be left alone; the few that are not — the
 * neck/shoulders/chest cluster, and the hips sitting just above the thighs —
 * are pushed apart vertically, because the body is much taller than it is wide
 * so there is far more room to move up and down than sideways.
 *
 * Left/right pairs move together and always share a height. Resolving them
 * independently lets one thigh collide with the hips while the other does not,
 * which leaves a symmetric body wearing visibly lopsided labels.
 *
 * Pure: no DOM, no React, same input always gives the same output.
 */
export function layoutOnBodyLabels(
  items: CalloutInput[],
  options: LabelLayoutOptions,
): LaidOutCallout[] {
  const { labelWidthPct, labelHeightPct, edgePaddingPct = 0, viewBox } = options;

  const toPct = (item: CalloutInput) => ({
    regionId: item.regionId,
    xPct: ((item.anchor.x - viewBox.minX) / viewBox.width) * 100,
    anchorYPct: ((item.anchor.y - viewBox.minY) / viewBox.height) * 100,
  });

  // Group left/right pairs into a single node so they can never drift apart.
  const groups = new Map<string, ReturnType<typeof toPct>[]>();
  for (const item of items) {
    const key = pairKey(item.regionId);
    groups.set(key, [...(groups.get(key) ?? []), toPct(item)]);
  }

  const nodes: Node[] = [...groups.entries()]
    .map(([key, members]) => {
      // A pair shares the mean of its anchors; in practice they are equal.
      const topPct = members.reduce((sum, m) => sum + m.anchorYPct, 0) / members.length;
      return { members, topPct, sortKey: topPct, key };
    })
    // Resolve top-to-bottom so the outcome does not depend on input order.
    .sort((a, b) => a.sortKey - b.sortKey || (a.key < b.key ? -1 : 1))
    .map(({ members, topPct, sortKey }) => ({ members, topPct, sortKey }));

  const lowerBound = edgePaddingPct;
  const upperBound = 100 - edgePaddingPct;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];

        if (!collides(a, b, labelWidthPct, labelHeightPct)) {
          continue;
        }

        // `nodes` is sorted by anchor height, so `a` is the upper label.
        const push = (labelHeightPct - Math.abs(a.topPct - b.topPct)) / 2 + 0.01;
        a.topPct = Math.max(lowerBound, a.topPct - push);
        b.topPct = Math.min(upperBound, b.topPct + push);
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return nodes.flatMap((node) =>
    node.members.map((member) => ({
      regionId: member.regionId,
      leftPct: member.xPct,
      topPct: node.topPct,
      anchorXPct: member.xPct,
      anchorYPct: member.anchorYPct,
    })),
  );
}
