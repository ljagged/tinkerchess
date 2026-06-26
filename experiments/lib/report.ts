// Tiny stats + formatting helpers for the experiment runners.

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Population standard deviation. */
export function stddev(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function fmt(n: number, d = 3): string {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

/** Game Refinement value GR = √B / D. */
export function gr(b: number, d: number): number {
  return Math.sqrt(b) / d;
}

/** Render a simple fixed-width table from rows of strings + a header. */
export function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}
