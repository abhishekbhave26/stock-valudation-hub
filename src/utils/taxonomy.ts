// Shared helpers for the multi-value taxonomy fields (categories, regions).
//
// A stock's categories/regions are stored as string arrays in
// dcf_inputs.category / dcf_inputs.region. Older rows still hold a single
// string (the 20251107000000 migration seeded one category per stock), so
// every read goes through normalizeStringList — no data migration, the app
// keeps working with old rows as-is.

/** Normalize a stored category/region value to a clean string array.
 *  A single string becomes a one-element array; anything else that is not
 *  an array of strings becomes empty. Trims values, drops blanks, drops
 *  the old "N/A" placeholder (which means "no category"), and dedupes
 *  case-insensitively, keeping the first spelling seen. */
export function normalizeStringList(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  raw.forEach(item => {
    if (typeof item !== 'string') return;
    const trimmed = item.trim();
    if (!trimmed || trimmed.toUpperCase() === 'N/A') return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out;
}

/** The value a category/region sort uses: the alphabetically-first value,
 *  or '' when the stock has none. Documented here so the sort key is a
 *  deliberate choice, not an accident. */
export function firstSortedValue(values: string[]): string {
  if (values.length === 0) return '';
  return [...values].sort((a, b) => a.localeCompare(b))[0];
}
