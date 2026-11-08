// Stock categories: one primary category per stock.
//
// This is the fixed list offered in the add/edit form dropdown, alongside a
// "Create new category…" option for anything outside it. Keeping the list
// fixed (rather than free text) keeps naming consistent across the watchlist.
// These are also the seed values applied to the existing 67 tickers by the
// 20251107000000_stock_categories migration (stored in dcf_inputs.category).
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
