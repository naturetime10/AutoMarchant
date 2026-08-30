/** Renders one CSV line, quoting the cells that need it (RFC 4180). */
export function csvLine(values: unknown[]): string {
  return `${values.map(cell).join(",")}\n`;
}

function cell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
