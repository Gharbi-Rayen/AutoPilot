export interface OutputColumnSpec {
  source: "left" | "right";
  column: string;
  alias?: string;
}

export const projectRow = (
  merged: Record<string, unknown>,
  outputColumns: OutputColumnSpec[] | undefined,
): Record<string, unknown> => {
  if (!outputColumns?.length) return merged; // passthrough — no projection
  const result: Record<string, unknown> = {};
  for (const spec of outputColumns) {
    // right-side columns were prefixed during merge — match that convention
    const sourceKey =
      spec.source === "right" ? `right_${spec.column}` : spec.column;
    result[spec.alias || spec.column] = merged[sourceKey] ?? null;
  }
  return result;
};
