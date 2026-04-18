export function interpolateTemplate(template: string, vars: Record<string, string | number | undefined | null>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const val = v == null ? "" : String(v);
    out = out.replaceAll(`{${k}}`, val);
  }
  return out;
}
