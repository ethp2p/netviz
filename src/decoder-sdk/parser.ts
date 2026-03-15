export function parseNdjson(lines: string[]): {
  header: Record<string, unknown>;
  eventLines: string[];
  footer: Record<string, unknown> | null;
} {
  if (lines.length < 2) throw new Error('Trace file too short');
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch {
    throw new Error('Trace header is not valid JSON');
  }
  let footer: Record<string, unknown> | null = null;
  let end = lines.length;
  try {
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    if (last['end'] === true) { footer = last; end = lines.length - 1; }
  } catch { /* no footer */ }
  return { header, eventLines: lines.slice(1, end), footer };
}

interface LineParser {
  parse(line: string): number;
  num(idx: number): number;
  str(idx: number): string;
}

function createLineParser(): LineParser {
  let fields: unknown[] = [];
  return {
    parse(line: string): number {
      try { fields = JSON.parse(line) as unknown[]; } catch { fields = []; } // safe: parse failure yields empty fields
      return fields.length;
    },
    num(idx: number): number { return fields[idx] as number; },
    str(idx: number): string { return fields[idx] as string; },
  };
}
