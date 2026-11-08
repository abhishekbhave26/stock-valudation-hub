// Stock categories: a stock can have several.
//
// This is the seed/fallback list offered in the add/edit form multi-select,
// alongside a "create new" input for anything outside it. Keeping the list
// fixed (rather than free text) keeps naming consistent across the
// watchlist. These are also the seed values applied to the existing 67
// tickers by the 20251107000000_stock_categories migration (stored as a
// single string in dcf_inputs.category — the app normalizes that to a
// one-element array on read).
//
// Once migration 20251108000000_stock_taxonomies is applied, the
// stock_taxonomies registry is the source of truth for the dropdowns (see
// src/services/taxonomyService.ts and src/hooks/useTaxonomy.ts): the
// options are the registry names plus any name actually in use, so a
// renamed or merged-away name disappears for good. This list then only
// stands in when the registry is empty or the table does not exist yet.
export const STOCK_CATEGORIES: string[] = [
  'AI Semiconductors',
  'Semiconductors',
  'Big Tech',
  'Software & Cloud',
  'Cybersecurity',
  'Hardware & IT Infrastructure',
  'Fintech & Payments',
  'Banking & Finance',
  'Healthcare & Biotech',
  'Consumer & E-Commerce',
  'Communication & Media',
  'Energy',
  'Industrials',
  'Aerospace & Defense'
];
