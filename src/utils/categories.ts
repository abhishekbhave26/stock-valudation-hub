// Stock categories: one primary category per stock.
//
// Categories are free text — the user can type any category in the add/edit
// form — but these suggestions keep naming consistent across the watchlist.
// They are also the seed values applied to the existing 67 tickers by the
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
