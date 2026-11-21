import type { Authority } from "./label.ts";
import { weakenedCount } from "./compare.ts";
import type { DiffReport, Item, Surface } from "./types.ts";

const itemLine = (item: Item): string => {
  const place = item.where === undefined ? "" : ` (${item.where})`;
  return `  ${item.change}: ${item.what}: ${item.before} -> ${item.after}${place}`;
};

function surfaceLines(surface: Surface): string[] {
  const moved = (change: Item["change"]): number =>
    surface.items.filter((item) => item.change === change).length;
  const counts = [
    `${String(surface.compared)} compared`,
    `${String(moved("weakened"))} weakened`,
    `${String(moved("strengthened"))} strengthened`,
    `${String(moved("changed"))} changed`,
  ];
  const head = `${surface.name}: ${counts.join(", ")}`;
  const note = surface.note === undefined ? [] : [`  note: ${surface.note}`];
  return [head, ...note, ...surface.items.map(itemLine)];
}

/** The text of the diff: every surface, with what was compared in it, and what moved. */
export function diffText(report: DiffReport, authority: Authority): string {
  const weakened = weakenedCount(report.surfaces);
  const result =
    weakened === 0
      ? "nothing weakened"
      : `${String(weakened)} weakened: ${authority.authorized ? "excused" : "not excused"}, ${authority.reason}`;
  const lines = [
    `law-diff ${report.base}..${report.head} (merge base ${report.mergeBase.slice(0, 12)})`,
    ...report.surfaces.flatMap(surfaceLines),
    "not compared:",
    ...report.notCompared.map((left) => `  ${left.what}: ${left.reason}`),
    result,
  ];
  return `${lines.join("\n")}\n`;
}

/** The diff as JSON: the report, the number weakened and whether the label excuses it. */
export function diffJson(report: DiffReport, authority: Authority): string {
  const weakened = weakenedCount(report.surfaces);
  return `${JSON.stringify({ ...report, weakened, excused: weakened > 0 && authority.authorized, authority }, null, 2)}\n`;
}

/** 0 when nothing weakened or the label excuses it, 1 when something weakened and nothing excuses it. */
export const diffExit = (report: DiffReport, authority: Authority): 0 | 1 =>
  weakenedCount(report.surfaces) === 0 || authority.authorized ? 0 : 1;
